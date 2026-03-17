'use strict';

/**
 * HasMany
 *
 * One-to-many: the foreign key lives on the related table.
 *
 *   class User extends Model {
 *     static relations = {
 *       posts: new HasMany(() => Post, 'user_id'),
 *     };
 *   }
 *
 *   const user  = await User.find(1);
 *   const posts = await user.posts();                     // lazy
 *   const users = await User.with('posts').get();         // eager
 *   const users = await User.with({                       // eager + constrained
 *     posts: q => q.where('published', true).latest()
 *   }).get();
 */
class HasMany {
  constructor(relatedFn, foreignKey, localKey = 'id') {
    this._relatedFn  = relatedFn;
    this._foreignKey = foreignKey;
    this._localKey   = localKey;
  }

  get _related() { return this._relatedFn(); }

  // ─── Lazy load ────────────────────────────────────────────────────────────

  async load(ownerInstance) {
    const key  = ownerInstance[this._localKey];
    const rows = await this._related._db().where(this._foreignKey, key);
    return rows.map(r => this._related._hydrate(r));
  }

  // ─── Eager load ───────────────────────────────────────────────────────────

  async eagerLoad(instances, relationName, constraint) {
    const keys = [...new Set(instances.map(i => i[this._localKey]).filter(v => v != null))];
    if (!keys.length) {
      for (const i of instances) i[relationName] = [];
      return;
    }

    let q = this._related._db().whereIn(this._foreignKey, keys);
    if (constraint) {
      const QueryBuilder = require('../query/QueryBuilder');
      const qb = new QueryBuilder(q, this._related);
      constraint(qb);
      q = qb._query;
    }

    const rows    = await q;
    const related = rows.map(r => this._related._hydrate(r));

    // Group by foreign key
    const map = new Map();
    for (const r of related) {
      const fkVal = r[this._foreignKey];
      if (!map.has(fkVal)) map.set(fkVal, []);
      map.get(fkVal).push(r);
    }

    for (const instance of instances) {
      instance[relationName] = map.get(instance[this._localKey]) ?? [];
    }
  }
}

module.exports = HasMany;
