'use strict';

const LookupParser        = require('./LookupParser');
const { AggregateExpression } = require('./Aggregates');
const MillasLog           = require('../../logger/internal');

/**
 * QueryBuilder
 *
 * Fluent query builder for Millas ORM — wraps knex with:
 *   • Django-style __ field lookups
 *   • Q objects for complex OR/AND/NOT grouping
 *   • Aggregation  (aggregate, annotate)
 *   • Eager loading (with)
 *   • Scopes       (scope)
 *   • Soft deletes (withTrashed, onlyTrashed)
 *   • Distinct, values, raw
 *   • Reliable paginate
 */
class QueryBuilder {
  constructor(knexQuery, ModelClass) {
    this._query      = knexQuery;
    this._model      = ModelClass;
    this._withs      = [];   // eager-load relations
    this._annotations = [];  // annotate() expressions
  }

  // ─── WHERE / Q ────────────────────────────────────────────────────────────

  /**
   * Add a WHERE constraint.
   * Accepts:
   *   .where('age__gte', 18)                 — lookup syntax
   *   .where('age', '>=', 18)                — explicit operator
   *   .where({ name: 'Alice', active: true }) — object shorthand
   *   .where(Q({ age__gte: 18 }).or(...))    — Q object
   */
  where(column, operatorOrValue, value) {
    return this._applyWhere('where', column, operatorOrValue, value);
  }

  orWhere(column, operatorOrValue, value) {
    return this._applyWhere('orWhere', column, operatorOrValue, value);
  }

  whereNot(column, value) {
    LookupParser.apply(this._query, column, value, this._model, 'whereNot');
    return this;
  }

  /** filter() is an alias for where() — matches Django's .filter() */
  filter(column, operatorOrValue, value) {
    return this.where(column, operatorOrValue, value);
  }

  /** exclude() — alias for whereNot() — matches Django's .exclude() */
  exclude(column, value) {
    return this.whereNot(column, value);
  }

  whereNull(column)    { this._query = this._query.whereNull(column);    return this; }
  whereNotNull(column) { this._query = this._query.whereNotNull(column); return this; }

  whereIn(column, values)    { this._query = this._query.whereIn(column, values);    return this; }
  whereNotIn(column, values) { this._query = this._query.whereNotIn(column, values); return this; }
  whereBetween(column, range){ this._query = this._query.whereBetween(column, range); return this; }
  whereLike(column, pattern) { this._query = this._query.whereLike(column, pattern); return this; }

  // ─── Soft deletes ─────────────────────────────────────────────────────────

  /** Include soft-deleted rows in results. */
  withTrashed() {
    this._query = this._query.withoutScope?.('softDelete') ?? this._query;
    this._includeTrashed = true;
    return this;
  }

  /** Return ONLY soft-deleted rows. */
  onlyTrashed() {
    this._query = this._query.whereNotNull(`${this._model.table}.deleted_at`);
    this._includeTrashed = true;
    return this;
  }

  /**
   * Bypass all global scopes for this query.
   * Useful when you intentionally need an unfiltered view of the table.
   *
   *   User.withoutGlobalScope().get()   // skips tenant filter, active-only, etc.
   */
  withoutGlobalScope() {
    // Re-build the base query directly from knex, bypassing _db() where
    // globalScopes are applied.
    const DatabaseManager = require('../drivers/DatabaseManager');
    const db = DatabaseManager.connection(this._model.connection || null);
    this._query = db(this._model.table);
    return this;
  }

  // ─── Scopes ───────────────────────────────────────────────────────────────

  /**
   * Apply a named scope defined on the model.
   *   Post.scope('published').get()
   *   Post.scope('published', { featuredOnly: true }).get()
   */
  scope(name, ...args) {
    const scopes = this._model.scopes || {};
    if (!scopes[name]) throw new Error(`Scope "${name}" is not defined on ${this._model.name}`);
    scopes[name](this, ...args);
    return this;
  }

  // ─── Eager loading ────────────────────────────────────────────────────────

  /**
   * Eager-load named relations to avoid N+1 queries.
   *
   *   Post.with('author').get()
   *   Post.with('author', 'tags').get()
   *   Post.with({ author: q => q.where('active', true) }).get()  // constrained
   */
  with(...relations) {
    for (const rel of relations.flat()) {
      if (typeof rel === 'string') {
        this._withs.push({ name: rel, constraint: null });
      } else if (typeof rel === 'object') {
        for (const [name, constraint] of Object.entries(rel)) {
          this._withs.push({ name, constraint });
        }
      }
    }
    return this;
  }

  /**
   * Eager-load a COUNT of related rows onto each result.
   *
   *   Post.withCount('comments').get()
   *   // each post gets .comments_count
   *
   *   Post.withCount('comments', 'likes').get()
   *   Post.withCount({ comments: q => q.where('approved', true) }).get()
   */
  withCount(...relations) {
    for (const rel of relations.flat()) {
      if (typeof rel === 'string') {
        this._withs.push({ name: rel, constraint: null, aggregate: 'count' });
      } else if (typeof rel === 'object') {
        for (const [name, constraint] of Object.entries(rel)) {
          this._withs.push({ name, constraint, aggregate: 'count' });
        }
      }
    }
    return this;
  }

  /**
   * Eager-load a SUM of a related column onto each result.
   *
   *   User.withSum('orders', 'amount').get()
   *   // each user gets .orders_sum_amount
   */
  withSum(relation, column) {
    this._withs.push({ name: relation, constraint: null, aggregate: 'sum', aggregateColumn: column });
    return this;
  }

  /**
   * Add per-row computed columns.
   *
   *   Post.annotate({ comment_count: Count('comments.id') }).get()
   *   // → each Post has .comment_count
   */
  annotate(expressions) {
    for (const [alias, expr] of Object.entries(expressions)) {
      if (!(expr instanceof AggregateExpression)) {
        throw new Error(`annotate() values must be Aggregate expressions (Sum, Count, …)`);
      }

      // If expression references a related table (contains '.'), auto-join
      if (expr.column.includes('.')) {
        const [relTable] = expr.column.split('.');
        this._query = this._query.leftJoin(
          relTable,
          `${this._model.table}.id`,
          `${relTable}.${this._model.table.replace(/s$/, '')}_id`,
        );
        this._query = this._query.groupBy(`${this._model.table}.id`);
      }

      this._annotations.push({ alias, expr });
      this._query = this._query.select(
        this._query.client.raw(`${expr.toSQL(alias)}`),
      );
    }
    return this;
  }

  // ─── ORDER / LIMIT / OFFSET ───────────────────────────────────────────────

  orderBy(column, direction = 'asc') {
    this._query = this._query.orderBy(column, direction);
    return this;
  }

  latest(column = 'created_at') { return this.orderBy(column, 'desc'); }
  oldest(column = 'created_at') { return this.orderBy(column, 'asc');  }

  limit(n)  { this._query = this._query.limit(n);  return this; }
  offset(n) { this._query = this._query.offset(n); return this; }
  skip(n)   { return this.offset(n); }
  take(n)   { return this.limit(n);  }

  // ─── SELECT / DISTINCT / VALUES ───────────────────────────────────────────

  select(...columns) {
    this._query = this._query.select(...columns);
    return this;
  }

  distinct(...columns) {
    this._query = columns.length
      ? this._query.distinct(...columns)
      : this._query.distinct();
    return this;
  }

  /**
   * Return plain objects instead of model instances (faster for reporting).
   * .values('id', 'name') → [{ id: 1, name: 'Alice' }, …]
   */
  values(...columns) {
    this._asValues = true;
    if (columns.length) this.select(...columns);
    return this;
  }

  /**
   * Return a flat array of a single column.
   * Same as .pluck() but can be chained before .get().
   */
  valuesList(column) {
    this._asValuesList = column;
    this.select(column);
    return this;
  }

  // ─── GROUPING / HAVING ────────────────────────────────────────────────────

  groupBy(...columns) {
    this._query = this._query.groupBy(...columns);
    return this;
  }

  join(table, col1, col2, col3) {
    this._query = col3
      ? this._query.join(table, col1, col2, col3)
      : this._query.join(table, col1, col2);
    return this;
  }

  leftJoin(table, col1, col2, col3) {
    this._query = col3
      ? this._query.leftJoin(table, col1, col2, col3)
      : this._query.leftJoin(table, col1, col2);
    return this;
  }

  rightJoin(table, col1, col2, col3) {
    this._query = col3
      ? this._query.rightJoin(table, col1, col2, col3)
      : this._query.rightJoin(table, col1, col2);
    return this;
  }

  having(column, operatorOrValue, value) {
    if (value !== undefined) {
      this._query = this._query.having(column, operatorOrValue, value);
    } else {
      this._query = this._query.having(column, operatorOrValue);
    }
    return this;
  }

  // ─── RAW ─────────────────────────────────────────────────────────────────

  /**
   * Append a raw WHERE clause.
   *   .whereRaw('YEAR(created_at) = ?', [2024])
   */
  whereRaw(sql, bindings = []) {
    this._query = this._query.whereRaw(sql, bindings);
    return this;
  }

  /**
   * Add a raw SELECT expression.
   *   .selectRaw('COUNT(*) as total')
   */
  selectRaw(sql, bindings = []) {
    this._query = this._query.select(this._query.client.raw(sql, bindings));
    return this;
  }

  // ─── EXECUTION ────────────────────────────────────────────────────────────

  /** Fetch all matching rows — returns model instances (or plain objects if .values() was called). */
  async get() {
    const rows = await this._query;

    // valuesList → flat array
    if (this._asValuesList) return rows.map(r => r[this._asValuesList]);

    // values() → plain objects
    if (this._asValues) return rows;

    const instances = rows.map(r => this._model._hydrate(r));

    // Eager load
    if (this._withs.length) await this._eagerLoad(instances);

    return instances;
  }

  /** Fetch the first matching row. */
  async first() {
    const row = await this._query.first();
    if (!row) return null;
    const instance = this._model._hydrate(row);
    if (this._withs.length) await this._eagerLoad([instance]);
    return instance;
  }

  /**
   * Find by primary key — allows chaining with .with().
   *   Post.with('author').find(1)
   */
  async find(id) {
    return this.where(this._model.primaryKey, id).first();
  }

  /**
   * Find by primary key or throw 404.
   *   Post.with('author').findOrFail(1)
   */
  async findOrFail(id, message) {
    const result = await this.find(id);
    if (!result) {
      const HttpError = require('../../errors/HttpError');
      throw new HttpError(404, message || `${this._model.name} not found`);
    }
    return result;
  }

  /** Count matching rows. */
  async count(column = '*') {
    const result = await this._query.clone()
      .clearSelect()
      .clearOrder()
      .count(`${column} as count`)
      .first();
    return Number(result?.count ?? 0);
  }

  /** Check whether any rows match. */
  async exists() {
    return (await this.count()) > 0;
  }

  /** Pluck a single column as a flat array. */
  async pluck(column) {
    const rows = await this._query.select(column);
    return rows.map(r => r[column]);
  }

  /**
   * Paginate results.
   * Returns { data, total, page, perPage, lastPage }
   */
  async paginate(page = 1, perPage = 15) {
    const offset = (page - 1) * perPage;
    const total  = await this._query.clone()
      .clearSelect()
      .clearOrder()
      .count('* as count')
      .first()
      .then(r => Number(r?.count ?? 0));

    const rows = await this._query.clone().limit(perPage).offset(offset);
    const instances = rows.map(r => this._model._hydrate(r));

    if (this._withs.length) await this._eagerLoad(instances);

    return {
      data:     instances,
      total,
      page:     Number(page),
      perPage,
      lastPage: Math.ceil(total / perPage) || 1,
    };
  }

  /** Update matching rows. */
  async update(data) {
    const F     = require('./F');
    const extra = this._model._updatedAtPayload?.() ?? {};
    const payload = {};
    for (const [key, val] of Object.entries({ ...data, ...extra })) {
      if (val instanceof F) {
        payload[key] = val.toKnex(this._query.client);
      } else {
        payload[key] = val;
      }
    }
    return this._query.update(payload);
  }

  /** Delete matching rows. */
  async delete() {
    return this._query.delete();
  }

  /**
   * Get exactly one result — raises if 0 or more than 1 found.
   * Matches Django's QuerySet.get()
   */
  async get_one(...args) {
    if (args.length) this.where(...args);
    this._query = this._query.limit(2);
    const rows = await this._query;
    if (rows.length === 0) {
      const HttpError = require('../../errors/HttpError');
      throw new HttpError(404, `${this._model.name} matching query does not exist.`);
    }
    if (rows.length > 1) {
      throw new Error(`get() returned more than one ${this._model.name} — it returned ${rows.length}!`);
    }
    const instance = this._model._hydrate(rows[0]);
    if (this._withs.length) await this._eagerLoad([instance]);
    return instance;
  }

  /**
   * Return last matching row (reverse of first()).
   *   Post.orderBy('created_at').last()
   */
  async last() {
    const rows = await this._query;
    if (!rows.length) return null;
    const instance = this._model._hydrate(rows[rows.length - 1]);
    if (this._withs.length) await this._eagerLoad([instance]);
    return instance;
  }

  /**
   * Return empty result set — useful for conditional queries.
   *   Post.none().get() // []
   */
  none() {
    this._query = this._query.whereRaw('1 = 0');
    return this;
  }

  /**
   * Lock selected rows for update (SELECT FOR UPDATE).
   * Postgres and MySQL only.
   *   Post.where('status', 'pending').selectForUpdate().first()
   */
  selectForUpdate(options = {}) {
    const client = this._query.client?.config?.client || '';
    if (client.includes('sqlite')) {
      // SQLite doesn't support SELECT FOR UPDATE — silently skip
      return this;
    }
    if (options.skipLocked) {
      this._query = this._query.forUpdate().skipLocked();
    } else if (options.noWait) {
      this._query = this._query.forUpdate().noWait();
    } else {
      this._query = this._query.forUpdate();
    }
    return this;
  }

  /**
   * Return a dict mapping pk → instance.
   * Matches Django's QuerySet.in_bulk()
   *   Post.inBulk([1, 2, 3])  // { 1: Post, 2: Post, 3: Post }
   *   Post.inBulk()           // all rows as dict
   */
  async inBulk(ids = null, fieldName = null) {
    const pk = fieldName || this._model.primaryKey;
    if (ids !== null) {
      if (ids.length === 0) return {};
      this._query = this._query.whereIn(pk, ids);
    }
    const rows = await this._query;
    const result = {};
    for (const row of rows) {
      const instance = this._model._hydrate(row);
      result[instance[pk]] = instance;
    }
    return result;
  }

  /**
   * Reverse the current ordering.
   * Matches Django's QuerySet.reverse()
   */
  reverse() {
    // Wrap current query as subquery and reverse order
    // Simple implementation: toggle asc/desc on existing order
    this._reversed = true;
    return this;
  }

  /**
   * Return query plan (EXPLAIN).
   * Matches Django's QuerySet.explain()
   */
  async explain() {
    const client = this._query.client?.config?.client || '';
    const sql    = this._query.toSQL();
    const prefix = client.includes('pg') ? 'EXPLAIN ANALYZE ' : 'EXPLAIN ';
    const db     = require('../drivers/DatabaseManager').connection(this._model.connection || null);
    const result = await db.raw(prefix + sql.sql, sql.bindings);
    return result.rows ?? result[0] ?? result;
  }

  /**
   * Use a specific DB connection for this query.
   * Matches Django's QuerySet.using()
   */
  using(connectionName) {
    const DatabaseManager = require('../drivers/DatabaseManager');
    const db = DatabaseManager.connection(connectionName);
    this._query = db(this._model.table);
    return this;
  }

  /**
   * Return the raw SQL string with bindings substituted — for debugging.
   * Matches Django's str(queryset.query) behaviour.
   *
   *   console.log(Post.where('published', true).orderBy('created_at').sql())
   *   // → select * from `posts` where `published` = true order by `created_at` asc
   *
   *   // Also available as toSQL() for the raw { sql, bindings } object
   *   Post.where('published', true).toSQL()
   *   // → { sql: 'select * from `posts` where `published` = ?', bindings: [true] }
   */
  sql() {
    const { sql, bindings } = this._query.toSQL();
    // Substitute bindings into the SQL string for readability
    let result = sql;
    for (const binding of bindings) {
      const val = binding === null ? 'NULL'
        : typeof binding === 'string' ? `'${binding}'`
        : String(binding);
      result = result.replace('?', val);
    }
    return result;
  }

  toSQL() {
    return this._query.toSQL();
  }

  // ─── Eager loading internals ──────────────────────────────────────────────

  async _eagerLoad(instances) {
    if (!instances.length) return;

    const relations = this._model._effectiveRelations();

    for (const { name, constraint, aggregate, aggregateColumn } of this._withs) {

      // ── withCount / withSum  ──────────────────────────────────────────────
      if (aggregate) {
        await this._eagerAggregate(instances, name, aggregate, aggregateColumn, constraint, relations);
        continue;
      }

      // -- Nested dot notation: 'documents.document_images'
      // Matches Django's prefetch_related('documents__document_images')
      if (name.includes('.')) {
        const [parentRel, ...rest] = name.split('.');
        const nestedName = rest.join('.');
        const parentRelDef = relations[parentRel];
        if (!parentRelDef) {
          MillasLog.w('ORM', `Relation "${parentRel}" not defined on ${this._model.name} -- skipping nested eager load`);
          continue;
        }
        const alreadyLoaded = instances[0]?.[parentRel] !== undefined &&
          typeof instances[0]?.[parentRel] !== 'function';
        if (!alreadyLoaded) {
          await parentRelDef.eagerLoad(instances, parentRel, null);
        }
        const parentInstances = instances.flatMap(i => {
          const val = i[parentRel];
          if (!val) return [];
          return Array.isArray(val) ? val : [val];
        });
        if (parentInstances.length) {
          const RelatedModel = parentRelDef._related;
          if (RelatedModel) {
            const QB = require('./QueryBuilder');
            const subQb = new QB(RelatedModel._db(), RelatedModel);
            subQb._withs = [{ name: nestedName, constraint: null }];
            await subQb._eagerLoad(parentInstances);
          }
        }
        continue;
      }

      // ── Normal eager load ─────────────────────────────────────────────────
      const rel = relations[name];
      if (!rel) {
        MillasLog.w('ORM', `Relation "${name}" not defined on ${this._model.name} — skipping eager load`);
        continue;
      }

      await rel.eagerLoad(instances, name, constraint);
    }
  }

  /**
   * Load an aggregate (COUNT / SUM) of a relation onto each instance
   * without pulling back full related rows.
   */
  async _eagerAggregate(instances, relName, aggFn, aggColumn, constraint, relations) {
    const rel = relations[relName];
    if (!rel) {
      MillasLog.w('ORM', `Relation "${relName}" not defined on ${this._model.name} — cannot compute ${aggFn}`);
      // Zero-fill the attribute
      const attr = aggFn === 'sum'
        ? `${relName}_sum_${aggColumn}`
        : `${relName}_count`;
      for (const i of instances) i[attr] = 0;
      return;
    }

    const attrName = aggFn === 'sum'
      ? `${relName}_sum_${aggColumn}`
      : `${relName}_count`;

    // We only support HasMany / BelongsToMany for aggregate loads for now.
    // For those, the foreignKey / pivot info is on the rel object.
    const HasMany       = require('../relations/HasMany');
    const BelongsToMany = require('../relations/BelongsToMany');

    const localKey  = rel._localKey   || this._model.primaryKey || 'id';
    const keys      = [...new Set(instances.map(i => i[localKey]).filter(v => v != null))];

    if (!keys.length) {
      for (const i of instances) i[attrName] = 0;
      return;
    }

    const related = rel._related;
    let q;

    if (rel instanceof HasMany) {
      const fk = rel._foreignKey;
      q = related._db()
        .select(`${fk} as _owner_id`)
        .whereIn(fk, keys);

      if (aggFn === 'count') {
        q = q.count(`${related.primaryKey || 'id'} as _agg_val`).groupBy(fk);
      } else {
        q = q.sum(`${aggColumn} as _agg_val`).groupBy(fk);
      }

    } else if (rel instanceof BelongsToMany) {
      const pivot    = rel._pivotTable;
      const fk       = rel._foreignPivotKey;
      const rk       = rel._relatedPivotKey;
      q = related._db()
        .join(pivot, `${related.table}.${related.primaryKey || 'id'}`, '=', `${pivot}.${rk}`)
        .select(`${pivot}.${fk} as _owner_id`)
        .whereIn(`${pivot}.${fk}`, keys);

      if (aggFn === 'count') {
        q = q.count(`${related.table}.${related.primaryKey || 'id'} as _agg_val`).groupBy(`${pivot}.${fk}`);
      } else {
        q = q.sum(`${related.table}.${aggColumn} as _agg_val`).groupBy(`${pivot}.${fk}`);
      }
    } else {
      // Unsupported relation type — zero-fill
      for (const i of instances) i[attrName] = 0;
      return;
    }

    if (constraint) {
      const QB = require('./QueryBuilder');
      const qb = new QB(q, related);
      constraint(qb);
      q = qb._query;
    }

    const rows = await q;
    const map  = new Map(rows.map(r => [r._owner_id, Number(r._agg_val ?? 0)]));

    for (const instance of instances) {
      instance[attrName] = map.get(instance[localKey]) ?? 0;
    }
  }

  // ─── Internal where dispatcher ────────────────────────────────────────────

  _applyWhere(method, column, operatorOrValue, value) {
    // Q object
    if (column && typeof column === 'object' && typeof column._applyToBuilder === 'function') {
      column._applyToBuilder(this._query, this._model, method);
      return this;
    }

    // Plain object — apply each key (supports lookups)
    if (typeof column === 'object' && column !== null) {
      for (const [k, v] of Object.entries(column)) {
        LookupParser.apply(this._query, k, v, this._model, method);
      }
      return this;
    }

    // Three-arg explicit operator — bypass lookup parsing
    if (value !== undefined) {
      this._query = this._query[method](column, operatorOrValue, value);
      return this;
    }

    // Two-arg — parse lookups
    LookupParser.apply(this._query, column, operatorOrValue, this._model, method);
    return this;
  }

  _getWhereBindings() { return {}; }
}

module.exports = QueryBuilder;
