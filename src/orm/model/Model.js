'use strict';

const QueryBuilder    = require('../query/QueryBuilder');
const LookupParser    = require('../query/LookupParser');
const DatabaseManager = require('../drivers/DatabaseManager');

/**
 * Model
 *
 * Base class for all Millas ORM models.
 *
 * ── Schema ───────────────────────────────────────────────────────────────────
 *
 *   class Post extends Model {
 *     static table  = 'posts';
 *     static fields = {
 *       id:           fields.id(),
 *       title:        fields.string(),
 *       body:         fields.text({ nullable: true }),
 *       user_id:      fields.foreignId('user_id'),
 *       published:    fields.boolean({ default: false }),
 *       published_at: fields.timestamp({ nullable: true }),
 *       created_at:   fields.timestamp(),
 *       updated_at:   fields.timestamp(),
 *     };
 *
 * ── Relations ────────────────────────────────────────────────────────────────
 *
 *     static relations = {
 *       author:   new BelongsTo(() => User, 'user_id'),
 *       comments: new HasMany(() => Comment, 'post_id'),
 *       tags:     new BelongsToMany(() => Tag, 'post_tag', 'post_id', 'tag_id'),
 *     };
 *
 * ── Scopes ───────────────────────────────────────────────────────────────────
 *
 *     static scopes = {
 *       published:  qb => qb.where('published', true),
 *       recent:     qb => qb.latest().limit(10),
 *       byUser:    (qb, userId) => qb.where('user_id', userId),
 *     };
 *
 * ── Soft deletes ─────────────────────────────────────────────────────────────
 *
 *     static softDeletes = true;
 *     // Now delete() sets deleted_at instead of removing the row.
 *     // All queries automatically exclude deleted rows.
 *
 * ── Validation ───────────────────────────────────────────────────────────────
 *
 *     static validate(data) {
 *       if (!data.title) throw new Error('title is required');
 *     }
 *
 * ── Lifecycle hooks (signals) ────────────────────────────────────────────────
 *
 *     static beforeCreate(data)   { return data; }  // can modify data
 *     static afterCreate(instance) {}
 *     static beforeUpdate(data)   { return data; }
 *     static afterUpdate(instance) {}
 *     static beforeDelete(instance) {}
 *     static afterDelete(instance) {}
 *   }
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   // CRUD
 *   const post  = await Post.create({ title: 'Hello' });
 *   const posts = await Post.all();
 *   const found = await Post.find(1);
 *   await post.update({ title: 'New Title' });
 *   await post.delete();                     // soft-delete if enabled
 *
 *   // Lookups
 *   Post.where('title__icontains', 'world').get()
 *   Post.where('published_at__year', 2024).get()
 *
 *   // Q objects
 *   Post.filter(Q({ published: true }).or({ user_id: 5 })).get()
 *
 *   // Scopes
 *   Post.scope('published').scope('recent').get()
 *
 *   // Relations
 *   Post.with('author', 'tags').get()
 *   post.author()     // lazy-load
 *   post.tags()       // lazy-load
 *   post.tags.attach(5)
 *   post.tags.sync([1, 2, 3])
 *
 *   // Aggregates
 *   Post.aggregate({ total: Count('id'), avg: Avg('views') })
 *   Post.annotate({ comment_count: Count('comments.id') }).get()
 *
 *   // Transactions
 *   await Post.transaction(async (trx) => {
 *     await Post.create({ title: 'Hello' }, { trx });
 *     await Tag.create({ name: 'news' }, { trx });
 *   });
 *
 *   // Soft deletes
 *   await post.delete()                 // sets deleted_at
 *   await post.restore()                // clears deleted_at
 *   Post.withTrashed().get()            // includes deleted
 *   Post.onlyTrashed().get()            // only deleted
 *
 *   // Bulk update
 *   await Post.bulkUpdate([
 *     { id: 1, title: 'One' },
 *     { id: 2, title: 'Two' },
 *   ], 'id');
 *
 *   // only() / defer()
 *   Post.only('id', 'title').get()
 *   Post.defer('body').get()
 *
 *   // Raw
 *   Post.raw('SELECT * FROM posts WHERE YEAR(created_at) = ?', [2024])
 */
class Model {
  // ─── Static schema config ─────────────────────────────────────────────────

  static get table() {
    return this._table || (this._table = this._defaultTable());
  }
  static set table(v) { this._table = v; }

  static primaryKey  = 'id';
  static timestamps  = true;
  static softDeletes = false;
  static fields      = {};
  static connection  = null;

  /** Define named scopes: static scopes = { published: qb => qb.where('published', true) } */
  static scopes = {};

  /** Define relations: static relations = { author: new BelongsTo(...) } */
  static relations = {};

  // ─── Lifecycle hooks (override in subclass) ───────────────────────────────

  static async beforeCreate(data)    { return data; }
  static async afterCreate(instance) {}
  static async beforeUpdate(data)    { return data; }
  static async afterUpdate(instance) {}
  static async beforeDelete(instance){}
  static async afterDelete(instance) {}

  // ─── Validation (override in subclass) ───────────────────────────────────

  /** Override to throw validation errors before create/update. */
  static validate(data) {}

  // ─── Transactions ─────────────────────────────────────────────────────────

  /**
   * Run a callback inside a database transaction.
   * If the callback throws, the transaction is rolled back automatically.
   *
   *   await Post.transaction(async (trx) => {
   *     const post = await Post.create({ title: 'Hi' }, { trx });
   *     await post.update({ published: true }, { trx });
   *   });
   */
  static async transaction(callback) {
    const db = DatabaseManager.connection(this.connection || null);
    return db.transaction(callback);
  }

  // ─── Static CRUD ──────────────────────────────────────────────────────────

  static async all() {
    const rows = await this._db();
    return rows.map(r => this._hydrate(r));
  }

  static async find(id) {
    const row = await this._db().where(this.primaryKey, id).first();
    return row ? this._hydrate(row) : null;
  }

  static async findOrFail(id) {
    const result = await this.find(id);
    if (!result) {
      const HttpError = require('../../errors/HttpError');
      throw new HttpError(404, `${this.name} #${id} not found`);
    }
    return result;
  }

  static async findBy(column, value) {
    const qb = new QueryBuilder(this._db(), this);
    qb.where(column, value);
    return qb.first();
  }

  static async findByOrFail(column, value) {
    const result = await this.findBy(column, value);
    if (!result) {
      const HttpError = require('../../errors/HttpError');
      throw new HttpError(404, `${this.name} not found`);
    }
    return result;
  }

  /**
   * Create a new row.
   * @param {object} data
   * @param {object} options  — { trx } for transaction support
   */
  static async create(data, { trx } = {}) {
    this.validate(data);

    const now     = new Date().toISOString();
    let payload   = {
      ...this._applyDefaults(data),
      ...(this.timestamps ? { created_at: now, updated_at: now } : {}),
    };

    payload = await this.beforeCreate(payload) ?? payload;

    const q     = trx ? trx(this.table) : this._db();
    const [id]  = await q.insert(payload);
    const instance = await (trx
      ? this._hydrateFromTrx(id, trx)
      : this.find(id));

    await this.afterCreate(instance);
    return instance;
  }

  static async firstOrCreate(search, extra = {}) {
    const existing = await this.where(search).first();
    if (existing) return existing;
    return this.create({ ...search, ...extra });
  }

  static async updateOrCreate(search, data) {
    const existing = await this.where(search).first();
    if (existing) {
      await existing.update(data);
      return existing;
    }
    return this.create({ ...search, ...data });
  }

  static async count(column = '*') {
    const result = await this._db().count(`${column} as count`).first();
    return Number(result?.count ?? 0);
  }

  static async exists(conditions = {}) {
    const qb = new QueryBuilder(this._db(), this);
    for (const [k, v] of Object.entries(conditions)) qb.where(k, v);
    return (await qb.count()) > 0;
  }

  static async insert(rows) {
    const now     = new Date().toISOString();
    const payload = rows.map(r => ({
      ...this._applyDefaults(r),
      ...(this.timestamps ? { created_at: now, updated_at: now } : {}),
    }));
    return this._db().insert(payload);
  }

  static async destroy(...ids) {
    return this._db().whereIn(this.primaryKey, ids.flat()).delete();
  }

  static async truncate() {
    return this._db().truncate();
  }

  // ─── Aggregation ──────────────────────────────────────────────────────────

  /**
   * Compute one or more aggregate values over the whole table.
   *
   *   await Order.aggregate({ total: Sum('amount'), avg: Avg('amount') })
   *   // → { total: 9430.5, avg: 94.3 }
   */
  static async aggregate(expressions) {
    const { AggregateExpression } = require('../query/Aggregates');
    let q = this._db();

    const selects = [];
    for (const [alias, expr] of Object.entries(expressions)) {
      if (!(expr instanceof AggregateExpression)) {
        throw new Error(`aggregate() values must be Aggregate expressions (Sum, Count, …)`);
      }
      selects.push(q.client.raw(expr.toSQL(alias)));
    }

    const row = await q.select(selects).first();
    // Parse numeric strings returned by some drivers
    const result = {};
    for (const key of Object.keys(expressions)) {
      result[key] = row[key] == null ? null : Number(row[key]);
    }
    return result;
  }

  // ─── Bulk update ──────────────────────────────────────────────────────────

  /**
   * Update many rows with different values in a single transaction.
   *
   *   await Post.bulkUpdate([
   *     { id: 1, title: 'One', published: true },
   *     { id: 2, title: 'Two', published: false },
   *   ], 'id');
   */
  static async bulkUpdate(rows, keyColumn = null) {
    const pk = keyColumn || this.primaryKey;
    return this.transaction(async (trx) => {
      for (const row of rows) {
        const { [pk]: keyValue, ...data } = row;
        if (keyValue == null) continue;
        const now = new Date().toISOString();
        await trx(this.table)
          .where(pk, keyValue)
          .update({ ...data, ...(this.timestamps ? { updated_at: now } : {}) });
      }
    });
  }

  // ─── only() / defer() ────────────────────────────────────────────────────

  /**
   * Select only these columns (like Django's .only()).
   *   Post.only('id', 'title').get()
   */
  static only(...columns) {
    return new QueryBuilder(this._db(), this).select(...columns);
  }

  /**
   * Select all columns EXCEPT the given ones (like Django's .defer()).
   *   Post.defer('body', 'metadata').get()
   */
  static defer(...columns) {
    const all     = Object.keys(this.fields);
    const exclude = new Set(columns);
    const keep    = all.filter(c => !exclude.has(c));
    return new QueryBuilder(this._db(), this).select(...keep.map(c => `${this.table}.${c}`));
  }

  // ─── Raw ──────────────────────────────────────────────────────────────────

  /**
   * Execute a raw SQL query and return hydrated model instances.
   *   Post.raw('SELECT * FROM posts WHERE YEAR(created_at) = ?', [2024])
   */
  static async raw(sql, bindings = []) {
    const db   = DatabaseManager.connection(this.connection || null);
    const rows = await db.raw(sql, bindings);
    // knex wraps raw results differently per driver
    const data = rows.rows ?? rows[0] ?? rows;
    return Array.isArray(data) ? data.map(r => this._hydrate(r)) : data;
  }

  // ─── Query Builder entry points ───────────────────────────────────────────

  static where(column, operatorOrValue, value) {
    return new QueryBuilder(this._db(), this).where(column, operatorOrValue, value);
  }

  /** filter() — Django alias for where() */
  static filter(column, operatorOrValue, value) {
    return this.where(column, operatorOrValue, value);
  }

  /** exclude() — Django alias for whereNot() */
  static exclude(column, value) {
    return new QueryBuilder(this._db(), this).whereNot(column, value);
  }

  static whereIn(column, values) {
    return new QueryBuilder(this._db(), this).whereIn(column, values);
  }

  static whereNull(column) {
    return new QueryBuilder(this._db(), this).whereNull(column);
  }

  static whereNotNull(column) {
    return new QueryBuilder(this._db(), this).whereNotNull(column);
  }

  static orderBy(column, dir = 'asc') {
    return new QueryBuilder(this._db(), this).orderBy(column, dir);
  }

  static latest(column = 'created_at') {
    return new QueryBuilder(this._db(), this).latest(column);
  }

  static oldest(column = 'created_at') {
    return new QueryBuilder(this._db(), this).oldest(column);
  }

  static limit(n) {
    return new QueryBuilder(this._db(), this).limit(n);
  }

  static select(...cols) {
    return new QueryBuilder(this._db(), this).select(...cols);
  }

  static distinct(...cols) {
    return new QueryBuilder(this._db(), this).distinct(...cols);
  }

  /** Start an eager-load chain. Relations inferred from fields are included automatically. */
  static with(...relations) {
    return new QueryBuilder(this._db(), this).with(...relations);
  }

  /** Apply a named scope. */
  static scope(name, ...args) {
    return new QueryBuilder(this._db(), this).scope(name, ...args);
  }

  /** Annotate rows with aggregate expressions. */
  static annotate(expressions) {
    return new QueryBuilder(this._db(), this).annotate(expressions);
  }

  /** Return plain objects instead of model instances. */
  static values(...columns) {
    return new QueryBuilder(this._db(), this).values(...columns);
  }

  /** Return a flat array of a single column. */
  static valuesList(column) {
    return new QueryBuilder(this._db(), this).valuesList(column);
  }

  /** Include soft-deleted rows. */
  static withTrashed() {
    return new QueryBuilder(this._db(), this).withTrashed();
  }

  /** Return only soft-deleted rows. */
  static onlyTrashed() {
    return new QueryBuilder(this._db(), this).onlyTrashed();
  }

  static query() {
    return new QueryBuilder(this._db(), this);
  }

  static async paginate(page = 1, perPage = 15) {
    return new QueryBuilder(this._db(), this).paginate(page, perPage);
  }

  // ─── Instance methods ─────────────────────────────────────────────────────

  constructor(attributes = {}) {
    Object.assign(this, attributes);
    this._original = { ...attributes };

    // Use effective relations: explicit static relations PLUS those
    // auto-inferred from ForeignKey / OneToOne / ManyToMany fields.
    const relations = this.constructor._effectiveRelations();

    for (const [name, rel] of Object.entries(relations)) {
      if (!(name in this)) {
        this[name] = () => rel.load(this);
      }
      const BelongsToMany = require('../relations/BelongsToMany');
      if (rel instanceof BelongsToMany) {
        Object.assign(this[name], rel._pivotManager(this));
      }
    }
  }

  /**
   * Returns the merged relation map for this model class.
   *
   * Priority (highest → lowest):
   *   1. Explicitly declared `static relations = {}`
   *   2. Auto-inferred from ForeignKey / OneToOne / ManyToMany fields
   *
   * Result is cached per class after first call.
   */
  static _effectiveRelations() {
    if (this._cachedRelations) return this._cachedRelations;

    const BelongsTo     = require('../relations/BelongsTo');
    const HasOne        = require('../relations/HasOne');
    const BelongsToMany = require('../relations/BelongsToMany');

    // Start with explicitly declared relations
    const merged = { ...(this.relations || {}) };

    for (const [fieldName, fieldDef] of Object.entries(this.fields || {})) {

      // ── ForeignKey / OneToOne ────────────────────────────────────────────
      if (fieldDef._isForeignKey) {
        // Infer accessor name:
        //   author_id  → author
        //   author     → author  (column will be author_id in migration)
        const accessorName = fieldName.endsWith('_id')
          ? fieldName.slice(0, -3)
          : fieldName;

        // Don't overwrite an explicitly declared relation
        if (!merged[accessorName]) {
          const modelRef   = fieldDef._fkModelRef;
          const toField    = fieldDef._fkToField || 'id';
          const self       = this;

          // self-referential: 'self' means this very model
          const resolveModel = () => {
            if (fieldDef._fkModel === 'self') return self;
            const M = typeof modelRef === 'function' ? modelRef() : modelRef;
            return M;
          };

          if (fieldDef._isOneToOne) {
            // OneToOne: BelongsTo on the declaring side
            merged[accessorName] = new BelongsTo(resolveModel, fieldName.endsWith('_id') ? fieldName : fieldName + '_id', toField);
          } else {
            merged[accessorName] = new BelongsTo(resolveModel, fieldName.endsWith('_id') ? fieldName : fieldName + '_id', toField);
          }
        }
      }

      // ── ManyToMany ────────────────────────────────────────────────────────
      if (fieldDef._isManyToMany && !merged[fieldName]) {
        const thisTableBase  = (this.table || this.name.toLowerCase()).replace(/s$/, '');
        const modelRef       = fieldDef._fkModelRef;

        const resolveRelated = () => {
          const M = typeof modelRef === 'function' ? modelRef() : modelRef;
          return M;
        };

        // Infer pivot table: sort both singular table names alphabetically
        const relatedName   = typeof fieldDef._fkModel === 'string'
          ? fieldDef._fkModel.toLowerCase().replace(/s$/, '')
          : fieldName.replace(/s$/, '');

        const pivotTable    = fieldDef._m2mThrough
          || [thisTableBase, relatedName].sort().join('_') + 's';

        const thisFk        = thisTableBase + '_id';
        const relatedFk     = relatedName + '_id';

        merged[fieldName] = new BelongsToMany(
          resolveRelated,
          pivotTable,
          thisFk,
          relatedFk,
        );
      }
    }

    this._cachedRelations = merged;
    return merged;
  }

  /** Clear the cached relations (call if fields are modified at runtime). */
  static _clearRelationCache() {
    this._cachedRelations = null;
  }

  /**
   * Persist changes to this instance.
   * @param {object} data
   * @param {object} options — { trx }
   */
  async update(data = {}, { trx } = {}) {
    this.constructor.validate(data);

    const now = new Date().toISOString();
    let payload = {
      ...data,
      ...(this.constructor.timestamps ? { updated_at: now } : {}),
    };

    payload = await this.constructor.beforeUpdate(payload) ?? payload;

    const q = trx
      ? trx(this.constructor.table)
      : this.constructor._db();

    await q
      .where(this.constructor.primaryKey, this[this.constructor.primaryKey])
      .update(payload);

    Object.assign(this, payload);
    await this.constructor.afterUpdate(this);
    return this;
  }

  async save() {
    const dirty = this._getDirty();
    if (!Object.keys(dirty).length) return this;
    return this.update(dirty);
  }

  /**
   * Delete this row.
   * If softDeletes = true, sets deleted_at instead of removing.
   */
  async delete({ trx } = {}) {
    await this.constructor.beforeDelete(this);

    const q = trx
      ? trx(this.constructor.table)
      : this.constructor._db();

    if (this.constructor.softDeletes) {
      const now = new Date().toISOString();
      await q
        .where(this.constructor.primaryKey, this[this.constructor.primaryKey])
        .update({ deleted_at: now });
      this.deleted_at = now;
    } else {
      await q
        .where(this.constructor.primaryKey, this[this.constructor.primaryKey])
        .delete();
    }

    await this.constructor.afterDelete(this);
    return this;
  }

  /** Restore a soft-deleted row. */
  async restore() {
    if (!this.constructor.softDeletes) {
      throw new Error(`${this.constructor.name} does not use soft deletes.`);
    }
    await this.constructor._db()
      .where(this.constructor.primaryKey, this[this.constructor.primaryKey])
      .update({ deleted_at: null });
    this.deleted_at = null;
    return this;
  }

  /** Force-delete even if softDeletes is enabled. */
  async forceDelete({ trx } = {}) {
    await this.constructor.beforeDelete(this);
    const q = trx ? trx(this.constructor.table) : this.constructor._db();
    await q.where(this.constructor.primaryKey, this[this.constructor.primaryKey]).delete();
    await this.constructor.afterDelete(this);
    return this;
  }

  async refresh() {
    const fresh = await this.constructor.find(this[this.constructor.primaryKey]);
    if (fresh) Object.assign(this, fresh);
    return this;
  }

  get isNew()       { return !this[this.constructor.primaryKey]; }
  get isTrashed()   { return !!this.deleted_at; }

  toJSON() {
    const obj = {};
    for (const key of Object.keys(this)) {
      if (!key.startsWith('_') && typeof this[key] !== 'function') {
        obj[key] = this[key];
      }
    }
    return obj;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  static _db() {
    const db    = DatabaseManager.connection(this.connection || null);
    let   q     = db(this.table);

    // Auto-exclude soft-deleted rows unless caller opts in
    if (this.softDeletes) {
      q = q.whereNull(`${this.table}.deleted_at`);
    }

    return q;
  }

  static _hydrate(row) {
    return new this(row);
  }

  static async _hydrateFromTrx(id, trx) {
    const row = await trx(this.table).where(this.primaryKey, id).first();
    return row ? this._hydrate(row) : null;
  }

  static _applyDefaults(data) {
    const result = { ...data };
    for (const [key, field] of Object.entries(this.fields)) {
      if (!(key in result) && field.default !== undefined) {
        result[key] = typeof field.default === 'function'
          ? field.default()
          : field.default;
      }
    }
    return result;
  }

  static _defaultTable() {
    const name = this.name.toLowerCase();
    if (name.endsWith('y') && !['ay','ey','iy','oy','uy'].some(s => name.endsWith(s)))
      return name.slice(0, -1) + 'ies';
    if (/(?:s|sh|ch|x|z)$/.test(name)) return name + 'es';
    return name + 's';
  }

  _getDirty() {
    const dirty = {};
    for (const key of Object.keys(this)) {
      if (!key.startsWith('_') && typeof this[key] !== 'function' && this[key] !== this._original[key]) {
        dirty[key] = this[key];
      }
    }
    return dirty;
  }
}

module.exports = Model;
