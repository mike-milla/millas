'use strict';

/**
 * BelongsTo
 *
 * Inverse of HasOne / HasMany — the foreign key lives on THIS model's table.
 *
 *   class Post extends Model {
 *     static relations = {
 *       author: new BelongsTo(() => User, 'user_id'),
 *     };
 *   }
 *
 *   const post   = await Post.find(1);
 *   const author = await post.author();                   // lazy
 *   const posts  = await Post.with('author').get();       // eager
 */
class BelongsTo {
  /**
   * @param {Function} relatedFn   — () => RelatedModelClass
   * @param {string}   foreignKey  — column on THIS table (e.g. 'user_id')
   * @param {string}   ownerKey    — primary key on the related table (default: 'id')
   */
  constructor(relatedFn, foreignKey, ownerKey = 'id') {
    this._relatedFn  = relatedFn;
    this._foreignKey = foreignKey;
    this._ownerKey   = ownerKey;
  }

  get _related() { return this._relatedFn(); }

  // ─── Lazy load ────────────────────────────────────────────────────────────

  async load(ownerInstance) {
    const key = ownerInstance[this._foreignKey];
    if (key == null) return null;
    const row = await this._related._db().where(this._ownerKey, key).first();
    return row ? this._related._hydrate(row) : null;
  }

  // ─── Eager load ───────────────────────────────────────────────────────────

  async eagerLoad(instances, relationName, constraint) {
    const keys = [...new Set(instances.map(i => i[this._foreignKey]).filter(v => v != null))];
    if (!keys.length) {
      for (const i of instances) i[relationName] = null;
      return;
    }

    let q = this._related._db().whereIn(this._ownerKey, keys);
    if (constraint) {
      const QueryBuilder = require('../query/QueryBuilder');
      const qb = new QueryBuilder(q, this._related);
      constraint(qb);
      q = qb._query;
    }

    const rows    = await q;
    const related = rows.map(r => this._related._hydrate(r));
    const map     = new Map(related.map(r => [r[this._ownerKey], r]));

    for (const instance of instances) {
      instance[relationName] = map.get(instance[this._foreignKey]) ?? null;
    }
  }
}

module.exports = BelongsTo;
