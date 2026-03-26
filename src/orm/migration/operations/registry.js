'use strict';

const { CreateModel, DeleteModel, RenameModel } = require('./models');
const { AddField, RemoveField, AlterField, RenameField } = require('./fields');
const { AddIndex, RemoveIndex, AlterUniqueTogether, RenameIndex } = require('./indexes');
const { RunSQL } = require('./special');
const { modelNameToTable, isSnakeCase } = require('../utils');

/**
 * registry.js
 *
 * Two responsibilities:
 *
 * 1. deserialise(op)
 *    Converts a plain JSON descriptor (loaded from a migration file) back
 *    into a live operation instance. Used by MigrationGraph.loadAll().
 *
 * 2. migrations proxy
 *    The named-argument API used inside generated migration files:
 *
 *      const { migrations, fields } = require('millas/core/db');
 *      static operations = [
 *        migrations.CreateModel({ name: 'posts', fields: [...] }),
 *        migrations.AddField({ modelName: 'posts', name: 'slug', field: fields.string() }),
 *      ];
 *
 *    Each proxy method returns a PLAIN DESCRIPTOR OBJECT — no live instances,
 *    no side-effects at require() time. MigrationGraph feeds these through
 *    deserialise() when it needs live operation objects.
 *
 *    _tableFromName() handles the legacy PascalCase → snake_case conversion
 *    for any hand-written migrations that used model names instead of table names.
 */

// ─── Deserialise ──────────────────────────────────────────────────────────────

/**
 * Convert a plain operation descriptor into a live operation instance.
 *
 * @param {object} op — plain descriptor with a `type` field
 * @returns {BaseOperation}
 * @throws {Error} if op.type is unrecognised
 */
function deserialise(op) {
  switch (op.type) {
    case 'CreateModel':  return new CreateModel(op.table, op.fields, op.indexes || [], op.uniqueTogether || []);
    case 'DeleteModel':  return new DeleteModel(op.table, op.fields);
    case 'RenameModel':  return new RenameModel(op.oldTable, op.newTable);
    case 'AddField':     return new AddField(op.table, op.column, op.field, op.oneOffDefault);
    case 'RemoveField':  return new RemoveField(op.table, op.column, op.field);
    case 'AlterField':   return new AlterField(op.table, op.column, op.field, op.previousField);
    case 'RenameField':  return new RenameField(op.table, op.oldColumn, op.newColumn);
    case 'AddIndex':            return new AddIndex(op.table, op.index);
    case 'RemoveIndex':         return new RemoveIndex(op.table, op.index);
    case 'RenameIndex':         return new RenameIndex(op.table, op.oldName, op.newName);
    case 'AlterUniqueTogether': return new AlterUniqueTogether(op.table, op.newUnique, op.oldUnique);
    case 'RunSQL':       return new RunSQL(op.sql, op.reverseSql);
    default:
      throw new Error(`Unknown migration operation type: "${op.type}"`);
  }
}

// ─── migrations proxy ─────────────────────────────────────────────────────────

/**
 * Named-argument API used in generated migration files.
 * Returns plain descriptor objects — zero side-effects at require() time.
 */
const migrations = {

  CreateModel({ name, fields: fieldList = [], indexes = [], uniqueTogether = [] }) {
    const fields = {};
    for (const [col, def] of fieldList) fields[col] = def;
    return { type: 'CreateModel', table: _tableFromName(name), fields, indexes, uniqueTogether };
  },

  DeleteModel({ name, fields: fieldList = [] }) {
    const fields = {};
    for (const [col, def] of (fieldList || [])) fields[col] = def;
    return { type: 'DeleteModel', table: _tableFromName(name), fields };
  },

  RenameModel({ oldName, newName }) {
    return {
      type:     'RenameModel',
      oldTable: _tableFromName(oldName),
      newTable: _tableFromName(newName),
    };
  },

  AddField({ modelName, name, field, oneOffDefault }) {
    const d = { type: 'AddField', table: modelName, column: name, field };
    if (oneOffDefault !== undefined) d.oneOffDefault = oneOffDefault;
    return d;
  },

  RemoveField({ modelName, name, field }) {
    return { type: 'RemoveField', table: modelName, column: name, field };
  },

  AlterField({ modelName, name, field, previousField }) {
    return { type: 'AlterField', table: modelName, column: name, field, previousField };
  },

  RenameField({ modelName, oldName, newName }) {
    return { type: 'RenameField', table: modelName, oldColumn: oldName, newColumn: newName };
  },

  AddIndex({ modelName, index }) {
    return { type: 'AddIndex', table: modelName, index };
  },

  RemoveIndex({ modelName, index }) {
    return { type: 'RemoveIndex', table: modelName, index };
  },

  RenameIndex({ modelName, oldName, newName }) {
    return { type: 'RenameIndex', table: modelName, oldName, newName };
  },

  AlterUniqueTogether({ modelName, newUnique, oldUnique = [] }) {
    return { type: 'AlterUniqueTogether', table: modelName, newUnique, oldUnique };
  },

  RunSQL({ sql, reverseSql = null }) {
    return { type: 'RunSQL', sql, reverseSql };
  },

};

// ─── _tableFromName ───────────────────────────────────────────────────────────

/**
 * Resolve a migration file `name:` field to a table name.
 *
 * MigrationWriter now writes the actual table name directly
 * (e.g. name: 'landlord_verification') so this is an identity function
 * for all newly generated migrations.
 *
 * Kept for backward compatibility with hand-written migrations that used
 * PascalCase model names (e.g. name: 'Post') — those get converted to
 * snake_case plural table names.
 *
 * @param {string} name
 * @returns {string} table name
 */
function _tableFromName(name) {
  // Already snake_case → return as-is. PascalCase → convert via utils.
  return isSnakeCase(name) ? name : modelNameToTable(name);
}

module.exports = { deserialise, migrations, _tableFromName };