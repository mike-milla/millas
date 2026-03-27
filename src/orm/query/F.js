'use strict';

/**
 * F — column reference expression
 *
 * Allows referencing model field values in queries without pulling them
 * into Python/JS first. Matches Django's F() expression exactly.
 *
 * Usage:
 *   const { F } = require('millas/core/db');
 *
 *   // Atomic increment — no race condition
 *   await Post.where('id', 1).update({ views: F('views').add(1) });
 *
 *   // Compare two columns
 *   await Product.where(F('sale_price').lt(F('cost_price'))).get();
 *
 *   // Order by expression
 *   await Post.orderByF(F('updated_at').desc()).get();
 *
 *   // Arithmetic
 *   F('price').multiply(1.1)   // price * 1.1
 *   F('stock').subtract(qty)   // stock - qty
 */
class F {
  constructor(column) {
    this._column = column;
    this._ops    = []; // [{ op, value }]
  }

  // ── Arithmetic ─────────────────────────────────────────────────────────────

  add(value)      { return this._op('+', value); }
  subtract(value) { return this._op('-', value); }
  multiply(value) { return this._op('*', value); }
  divide(value)   { return this._op('/', value); }

  // ── Ordering ───────────────────────────────────────────────────────────────

  asc()  { this._order = 'asc';  return this; }
  desc() { this._order = 'desc'; return this; }

  // ── Comparison (for use in where()) ───────────────────────────────────────

  eq(value)  { return this._compare('=',  value); }
  ne(value)  { return this._compare('!=', value); }
  gt(value)  { return this._compare('>',  value); }
  gte(value) { return this._compare('>=', value); }
  lt(value)  { return this._compare('<',  value); }
  lte(value) { return this._compare('<=', value); }

  // ── SQL rendering ──────────────────────────────────────────────────────────

  /**
   * Render this F expression to a knex raw SQL fragment.
   * @param {object} knexClient — knex client instance (for raw())
   * @returns {object} knex raw expression
   */
  toKnex(knexClient) {
    let sql = this._quoteCol(this._column);

    for (const { op, value } of this._ops) {
      if (value instanceof F) {
        sql = `(${sql} ${op} ${value._buildSQL()})`;
      } else {
        sql = `(${sql} ${op} ${typeof value === 'string' ? `'${value}'` : value})`;
      }
    }

    return knexClient.raw(sql);
  }

  _buildSQL() {
    let sql = this._quoteCol(this._column);
    for (const { op, value } of this._ops) {
      const v = value instanceof F ? value._buildSQL() : (typeof value === 'string' ? `'${value}'` : value);
      sql = `(${sql} ${op} ${v})`;
    }
    return sql;
  }

  _quoteCol(col) {
    // Handle table.column notation
    return col.includes('.') ? col.split('.').map(p => `"${p}"`).join('.') : `"${col}"`;
  }

  _op(op, value) {
    const clone = new F(this._column);
    clone._ops  = [...this._ops, { op, value }];
    return clone;
  }

  _compare(op, value) {
    return { _isF: true, _fExpr: this, _op: op, _value: value };
  }
}

module.exports = F;
