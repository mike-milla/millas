'use strict';

/**
 * Aggregates
 *
 * Functions for use with QueryBuilder.aggregate() and .annotate().
 *
 * Usage:
 *   const { Sum, Avg, Min, Max, Count } = require('millas/src/orm/query/Aggregates');
 *
 *   // Single aggregate value
 *   await Order.aggregate({ total: Sum('amount') })
 *   // → { total: 9430.50 }
 *
 *   await Order.aggregate({
 *     total:   Sum('amount'),
 *     average: Avg('amount'),
 *     lowest:  Min('amount'),
 *     highest: Max('amount'),
 *     orders:  Count('id'),
 *   })
 *
 *   // Per-row annotation (adds a computed column to each result)
 *   await Post.annotate({ comment_count: Count('comments.id') })
 *             .where('active', true)
 *             .get()
 *   // each Post instance has .comment_count
 */

class AggregateExpression {
  constructor(fn, column, options = {}) {
    this.fn      = fn;      // 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT'
    this.column  = column;
    this.distinct = options.distinct ?? false;
  }

  /**
   * Render to a knex raw expression string for use in .select() or .count() etc.
   * @param {string} alias  — SQL alias for the result column
   */
  toSQL(alias) {
    const col  = this.column === '*' ? '*' : `"${this.column.replace('.', '"."')}"`;
    const expr = this.distinct ? `${this.fn}(DISTINCT ${col})` : `${this.fn}(${col})`;
    return alias ? `${expr} as ${alias}` : expr;
  }
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

const Sum   = (column, opts) => new AggregateExpression('SUM',   column, opts);
const Avg   = (column, opts) => new AggregateExpression('AVG',   column, opts);
const Min   = (column, opts) => new AggregateExpression('MIN',   column, opts);
const Max   = (column, opts) => new AggregateExpression('MAX',   column, opts);
const Count = (column = '*', opts) => new AggregateExpression('COUNT', column, opts);

module.exports = { AggregateExpression, Sum, Avg, Min, Max, Count };
