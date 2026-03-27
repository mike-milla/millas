'use strict';

const { BaseOperation }              = require('./base');
const { applyColumn, alterColumn }   = require('./column');
const { normaliseField }             = require('../ProjectState');
const { resolveDefault }             = require('../DefaultValueParser');

/**
 * fields.js
 *
 * Column-level migration operations:
 *   AddField     — add a new column (with optional safe backfill for NOT NULL)
 *   RemoveField  — drop a column
 *   AlterField   — modify a column definition
 *   RenameField  — rename a column
 *
 * Key improvement over the old Operations.js:
 *   AlterField no longer duplicates the type→knex switch. It delegates to
 *   alterColumn() from column.js — one place for all column-building logic.
 */

// ─── AddField ─────────────────────────────────────────────────────────────────

class AddField extends BaseOperation {
  /**
   * @param {string}   table
   * @param {string}   column
   * @param {object}   field          — FieldDefinition or normalised plain object
   * @param {object}   [oneOffDefault] — backfill descriptor for existing rows.
   *   NOT part of the model schema — only lives in this migration file.
   *   Shape: { kind: 'literal', value } | { kind: 'callable', expression }
   *   Legacy: plain primitive (backward compat)
   */
  constructor(table, column, field, oneOffDefault = undefined) {
    super();
    this.type          = 'AddField';
    this.table         = table;
    this.column        = column;
    this.field         = field;
    this.oneOffDefault = oneOffDefault;
  }

  applyState(state) {
    state.addField(this.table, this.column, this.field);
  }

  async up(db) {
    const def         = normaliseField(this.field);
    const hasBackfill = this.oneOffDefault !== undefined && this.oneOffDefault !== null;
    const needsSafe   = hasBackfill && !def.nullable && def.default === null;

    if (needsSafe) {
      await this._safeBackfill(db, def);
    } else {
      await db.schema.table(this.table, (t) => {
        applyColumn(t, this.column, def, this.table);
      });
    }
  }

  async down(db) {
    await db.schema.table(this.table, (t) => {
      t.dropColumn(this.column);
    });
  }

  toJSON() {
    const j = {
      type:   'AddField',
      table:  this.table,
      column: this.column,
      field:  this.field,
    };
    if (this.oneOffDefault !== undefined) j.oneOffDefault = this.oneOffDefault;
    return j;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Three-step safe backfill for adding a NOT NULL column to a non-empty table.
   *
   * Step 1 — Add column as nullable so existing rows don't immediately
   *           violate the NOT NULL constraint.
   * Step 2 — Backfill existing rows with the one-off default value.
   *           Callable defaults (uuid, timestamp) are invoked per row so
   *           each row gets its own unique value.
   *           Literal defaults are applied in a single bulk UPDATE.
   * Step 3 — Tighten the column to NOT NULL now that all rows have a value.
   */
  async _safeBackfill(db, def) {
    const resolved   = resolveDefault(this.oneOffDefault);
    const isCallable = typeof resolved === 'function';

    // Step 1: add as nullable
    await db.schema.table(this.table, (t) => {
      applyColumn(t, this.column, { ...def, nullable: true, default: null }, this.table);
    });

    // Step 2: backfill
    if (isCallable) {
      // Callable — fetch PKs and update each row individually
      const rows = await db(this.table).whereNull(this.column).select('id');
      for (const row of rows) {
        await db(this.table)
          .where('id', row.id)
          .update({ [this.column]: resolved() });
      }
    } else {
      // Literal — single bulk UPDATE
      await db(this.table)
        .whereNull(this.column)
        .update({ [this.column]: resolved });
    }

    // Step 3: tighten to NOT NULL
    await db.schema.alterTable(this.table, (t) => {
      alterColumn(t, this.column, { ...def, nullable: false }, this.table);
    });
  }
}

// ─── RemoveField ──────────────────────────────────────────────────────────────

class RemoveField extends BaseOperation {
  /**
   * @param {string} table
   * @param {string} column
   * @param {object} field  — kept for down() reconstruction
   */
  constructor(table, column, field) {
    super();
    this.type   = 'RemoveField';
    this.table  = table;
    this.column = column;
    this.field  = field;
  }

  applyState(state) {
    state.removeField(this.table, this.column);
  }

  async up(db) {
    await db.schema.table(this.table, (t) => {
      t.dropColumn(this.column);
    });
  }

  async down(db) {
    await db.schema.table(this.table, (t) => {
      applyColumn(t, this.column, normaliseField(this.field), this.table);
    });
  }

  toJSON() {
    return {
      type:   'RemoveField',
      table:  this.table,
      column: this.column,
      field:  this.field,
    };
  }
}

// ─── AlterField ───────────────────────────────────────────────────────────────

class AlterField extends BaseOperation {
  /**
   * @param {string} table
   * @param {string} column
   * @param {object} field         — new field definition
   * @param {object} previousField — old field definition (for down())
   */
  constructor(table, column, field, previousField) {
    super();
    this.type          = 'AlterField';
    this.table         = table;
    this.column        = column;
    this.field         = field;
    this.previousField = previousField;
  }

  applyState(state) {
    state.alterField(this.table, this.column, this.field);
  }

  async up(db) {
    await db.schema.alterTable(this.table, (t) => {
      alterColumn(t, this.column, normaliseField(this.field), this.table);
    });
  }

  async down(db) {
    await db.schema.alterTable(this.table, (t) => {
      alterColumn(t, this.column, normaliseField(this.previousField), this.table);
    });
  }

  toJSON() {
    return {
      type:          'AlterField',
      table:         this.table,
      column:        this.column,
      field:         this.field,
      previousField: this.previousField,
    };
  }
}

// ─── RenameField ──────────────────────────────────────────────────────────────

class RenameField extends BaseOperation {
  /**
   * @param {string} table
   * @param {string} oldColumn
   * @param {string} newColumn
   */
  constructor(table, oldColumn, newColumn) {
    super();
    this.type      = 'RenameField';
    this.table     = table;
    this.oldColumn = oldColumn;
    this.newColumn = newColumn;
  }

  applyState(state) {
    state.renameField(this.table, this.oldColumn, this.newColumn);
  }

  async up(db) {
    await db.schema.table(this.table, (t) => {
      t.renameColumn(this.oldColumn, this.newColumn);
    });
  }

  async down(db) {
    await db.schema.table(this.table, (t) => {
      t.renameColumn(this.newColumn, this.oldColumn);
    });
  }

  toJSON() {
    return {
      type:      'RenameField',
      table:     this.table,
      oldColumn: this.oldColumn,
      newColumn: this.newColumn,
    };
  }
}

module.exports = { AddField, RemoveField, AlterField, RenameField };