'use strict';

/**
 * BelongsToMany
 *
 * Many-to-many through a pivot table.
 *
 *   class Post extends Model {
 *     static relations = {
 *       tags: new BelongsToMany(() => Tag, 'post_tag', 'post_id', 'tag_id'),
 *     };
 *   }
 *
 *   class Tag extends Model {
 *     static relations = {
 *       posts: new BelongsToMany(() => Post, 'post_tag', 'tag_id', 'post_id'),
 *     };
 *   }
 *
 *   const post = await Post.find(1);
 *
 *   // Lazy
 *   const tags = await post.tags();
 *
 *   // Eager
 *   const posts = await Post.with('tags').get();
 *
 *   // Attach / detach / sync
 *   await post.tags.attach(5)
 *   await post.tags.attach([5, 6], { approved: true })  // with pivot data
 *   await post.tags.detach(5)
 *   await post.tags.detach()         // detach all
 *   await post.tags.sync([1, 2, 3])  // replace pivot rows
 *   await post.tags.toggle([1, 2])
 */
class BelongsToMany {
  /**
   * @param {Function} relatedFn      — () => RelatedModelClass
   * @param {string}   pivotTable     — name of the join table
   * @param {string}   foreignPivotKey — pivot column pointing to this model
   * @param {string}   relatedPivotKey — pivot column pointing to the related model
   * @param {string}   localKey        — PK on this model (default: 'id')
   * @param {string}   relatedKey      — PK on related model (default: 'id')
   */
  constructor(relatedFn, pivotTable, foreignPivotKey, relatedPivotKey, localKey = 'id', relatedKey = 'id') {
    this._relatedFn       = relatedFn;
    this._pivotTable      = pivotTable;
    this._foreignPivotKey = foreignPivotKey;
    this._relatedPivotKey = relatedPivotKey;
    this._localKey        = localKey;
    this._relatedKey      = relatedKey;
  }

  get _related() { return this._relatedFn(); }

  // ─── Lazy load ────────────────────────────────────────────────────────────

  async load(ownerInstance) {
    const db  = this._related._db;
    const key = ownerInstance[this._localKey];

    const rows = await this._related._db()
      .join(
        this._pivotTable,
        `${this._related.table}.${this._relatedKey}`,
        '=',
        `${this._pivotTable}.${this._relatedPivotKey}`,
      )
      .where(`${this._pivotTable}.${this._foreignPivotKey}`, key)
      .select(`${this._related.table}.*`);

    return rows.map(r => this._related._hydrate(r));
  }

  // ─── Eager load ───────────────────────────────────────────────────────────

  async eagerLoad(instances, relationName, constraint) {
    const keys = [...new Set(instances.map(i => i[this._localKey]).filter(v => v != null))];
    if (!keys.length) {
      for (const i of instances) i[relationName] = [];
      return;
    }

    let q = this._related._db()
      .join(
        this._pivotTable,
        `${this._related.table}.${this._relatedKey}`,
        '=',
        `${this._pivotTable}.${this._relatedPivotKey}`,
      )
      .whereIn(`${this._pivotTable}.${this._foreignPivotKey}`, keys)
      .select(
        `${this._related.table}.*`,
        `${this._pivotTable}.${this._foreignPivotKey} as _pivot_owner_id`,
      );

    if (constraint) {
      const QueryBuilder = require('../query/QueryBuilder');
      const qb = new QueryBuilder(q, this._related);
      constraint(qb);
      q = qb._query;
    }

    const rows    = await q;
    const related = rows.map(r => {
      const instance = this._related._hydrate(r);
      instance._pivotOwnerId = r._pivot_owner_id;
      return instance;
    });

    const map = new Map();
    for (const r of related) {
      const ownerId = r._pivotOwnerId;
      if (!map.has(ownerId)) map.set(ownerId, []);
      map.get(ownerId).push(r);
    }

    for (const instance of instances) {
      instance[relationName] = map.get(instance[this._localKey]) ?? [];
    }
  }

  // ─── Pivot management (returned as methods on the instance proxy) ─────────

  /**
   * Build pivot manager bound to a specific owner instance.
   * Called internally — results attached as instance[relationName].
   */
  _pivotManager(ownerInstance) {
    const self = this;
    const db   = () => ownerInstance.constructor._db().client; // knex instance

    // We need raw knex for pivot table operations
    const knex = () => {
      const DatabaseManager = require('../drivers/DatabaseManager');
      return DatabaseManager.connection();
    };

    return {
      /** Attach related IDs to the pivot table */
      async attach(ids, pivotData = {}) {
        const ownerId  = ownerInstance[self._localKey];
        const idArray  = Array.isArray(ids) ? ids : [ids];
        const rows     = idArray.map(id => ({
          [self._foreignPivotKey]: ownerId,
          [self._relatedPivotKey]: id,
          ...pivotData,
        }));
        await knex()(self._pivotTable).insert(rows).onConflict().ignore();
      },

      /** Remove related IDs from the pivot table */
      async detach(ids) {
        const ownerId = ownerInstance[self._localKey];
        let q = knex()(self._pivotTable).where(self._foreignPivotKey, ownerId);
        if (ids != null) {
          const idArray = Array.isArray(ids) ? ids : [ids];
          q = q.whereIn(self._relatedPivotKey, idArray);
        }
        await q.delete();
      },

      /** Replace all pivot rows with the given set of IDs */
      async sync(ids, pivotData = {}) {
        await this.detach();
        if (ids.length) await this.attach(ids, pivotData);
      },

      /** Toggle IDs — attach if not present, detach if present */
      async toggle(ids) {
        const ownerId  = ownerInstance[self._localKey];
        const idArray  = Array.isArray(ids) ? ids : [ids];
        const existing = await knex()(self._pivotTable)
          .where(self._foreignPivotKey, ownerId)
          .whereIn(self._relatedPivotKey, idArray)
          .pluck(self._relatedPivotKey);

        const toAttach = idArray.filter(id => !existing.includes(id));
        const toDetach = existing;

        if (toAttach.length) await this.attach(toAttach);
        if (toDetach.length) await this.detach(toDetach);
      },
    };
  }
}

module.exports = BelongsToMany;
