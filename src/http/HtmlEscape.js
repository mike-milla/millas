'use strict';

/**
 * HtmlEscape
 *
 * Escapes user-provided strings for safe inclusion in HTML output,
 * preventing Cross-Site Scripting (XSS) attacks.
 *
 * ── The problem ───────────────────────────────────────────────────────────────
 *
 *   const name = req.input('name');  // attacker sends: <script>alert(1)</script>
 *   return `<p>Hello ${name}</p>`;   // → XSS vulnerability
 *
 * ── The solution ──────────────────────────────────────────────────────────────
 *
 *   const { e } = require('millas/src/http/HtmlEscape');
 *   return `<p>Hello ${e(name)}</p>`;  // → <p>Hello &lt;script&gt;...&lt;/script&gt;</p>
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const { escapeHtml, e, safeHtml } = require('millas/src/http/HtmlEscape');
 *
 *   // Escape a single value
 *   escapeHtml('<script>alert(1)</script>')
 *   // → '&lt;script&gt;alert(1)&lt;/script&gt;'
 *
 *   // Short alias for use in template literals
 *   `<p>${e(user.name)}</p>`
 *
 *   // Build a safe HTML response — all interpolated values are escaped
 *   return safeHtml`<h1>Hello ${user.name}</h1><p>${user.bio}</p>`;
 *
 *   // Mark a value as already-safe (trusted HTML — use with caution)
 *   const trusted = new SafeString('<b>bold</b>');
 *   safeHtml`<div>${trusted}</div>`  // not double-escaped
 *
 * ── In templates ─────────────────────────────────────────────────────────────
 *
 *   When using a template engine, enable auto-escaping at the engine level.
 *   These utilities are for cases where you build HTML strings in route handlers
 *   or helpers without a template engine.
 *
 * ── What is escaped ──────────────────────────────────────────────────────────
 *
 *   &   →  &amp;     (must be first to avoid double-escaping)
 *   <   →  &lt;
 *   >   →  &gt;
 *   "   →  &quot;    (safe in attribute values)
 *   '   →  &#x27;    (safe in attribute values)
 *   /   →  &#x2F;    (helps close tags inside attribute values)
 *   `   →  &#x60;    (template literal injection)
 *   =   →  &#x3D;    (attribute injection without quotes)
 */

// ── SafeString ────────────────────────────────────────────────────────────────

/**
 * A wrapper that marks a string as already-escaped / trusted HTML.
 * safeHtml`` will not escape SafeString instances.
 *
 *   const html = new SafeString('<strong>bold</strong>');
 */
class SafeString {
  constructor(value) {
    this.value = String(value);
  }
  toString() {
    return this.value;
  }
}

// ── Core escape function ──────────────────────────────────────────────────────

const ESCAPE_MAP = {
  '&':  '&amp;',
  '<':  '&lt;',
  '>':  '&gt;',
  '"':  '&quot;',
  "'":  '&#x27;',
  '/':  '&#x2F;',
  '`':  '&#x60;',
  '=':  '&#x3D;',
};

const ESCAPE_RE = /[&<>"'`=/]/g;

/**
 * Escape a value for safe inclusion in HTML.
 * Returns an empty string for null/undefined.
 * Non-string values are converted to string first.
 * SafeString instances are returned as-is (already trusted).
 *
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
  if (value instanceof SafeString) return value.value;
  if (value === null || value === undefined) return '';
  return String(value).replace(ESCAPE_RE, c => ESCAPE_MAP[c]);
}

/**
 * Short alias — designed for template literals:
 *   `<p>${e(user.name)}</p>`
 */
const e = escapeHtml;

// ── Tagged template literal ───────────────────────────────────────────────────

/**
 * Tagged template literal that auto-escapes all interpolated values.
 * Returns a MillasResponse (html type) so it can be returned directly
 * from a route handler.
 *
 *   return safeHtml`<h1>Hello ${user.name}</h1>`;
 *   return safeHtml`<ul>${items.map(i => safeHtml`<li>${i.name}</li>`).join('')}</ul>`;
 *
 * To include trusted HTML without escaping, wrap it in SafeString:
 *   const icon = new SafeString('<svg>...</svg>');
 *   return safeHtml`<div>${icon} ${user.name}</div>`;
 *
 * @param {TemplateStringsArray} strings
 * @param {...*} values
 * @returns {string}  — escaped HTML string
 */
function safeHtml(strings, ...values) {
  let result = '';
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      result += escapeHtml(values[i]);
    }
  }
  return result;
}

// ── ResponseDispatcher integration ───────────────────────────────────────────

/**
 * Detect whether a string contains unescaped HTML characters that could
 * indicate unsanitized user input was interpolated directly.
 *
 * Used by ResponseDispatcher.autoWrap() to emit a development warning
 * when a route returns an HTML string containing potentially dangerous chars.
 *
 * This is NOT a security control — it is a development-time hint to help
 * developers discover forgotten escaping. The real protection is using
 * safeHtml`` or a template engine with auto-escaping enabled.
 *
 * @param {string} html
 * @returns {boolean}
 */
function containsUnsafeHtmlPatterns(html) {
  // Look for raw script tags, event handlers, javascript: URIs
  // that are commonly injected — not exhaustive, just a hint
  return /<script[\s>]/i.test(html)           ||
         /\son\w+\s*=/i.test(html)            ||
         /javascript\s*:/i.test(html)         ||
         /data\s*:\s*text\/html/i.test(html);
}

module.exports = { escapeHtml, e, safeHtml, SafeString, containsUnsafeHtmlPatterns };