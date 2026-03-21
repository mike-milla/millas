'use strict';

/**
 * LogRedactor
 *
 * Scrubs sensitive field values from log context objects before they
 * are serialised and written to any log channel.
 *
 * ── Why this matters ─────────────────────────────────────────────────────────
 *
 *   Log.d('Auth', 'Login', { email, password });       // password logged ✗
 *   Log.d('AI',   'Config', this._config);             // API keys logged ✗
 *   Log.d('HTTP', 'Request', req.body);                // form fields logged ✗
 *
 *   With redaction enabled (default):
 *   Log.d('Auth', 'Login', { email, password });
 *   → { email: 'alice@example.com', password: '[REDACTED]' }
 *
 * ── Default sensitive field names ────────────────────────────────────────────
 *
 *   password, passwd, secret, token, apikey, api_key, authorization,
 *   cookie, access_token, refresh_token, private_key, private, credential,
 *   ssn, credit_card, card_number, cvv, pin
 *
 *   Matching is case-insensitive and substring-based:
 *     'userPassword' matches 'password'
 *     'X-API-Key'    matches 'apikey'
 *     'AUTHORIZATION' matches 'authorization'
 *
 * ── Configuration ─────────────────────────────────────────────────────────────
 *
 *   // Add custom sensitive field names (globally):
 *   LogRedactor.addSensitiveKeys(['mpesa_pin', 'stk_passkey', 'webhook_secret']);
 *
 *   // Replace the entire list:
 *   LogRedactor.setSensitiveKeys([...LogRedactor.DEFAULT_KEYS, 'my_secret']);
 *
 *   // Change the redaction placeholder:
 *   LogRedactor.setPlaceholder('***');
 *
 *   // Disable redaction entirely (not recommended for production):
 *   LogRedactor.disable();
 *
 * ── Integration ───────────────────────────────────────────────────────────────
 *
 *   Redaction is applied automatically inside every formatter's format() call.
 *   No action needed — it is on by default.
 */

// ── Default sensitive key fragments ───────────────────────────────────────────

const DEFAULT_KEYS = [
  'password', 'passwd', 'pass',
  'secret',
  'token',
  'apikey', 'api_key',
  'authorization', 'auth',
  'cookie',
  'access_token', 'accesstoken',
  'refresh_token', 'refreshtoken',
  'private_key', 'privatekey', 'private',
  'credential', 'credentials',
  'ssn',
  'credit_card', 'creditcard', 'card_number', 'cardnumber',
  'cvv', 'cvc',
  'pin',
  'passphrase',
  'webhook_secret', 'signing_secret',
];

// ── Module-level state ────────────────────────────────────────────────────────

let _sensitiveKeys  = [...DEFAULT_KEYS];
let _placeholder    = '[REDACTED]';
let _enabled        = true;
let _cachedLower    = null;  // lazily built lowercased copy

function _getLower() {
  if (!_cachedLower) _cachedLower = _sensitiveKeys.map(k => k.toLowerCase());
  return _cachedLower;
}

function _invalidateCache() {
  _cachedLower = null;
}

// ── Core redaction ────────────────────────────────────────────────────────────

/**
 * Check if a key name contains any sensitive fragment.
 *
 * @param {string} key
 * @returns {boolean}
 */
function isSensitiveKey(key) {
  const lower  = String(key).toLowerCase().replace(/[-_\s]/g, '');
  const frags  = _getLower().map(k => k.replace(/[-_\s]/g, ''));
  return frags.some(frag => lower.includes(frag));
}

/**
 * Redact sensitive values from an object (shallow or deep).
 * Returns a new object — never mutates the original.
 *
 * Handles:
 *   - Plain objects (nested recursively up to depth 10)
 *   - Arrays (each element redacted)
 *   - Primitives (returned as-is unless the key is sensitive)
 *   - Circular references (detected and replaced with '[Circular]')
 *
 * @param {*}      value    — the context value to redact
 * @param {number} [depth]  — internal recursion counter
 * @param {Set}    [seen]   — internal circular reference tracker
 * @returns {*}
 */
function redact(value, depth = 0, seen = new Set()) {
  if (!_enabled) return value;

  // Depth guard — don't recurse into deeply nested structures
  if (depth > 10) return value;

  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  // Circular reference guard
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map(item => redact(item, depth + 1, seen));
    seen.delete(value);
    return result;
  }

  const result = {};
  for (const [k, v] of Object.entries(value)) {
    if (isSensitiveKey(k)) {
      result[k] = _placeholder;
    } else if (v !== null && typeof v === 'object') {
      result[k] = redact(v, depth + 1, seen);
    } else {
      result[k] = v;
    }
  }
  seen.delete(value);
  return result;
}

// ── LogRedactor class ─────────────────────────────────────────────────────────

class LogRedactor {
  /**
   * The default list of sensitive key fragments.
   * Useful when callers want to extend it:
   *   LogRedactor.setSensitiveKeys([...LogRedactor.DEFAULT_KEYS, 'my_key']);
   */
  static get DEFAULT_KEYS() { return [...DEFAULT_KEYS]; }

  /**
   * Redact sensitive fields from a log context value.
   * Non-objects are returned unchanged.
   *
   * @param {*} context
   * @returns {*}
   */
  static redact(context) {
    if (!_enabled) return context;
    if (context === null || context === undefined) return context;
    if (typeof context !== 'object') return context;
    return redact(context);
  }

  /**
   * Add extra sensitive key fragments to the global list.
   *
   *   LogRedactor.addSensitiveKeys(['mpesa_pin', 'stk_passkey']);
   *
   * @param {string[]} keys
   */
  static addSensitiveKeys(keys) {
    _sensitiveKeys = [...new Set([..._sensitiveKeys, ...keys.map(k => k.toLowerCase())])];
    _invalidateCache();
  }

  /**
   * Replace the entire sensitive key list.
   *
   *   LogRedactor.setSensitiveKeys([...LogRedactor.DEFAULT_KEYS, 'my_secret']);
   *
   * @param {string[]} keys
   */
  static setSensitiveKeys(keys) {
    _sensitiveKeys = keys.map(k => k.toLowerCase());
    _invalidateCache();
  }

  /**
   * Get a copy of the current sensitive key list.
   *
   * @returns {string[]}
   */
  static getSensitiveKeys() {
    return [..._sensitiveKeys];
  }

  /**
   * Change the redaction placeholder string.
   *   LogRedactor.setPlaceholder('***');
   *
   * @param {string} placeholder
   */
  static setPlaceholder(placeholder) {
    _placeholder = String(placeholder);
  }

  /**
   * Enable redaction (default).
   */
  static enable() {
    _enabled = true;
  }

  /**
   * Disable redaction. Use only in test environments where you need
   * to inspect exact log context values.
   */
  static disable() {
    _enabled = false;
  }

  /**
   * Whether redaction is currently enabled.
   */
  static get enabled() { return _enabled; }

  /**
   * Check if a specific key would be redacted.
   *
   *   LogRedactor.isSensitive('userPassword')  // true
   *   LogRedactor.isSensitive('userId')        // false
   */
  static isSensitive(key) {
    return isSensitiveKey(key);
  }
}

module.exports = { LogRedactor, redact, isSensitiveKey };