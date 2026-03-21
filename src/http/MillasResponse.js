'use strict';

// Secure cookie defaults — can be overridden per-call or via config/security.js
// These are applied in cookie() below; callers can override any individual option.
let _cookieDefaults = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'Lax',
  path:     '/',
};

/**
 * MillasResponse
 *
 * An immutable value object representing an HTTP response.
 * Nothing is written to the socket until ResponseDispatcher.dispatch() is called.
 *
 * Developers never instantiate this directly — use the helper functions:
 *   jsonify(data, options)
 *   view('template', data, options)
 *   redirect('/path', options)
 *   text('Hello', options)
 *   file('/path/to/file')
 *   empty(204)
 *
 * Route handlers return a MillasResponse (or a plain value that gets
 * auto-wrapped). Middleware can inspect or modify the response before
 * it reaches the dispatcher.
 *
 * Fluent mutation — each method returns a NEW MillasResponse:
 *   return jsonify(user).status(201).header('X-Custom', 'value');
 */
class MillasResponse {
  /**
   * @param {object} options
   * @param {string}  options.type     — 'json' | 'html' | 'text' | 'redirect' | 'file' | 'empty' | 'stream'
   * @param {*}       options.body     — response body
   * @param {number}  [options.status] — HTTP status code (default: 200)
   * @param {object}  [options.headers]— additional headers
   * @param {object}  [options.cookies]— cookies to set: { name: { value, options } }
   */
  constructor({ type, body, status = 200, headers = {}, cookies = {} } = {}) {
    this._type    = type;
    this._body    = body;
    this._status  = status;
    this._headers = { ...headers };
    this._cookies = { ...cookies };

    // Make immutable after construction
    Object.freeze(this._headers);
    Object.freeze(this._cookies);
  }

  // ─── Accessors ──────────────────────────────────────────────────────────────

  get type()    { return this._type; }
  get body()    { return this._body; }
  get statusCode() { return this._status; }
  get headers() { return this._headers; }
  get cookies() { return this._cookies; }

  // ─── Fluent builders (return new instance each time) ─────────────────────

  /**
   * Set the HTTP status code.
   *   return jsonify(data).status(201)
   */
  status(code) {
    return new MillasResponse({
      type:    this._type,
      body:    this._body,
      status:  code,
      headers: this._headers,
      cookies: this._cookies,
    });
  }

  /**
   * Add or override a response header.
   *   return jsonify(data).header('X-Custom-Id', '123')
   */
  header(name, value) {
    return new MillasResponse({
      type:    this._type,
      body:    this._body,
      status:  this._status,
      headers: { ...this._headers, [name]: value },
      cookies: this._cookies,
    });
  }

  /**
   * Add multiple headers at once.
   *   return jsonify(data).withHeaders({ 'X-A': '1', 'X-B': '2' })
   */
  withHeaders(map = {}) {
    return new MillasResponse({
      type:    this._type,
      body:    this._body,
      status:  this._status,
      headers: { ...this._headers, ...map },
      cookies: this._cookies,
    });
  }

  /**
   * Set a cookie on the response.
   *
   * Secure defaults (httpOnly, secure, sameSite: Lax, path: /) are applied
   * automatically. Pass explicit options to override any individual default.
   *
   *   // Secure by default — no extra options needed:
   *   return jsonify(data).cookie('session', token)
   *
   *   // Override individual options:
   *   return jsonify(data).cookie('token', jwt, { maxAge: 3600 })
   *
   *   // Opt out of a default (e.g. a non-sensitive preference cookie):
   *   return jsonify(data).cookie('theme', 'dark', { httpOnly: false })
   *
   *   // Cross-site cookie (e.g. OAuth callback) — must also set secure: true:
   *   return jsonify(data).cookie('oauth_state', state, { sameSite: 'None', secure: true })
   */
  cookie(name, value, options = {}) {
    // Merge: secure defaults < caller options
    // This means callers can always override, but never accidentally get insecure defaults
    const merged = { ..._cookieDefaults, ...options };
    return new MillasResponse({
      type:    this._type,
      body:    this._body,
      status:  this._status,
      headers: this._headers,
      cookies: { ...this._cookies, [name]: { value, options: merged } },
    });
  }

  /**
   * Clear a cookie.
   *
   *   return jsonify(data).clearCookie('session')
   *
   * Preserves the same path/domain options used when the cookie was set
   * so the browser correctly removes it.
   */
  clearCookie(name, options = {}) {
    // Must match the path/domain of the original cookie for the browser to delete it.
    // Merge defaults so path always matches.
    const clearOpts = { ..._cookieDefaults, ...options, maxAge: 0, expires: new Date(0) };
    return new MillasResponse({
      type:    this._type,
      body:    this._body,
      status:  this._status,
      headers: this._headers,
      cookies: { ...this._cookies, [name]: { value: '', options: clearOpts } },
    });
  }

  // ─── Static factories ─────────────────────────────────────────────────────

  /** JSON response */
  static json(data, { status = 200, headers = {} } = {}) {
    return new MillasResponse({
      type: 'json',
      body: data,
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  }

  /** HTML response */
  static html(html, { status = 200, headers = {} } = {}) {
    return new MillasResponse({
      type: 'html',
      body: html,
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
    });
  }

  /** Plain text response */
  static text(text, { status = 200, headers = {} } = {}) {
    return new MillasResponse({
      type: 'text',
      body: String(text),
      status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers },
    });
  }

  /** Redirect response */
  static redirect(url, { status = 302 } = {}) {
    return new MillasResponse({
      type:    'redirect',
      body:    url,
      status,
      headers: { Location: url },
    });
  }

  /** File download / serve response */
  static file(filePath, { download = false, name = null, headers = {} } = {}) {
    return new MillasResponse({
      type: 'file',
      body: { path: filePath, download, name },
      status: 200,
      headers,
    });
  }

  /** Empty response (204 No Content by default) */
  static empty(status = 204) {
    return new MillasResponse({ type: 'empty', body: null, status });
  }

  /** Rendered view/template response */
  static view(template, data = {}, { status = 200, headers = {} } = {}) {
    return new MillasResponse({
      type:   'view',
      body:   { template, data },
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
    });
  }

  /**
   * Check if something is a MillasResponse instance.
   * Used by the router to distinguish from plain return values.
   */
  static isResponse(value) {
    return value instanceof MillasResponse;
  }

  /**
   * Override the global cookie defaults.
   *
   * Called by the framework bootstrap when it loads config/security.js.
   * Can also be called by developers for custom defaults:
   *
   *   MillasResponse.configureCookieDefaults({
   *     httpOnly: true,
   *     secure:   true,
   *     sameSite: 'Strict',   // stricter than default Lax
   *   });
   *
   * @param {object} defaults
   */
  static configureCookieDefaults(defaults = {}) {
    _cookieDefaults = { ..._cookieDefaults, ...defaults };
  }

  /**
   * Get the current cookie defaults (read-only copy).
   * Useful for debugging or testing.
   *
   * @returns {object}
   */
  static getCookieDefaults() {
    return { ..._cookieDefaults };
  }
}

module.exports = MillasResponse;