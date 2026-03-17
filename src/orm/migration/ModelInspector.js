'use strict';

const fs = require('fs-extra');
const path = require('path');
const MillasLog = require('../../logger/internal');

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

        if (!fs.existsSync(this._modelsPath)) return schema;

        const files = fs.readdirSync(this._modelsPath)
            .filter(f => f.endsWith('.js') && !f.startsWith('.') && f !== 'index.js');

        for (const file of files) {
            const fullPath = path.join(this._modelsPath, file);

            // Always bust require cache so the inspector picks up edits made
            // in the same process (e.g. during tests).
            try {
                delete require.cache[require.resolve(fullPath)];
            } catch { /* path not yet cached — fine */
            }

            let exported;
            exported = require(fullPath);


            // Collect every candidate class from the export
            const candidates = this._extractClasses(exported);

            for (const ModelClass of candidates) {
                if (!this._isMillasModel(ModelClass)) continue;

                const table = this._resolveTable(ModelClass, file);
                schema[table] = this._extractFields(ModelClass.fields);
            }
        }

        return schema;
    }

    /**
     * Given a module export (class, plain object, or anything), return an
     * array of class/function values that might be Model subclasses.
     */
    _extractClasses(exported) {
        if (!exported) return [];

        // Direct class export:  module.exports = MyModel
        if (typeof exported === 'function') return [exported];

        // Named export object:  module.exports = { MyModel, AnotherModel }
        if (typeof exported === 'object') {
            return Object.values(exported).filter(v => typeof v === 'function');
        }

        return [];
    }

    /**
     * A class qualifies as a Millas Model if:
     *   - It is a function (class)
     *   - It has a static `fields` property that is a non-null object
     *
     * We intentionally do NOT do `instanceof` checks so the inspector
     * works even when the user imports Model from a different resolution
     * path than the one this file was loaded from.
     */
    _isMillasModel(cls) {
        if (typeof cls !== 'function') return false;
        if (!cls.fields || typeof cls.fields !== 'object') return false;
        // Must have at least one field
        return Object.keys(cls.fields).length > 0;
    }

    /**
     * Derive the table name from the model class or fall back to the file name.
     */
    _resolveTable(ModelClass, fileName) {
        // Explicitly set static table = '...'
        if (typeof ModelClass.table === 'string' && ModelClass.table) {
            return ModelClass.table;
        }
        // Convention: file name without extension, pluralised, lowercased
        return fileName.replace(/\.js$/, '').toLowerCase() + 's';
    }

    /**
     * Convert a fields map (whose values may be FieldDefinition instances or
     * plain objects) into a stable plain-object representation suitable for
     * snapshot storage and deterministic JSON comparison.
     */
    _extractFields(fields) {
        const result = {};

        for (const [name, field] of Object.entries(fields)) {
            // Normalise — accept both FieldDefinition instances and plain objects
            result[name] = {
                type: field.type ?? 'string',
                nullable: field.nullable ?? false,
                unique: field.unique ?? false,
                default: field.default !== undefined ? field.default : null,
                max: field.max ?? null,
                unsigned: field.unsigned ?? false,
                enumValues: field.enumValues ?? null,
                references: field.references ?? null,
                precision: field.precision ?? null,
                scale: field.scale ?? null,
            };
        }

        return result;
    }

    // ─── Diffing ──────────────────────────────────────────────────────────────

    _diff(current, snapshot) {
        const diffs = [];

        // New tables (model added / first run)
        for (const table of Object.keys(current)) {
            if (!snapshot[table]) {
                diffs.push({type: 'create_table', table, fields: current[table]});
            }
        }

        // Dropped tables (model file removed)
        for (const table of Object.keys(snapshot)) {
            if (!current[table]) {
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
                if (!this._fieldsEqual(curr[col], prev[col])) {
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
    _fieldsEqual(a, b) {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const k of keys) {
            if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
        }
        return true;
    }

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
