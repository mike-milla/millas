'use strict';

const { BaseOperation } = require('./base');

/**
 * special.js
 *
 * Escape-hatch operations that don't fit the structured field/model pattern:
 *   RunSQL — execute arbitrary SQL (forward and optionally reverse)
 *
 * applyState() is a no-op for RunSQL — the migration system cannot know
 * what arbitrary SQL does to the schema, so ProjectState is not mutated.
 * This means RunSQL migrations are opaque to makemigrations diffing.
 */

// ─── RunSQL ───────────────────────────────────────────────────────────────────

class RunSQL extends BaseOperation {
  /**
   * @param {string}      sql         — SQL to run on migrate
   * @param {string|null} reverseSql  — SQL to run on rollback (optional)
   */
  constructor(sql, reverseSql = null) {
    super();
    this.type       = 'RunSQL';
    this.sql        = sql;
    this.reverseSql = reverseSql;
  }

  // Opaque — RunSQL does not mutate ProjectState.
  // makemigrations cannot infer schema changes from raw SQL.
  applyState(/* _state */) {}

  async up(db) {
    await db.raw(this.sql);
  }

  async down(db) {
    if (this.reverseSql) await db.raw(this.reverseSql);
  }

  toJSON() {
    return {
      type:       'RunSQL',
      sql:        this.sql,
      reverseSql: this.reverseSql,
    };
  }
}

module.exports = { RunSQL };