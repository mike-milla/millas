'use strict';

const { BaseOperation }                        = require('./base');
const { applyColumn, attachFKConstraints }     = require('./column');
const { normaliseField }                       = require('../ProjectState');

/**
 * models.js
 *
 * Table-level migration operations:
 *   CreateModel  — CREATE TABLE
 *   DeleteModel  — DROP TABLE
 *   RenameModel  — RENAME TABLE
 *
 * FK constraint strategy (CreateModel):
 *   MigrationRunner calls upWithoutFKs() for every CreateModel in a migration
 *   first, then calls applyFKConstraints() for each — so all tables exist
 *   before any constraint is attached. This handles any ordering and circular
 *   references without extra DB round-trips per column.
 *
 *   up() still creates with inline FKs for the single-CreateModel case
 *   (e.g. AddField to an existing schema) where ordering is never an issue.
 */

// ─── CreateModel ──────────────────────────────────────────────────────────────

class CreateModel extends BaseOperation {
  /**
   * @param {string} table
   * @param {object} fields  — { columnName: normalisedFieldDef }
   * @param {Array}  [indexes]
   * @param {Array}  [uniqueTogether]
   */
  constructor(table, fields, indexes = [], uniqueTogether = []) {
    super();
    this.type          = 'CreateModel';
    this.table         = table;
    this.fields        = fields;
    this.indexes       = indexes;
    this.uniqueTogether = uniqueTogether;
  }

  applyState(state) {
    state.createModel(this.table, this.fields, this.indexes, this.uniqueTogether);
  }

  // Standard up() — inline FKs. Safe when only one CreateModel in a migration.
  async up(db) {
    await db.schema.createTable(this.table, (t) => {
      for (const [name, def] of Object.entries(this.fields)) {
        applyColumn(t, name, normaliseField(def));
      }
    });
    await this._applyIndexes(db);
  }

  /**
   * Create the table with FK columns as plain integers (no constraints).
   * Called by MigrationRunner phase 1 when a migration has multiple CreateModel ops.
   */
  async upWithoutFKs(db) {
    await db.schema.createTable(this.table, (t) => {
      for (const [name, def] of Object.entries(this.fields)) {
        applyColumn(t, name, { ...normaliseField(def), references: null });
      }
    });
    await this._applyIndexes(db);
  }

  /**
   * Attach all FK constraints for this table in a single ALTER TABLE.
   * Called by MigrationRunner phase 2, after all tables exist.
   */
  async applyFKConstraints(db) {
    const normalisedFields = Object.fromEntries(
      Object.entries(this.fields).map(([name, def]) => [name, normaliseField(def)])
    );
    await attachFKConstraints(db, this.table, normalisedFields);
  }

  async down(db) {
    await db.schema.dropTableIfExists(this.table);
  }

  async _applyIndexes(db) {
    const { indexName } = require('./indexes');
    const all = [
      ...(this.indexes || []),
    ];
    const ut = this.uniqueTogether || [];
    if (!all.length && !ut.length) return;
    await db.schema.table(this.table, (t) => {
      for (const idx of all) {
        const name = idx.name || indexName(this.table, idx.fields, idx.unique);
        if (idx.unique) t.unique(idx.fields, { indexName: name });
        else            t.index(idx.fields, name);
      }
      for (const fields of ut) {
        const name = `${this.table}_${fields.join('_')}_unique`;
        t.unique(fields, { indexName: name });
      }
    });
  }

  toJSON() {
    return { type: 'CreateModel', table: this.table, fields: this.fields, indexes: this.indexes, uniqueTogether: this.uniqueTogether };
  }
}

// ─── DeleteModel ──────────────────────────────────────────────────────────────

class DeleteModel extends BaseOperation {
  /**
   * @param {string} table
   * @param {object} fields — kept for down() reconstruction only
   */
  constructor(table, fields) {
    super();
    this.type   = 'DeleteModel';
    this.table  = table;
    this.fields = fields;
  }

  applyState(state) {
    state.deleteModel(this.table);
  }

  async up(db) {
    await db.schema.dropTableIfExists(this.table);
  }

  // Reconstruct table on rollback. FK constraints included — the table
  // being restored was previously fully formed.
  async down(db) {
    await db.schema.createTable(this.table, (t) => {
      for (const [name, def] of Object.entries(this.fields)) {
        applyColumn(t, name, normaliseField(def));
      }
    });
  }

  toJSON() {
    return { type: 'DeleteModel', table: this.table, fields: this.fields };
  }
}

// ─── RenameModel ──────────────────────────────────────────────────────────────

class RenameModel extends BaseOperation {
  /**
   * @param {string} oldTable
   * @param {string} newTable
   */
  constructor(oldTable, newTable) {
    super();
    this.type     = 'RenameModel';
    this.oldTable = oldTable;
    this.newTable = newTable;
  }

  applyState(state) {
    state.renameModel(this.oldTable, this.newTable);
  }

  async up(db) {
    await db.schema.renameTable(this.oldTable, this.newTable);
  }

  async down(db) {
    await db.schema.renameTable(this.newTable, this.oldTable);
  }

  toJSON() {
    return { type: 'RenameModel', oldTable: this.oldTable, newTable: this.newTable };
  }
}

module.exports = { CreateModel, DeleteModel, RenameModel };