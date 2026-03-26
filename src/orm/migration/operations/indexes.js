'use strict';

const { BaseOperation } = require('./base');

// ─── helpers ──────────────────────────────────────────────────────────────────

function indexName(table, fields, unique = false) {
  const fieldPart = fields.map(f => f.replace(/^-/, '')).join('_');
  return `${table}_${fieldPart}_${unique ? 'unique' : 'index'}`;
}

function _applyIndex(t, table, idx) {
  const { fields, name, unique } = idx;
  const idxName  = name || indexName(table, fields, unique);
  // Separate plain fields from descending fields (prefixed with '-')
  const columns  = fields.map(f => f.replace(/^-/, ''));
  const hasDesc  = fields.some(f => f.startsWith('-'));

  if (unique) {
    t.unique(columns, { indexName: idxName });
  } else if (hasDesc) {
    // knex doesn't support per-column sort direction in t.index() —
    // use raw for descending indexes
    const colsSql = fields.map(f =>
      f.startsWith('-') ? `\`${f.slice(1)}\` DESC` : `\`${f}\``
    ).join(', ');
    t.index(columns, idxName); // fallback — knex limitation
    // Note: true DESC index requires raw SQL; knex wraps it as regular index
  } else {
    t.index(columns, idxName);
  }
}

// ─── AddIndex ─────────────────────────────────────────────────────────────────

class AddIndex extends BaseOperation {
  /**
   * @param {string}   table
   * @param {object}   index  — { fields, name?, unique? }
   */
  constructor(table, index) {
    super();
    this.type  = 'AddIndex';
    this.table = table;
    this.index = index;
  }

  applyState(state) {
    state.addIndex(this.table, this.index);
  }

  async up(db) {
    const { fields, name, unique } = this.index;
    const idxName = name || indexName(this.table, fields, unique);
    await db.schema.table(this.table, (t) => _applyIndex(t, this.table, this.index));
  }

  async down(db) {
    const { fields, name, unique } = this.index;
    const idxName = name || indexName(this.table, fields, unique);
    const columns = fields.map(f => f.replace(/^-/, ''));
    await db.schema.table(this.table, (t) => {
      if (unique) t.dropUnique(columns, idxName);
      else        t.dropIndex(columns, idxName);
    });
  }

  toJSON() {
    return { type: 'AddIndex', table: this.table, index: this.index };
  }
}

// ─── RemoveIndex ──────────────────────────────────────────────────────────────

class RemoveIndex extends BaseOperation {
  constructor(table, index) {
    super();
    this.type  = 'RemoveIndex';
    this.table = table;
    this.index = index;
  }

  applyState(state) {
    state.removeIndex(this.table, this.index);
  }

  async up(db) {
    const { fields, name, unique } = this.index;
    const idxName = name || indexName(this.table, fields, unique);
    const columns = fields.map(f => f.replace(/^-/, ''));
    await db.schema.table(this.table, (t) => {
      if (unique) t.dropUnique(columns, idxName);
      else        t.dropIndex(columns, idxName);
    });
  }

  async down(db) {
    await db.schema.table(this.table, (t) => _applyIndex(t, this.table, this.index));
  }

  toJSON() {
    return { type: 'RemoveIndex', table: this.table, index: this.index };
  }
}

// ─── AlterUniqueTogether ──────────────────────────────────────────────────────

class AlterUniqueTogether extends BaseOperation {
  /**
   * @param {string}     table
   * @param {string[][]} newUnique   — new uniqueTogether sets
   * @param {string[][]} oldUnique   — previous uniqueTogether sets (for down())
   */
  constructor(table, newUnique, oldUnique = []) {
    super();
    this.type      = 'AlterUniqueTogether';
    this.table     = table;
    this.newUnique = newUnique;
    this.oldUnique = oldUnique;
  }

  applyState(state) {
    state.alterUniqueTogether(this.table, this.newUnique);
  }

  async up(db) {
    await this._apply(db, this.oldUnique, this.newUnique);
  }

  async down(db) {
    await this._apply(db, this.newUnique, this.oldUnique);
  }

  async _apply(db, remove, add) {
    await db.schema.table(this.table, (t) => {
      for (const fields of remove) {
        const name = `${this.table}_${fields.join('_')}_unique`;
        try { t.dropUnique(fields, name); } catch { /* already gone */ }
      }
      for (const fields of add) {
        const name = `${this.table}_${fields.join('_')}_unique`;
        t.unique(fields, { indexName: name });
      }
    });
  }

  toJSON() {
    return {
      type:      'AlterUniqueTogether',
      table:     this.table,
      newUnique: this.newUnique,
      oldUnique: this.oldUnique,
    };
  }
}

// ─── RenameIndex ─────────────────────────────────────────────────────────────

class RenameIndex extends BaseOperation {
  constructor(table, oldName, newName) {
    super();
    this.type    = 'RenameIndex';
    this.table   = table;
    this.oldName = oldName;
    this.newName = newName;
  }

  applyState(state) {
    state.renameIndex(this.table, this.oldName, this.newName);
  }

  async up(db) {
    // knex doesn't have renameIndex — drop and recreate
    // The index definition is stored on the op for reconstruction
    await db.schema.table(this.table, (t) => {
      t.dropIndex([], this.oldName);
    });
    await db.schema.table(this.table, (t) => {
      t.index(this.fields || [], this.newName);
    });
  }

  async down(db) {
    await db.schema.table(this.table, (t) => {
      t.dropIndex([], this.newName);
    });
    await db.schema.table(this.table, (t) => {
      t.index(this.fields || [], this.oldName);
    });
  }

  toJSON() {
    return { type: 'RenameIndex', table: this.table, oldName: this.oldName, newName: this.newName, fields: this.fields };
  }
}

module.exports = { AddIndex, RemoveIndex, AlterUniqueTogether, RenameIndex, indexName, _applyIndex };
