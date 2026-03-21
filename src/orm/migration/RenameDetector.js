'use strict';

const readline = require('readline');

/**
 * RenameDetector
 *
 * Detects likely field renames during makemigrations and prompts the developer
 * to confirm, exactly as Django does:
 *
 *   Was student.age4 renamed to student.age7 (a IntegerField)? [y/N]
 *
 * ── Algorithm ─────────────────────────────────────────────────────────────────
 *
 *  For each table with both RemoveField and AddField ops:
 *    1. Find pairs where types match
 *    2. Score similarity (type match required; attribute similarity is a bonus)
 *    3. Prompt for each candidate, highest-score first
 *    4. On confirm → replace the Remove+Add pair with a single RenameField
 *    5. On deny  → keep Remove + Add as separate ops
 *
 *  Multiple renames in a single run: each candidate is prompted independently.
 *  Chained renames across migrations: handled automatically because the history
 *  state is replayed from all existing migrations, so the "old name" is always
 *  whatever the field is currently called in the DB.
 *
 * ── Matching rules ────────────────────────────────────────────────────────────
 *
 *  Required:   same table, same type
 *  Bonus:      same nullable, same default, same max/precision/enumValues
 *  No match:   different types (an integer cannot rename to a string)
 *
 * ── Non-interactive mode ──────────────────────────────────────────────────────
 *
 *  Never prompts. All Remove+Add pairs are kept as-is.
 *  This matches Django's --no-input behaviour.
 */
class RenameDetector {
  constructor(options = {}) {
    this._nonInteractive = options.nonInteractive || !process.stdin.isTTY;
  }

  /**
   * Given a flat ops list from MigrationWriter.diff(), detect and resolve renames.
   * Returns a new ops list with confirmed renames replaced by RenameField ops.
   *
   * @param {Array<object>} ops
   * @returns {Promise<Array<object>>}
   */
  async detect(ops) {
    if (this._nonInteractive) return ops;

    // Group RemoveField and AddField by table
    const removes = ops.filter(op => op.type === 'RemoveField');
    const adds    = ops.filter(op => op.type === 'AddField');

    if (removes.length === 0 || adds.length === 0) return ops;

    // Build rename candidates: (remove, add) pairs on the same table with same type
    const candidates = [];
    for (const rem of removes) {
      for (const add of adds) {
        if (rem.table !== add.table) continue;
        if (rem.field.type !== add.field.type) continue;

        const score = this._similarity(rem.field, add.field);
        candidates.push({ rem, add, score });
      }
    }

    if (candidates.length === 0) return ops;

    // Sort by score descending — highest confidence first
    candidates.sort((a, b) => b.score - a.score);

    // Track which ops have been consumed by a confirmed rename
    const consumed = new Set(); // op references

    for (const { rem, add } of candidates) {
      // Skip if either op was already consumed by a previous rename
      if (consumed.has(rem) || consumed.has(add)) continue;

      const fieldTypeLabel = this._fieldTypeLabel(rem.field);
      const confirmed = await this._ask(rem.table, rem.column, add.column, fieldTypeLabel);

      if (confirmed) {
        consumed.add(rem);
        consumed.add(add);
        // Mark for replacement — attach the rename info to the RemoveField op
        rem._renameToColumn = add.column;
      }
    }

    // Rebuild ops list: replace consumed pairs with RenameField, preserve order
    const result = [];
    for (const op of ops) {
      if (consumed.has(op)) {
        if (op.type === 'RemoveField' && op._renameToColumn) {
          // Replace Remove with RenameField
          result.push({
            type:      'RenameField',
            table:     op.table,
            oldColumn: op.column,
            newColumn: op._renameToColumn,
          });
          delete op._renameToColumn;
        }
        // Skip the AddField that was consumed — it's been folded into RenameField
      } else {
        result.push(op);
      }
    }

    return result;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * Score how similar two field definitions are.
   * Type match is a prerequisite (checked before calling this).
   * Returns a score 0–5: higher = more likely a rename.
   */
  _similarity(a, b) {
    let score = 1; // base: types match
    if (a.nullable  === b.nullable)  score++;
    if (JSON.stringify(a.default)   === JSON.stringify(b.default))  score++;
    if (a.max       === b.max)       score++;
    if (JSON.stringify(a.enumValues) === JSON.stringify(b.enumValues)) score++;
    if (a.unique    === b.unique)    score++;
    return score;
  }

  /**
   * Human-readable field type label — matches Django's "a IntegerField" style.
   */
  _fieldTypeLabel(field) {
    const map = {
      id:         'AutoField',
      string:     'CharField',
      text:       'TextField',
      integer:    'IntegerField',
      bigInteger: 'BigIntegerField',
      float:      'FloatField',
      decimal:    'DecimalField',
      boolean:    'BooleanField',
      json:       'JSONField',
      date:       'DateField',
      timestamp:  'DateTimeField',
      enum:       'CharField',
      uuid:       'UUIDField',
    };
    return map[field.type] || `${field.type}Field`;
  }

  /**
   * Prompt:  Was <table>.<oldCol> renamed to <table>.<newCol> (a <Type>)? [y/N]
   * Returns true if confirmed.
   */
  async _ask(table, oldCol, newCol, typeLabel) {
    return new Promise((resolve) => {
      const question = `Was ${table}.${oldCol} renamed to ${table}.${newCol} (a ${typeLabel})? [y/N] `;
      const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
      });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      });
    });
  }
}

module.exports = RenameDetector;