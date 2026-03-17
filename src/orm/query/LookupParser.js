'use strict';

/**
 * LookupParser
 *
 * Parses Django-style __ field lookups and applies them to a knex query.
 *
 * Supported lookup types:
 *
 *   Comparison
 *     field__exact        =    (default, same as no suffix)
 *     field__not          !=
 *     field__gt           >
 *     field__gte          >=
 *     field__lt           <
 *     field__lte          <=
 *
 *   Null checks
 *     field__isnull       IS NULL  (value: true) / IS NOT NULL (value: false)
 *
 *   Range / set
 *     field__in           IN (array)
 *     field__notin        NOT IN (array)
 *     field__between      BETWEEN [min, max]
 *
 *   String matching
 *     field__contains     LIKE %value%       (case-sensitive)
 *     field__icontains    ILIKE %value%      (case-insensitive)
 *     field__startswith   LIKE value%
 *     field__istartswith  ILIKE value%
 *     field__endswith     LIKE %value
 *     field__iendswith    ILIKE %value
 *     field__like         LIKE <raw pattern>  (you supply the %)
 *
 *   Date / time extraction  (SQLite: strftime, PG/MySQL: EXTRACT / DATE_FORMAT)
 *     field__year
 *     field__month
 *     field__day
 *     field__hour
 *     field__minute
 *     field__second
 *
 *   Relationship traversal  (requires Model.fields with references)
 *     profile__city__icontains  → joins profiles, filters on city
 *
 * Usage (internal — called by QueryBuilder):
 *   LookupParser.apply(knexQuery, 'age__gte', 18, ModelClass)
 *   LookupParser.apply(knexQuery, 'profile__city', 'Nairobi', ModelClass)
 */
class LookupParser {

  /**
   * All recognised lookup suffixes, in order from longest to shortest so
   * that e.g. "icontains" is matched before a hypothetical "contains" variant.
   */
  static LOOKUPS = [
    'icontains', 'istartswith', 'iendswith',
    'contains', 'startswith', 'endswith', 'like',
    'isnull', 'between', 'notin', 'in',
    'exact', 'not',
    'gte', 'lte', 'gt', 'lt',
    'year', 'month', 'day', 'hour', 'minute', 'second',
  ];

  /**
   * Parse a lookup key and apply the appropriate knex constraint.
   *
   * @param {object}  q          — knex query builder (mutated in place)
   * @param {string}  key        — e.g. "age__gte", "profile__city__icontains"
   * @param {*}       value      — the comparison value
   * @param {class}   ModelClass — the root Model class (for relationship traversal)
   * @param {string}  [method]   — 'where' | 'orWhere' (default: 'where')
   * @returns {object} the (mutated) knex query
   */
  static apply(q, key, value, ModelClass, method = 'where') {
    // No __ at all → plain equality, pass straight through
    if (!key.includes('__')) {
      q[method](key, value);
      return q;
    }

    const parts  = key.split('__');
    const lookup = this._extractLookup(parts);
    // Everything left after stripping the lookup is the field path
    const fieldPath = lookup ? parts.slice(0, -1) : parts;

    // Relationship traversal: more than one segment in the field path
    if (fieldPath.length > 1) {
      return this._applyRelational(q, fieldPath, lookup, value, ModelClass, method);
    }

    const column = fieldPath[0];
    return this._applyLookup(q, column, lookup || 'exact', value, method);
  }

  // ─── Lookup application ───────────────────────────────────────────────────

  static _applyLookup(q, column, lookup, value, method) {
    switch (lookup) {
      case 'exact':
        q[method](column, value);
        break;

      case 'not':
        q[method](column, '!=', value);
        break;

      case 'gt':
        q[method](column, '>', value);
        break;

      case 'gte':
        q[method](column, '>=', value);
        break;

      case 'lt':
        q[method](column, '<', value);
        break;

      case 'lte':
        q[method](column, '<=', value);
        break;

      case 'isnull':
        if (value) q[`${method}Null`]   ? q[`${method}Null`](column)   : q.whereNull(column);
        else       q[`${method}NotNull`] ? q[`${method}NotNull`](column) : q.whereNotNull(column);
        break;

      case 'in':
        q[`${method}In`] ? q[`${method}In`](column, value) : q.whereIn(column, value);
        break;

      case 'notin':
        q[`${method}NotIn`] ? q[`${method}NotIn`](column, value) : q.whereNotIn(column, value);
        break;

      case 'between':
        q[`${method}Between`]
          ? q[`${method}Between`](column, value)
          : q.whereBetween(column, value);
        break;

      case 'contains':
        q[method](column, 'like', `%${value}%`);
        break;

      case 'icontains':
        q[method](column, 'ilike', `%${value}%`);
        break;

      case 'startswith':
        q[method](column, 'like', `${value}%`);
        break;

      case 'istartswith':
        q[method](column, 'ilike', `${value}%`);
        break;

      case 'endswith':
        q[method](column, 'like', `%${value}`);
        break;

      case 'iendswith':
        q[method](column, 'ilike', `%${value}`);
        break;

      case 'like':
        q[method](column, 'like', value);
        break;

      // ── Date/time extractions ──────────────────────────────────────────
      case 'year':
      case 'month':
      case 'day':
      case 'hour':
      case 'minute':
      case 'second':
        this._applyDatePart(q, column, lookup, value, method);
        break;

      default:
        // Unrecognised suffix — treat whole key as column name, do equality
        q[method](column, value);
    }

    return q;
  }

  // ─── Date part extraction — dialect-aware ─────────────────────────────────

  static _applyDatePart(q, column, part, value, method) {
    const client = q.client?.config?.client || 'sqlite3';

    if (client.includes('pg') || client.includes('postgres')) {
      // PostgreSQL: EXTRACT(YEAR FROM column) = value
      const pgPart = part.toUpperCase();
      q[method](q.client.raw(`EXTRACT(${pgPart} FROM "${column}")`, []), value);

    } else if (client.includes('mysql') || client.includes('maria')) {
      // MySQL: YEAR(column) = value etc.
      const fn = part.toUpperCase();
      q[method](q.client.raw(`${fn}(\`${column}\`)`, []), value);

    } else {
      // SQLite: strftime('%Y', column) = value
      const fmtMap = {
        year: '%Y', month: '%m', day: '%d',
        hour: '%H', minute: '%M', second: '%S',
      };
      const fmt = fmtMap[part];
      q[method](q.client.raw(`strftime('${fmt}', "${column}")`, []), String(value).padStart(part === 'year' ? 4 : 2, '0'));
    }
  }

  // ─── Relationship traversal ───────────────────────────────────────────────

  /**
   * Handle multi-segment paths like profile__city or post__author__role.
   *
   * Resolves each hop using Model.fields[x].references, auto-joins the
   * necessary tables, then applies the final lookup on the leaf column.
   *
   * @param {object}   q          — knex query
   * @param {string[]} fieldPath  — e.g. ['profile', 'city']
   * @param {string}   lookup     — e.g. 'icontains'
   * @param {*}        value
   * @param {class}    ModelClass — root model
   * @param {string}   method     — 'where' | 'orWhere'
   */
  static _applyRelational(q, fieldPath, lookup, value, ModelClass, method) {
    let currentModel = ModelClass;
    const joinedTables = new Set();

    // Walk all segments except the last — each one is a relationship hop
    for (let i = 0; i < fieldPath.length - 1; i++) {
      const segment  = fieldPath[i];
      const fields   = currentModel.fields || {};

      // Try to find a field whose name matches the segment
      const fieldDef = fields[segment] || fields[`${segment}_id`];

      if (!fieldDef || !fieldDef.references) {
        // No references info — fall back to treating the whole path as a
        // raw column name with underscores (best-effort)
        const fallbackCol = fieldPath.join('_');
        return this._applyLookup(q, fallbackCol, lookup || 'exact', value, method);
      }

      const { table: relTable, column: relColumn } = fieldDef.references;
      const localColumn = fieldDef.references.localKey || segment + '_id';
      const joinKey     = `${currentModel.table}__${relTable}`;

      if (!joinedTables.has(joinKey)) {
        q.join(relTable, `${currentModel.table}.${localColumn}`, '=', `${relTable}.${relColumn}`);
        joinedTables.add(joinKey);
      }

      // Advance — try to resolve the related model for the next hop.
      // We do a best-effort require() from the models directory.
      currentModel = this._resolveRelatedModel(relTable) || { table: relTable, fields: {} };
    }

    // The final segment is the leaf column on the last joined table
    const leafColumn = `${currentModel.table}.${fieldPath[fieldPath.length - 1]}`;
    return this._applyLookup(q, leafColumn, lookup || 'exact', value, method);
  }

  /**
   * Try to resolve a related Model class by table name.
   * Looks in process.cwd()/app/models/  (best-effort, graceful failure).
   */
  static _resolveRelatedModel(tableName) {
    try {
      const path     = require('path');
      const fs       = require('fs');
      const modelsDir = path.join(process.cwd(), 'app', 'models');

      if (!fs.existsSync(modelsDir)) return null;

      const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js'));

      for (const file of files) {
        try {
          const cls = require(path.join(modelsDir, file));
          const ModelClass = typeof cls === 'function' ? cls
            : Object.values(cls).find(v => typeof v === 'function');

          if (ModelClass && ModelClass.table === tableName) return ModelClass;
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    return null;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Given the split parts array, return the lookup suffix if the last
   * element is a known lookup keyword, otherwise return null.
   */
  static _extractLookup(parts) {
    const last = parts[parts.length - 1];
    return this.LOOKUPS.includes(last) ? last : null;
  }
}

module.exports = LookupParser;
