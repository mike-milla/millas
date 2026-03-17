'use strict';

const { FieldDefinition } = require('../fields');

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
      this._applyFields(t, fields, ModelClass);
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

  _applyFields(tableBuilder, fields, ModelClass) {
    for (const [name, field] of Object.entries(fields)) {
      this._applyField(tableBuilder, name, field, ModelClass);
    }
  }

  _applyField(t, name, field) {
    let col;

    switch (field.type) {
      case 'id':
        t.increments(name);
        return;

      case 'string':
        col = t.string(name, field.max || 255);
        break;

      case 'text':
        col = t.text(name);
        break;

      case 'integer':
        col = field.unsigned ? t.integer(name).unsigned() : t.integer(name);
        break;

      case 'bigInteger':
        col = field.unsigned ? t.bigInteger(name).unsigned() : t.bigInteger(name);
        break;

      case 'float':
        col = t.float(name);
        break;

      case 'decimal':
        col = t.decimal(name, field.precision || 8, field.scale || 2);
        break;

      case 'boolean':
        col = t.boolean(name);
        break;

      case 'json':
        col = t.json(name);
        break;

      case 'date':
        col = t.date(name);
        break;

      case 'timestamp':
        col = t.timestamp(name, { useTz: false });
        break;

      case 'enum':
        col = t.enum(name, field.enumValues || []);
        break;

      case 'uuid':
        col = t.uuid(name);
        break;

      default:
        col = t.string(name);
    }

    if (!col) return;

    if (field.nullable)               col = col.nullable();
    else if (field.type !== 'id')     col = col.notNullable();

    if (field.unique)                 col = col.unique();

    if (field.default !== undefined)  col = col.defaultTo(field.default);

    if (field.references) {
      col = col.references(field.references.column)
                .inTable(field.references.table)
                .onDelete('CASCADE');
    }
  }
}

module.exports = SchemaBuilder;
