'use strict';

const { applyColumn } = require('./operations/column');
const { normaliseField } = require('./ProjectState');

/**
 * SchemaBuilder
 *
 * Converts Model.fields definitions into knex schema operations.
 * Used by the migration system (Phase 6) and DatabaseServiceProvider.
 *
 * Usage:
 *   const sb = new SchemaBuilder(db);
 *   await sb.createFromModel(User);
 *   await sb.dropTable('users');
 *   await sb.tableExists('users');
 */
class SchemaBuilder {
  constructor(knexConnection) {
    this._db = knexConnection;
  }

  /**
   * Create a table from a Model class's static fields definition.
   */
  async createFromModel(ModelClass) {
    const table  = ModelClass.table;
    const fields = ModelClass.fields;

    await this._db.schema.createTable(table, (t) => {
      this._applyFields(t, fields);
    });
  }

  /**
   * Create table only if it doesn't exist.
   */
  async createFromModelIfNotExists(ModelClass) {
    const exists = await this.tableExists(ModelClass.table);
    if (!exists) await this.createFromModel(ModelClass);
  }

  /**
   * Drop a table.
   */
  async dropTable(tableName) {
    await this._db.schema.dropTableIfExists(tableName);
  }

  /**
   * Check whether a table exists.
   */
  async tableExists(tableName) {
    return this._db.schema.hasTable(tableName);
  }

  /**
   * Add a column to an existing table.
   */
  async addColumn(tableName, columnName, fieldDef) {
    await this._db.schema.table(tableName, (t) => {
      this._applyField(t, columnName, fieldDef);
    });
  }

  /**
   * Drop a column from a table.
   */
  async dropColumn(tableName, columnName) {
    await this._db.schema.table(tableName, (t) => {
      t.dropColumn(columnName);
    });
  }

  /**
   * Rename a table.
   */
  async renameTable(from, to) {
    await this._db.schema.renameTable(from, to);
  }

  /**
   * Return the raw knex schema builder for advanced use.
   */
  get schema() {
    return this._db.schema;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  // Delegates to operations/column.js applyColumn — single source of truth
  // for the type → knex column builder mapping.
  _applyFields(tableBuilder, fields) {
    for (const [name, field] of Object.entries(fields)) {
      applyColumn(tableBuilder, name, normaliseField(field));
    }
  }
}

module.exports = SchemaBuilder;