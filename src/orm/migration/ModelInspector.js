'use strict';

const fs = require('fs-extra');
const path = require('path');
const MillasLog = require('../../logger/internal');
const { walkJs, extractClasses, isMillasModel, fieldsEqual } = require('./utils');
const { normaliseField } = require('./ProjectState');

/**
 * ModelInspector
 *
 * Implements `millas makemigrations` — Django-style auto-migration generation.
 *
 * Workflow:
 *   1. Scan app/models/ for Model subclasses that have static `fields`
 *   2. Load the last known schema snapshot (.millas/schema.json)
 *   3. Diff current fields vs snapshot
 *   4. Generate timestamped migration file(s) for each detected change
 *   5. Update the snapshot so the next run starts clean
 *
 * Detects:
 *   - New tables   (model file added)
 *   - Dropped tables (model file removed)
 *   - Added columns
 *   - Removed columns
 *   - Changed column attributes (type, nullable, unique, default, …)
 *
 * Developers only touch model files — never migration files directly.
 */
class ModelInspector {
    constructor(modelsPath, migrationsPath, snapshotPath) {
        this._modelsPath = modelsPath;
        this._migrationsPath = migrationsPath;
        this._snapshotPath = snapshotPath || path.join(process.cwd(), '.millas', 'schema.json');
    }

    /**
     * The baseline schema that each system migration creates.
     * Keyed by table name → field definitions (same shape as _extractFields output).
     *
     * When makemigrations encounters a system-owned table for the first time
     * (no snapshot entry yet), it seeds the snapshot from this baseline rather
     * than from the current model. That ensures any fields the developer added
     * beyond the baseline are detected as add_column diffs — not silently ignored.
     *
     * Keep in sync with src/migrations/system/000*.js.
     */
    static get SYSTEM_BASELINES() {
        // Lazy-load AuthUser so this file has no hard dependency at module load time.
        // The getter is only called during makeMigrations(), never at require() time.
        const AuthUser = require('../../auth/AuthUser');
        const { fields } = require('../fields/index');

        const extractFields = (fieldsMap) => {
            const result = {};
            for (const [name, field] of Object.entries(fieldsMap)) {
                result[name] = {
                    type:       field.type        ?? 'string',
                    nullable:   field.nullable     ?? false,
                    unique:     field.unique        ?? false,
                    default:    field.default !== undefined ? field.default : null,
                    max:        field.max          ?? null,
                    unsigned:   field.unsigned      ?? false,
                    enumValues: field.enumValues    ?? null,
                    references: field.references    ?? null,
                    precision:  field.precision     ?? null,
                    scale:      field.scale         ?? null,
                };
            }
            return result;
        };

        return {
            // system/0001_users.js — mirrors AuthUser.fields exactly
            users: extractFields(AuthUser.fields),

            // system/0002_admin_log.js
            millas_admin_log: extractFields({
                id:         fields.id(),
                user_id:    fields.integer({ unsigned: true, nullable: true }),
                user_email: fields.string({ nullable: true }),
                resource:   fields.string(),
                record_id:  fields.string({ nullable: true }),
                action:     fields.enum(['create', 'update', 'delete']),
                label:      fields.string({ nullable: true }),
                change_msg: fields.text({ nullable: true }),
                created_at: fields.timestamp(),
            }),

            // system/0003_sessions.js
            millas_sessions: extractFields({
                session_key: fields.string({ max: 64 }),
                user_id:     fields.integer({ unsigned: true }),
                payload:     fields.text({ nullable: true }),
                ip_address:  fields.string({ max: 45, nullable: true }),
                user_agent:  fields.string({ max: 512, nullable: true }),
                expires_at:  fields.timestamp(),
                created_at:  fields.timestamp(),
            }),

            // millas_migrations — internal tracking table, not user-accessible
            millas_migrations: extractFields({
                id:    fields.id(),
                name:  fields.string(),
                pool:  fields.string({ max: 20 }),
                batch: fields.integer(),
            }),
        };
    }

    /** Convenience: just the set of system table names. */
    static get SYSTEM_TABLES() {
        return new Set(Object.keys(ModelInspector.SYSTEM_BASELINES));
    }

    /**
     * Detect changes and generate migration files.
     * Returns { files: string[], message: string }
     */
    async makeMigrations() {
        const current = this._scanModels();
        const snapshot = this._loadSnapshot();
        const diffs = this._diff(current, snapshot);

        if (diffs.length === 0) {
            return {files: [], message: 'No changes detected.'};
        }

        await fs.ensureDir(this._migrationsPath);

        // All diffs in this run share the same timestamp prefix so they sort
        // together and apply as a logical group.
        const ts = this._timestamp();
        const files = [];

        for (const diff of diffs) {
            const file = await this._generateMigration(diff, ts);
            if (file) files.push(file);
        }

        // Persist the new baseline — must happen AFTER generating files so
        // a crash mid-generation doesn't advance the snapshot prematurely.
        this._saveSnapshot(current);

        return {files, message: `Generated ${files.length} migration file(s).`};
    }

    // ─── Model scanning ───────────────────────────────────────────────────────

    /**
     * Walk app/models/ and return a plain-object schema map:
     *   { tableName: { columnName: { type, nullable, … }, … }, … }
     *
     * Handles both default exports (`module.exports = MyModel`) and
     * named exports (`module.exports = { MyModel }`).
     */
    _scanModels() {
        const schema = {};
        const tableToFile = {}; // track which file owns each table name

        if (!fs.existsSync(this._modelsPath)) return schema;

        const files = walkJs(this._modelsPath);

        for (const fullPath of files) {
            const file = path.basename(fullPath);
            const relPath = path.relative(this._modelsPath, fullPath);

            // Always bust require cache so the inspector picks up edits made
            // in the same process (e.g. during tests).
            try {
                delete require.cache[require.resolve(fullPath)];
            } catch { /* path not yet cached — fine */ }

            let exported;
            try {
                exported = require(fullPath);
            } catch (err) {
                // Surface require errors so developers know why a model was skipped.
                // Common causes: missing dependency, syntax error, bad import path.
                MillasLog.warn(`[makemigrations] Skipping ${path.relative(this._modelsPath, fullPath)}: ${err.message}`);
                process.stderr.write(`  ⚠  Could not load model: ${path.relative(this._modelsPath, fullPath)}\n     ${err.message}\n`);
                continue;
            }

            // Collect every candidate class from the export
            const candidates = extractClasses(exported);

            for (const ModelClass of candidates) {
                if (!isMillasModel(ModelClass)) continue;

                const table = this._resolveTable(ModelClass, file);

                if (tableToFile[table] && tableToFile[table] !== relPath) {
                    // Same table claimed by two files.
                    // This is the inheritance pattern: User extends BaseUser, same table.
                    // Keep the one with MORE fields — that's always the most derived class,
                    // which has the complete column set for the table.
                    const existingFieldCount = Object.keys(schema[table] || {}).length;
                    const newFieldCount      = Object.keys(ModelClass.fields || {}).length;

                    if (newFieldCount > existingFieldCount) {
                        // New class is more derived — replace
                        tableToFile[table] = relPath;
                        schema[table] = this._extractFields(ModelClass.fields);
                    }
                    // Otherwise keep the existing (more derived) definition silently.
                    // No warning — this is expected when extending a base model.
                } else if (!tableToFile[table]) {
                    tableToFile[table] = relPath;
                    schema[table] = this._extractFields(ModelClass.fields);
                }
            }
        }

        return schema;
    }

    /**
     * Recursively collect all .js files under a directory,
     * excluding dotfiles and index.js at any depth.
     */


    /**
     * Derive the table name from the model class.
     * Delegates to utils.resolveTable which respects abstract flag and convention.
     * fileName fallback kept for backward compat with old snapshot entries.
     */
    _resolveTable(ModelClass, fileName) {
        return resolveTable(ModelClass) ||
          (fileName ? fileName.replace(/\.js$/, '').toLowerCase() + 's' : null);
    }

    /**
     * Convert a fields map (whose values may be FieldDefinition instances or
     * plain objects) into a stable plain-object representation suitable for
     * snapshot storage and deterministic JSON comparison.
     */
    _extractFields(fields) {
        // Delegate to normaliseField — single source of truth for field shape.
        const result = {};
        for (const [name, field] of Object.entries(fields)) {
            result[name] = normaliseField(field);
        }
        return result;
    }

    // ─── Diffing ──────────────────────────────────────────────────────────────

    _diff(current, snapshot) {
        const diffs = [];

        // New tables (model added / first run)
        for (const table of Object.keys(current)) {
            if (!snapshot[table]) {
                if (ModelInspector.SYSTEM_TABLES.has(table)) {
                    // System table — already created by a system migration.
                    // Seed the snapshot from the KNOWN SYSTEM BASELINE (what the
                    // migration actually created), NOT from the current model.
                    // This ensures any extra fields the developer added beyond the
                    // baseline are detected as add_column diffs below.
                    snapshot[table] = ModelInspector.SYSTEM_BASELINES[table] || current[table];
                } else {
                    diffs.push({type: 'create_table', table, fields: current[table]});
                }
            }
        }

        // Dropped tables (model file removed)
        // Never generate drop_table for system tables — they are managed by
        // system migrations, not by user model files.
        for (const table of Object.keys(snapshot)) {
            if (!current[table] && !ModelInspector.SYSTEM_TABLES.has(table)) {
                diffs.push({type: 'drop_table', table, fields: snapshot[table]});
            }
        }

        // Column-level changes on existing tables
        for (const table of Object.keys(current)) {
            if (!snapshot[table]) continue; // handled above as create_table

            const curr = current[table];
            const prev = snapshot[table];

            // Added columns
            for (const col of Object.keys(curr)) {
                if (!prev[col]) {
                    diffs.push({type: 'add_column', table, column: col, field: curr[col]});
                }
            }

            // Removed columns
            for (const col of Object.keys(prev)) {
                if (!curr[col]) {
                    diffs.push({type: 'drop_column', table, column: col, field: prev[col]});
                }
            }

            // Changed columns — compare each attribute individually for stability
            for (const col of Object.keys(curr)) {
                if (!prev[col]) continue; // new column — already handled above
                if (!fieldsEqual(curr[col], prev[col])) {
                    diffs.push({
                        type: 'alter_column',
                        table,
                        column: col,
                        field: curr[col],
                        previous: prev[col],
                    });
                }
            }
        }

        return diffs;
    }

    /**
     * Stable field equality check that ignores key-ordering differences
     * which can appear when objects are reconstituted from JSON.
     */


    // ─── Migration generation ─────────────────────────────────────────────────

    async _generateMigration(diff, ts) {
        const name = this._diffToName(diff);
        const fileName = `${ts}_${name}.js`;
        const filePath = path.join(this._migrationsPath, fileName);

        const content = this._renderMigration(diff, name);
        await fs.writeFile(filePath, content, 'utf8');
        return fileName;
    }

    _diffToName(diff) {
        switch (diff.type) {
            case 'create_table':
                return `create_${diff.table}_table`;
            case 'drop_table':
                return `drop_${diff.table}_table`;
            case 'add_column':
                return `add_${diff.column}_to_${diff.table}`;
            case 'drop_column':
                return `remove_${diff.column}_from_${diff.table}`;
            case 'alter_column':
                return `alter_${diff.column}_on_${diff.table}`;
            default:
                return `auto_migration`;
        }
    }

    _renderMigration(diff, name) {
        switch (diff.type) {

            case 'create_table':
                return `'use strict';

/**
 * Auto-generated migration: ${name}
 * Created by: millas makemigrations
 *
 * DO NOT EDIT — changes to your model will generate a new migration.
 */
module.exports = {
  async up(db) {
    await db.schema.createTable('${diff.table}', (t) => {
${this._renderColumns(diff.fields)}    });
  },

  async down(db) {
    await db.schema.dropTableIfExists('${diff.table}');
  },
};
`;

            case 'drop_table':
                return `'use strict';

/**
 * Auto-generated migration: ${name}
 * Created by: millas makemigrations
 */
module.exports = {
  async up(db) {
    await db.schema.dropTableIfExists('${diff.table}');
  },

  async down(db) {
    // Restore the table — regenerate by reverting the model deletion
    // and running: millas makemigrations
    await db.schema.createTable('${diff.table}', (t) => {
${this._renderColumns(diff.fields || {})}    });
  },
};
`;

            case 'add_column':
                return `'use strict';

/**
 * Auto-generated migration: ${name}
 * Created by: millas makemigrations
 */
module.exports = {
  async up(db) {
    await db.schema.table('${diff.table}', (t) => {
${this._renderColumn('      ', diff.column, diff.field)}
    });
  },

  async down(db) {
    await db.schema.table('${diff.table}', (t) => {
      t.dropColumn('${diff.column}');
    });
  },
};
`;

            case 'drop_column':
                return `'use strict';

/**
 * Auto-generated migration: ${name}
 * Created by: millas makemigrations
 */
module.exports = {
  async up(db) {
    await db.schema.table('${diff.table}', (t) => {
      t.dropColumn('${diff.column}');
    });
  },

  async down(db) {
    await db.schema.table('${diff.table}', (t) => {
${this._renderColumn('      ', diff.column, diff.field)}
    });
  },
};
`;

            case 'alter_column':
                return `'use strict';

/**
 * Auto-generated migration: ${name}
 * Created by: millas makemigrations
 * Changed: ${JSON.stringify(diff.previous)} → ${JSON.stringify(diff.field)}
 */
module.exports = {
  async up(db) {
    await db.schema.table('${diff.table}', (t) => {
${this._renderColumn('      ', diff.column, diff.field, '.alter()')}
    });
  },

  async down(db) {
    await db.schema.table('${diff.table}', (t) => {
${this._renderColumn('      ', diff.column, diff.previous, '.alter()')}
    });
  },
};
`;

            default:
                return `'use strict';\nmodule.exports = { async up(db) {}, async down(db) {} };\n`;
        }
    }

    _renderColumns(fields) {
        if (!fields || Object.keys(fields).length === 0) {
            return '      t.increments(\'id\');\n      t.timestamps();\n';
        }
        return Object.entries(fields)
            .map(([name, field]) => this._renderColumn('      ', name, field))
            .join('\n') + '\n';
    }

    _renderColumn(indent, name, field, suffix = '') {
        let line;

        switch (field.type) {
            case 'id':
                return `${indent}t.increments('${name}')${suffix};`;

            case 'string':
            case 'email':
            case 'url':
            case 'slug':
            case 'ipAddress':
                line = `t.string('${name}', ${field.max || 255})`;
                break;

            case 'text':
                line = `t.text('${name}')`;
                break;

            case 'integer':
                line = field.unsigned
                    ? `t.integer('${name}').unsigned()`
                    : `t.integer('${name}')`;
                break;

            case 'bigInteger':
                line = field.unsigned
                    ? `t.bigInteger('${name}').unsigned()`
                    : `t.bigInteger('${name}')`;
                break;

            case 'float':
                line = `t.float('${name}')`;
                break;

            case 'decimal':
                line = `t.decimal('${name}', ${field.precision || 8}, ${field.scale || 2})`;
                break;

            case 'boolean':
                line = `t.boolean('${name}')`;
                break;

            case 'json':
                line = `t.json('${name}')`;
                break;

            case 'array':
                line = `t.specificType('${name}', '${field.arrayOf || 'text'}[]')`;
                break;

            case 'date':
                line = `t.date('${name}')`;
                break;

            case 'timestamp':
                line = `t.timestamp('${name}', { useTz: false })`;
                break;

            case 'enum':
                line = `t.enum('${name}', ${JSON.stringify(field.enumValues || [])})`;
                break;

            case 'uuid':
                line = `t.uuid('${name}')`;
                break;

            default:
                line = `t.string('${name}')`;
        }

        if (field.nullable) line += '.nullable()';
        else if (field.type !== 'id') line += '.notNullable()';

        if (field.unique) line += '.unique()';

        if (field.default !== null && field.default !== undefined) {
            line += `.defaultTo(${JSON.stringify(field.default)})`;
        }

        if (field.references) {
            line += `.references('${field.references.column}')` +
                `.inTable('${field.references.table}')` +
                `.onDelete('CASCADE')`;
        }

        return `${indent}${line}${suffix};`;
    }

    // ─── Snapshot ─────────────────────────────────────────────────────────────

    _loadSnapshot() {
        try {
            return fs.readJsonSync(this._snapshotPath);
        } catch {
            return {};
        }
    }

    _saveSnapshot(schema) {
        fs.ensureDirSync(path.dirname(this._snapshotPath));
        fs.writeJsonSync(this._snapshotPath, schema, {spaces: 2});
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    _timestamp() {
        return new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
    }
}

module.exports = ModelInspector;