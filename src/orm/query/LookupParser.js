'use strict';

/**
 * LookupParser
 *
 * Parses Django-style __ field lookups and applies them to a knex query.
 *
 * Supports unlimited depth traversal — each __ segment is either:
 *   - A relation name  → auto-JOIN (BelongsTo) or EXISTS subquery (HasMany/M2M)
 *   - A lookup suffix  → terminal condition (exact, icontains, gte, etc.)
 *
 * Examples:
 *   'age__gte'                          → WHERE age >= 18
 *   'author__name'                      → JOIN users, WHERE users.name = ?
 *   'author__profile__city__icontains'  → JOIN users JOIN profiles, WHERE LOWER(city) LIKE ?
 *   'unit_categories__unit_type__in'    → WHERE EXISTS (SELECT 1 FROM unit_categories WHERE ...)
 *   'tags__name__icontains'             → WHERE EXISTS (SELECT 1 FROM pivot JOIN tags WHERE ...)
 *   'pk'                                → WHERE id = ?  (pk shorthand)
 */
class LookupParser {

  static LOOKUPS = [
    'icontains', 'istartswith', 'iendswith', 'iexact',
    'contains', 'startswith', 'endswith', 'ilike', 'like',
    'iregex', 'regex',
    'isnull', 'between', 'range', 'notin', 'in',
    'exact', 'not',
    'gte', 'lte', 'gt', 'lt',
    'year', 'month', 'day', 'hour', 'minute', 'second',
    'date', 'time', 'week', 'week_day', 'quarter',
  ];

  /**
   * Parse a lookup key and apply the appropriate knex constraint.
   *
   * @param {object}  q          — knex query builder (mutated in place)
   * @param {string}  key        — e.g. 'age__gte', 'author__profile__city__icontains'
   * @param {*}       value      — the comparison value
   * @param {class}   ModelClass — the root Model class
   * @param {string}  [method]   — 'where' | 'orWhere' (default: 'where')
   */
  static apply(q, key, value, ModelClass, method = 'where') {
    // pk shorthand — resolve to actual primary key
    if (key === 'pk' || key === 'pk__exact') {
      q[method](ModelClass.primaryKey || 'id', value);
      return q;
    }
    if (key.startsWith('pk__')) {
      key = (ModelClass.primaryKey || 'id') + '__' + key.slice(4);
    }

    // No __ at all → plain equality
    if (!key.includes('__')) {
      q[method](key, value);
      return q;
    }

    const parts  = key.split('__');
    const lookup = this._extractLookup(parts);
    const fieldPath = lookup ? parts.slice(0, -1) : parts;

    // Single field, no relation traversal
    if (fieldPath.length === 1) {
      return this._applyLookup(q, fieldPath[0], lookup || 'exact', value, method);
    }

    // Multi-segment — walk the relation chain
    return this._applyDeep(q, fieldPath, lookup || 'exact', value, ModelClass, method);
  }

  // ─── Deep relation traversal ──────────────────────────────────────────────

  /**
   * Walk a multi-segment field path, resolving each segment as either:
   *   - A relation → JOIN (BelongsTo/HasOne) or EXISTS subquery (HasMany/M2M)
   *   - A plain column → apply the lookup
   *
   * Matches Django's names_to_path() + setup_joins() behaviour.
   */
  static _applyDeep(q, fieldPath, lookup, value, ModelClass, method) {
    let currentModel = ModelClass;
    const joinedTables = new Set(); // track already-joined tables to avoid duplicates

    for (let i = 0; i < fieldPath.length; i++) {
      const segment   = fieldPath[i];
      const isLast    = i === fieldPath.length - 1;
      const relations = currentModel._effectiveRelations
        ? currentModel._effectiveRelations()
        : (currentModel.relations || {});

      const rel = relations[segment];

      if (!rel) {
        // Not a relation — treat as a column on the current model
        const column = currentModel.table
          ? `${currentModel.table}.${segment}`
          : segment;
        return this._applyLookup(q, column, lookup, value, method);
      }

      const BelongsTo     = require('../relations/BelongsTo');
      const HasOne        = require('../relations/HasOne');
      const HasMany       = require('../relations/HasMany');
      const BelongsToMany = require('../relations/BelongsToMany');

      if (rel instanceof BelongsTo || rel instanceof HasOne) {
        // Forward FK or HasOne — safe to JOIN
        const RelatedModel = rel._related;
        if (!RelatedModel) {
          // Can't resolve — fall back to flat column
          return this._applyLookup(q, segment, lookup, value, method);
        }

        if (rel instanceof BelongsTo) {
          // FK is on current table: current.fk_col = related.pk
          const fkCol    = rel._foreignKey;
          const ownerKey = rel._ownerKey || 'id';
          const joinKey  = `${currentModel.table}__${RelatedModel.table}`;

          if (!joinedTables.has(joinKey)) {
            q = q.join(
              RelatedModel.table,
              `${currentModel.table}.${fkCol}`,
              '=',
              `${RelatedModel.table}.${ownerKey}`
            );
            joinedTables.add(joinKey);
          }
        } else {
          // HasOne — FK is on related table: related.fk_col = current.pk
          const fkCol   = rel._foreignKey;
          const localKey = rel._localKey || 'id';
          const joinKey  = `${currentModel.table}__${RelatedModel.table}`;

          if (!joinedTables.has(joinKey)) {
            q = q.join(
              RelatedModel.table,
              `${RelatedModel.table}.${fkCol}`,
              '=',
              `${currentModel.table}.${localKey}`
            );
            joinedTables.add(joinKey);
          }
        }

        if (isLast) {
          // Last segment is the relation itself — compare its PK
          const RelatedModel = rel._related;
          const pkCol = `${RelatedModel.table}.${RelatedModel.primaryKey || 'id'}`;
          return this._applyLookup(q, pkCol, lookup, value, method);
        }

        currentModel = rel._related;

      } else if (rel instanceof HasMany || rel instanceof BelongsToMany) {
        // Reverse relation — use EXISTS subquery to avoid row multiplication
        // This matches Django's split_exclude / subquery strategy for N-to-many
        const remainingPath = fieldPath.slice(i + 1);
        const remainingLookup = lookup;

        return this._applyExistsSubquery(
          q, rel, remainingPath, remainingLookup, value, currentModel, method,
          rel instanceof BelongsToMany
        );
      }
    }

    // Reached end of path without hitting a terminal — shouldn't happen
    return q;
  }

  /**
   * Apply an EXISTS subquery for HasMany and BelongsToMany relations.
   *
   * Generates:
   *   WHERE EXISTS (
   *     SELECT 1 FROM related_table
   *     WHERE related_table.fk = current_table.pk
   *     AND related_table.column [lookup] value
   *   )
   *
   * For M2M:
   *   WHERE EXISTS (
   *     SELECT 1 FROM pivot_table
   *     JOIN related_table ON pivot.related_fk = related.pk
   *     WHERE pivot.owner_fk = current.pk
   *     AND related_table.column [lookup] value
   *   )
   */
  static _applyExistsSubquery(q, rel, remainingPath, lookup, value, ownerModel, method, isM2M) {
    const HasMany       = require('../relations/HasMany');
    const BelongsToMany = require('../relations/BelongsToMany');
    const DatabaseManager = require('../drivers/DatabaseManager');

    const db = DatabaseManager.connection(ownerModel.connection || null);

    if (isM2M) {
      const RelatedModel    = rel._related;
      const pivotTable      = rel._pivotTable;
      const foreignPivotKey = rel._foreignPivotKey;
      const relatedPivotKey = rel._relatedPivotKey;
      const localKey        = rel._localKey || 'id';
      const relatedKey      = rel._relatedKey || 'id';

      q[method](function () {
        let sub = db(pivotTable)
          .select(db.raw('1'))
          .join(
            RelatedModel.table,
            `${RelatedModel.table}.${relatedKey}`,
            '=',
            `${pivotTable}.${relatedPivotKey}`
          )
          .whereRaw(
            `${pivotTable}.${foreignPivotKey} = ${ownerModel.table}.${localKey}`
          );

        if (remainingPath.length > 0) {
          const colName = `${RelatedModel.table}.${remainingPath.join('__')}`;
          LookupParser._applyLookup(sub, colName, lookup, value, 'where');
        }

        this.whereExists(sub);
      });

    } else {
      // HasMany
      const RelatedModel = rel._related;
      const foreignKey   = rel._foreignKey;
      const localKey     = rel._localKey || 'id';

      q[method](function () {
        let sub = db(RelatedModel.table)
          .select(db.raw('1'))
          .whereRaw(
            `${RelatedModel.table}.${foreignKey} = ${ownerModel.table}.${localKey}`
          );

        if (remainingPath.length > 0) {
          // Remaining path could be a simple column or another deep lookup
          // Qualify the column with the table name to avoid ambiguity
          const remainingKey = remainingPath.join('__');
          // If it's a simple column (no further relation hops), qualify it
          const firstSegment = remainingPath[0];
          const relRelations = RelatedModel._effectiveRelations
            ? RelatedModel._effectiveRelations()
            : (RelatedModel.relations || {});
          const isRelation = !!relRelations[firstSegment];
          if (!isRelation && remainingPath.length === 1) {
            // Simple column — qualify with table name
            LookupParser._applyLookup(sub, `${RelatedModel.table}.${firstSegment}`, lookup, value, 'where');
          } else {
            LookupParser.apply(sub, remainingKey, value, RelatedModel, 'where');
          }
        }

        this.whereExists(sub);
      });
    }

    return q;
  }

  // ─── Lookup application ───────────────────────────────────────────────────

  static _applyLookup(q, column, lookup, value, method) {
    switch (lookup) {
      case 'exact':
        q[method](column, value);
        break;

      case 'iexact':
        this._applyILike(q, column, value, method);
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
        if (value) {
          if (typeof q.whereNull === 'function') q.whereNull(column);
          else q[method](column, null);
        } else {
          if (typeof q.whereNotNull === 'function') q.whereNotNull(column);
          else q[method](column, '!=', null);
        }
        break;

      case 'in':
        q[`${method}In`] ? q[`${method}In`](column, value) : q.whereIn(column, value);
        break;

      case 'notin':
        q[`${method}NotIn`] ? q[`${method}NotIn`](column, value) : q.whereNotIn(column, value);
        break;

      case 'between':
      case 'range':
        q[`${method}Between`]
          ? q[`${method}Between`](column, value)
          : q.whereBetween(column, value);
        break;

      case 'contains':
        q[method](column, 'like', `%${value}%`);
        break;

      case 'icontains':
        this._applyILike(q, column, `%${value}%`, method);
        break;

      case 'startswith':
        q[method](column, 'like', `${value}%`);
        break;

      case 'istartswith':
        this._applyILike(q, column, `${value}%`, method);
        break;

      case 'endswith':
        q[method](column, 'like', `%${value}`);
        break;

      case 'iendswith':
        this._applyILike(q, column, `%${value}`, method);
        break;

      case 'like':
        q[method](column, 'like', value);
        break;

      case 'ilike':
        this._applyILike(q, column, value, method);
        break;

      case 'regex':
        this._applyRegex(q, column, value, method, false);
        break;

      case 'iregex':
        this._applyRegex(q, column, value, method, true);
        break;

      case 'year':
      case 'month':
      case 'day':
      case 'hour':
      case 'minute':
      case 'second':
      case 'date':
      case 'time':
      case 'week':
      case 'week_day':
      case 'quarter':
        this._applyDatePart(q, column, lookup, value, method);
        break;

      default:
        q[method](column, value);
    }

    return q;
  }

  // ─── Dialect-aware helpers ────────────────────────────────────────────────

  static _applyILike(q, column, pattern, method) {
    const client = q.client?.config?.client || 'sqlite3';
    if (client.includes('pg') || client.includes('postgres')) {
      q[method](column, 'ilike', pattern);
    } else {
      // SQLite / MySQL: LOWER() both sides for Unicode safety
      const col = column.includes('.') ? column : `\`${column}\``;
      q[method](q.client.raw(`LOWER(${col})`), 'like', pattern.toLowerCase());
    }
  }

  static _applyRegex(q, column, pattern, method, caseInsensitive) {
    const client = q.client?.config?.client || 'sqlite3';
    if (client.includes('pg') || client.includes('postgres')) {
      const op = caseInsensitive ? '~*' : '~';
      q[method](q.client.raw(`"${column}" ${op} ?`, [pattern]));
    } else if (client.includes('mysql') || client.includes('maria')) {
      const op = caseInsensitive ? 'REGEXP' : 'REGEXP BINARY';
      q[method](q.client.raw(`\`${column}\` ${op} ?`, [pattern]));
    } else {
      console.warn(`[Millas] regex lookup is not supported on SQLite. Falling back to LIKE.`);
      q[method](column, 'like', `%${pattern}%`);
    }
  }

  static _applyDatePart(q, column, part, value, method) {
    const client = q.client?.config?.client || 'sqlite3';

    if (client.includes('pg') || client.includes('postgres')) {
      const pgMap = {
        year: 'YEAR', month: 'MONTH', day: 'DAY',
        hour: 'HOUR', minute: 'MINUTE', second: 'SECOND',
        week: 'WEEK', quarter: 'QUARTER',
        date: 'DATE', time: 'TIME', week_day: 'DOW',
      };
      const pgPart = pgMap[part] || part.toUpperCase();
      if (part === 'date') {
        q[method](q.client.raw(`"${column}"::date`), value);
      } else if (part === 'time') {
        q[method](q.client.raw(`"${column}"::time`), value);
      } else {
        q[method](q.client.raw(`EXTRACT(${pgPart} FROM "${column}")`), value);
      }

    } else if (client.includes('mysql') || client.includes('maria')) {
      const mysqlMap = {
        year: 'YEAR', month: 'MONTH', day: 'DAY',
        hour: 'HOUR', minute: 'MINUTE', second: 'SECOND',
        week: 'WEEK', quarter: 'QUARTER',
        date: 'DATE', time: 'TIME', week_day: 'DAYOFWEEK',
      };
      const fn = mysqlMap[part] || part.toUpperCase();
      q[method](q.client.raw(`${fn}(\`${column}\`)`), value);

    } else {
      // SQLite
      const fmtMap = {
        year: '%Y', month: '%m', day: '%d',
        hour: '%H', minute: '%M', second: '%S',
        date: '%Y-%m-%d', time: '%H:%M:%S',
        week: '%W', week_day: '%w', quarter: null,
      };
      const fmt = fmtMap[part];
      if (!fmt) {
        q[method](q.client.raw(`CAST((strftime('%m', \`${column}\`) + 2) / 3 AS INTEGER)`), value);
      } else {
        const pad = part === 'year' ? 4 : 2;
        q[method](
          q.client.raw(`strftime('${fmt}', \`${column}\`)`),
          String(value).padStart(pad, '0')
        );
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  static _extractLookup(parts) {
    const last = parts[parts.length - 1];
    return this.LOOKUPS.includes(last) ? last : null;
  }
}

module.exports = LookupParser;
