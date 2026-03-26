'use strict';

/**
 * column.js
 *
 * Knex column builder helpers shared across all field-level operations.
 *
 * Having these in one place means:
 *   - The type → knex method mapping is never duplicated
 *   - AlterField reuses the same logic as AddField, with `.alter()` appended
 *   - FK constraint attachment is explicit and separated from column creation
 *
 * Exports:
 *   applyColumn(t, name, def)            — add a new column to a table builder
 *   alterColumn(t, name, def)            — modify an existing column (.alter())
 *   attachFKConstraints(db, table, fields) — attach FK constraints via ALTER TABLE
 *                                           after all tables in a migration exist
 */

// ─── Core column builder ──────────────────────────────────────────────────────

/**
 * Add a single column to a knex table builder.
 *
 * Handles all supported field types, nullability, uniqueness, defaults,
 * and inline FK constraints (references).
 *
 * Pass `{ ...def, references: null }` to suppress FK constraint creation
 * when deferring constraints to a later ALTER TABLE pass.
 *
 * @param {object} t     — knex table builder (from createTable / table callback)
 * @param {string} name  — column name
 * @param {object} def   — normalised field definition from ProjectState.normaliseField()
 */
function applyColumn(t, name, def) {
  const col = _buildColumn(t, name, def);
  if (!col) return; // 'id' handled internally by _buildColumn

  _applyModifiers(col, def);
}

/**
 * Modify an existing column in a knex alterTable builder.
 * Identical to applyColumn but appends `.alter()` — required by knex to
 * signal that this is a column modification, not a new column addition.
 *
 * Note: FK constraints are NOT altered here — use attachFKConstraints()
 * to manage them separately. Most DBs require DROP CONSTRAINT + re-add
 * for FK changes, which is safer to do explicitly.
 *
 * @param {object} t     — knex table builder (from alterTable callback)
 * @param {string} name  — column name
 * @param {object} def   — normalised field definition
 */
function alterColumn(t, name, def) {
  const col = _buildColumn(t, name, def, { forAlter: true });
  if (!col) return;

  _applyModifiers(col, def, { skipFK: true }); // FKs not altered inline
  col.alter();
}

/**
 * Attach FK constraints for a set of fields on a table.
 *
 * Called by MigrationRunner AFTER all tables in a migration have been
 * created — this guarantees all referenced tables exist.
 *
 * All FK columns for a given table are batched into a single ALTER TABLE
 * statement, not one per column.
 *
 * @param {import('knex').Knex} db
 * @param {string}  table   — table name
 * @param {object}  fields  — { columnName: normalisedDef, ... }
 */
async function attachFKConstraints(db, table, fields) {
  const fkEntries = Object.entries(fields).filter(([, def]) => def.references);

  if (fkEntries.length === 0) return;

  await db.schema.alterTable(table, (t) => {
    for (const [name, def] of fkEntries) {
      const ref = def.references;
      t.foreign(name)
       .references(ref.column)
       .inTable(ref.table)
       .onDelete(ref.onDelete || 'CASCADE');
    }
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a knex column builder for a given field type.
 * Returns null for 'id' fields (handled by t.increments which returns void).
 *
 * @param {object}  t
 * @param {string}  name
 * @param {object}  def
 * @param {object}  [opts]
 * @param {boolean} [opts.forAlter] — if true, skip t.increments (can't alter PK)
 * @returns {object|null} knex column builder
 */
function _buildColumn(t, name, def, opts = {}) {
  switch (def.type) {
    case 'id':
      if (!opts.forAlter) t.increments(name).primary();
      return null; // increments() doesn't return a chainable column builder

    case 'string':
    case 'email':
    case 'url':
    case 'slug':
    case 'ipAddress':
      return t.string(name, def.max || 255);

    case 'text':
      return t.text(name);

    case 'integer':
      return def.unsigned
        ? t.integer(name).unsigned()
        : t.integer(name);

    case 'bigInteger':
      return def.unsigned
        ? t.bigInteger(name).unsigned()
        : t.bigInteger(name);

    case 'float':
      return t.float(name);

    case 'decimal':
      return t.decimal(name, def.precision || 8, def.scale || 2);

    case 'boolean':
      return t.boolean(name);

    case 'json':
      return t.json(name);

    case 'date':
      return t.date(name);

    case 'timestamp':
      return t.timestamp(name, { useTz: false });

    case 'enum':
      return t.enu(name, def.enumValues || []);

    case 'uuid':
      return t.uuid(name);

    default:
      return t.string(name); // safe fallback
  }
}

/**
 * Apply nullability, uniqueness, default, and FK constraint modifiers
 * to an already-built knex column builder.
 *
 * @param {object}  col           — knex column builder
 * @param {object}  def           — normalised field def
 * @param {object}  [opts]
 * @param {boolean} [opts.skipFK] — skip FK constraint (used by alterColumn)
 */
function _applyModifiers(col, def, opts = {}) {
  // Nullability
  if (def.nullable) {
    col.nullable();
  } else if (def.type !== 'id') {
    col.notNullable();
  }

  // Uniqueness
  if (def.unique) col.unique();

  // Default value
  if (def.default !== null && def.default !== undefined) {
    col.defaultTo(def.default);
  }

  // Inline FK constraint — skipped when deferring to attachFKConstraints()
  if (!opts.skipFK && def.references) {
    const ref = def.references;
    col
      .references(ref.column)
      .inTable(ref.table)
      .onDelete(ref.onDelete || 'CASCADE');
  }
}

module.exports = { applyColumn, alterColumn, attachFKConstraints };