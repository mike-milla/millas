'use strict';

const LookupParser = require('./LookupParser');

/**
 * Q — complex boolean query objects
 *
 * Lets you express any combination of AND / OR / NOT conditions,
 * including deeply nested groups, in a single readable expression.
 *
 * Usage:
 *   const { Q } = require('millas');
 *
 *   // OR
 *   User.filter(Q({ age__gte: 18 }).or(Q({ role: 'admin' })))
 *
 *   // AND (default when chaining .where())
 *   User.filter(Q({ city: 'Nairobi' }).and(Q({ active: true })))
 *
 *   // NOT
 *   User.filter(Q({ status: 'banned' }).not())
 *
 *   // Nested
 *   User.filter(
 *     Q({ role: 'admin' }).or(
 *       Q({ age__gte: 18 }).and(Q({ active: true }))
 *     )
 *   )
 *
 *   // Shorthand operators
 *   Q({ age__gte: 18 }).or({ role: 'admin' })
 */
class Q {
  /**
   * @param {object} conditions  — plain { field: value } or { field__lookup: value }
   */
  constructor(conditions = {}) {
    this._conditions = conditions;
    this._children   = [];   // [{ type: 'and'|'or', node: Q }]
    this._negated    = false;
  }

  // ─── Combinators ──────────────────────────────────────────────────────────

  and(other) {
    const node = other instanceof Q ? other : new Q(other);
    this._children.push({ type: 'and', node });
    return this;
  }

  or(other) {
    const node = other instanceof Q ? other : new Q(other);
    this._children.push({ type: 'or', node });
    return this;
  }

  not() {
    this._negated = !this._negated;
    return this;
  }

  // ─── Application ──────────────────────────────────────────────────────────

  /**
   * Apply this Q tree to a knex query builder.
   *
   * @param {object} knexQuery  — knex query (mutated)
   * @param {class}  ModelClass — root model (for lookups / joins)
   * @param {string} method     — 'where' | 'orWhere'
   */
  apply(knexQuery, ModelClass, method = 'where') {
    const applyFn = this._negated ? `${method}Not` : method;

    knexQuery[method](function () {
      const sub = this; // knex sub-query builder

      // Apply own conditions
      for (const [key, value] of Object.entries(Q.prototype._conditions
        ? {}
        : {})) { void key; void value; } // placeholder — see below

      // Own conditions
      for (const [key, value] of Object.entries(
        // `this` in constructor is the Q instance captured by closure below
        {}
      )) { void key; void value; }

      // We need the Q instance inside the knex callback — use a wrapper
    });

    // Re-implement without the confusing closure issue:
    this._applyToBuilder(knexQuery, ModelClass, method);
    return knexQuery;
  }

  /**
   * Internal — recursively applies the Q tree.
   */
  _applyToBuilder(knexQuery, ModelClass, outerMethod = 'where') {
    const self    = this;
    const wrapped = this._negated ? `${outerMethod}Not` : outerMethod;

    // knex `.where(function() { ... })` creates a grouped sub-expression
    knexQuery[outerMethod](function () {
      const sub = this;

      // Own conditions
      for (const [key, value] of Object.entries(self._conditions)) {
        LookupParser.apply(sub, key, value, ModelClass, 'where');
      }

      // Child nodes
      for (const { type, node } of self._children) {
        const childMethod = type === 'or' ? 'orWhere' : 'where';
        node._applyToBuilder(sub, ModelClass, childMethod);
      }
    });

    return knexQuery;
  }
}

module.exports = Q;
