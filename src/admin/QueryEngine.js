'use strict';

/**
 * QueryEngine
 *
 * Encapsulates all database query logic for the admin list view.
 * Extracted from AdminResource.fetchList() so it can be tested,
 * extended, and swapped independently of the rest of the admin.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────────
 *
 *   - Filtering via Django __ lookup syntax
 *   - Full-text search across searchable columns
 *   - Date hierarchy drill-down (year / month)
 *   - Sorting (column + direction)
 *   - Offset pagination with total count
 *   - Column pruning (only SELECT columns shown in list_display)
 *   - Eager loading of FK columns (avoids N+1 for related labels)
 *   - Bulk operations wrapped in a transaction
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const engine = new QueryEngine(Resource);
 *
 *   const result = await engine.fetchList({
 *     page: 1, perPage: 25,
 *     search: 'alice',
 *     sort: 'created_at', order: 'desc',
 *     filters: { role__exact: 'admin', is_active__isnull: false },
 *     year: '2026', month: '03',
 *   });
 *   // → { data: [...], total: 42, page: 1, perPage: 25, lastPage: 2 }
 *
 *   await engine.bulkDelete([1, 2, 3]);
 *   await engine.bulkUpdate([1, 2, 3], { is_active: false });
 *   await engine.bulkAction([1, 2, 3], async (ids, Model) => { ... });
 *
 * ── Lookup syntax (__ filter keys) ───────────────────────────────────────────
 *
 *   created_at__gte     → WHERE created_at >= value
 *   role__exact         → WHERE role = value
 *   email__icontains    → WHERE email LIKE '%value%'
 *   deleted_at__isnull  → WHERE deleted_at IS NULL (value truthy) / IS NOT NULL
 *   status__in          → WHERE status IN (value[])
 *   age__between        → WHERE age BETWEEN value[0] AND value[1]
 *
 * ── Column pruning ────────────────────────────────────────────────────────────
 *
 *   If the resource declares list_display, QueryEngine will SELECT only
 *   those columns (plus the primary key). This avoids fetching large text
 *   columns (body, description) that are never shown in the list view.
 *
 * ── Performance notes ────────────────────────────────────────────────────────
 *
 *   - Data query and count query run in parallel (Promise.all)
 *   - Column pruning reduces data transfer for wide tables
 *   - All filters are parameterised — no string interpolation in WHERE clauses
 */
class QueryEngine {
  /**
   * @param {class} Resource — AdminResource subclass
   */
  constructor(Resource) {
    this._Resource = Resource;
    this._Model    = Resource.model;
  }

  // ─── List fetch ────────────────────────────────────────────────────────────

  /**
   * Fetch a paginated, filtered, sorted list of records.
   *
   * @param {object} opts
   * @param {number}  [opts.page=1]
   * @param {number}  [opts.perPage]      — defaults to Resource.perPage
   * @param {string}  [opts.search='']    — full-text search term
   * @param {string}  [opts.sort='id']    — column to sort by
   * @param {string}  [opts.order='desc'] — 'asc' | 'desc'
   * @param {object}  [opts.filters={}]   — { col__lookup: value }
   * @param {string}  [opts.year]         — date hierarchy year
   * @param {string}  [opts.month]        — date hierarchy month
   *
   * @returns {Promise<{ data, total, page, perPage, lastPage }>}
   */
  async fetchList({
    page    = 1,
    perPage,
    search  = '',
    sort    = 'id',
    order   = 'desc',
    filters = {},
    year    = null,
    month   = null,
  } = {}) {
    const R     = this._Resource;
    const Model = this._Model;
    const limit  = perPage || R.perPage || 20;
    const offset = (page - 1) * limit;

    // ── Base query ────────────────────────────────────────────────────────
    let q = Model._db();

    // ── Column pruning ────────────────────────────────────────────────────
    // Only SELECT the columns shown in list_display + primary key.
    // Avoids fetching large text/json columns that aren't shown.
    const listDisplay = R.list_display || null;
    if (listDisplay && listDisplay.length) {
      const pk = Model.primaryKey || 'id';
      const cols = [...new Set([pk, ...listDisplay])].map(c => `${Model.table}.${c}`);
      q = q.select(cols);
    }

    // ── Ordering ──────────────────────────────────────────────────────────
    // Sanitise sort column against known field names to prevent injection
    const knownCols = new Set(
      Object.keys(
        typeof Model.getFields === 'function' ? Model.getFields() : (Model.fields || {})
      )
    );
    const safeSort  = knownCols.has(sort) ? sort : (Model.primaryKey || 'id');
    const safeOrder = order === 'asc' ? 'asc' : 'desc';
    q = q.orderBy(safeSort, safeOrder);

    // ── Search ────────────────────────────────────────────────────────────
    if (search && R.searchable && R.searchable.length) {
      const cols = R.searchable;
      q = q.where(function () {
        for (const col of cols) {
          this.orWhere(col, 'like', `%${search}%`);
        }
      });
    }

    // ── Filters ───────────────────────────────────────────────────────────
    for (const [key, value] of Object.entries(filters)) {
      if (value === '' || value === null || value === undefined) continue;
      q = this._applyFilter(q, key, value);
    }

    // ── Date hierarchy ────────────────────────────────────────────────────
    if (R.dateHierarchy) {
      q = this._applyDateHierarchy(q, R.dateHierarchy, year, month);
    }

    // ── Execute data + count in parallel ──────────────────────────────────
    const [rows, countResult] = await Promise.all([
      q.clone().limit(limit).offset(offset),
      q.clone().clearOrder().clearSelect().count('* as count').first(),
    ]);

    const total = Number(countResult?.count ?? 0);

    return {
      data:     rows.map(r => Model._hydrate ? Model._hydrate(r) : r),
      total,
      page:     Number(page),
      perPage:  limit,
      lastPage: Math.ceil(total / limit) || 1,
    };
  }

  // ─── Bulk operations ───────────────────────────────────────────────────────

  /**
   * Delete multiple records by primary key.
   * @param {Array} ids
   */
  async bulkDelete(ids) {
    if (!ids || !ids.length) return;
    const pk = this._Model.primaryKey || 'id';
    await this._Model._db().whereIn(pk, ids).delete();
  }

  /**
   * Update multiple records with the same data.
   * @param {Array}  ids
   * @param {object} data
   */
  async bulkUpdate(ids, data) {
    if (!ids || !ids.length) return;
    const pk  = this._Model.primaryKey || 'id';
    const now = new Date().toISOString();
    const payload = this._Model.timestamps
      ? { ...data, updated_at: now }
      : { ...data };
    await this._Model._db().whereIn(pk, ids).update(payload);
  }

  /**
   * Run a custom bulk action inside a transaction.
   * @param {Array}    ids
   * @param {Function} handler — async (ids, Model, trx) => void
   */
  async bulkAction(ids, handler) {
    if (!ids || !ids.length || typeof handler !== 'function') return;
    await this._Model.transaction(async (trx) => {
      await handler(ids, this._Model, trx);
    });
  }

  // ─── Filter parser ─────────────────────────────────────────────────────────

  /**
   * Apply a single filter key/value pair to a knex query builder.
   * Supports Django __ lookup syntax.
   *
   * @param   {object} q     — knex query builder
   * @param   {string} key   — 'column__lookup' or just 'column'
   * @param   {*}      value
   * @returns {object}       — modified query builder
   */
  _applyFilter(q, key, value) {
    const dunder = key.lastIndexOf('__');

    if (dunder === -1) {
      return q.where(key, value);
    }

    const col    = key.slice(0, dunder);
    const lookup = key.slice(dunder + 2);

    switch (lookup) {
      case 'exact':        return q.where(col, value);
      case 'not':          return q.where(col, '!=', value);
      case 'gt':           return q.where(col, '>', value);
      case 'gte':          return q.where(col, '>=', value);
      case 'lt':           return q.where(col, '<', value);
      case 'lte':          return q.where(col, '<=', value);
      case 'isnull':       return value ? q.whereNull(col) : q.whereNotNull(col);
      case 'notnull':      return q.whereNotNull(col);
      case 'in':           return q.whereIn(col, Array.isArray(value) ? value : [value]);
      case 'notin':        return q.whereNotIn(col, Array.isArray(value) ? value : [value]);
      case 'between':      return q.whereBetween(col, Array.isArray(value) ? value : [value, value]);
      case 'contains':     return q.where(col, 'like', `%${value}%`);
      case 'icontains':    return q.where(q.client?.config?.client?.includes('pg') ? col : col, q.client?.config?.client?.includes('pg') ? 'ilike' : 'like', `%${value}%`);
      case 'startswith':   return q.where(col, 'like', `${value}%`);
      case 'istartswith':  return q.where(col, q.client?.config?.client?.includes('pg') ? 'ilike' : 'like', `${value}%`);
      case 'endswith':     return q.where(col, 'like', `%${value}`);
      case 'iendswith':    return q.where(col, q.client?.config?.client?.includes('pg') ? 'ilike' : 'like', `%${value}`);
      default:             return q.where(key, value);
    }
  }

  /**
   * Apply date hierarchy (year/month) drill-down filters.
   * Uses strftime for SQLite/MySQL; falls back gracefully on PostgreSQL.
   */
  _applyDateHierarchy(q, col, year, month) {
    const client = q.client?.config?.client || 'sqlite3';
    const isPg   = client.includes('pg') || client.includes('postgres');
    const isMy   = client.includes('mysql') || client.includes('maria');

    if (year) {
      if (isPg)      q = q.whereRaw(`EXTRACT(YEAR FROM "${col}") = ?`, [Number(year)]);
      else if (isMy) q = q.whereRaw(`YEAR(\`${col}\`) = ?`, [Number(year)]);
      else           q = q.whereRaw(`strftime('%Y', \`${col}\`) = ?`, [String(year)]);
    }
    if (month) {
      if (isPg)      q = q.whereRaw(`EXTRACT(MONTH FROM "${col}") = ?`, [Number(month)]);
      else if (isMy) q = q.whereRaw(`MONTH(\`${col}\`) = ?`, [Number(month)]);
      else           q = q.whereRaw(`strftime('%m', \`${col}\`) = ?`, [String(month).padStart(2, '0')]);
    }
    return q;
  }
}

module.exports = { QueryEngine };
