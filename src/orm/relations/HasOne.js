'use strict';

/**
 * HasOne
 *
 * Represents a one-to-one relation where the foreign key lives on the
 * related model's table.
 *
 *   class User extends Model {
 *     static relations = {
 *       profile: new HasOne(() => Profile, 'user_id'),
 *     };
 *   }
 *
 *   const user = await User.find(1);
 *   const profile = await user.profile();        // single instance or null
 *   const users   = await User.with('profile').get();  // eager loaded
 */
class HasOne {
  /**
   * @param {Function} relatedFn   — () => RelatedModelClass  (thunk avoids circular requires)
   * @param {string}   foreignKey  — column on the related table pointing back here
   * @param {string}   localKey    — column on this table (default: 'id')
   */
  constructor(relatedFn, foreignKey, localKey = 'id') {
    this._relatedFn   = relatedFn;
    this._foreignKey  = foreignKey;
    this._localKey    = localKey;
  }

  get _related() { return this._relatedFn(); }

  // ─── Lazy load (instance method) ─────────────────────────────────────────

  async load(ownerInstance) {
    const key = ownerInstance[this._localKey];
    const row = await this._related._db()
      .where(this._foreignKey, key)
      .first();
    return row ? this._related._hydrate(row) : null;
  }

  // ─── Eager load ───────────────────────────────────────────────────────────

  async eagerLoad(instances, relationName, constraint) {
    const keys = [...new Set(instances.map(i => i[this._localKey]).filter(v => v != null))];
    if (!keys.length) return;

    let q = this._related._db().whereIn(this._foreignKey, keys);
    if (constraint) {
      const QueryBuilder = require('../query/QueryBuilder');
      const qb = new QueryBuilder(q, this._related);
      constraint(qb);
      q = qb._query;
    }

    const rows    = await q;
    const related = rows.map(r => this._related._hydrate(r));
    const map     = new Map(related.map(r => [r[this._foreignKey], r]));

    for (const instance of instances) {
      instance[relationName] = map.get(instance[this._localKey]) ?? null;
    }
  }
}

module.exports = HasOne;
