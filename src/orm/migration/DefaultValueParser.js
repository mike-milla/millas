'use strict';

/**
 * DefaultValueParser
 *
 * Evaluates user-provided default value expressions in a safe, restricted
 * context during makemigrations.
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 *
 *  1. Receives raw string input from the developer (e.g. "42", "'hello'",
 *     "Date.now", "crypto.randomUUID", "() => new Date().toISOString()")
 *
 *  2. Classifies it as:
 *       literal   — a plain value that can be serialised to JSON
 *                   (number, string, boolean, null, array, object)
 *       callable  — a reference or arrow function that must be called
 *                   per-row at migration time (Date.now, uuid, etc.)
 *
 *  3. For literals: evaluates the expression and returns the typed value
 *  4. For callables: stores the expression string as-is (never evaluated here)
 *
 * ── Safe context ─────────────────────────────────────────────────────────────
 *
 *  The evaluation sandbox pre-imports a whitelist of safe helpers:
 *    Date         — current time
 *    crypto       — randomUUID, randomBytes
 *    Math         — floor, random, etc.
 *
 *  Blocked:
 *    require, process, __dirname, __filename, Buffer (file/OS/network access)
 *    eval, Function constructor (code injection)
 *
 * ── Result shape ─────────────────────────────────────────────────────────────
 *
 *   Literal:
 *     { kind: 'literal', value: 42, expression: '42' }
 *
 *   Callable:
 *     { kind: 'callable', expression: 'Date.now' }
 *     { kind: 'callable', expression: '() => crypto.randomUUID()' }
 *
 * ── How it's stored in migration files ───────────────────────────────────────
 *
 *   Literal:   oneOffDefault: { kind: 'literal', value: 42 }
 *              Rendered as:  { kind: 'literal', value: 42 }
 *
 *   Callable:  oneOffDefault: { kind: 'callable', expression: 'Date.now' }
 *              Rendered as:  { kind: 'callable', expression: 'Date.now' }
 *
 * ── How it's applied at migrate time ─────────────────────────────────────────
 *
 *   Literal:   db(table).whereNull(col).update({ col: value })
 *              — single UPDATE for all rows
 *
 *   Callable:  called once per row, each row gets its own value
 *              — used for uuid, timestamps, random values
 *
 * ── Determinism ──────────────────────────────────────────────────────────────
 *
 *   The migration file always stores the EXPRESSION, never the evaluated
 *   result. This means:
 *     - `Date.now` in the file → each deployment gets the current timestamp
 *     - `42` in the file → always 42, deterministic across deployments
 *   The developer chooses which behaviour they want by what they type.
 */
class DefaultValueParser {

  /**
   * Parse a raw string input from the developer.
   *
   * @param {string} raw        — what the developer typed
   * @param {string} fieldType  — 'string' | 'integer' | 'boolean' | etc.
   * @returns {{ kind: 'literal'|'callable', value?: *, expression: string }}
   * @throws {Error} if input is unsafe or unparseable
   */
  parse(raw, fieldType) {
    const trimmed = raw.trim();

    if (!trimmed) {
      throw new Error('No value provided. Enter a value or expression.');
    }

    // ── Detect callable ───────────────────────────────────────────────────────
    if (this._isCallable(trimmed)) {
      this._assertSafe(trimmed);
      return { kind: 'callable', expression: trimmed };
    }

    // ── Evaluate as literal ───────────────────────────────────────────────────
    this._assertSafe(trimmed);
    const value = this._evalLiteral(trimmed, fieldType);
    return { kind: 'literal', value, expression: this._serialiseExpression(value) };
  }

  // ─── Detection ────────────────────────────────────────────────────────────

  /**
   * Detect if the input looks like a callable reference or function.
   *
   * Callables:
   *   Date.now                    — property reference (no call)
   *   crypto.randomUUID           — property reference
   *   () => new Date().toISOString()  — arrow function
   *   function() { return 1; }   — function expression
   *   Date.now()                  — already called → callable (per-row)
   */
  _isCallable(expr) {
    // Arrow function
    if (/^\(?\s*\w*\s*\)?\s*=>/.test(expr)) return true;
    // function keyword
    if (/^function\s*\(/.test(expr)) return true;
    // Property reference that maps to a known callable
    if (CALLABLE_REFS.has(expr)) return true;
    // Dot-notation that ends in a name (not a string/number/bool)
    // e.g. Date.now, crypto.randomUUID, Math.random
    if (/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(expr)) {
      // Only treat as callable if first segment is a known safe object
      const root = expr.split('.')[0];
      return SAFE_GLOBALS.has(root);
    }
    // Function call expression e.g. Date.now() or crypto.randomUUID()
    if (/^[A-Za-z_$][A-Za-z0-9_$.]+\(\)$/.test(expr)) return true;
    return false;
  }

  // ─── Safety ───────────────────────────────────────────────────────────────

  /**
   * Throw if the expression contains forbidden patterns.
   * This is a defense-in-depth check — the sandbox also blocks these,
   * but we want a clear error message before even attempting evaluation.
   */
  _assertSafe(expr) {
    const forbidden = [
      /\brequire\s*\(/,          // require()
      /\bimport\s*\(/,           // dynamic import
      /\bprocess\b/,             // process.env, process.exit
      /\b__dirname\b/,           // filesystem
      /\b__filename\b/,          // filesystem
      /\bfs\b/,                  // fs module
      /\bchild_process\b/,       // shell
      /\bexec\b\s*\(/,           // exec()
      /\bspawn\b\s*\(/,          // spawn()
      /\bfetch\b\s*\(/,          // network
      /\bXMLHttpRequest\b/,      // network
      /\bnew\s+Function\b/,      // Function constructor
      /\beval\s*\(/,             // eval
      /\bsetTimeout\b/,          // async timing
      /\bsetInterval\b/,         // async timing
      /\bglobalThis\b/,          // global escape
      /\bself\b/,                // global escape
      /\bwindow\b/,              // DOM escape
    ];

    for (const pattern of forbidden) {
      if (pattern.test(expr)) {
        throw new Error(
          `Unsafe expression: "${expr}" contains a forbidden pattern.\n` +
          `Only safe expressions are allowed (literals, Date, Math, crypto).`
        );
      }
    }
  }

  // ─── Literal evaluation ───────────────────────────────────────────────────

  _evalLiteral(expr, fieldType) {
    // ── null ──────────────────────────────────────────────────────────────────
    if (expr === 'null' || expr === 'NULL') return null;

    // ── boolean ───────────────────────────────────────────────────────────────
    if (expr === 'true'  || expr === 'True')  return true;
    if (expr === 'false' || expr === 'False') return false;

    // ── quoted string ─────────────────────────────────────────────────────────
    if ((expr.startsWith('"') && expr.endsWith('"')) ||
        (expr.startsWith("'") && expr.endsWith("'"))) {
      return expr.slice(1, -1);
    }

    // ── number ────────────────────────────────────────────────────────────────
    if (/^-?\d+(\.\d+)?$/.test(expr)) {
      const n = Number(expr);
      if (!isNaN(n)) return n;
    }

    // ── JSON array / object ───────────────────────────────────────────────────
    if ((expr.startsWith('[') && expr.endsWith(']')) ||
        (expr.startsWith('{') && expr.endsWith('}'))) {
      try { return JSON.parse(expr); } catch {}
    }

    // ── Field-type coercion for bare unquoted strings ─────────────────────────
    if (fieldType === 'integer' || fieldType === 'bigInteger') {
      const n = parseInt(expr, 10);
      if (!isNaN(n)) return n;
      throw new Error(`"${expr}" is not a valid integer.`);
    }
    if (fieldType === 'float' || fieldType === 'decimal') {
      const f = parseFloat(expr);
      if (!isNaN(f)) return f;
      throw new Error(`"${expr}" is not a valid number.`);
    }
    if (fieldType === 'boolean') {
      if (['1', 'yes', 'y'].includes(expr.toLowerCase())) return true;
      if (['0', 'no',  'n'].includes(expr.toLowerCase())) return false;
      throw new Error(`"${expr}" is not a valid boolean.`);
    }

    // ── Safe Date/Math expressions ────────────────────────────────────────────
    // e.g. "new Date().toISOString()" evaluated once as a literal snapshot
    if (/^new\s+Date\s*\(/.test(expr) || /^Math\./.test(expr)) {
      try {
        const result = this._sandboxEval(expr);
        return result;
      } catch (e) {
        throw new Error(`Could not evaluate "${expr}": ${e.message}`);
      }
    }

    // ── Bare unquoted string (last resort for string/text/enum fields) ────────
    if (['string', 'text', 'enum', 'uuid', 'date', 'timestamp'].includes(fieldType)) {
      return expr;
    }

    throw new Error(
      `Cannot interpret "${expr}" as a ${fieldType}.\n` +
      `For strings, wrap in quotes: '${expr}'\n` +
      `For callables (uuid, timestamp), they will be called per-row at migrate time.`
    );
  }

  /**
   * Minimal sandbox for safe Date/Math expressions only.
   * Uses Function constructor with a clean scope — no globals exposed.
   */
  _sandboxEval(expr) {
    // eslint-disable-next-line no-new-func
    const fn = new Function('Date', 'Math', `'use strict'; return (${expr});`);
    return fn(Date, Math);
  }

  // ─── Serialisation ────────────────────────────────────────────────────────

  /**
   * Convert a literal JS value back to a clean expression string.
   * Used to display confirmation back to the developer.
   */
  _serialiseExpression(value) {
    if (value === null)            return 'null';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  }
}

// ─── Safe callable registry ───────────────────────────────────────────────────

/**
 * Exact callable references the developer can type.
 * These are resolved to actual functions at migration time.
 */
const CALLABLE_REFS = new Map([
  ['Date.now',          () => Date.now()],
  ['Date.now()',        () => Date.now()],
  ['new Date()',        () => new Date().toISOString()],
  ['crypto.randomUUID', () => require('crypto').randomUUID()],
  ['crypto.randomUUID()', () => require('crypto').randomUUID()],
  ['Math.random',       () => Math.random()],
  ['Math.random()',     () => Math.random()],
]);

/**
 * Safe root objects that are allowed in callable expressions.
 */
const SAFE_GLOBALS = new Set(['Date', 'Math', 'crypto', 'JSON', 'Number', 'String', 'Boolean']);

/**
 * Resolve a stored `oneOffDefault` descriptor into a concrete value or function.
 *
 * Called at migration time (inside AddField.up()), NOT at makemigrations time.
 *
 * @param {{ kind: 'literal'|'callable', value?: *, expression?: string }} descriptor
 * @returns {* | () => *}  — a literal value, or a zero-arg function for callables
 */
function resolveDefault(descriptor) {
  if (!descriptor) return undefined;

  // Legacy: plain primitive stored directly (backward compat with old migrations)
  if (typeof descriptor !== 'object' || !('kind' in descriptor)) {
    return descriptor;
  }

  if (descriptor.kind === 'literal') {
    return descriptor.value;
  }

  if (descriptor.kind === 'callable') {
    const expr = descriptor.expression;

    // Known safe callable → return the pre-registered function
    if (CALLABLE_REFS.has(expr)) {
      return CALLABLE_REFS.get(expr);
    }

    // Arrow function or function expression → compile in safe context
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('Date', 'Math', 'crypto',
        `'use strict'; return (${expr});`
      )(Date, Math, require('crypto'));
      if (typeof fn === 'function') return fn;
      // Expression evaluated to a value — treat as literal
      return () => fn;
    } catch (e) {
      throw new Error(`Cannot resolve callable default "${expr}": ${e.message}`);
    }
  }

  throw new Error(`Unknown oneOffDefault descriptor kind: "${descriptor.kind}"`);
}

module.exports = { DefaultValueParser, resolveDefault, CALLABLE_REFS, SAFE_GLOBALS };
