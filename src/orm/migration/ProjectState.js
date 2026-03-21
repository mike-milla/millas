'use strict';

const { tableFromClass, modelNameToTable, isSnakeCase } = require('./utils');

/**
 * ProjectState
 *
 * An in-memory representation of the full database schema at a given point
 * in migration history. Built by replaying migration operations in order.
 *
 * This is the Django-equivalent of ProjectState / ModelState.
 * It is NEVER derived from the live database — only from migration files.
 *
 * Shape:
 *   state.models = Map<tableName, ModelState>
 *
 * ModelState:
 *   { table, fields: Map<columnName, FieldState>, meta: {} }
 *
 * FieldState (plain object, serialisable):
 *   { type, nullable, unique, default, max, unsigned, enumValues,
 *     references, precision, scale }
 */
class ProjectState {
  constructor() {
    // Map<table, { table, fields: Map<name, fieldState> }>
    this.models = new Map();
  }

  // ─── Mutation (called by operations during replay) ────────────────────────

  createModel(table, fields) {
    if (this.models.has(table)) {
      throw new Error(`ProjectState: table "${table}" already exists`);
    }
    const fieldMap = new Map();
    for (const [name, def] of Object.entries(fields)) {
      fieldMap.set(name, normaliseField(def));
    }
    this.models.set(table, { table, fields: fieldMap });
  }

  deleteModel(table) {
    this.models.delete(table);
  }

  addField(table, column, fieldDef) {
    const model = this._requireModel(table);
    if (model.fields.has(column)) {
      throw new Error(`ProjectState: column "${column}" already exists on "${table}"`);
    }
    model.fields.set(column, normaliseField(fieldDef));
  }

  removeField(table, column) {
    const model = this._requireModel(table);
    model.fields.delete(column);
  }

  alterField(table, column, fieldDef) {
    const model = this._requireModel(table);
    model.fields.set(column, normaliseField(fieldDef));
  }

  renameField(table, oldColumn, newColumn) {
    const model  = this._requireModel(table);
    const def    = model.fields.get(oldColumn);
    if (!def) throw new Error(`ProjectState: column "${oldColumn}" not found on "${table}"`);
    model.fields.delete(oldColumn);
    model.fields.set(newColumn, def);
  }

  renameModel(oldTable, newTable) {
    const model = this._requireModel(oldTable);
    this.models.delete(oldTable);
    model.table = newTable;
    this.models.set(newTable, model);
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  hasTable(table) {
    return this.models.has(table);
  }

  getFields(table) {
    return this._requireModel(table).fields;
  }

  /** Return a plain-object snapshot of the full state (for diffing). */
  toSchema() {
    const schema = {};
    for (const [table, model] of this.models) {
      schema[table] = {};
      for (const [col, def] of model.fields) {
        schema[table][col] = { ...def };
      }
    }
    return schema;
  }

  /** Deep clone — used to capture state at a point in time. */
  clone() {
    const copy = new ProjectState();
    for (const [table, model] of this.models) {
      const fieldMap = new Map();
      for (const [col, def] of model.fields) {
        fieldMap.set(col, { ...def });
      }
      copy.models.set(table, { table, fields: fieldMap });
    }
    return copy;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _requireModel(table) {
    const m = this.models.get(table);
    if (!m) throw new Error(`ProjectState: table "${table}" not found`);
    return m;
  }
}

/**
 * Normalise a field definition (FieldDefinition instance or plain object)
 * into a stable plain object for storage in ProjectState.
 *
 * Handles both:
 *   - Legacy foreignId() / raw references object  → references: { table, column, onDelete }
 *   - Modern ForeignKey() / OneToOne()            → _isForeignKey + _fkModel* resolved here
 *
 * For ForeignKey fields, the target table is resolved eagerly from _fkModel so that
 * the migration system can diff and generate FK constraints correctly.
 */
function normaliseField(def) {
  if (!def) return { type: 'string', nullable: false, unique: false, default: null, max: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null };
  const type = def.type ?? 'string';
  const precision = def.precision ?? (type === 'decimal' ? 8 : null);
  const scale     = def.scale     ?? (type === 'decimal' ? 2 : null);

  // ── Resolve modern ForeignKey / OneToOne references ───────────────────────
  // fields.ForeignKey() stores metadata in _isForeignKey + _fkModel* rather
  // than the legacy `references` plain object. Resolve that here so all
  // downstream code (Operations, SchemaBuilder, MigrationWriter) sees a
  // uniform `references: { table, column, onDelete }` shape.
  let references = def.references ?? null;
  if (def._isForeignKey && !references) {
    const targetTable = _resolveTargetTable(def._fkModel, def._fkModelRef);
    if (targetTable) {
      references = {
        table:    targetTable,
        column:   def._fkToField ?? 'id',
        onDelete: def._fkOnDelete ?? 'CASCADE',
      };
    }
  }

  return {
    type,
    nullable:        def.nullable    ?? false,
    unique:          def.unique       ?? false,
    default:         def.default !== undefined ? def.default : null,
    max:             def.max         ?? null,
    unsigned:        def.unsigned     ?? false,
    enumValues:      def.enumValues   ?? null,
    references,
    precision,
    scale,
    // Preserve FK metadata so MigrationWriter can render fields.ForeignKey(...)
    // instead of a bare fields.integer(...). Stripped from plain objects (migration files).
    _isForeignKey:   def._isForeignKey  ?? false,
    _isOneToOne:     def._isOneToOne    ?? false,
    _fkOnDelete:     def._fkOnDelete    ?? null,
    _fkRelatedName:  def._fkRelatedName ?? null,
  };
}

/**
 * Resolve a _fkModel / _fkModelRef pair to a table name string.
 *
 * _fkModel may be:
 *   - A Model class (has static .table)
 *   - A string model name like 'User' or 'self'
 *   - null / undefined
 *
 * _fkModelRef is a lazy () => ModelClass resolver generated by _makeModelRef().
 */
/**
 * Resolve a _fkModel / _fkModelRef pair to a table name string.
 * Delegates to tableFromClass / modelNameToTable from utils.js.
 */
function _resolveTargetTable(fkModel, fkModelRef) {
  if (fkModel && typeof fkModel === 'function') {
    const table = tableFromClass(fkModel);
    if (table) return table;
  }
  if (typeof fkModelRef === 'function') {
    try {
      const resolved = fkModelRef();
      if (resolved) {
        const table = tableFromClass(resolved);
        if (table) return table;
      }
    } catch { /* unresolvable at scan time */ }
  }
  if (typeof fkModel === 'string' && fkModel !== 'self') {
    return isSnakeCase(fkModel) ? fkModel : modelNameToTable(fkModel);
  }
  return null;
}


module.exports = { ProjectState, normaliseField };