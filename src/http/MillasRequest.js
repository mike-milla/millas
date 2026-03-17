'use strict';

/**
 * MillasRequest
 *
 * Wraps an Express request and exposes a clean, framework-level API.
 * Developers never touch the raw Express req — they use this instead.
 *
 * The raw Express req is accessible via req.raw for escape hatches,
 * but should never be needed in normal application code.
 *
 * Usage in route handlers:
 *   Route.get('/users/:id', async (req) => {
 *     const id   = req.param('id');
 *     const page = req.input('page', 1);
 *     const user = await User.findOrFail(id);
 *     return jsonify(user);
 *   });
 */
class MillasRequest {
  /**
   * @param {import('express').Request} expressReq
   */
  constructor(expressReq) {
    /** @private — access via req.raw if absolutely necessary */
    this._req = expressReq;

    // Proxy commonly-used scalar properties for convenience
    this.method  = expressReq.method;
    this.path    = expressReq.path;
    this.url     = expressReq.url;
    this.baseUrl = expressReq.baseUrl;
    this.originalUrl = expressReq.originalUrl;
  }

  // ─── Input ─────────────────────────────────────────────────────────────────

  /**
   * Read a value from body, query, or route params — in that priority order.
   * Returns defaultValue if not present.
   *
   *   req.input('email')
   *   req.input('page', 1)
   */
  input(key, defaultValue = null) {
    if (key === undefined) return this.all();
    const r = this._req;
    const v =
      (r.body   && r.body[key]   !== undefined ? r.body[key]   : undefined) ??
      (r.query  && r.query[key]  !== undefined ? r.query[key]  : undefined) ??
      (r.params && r.params[key] !== undefined ? r.params[key] : undefined);
    return v !== undefined ? v : defaultValue;
  }

  /**
   * Read a route parameter.
   *   req.param('id')
   */
  param(key, defaultValue = null) {
    return this._req.params?.[key] ?? defaultValue;
  }

  /**
   * Read a query string value.
   *   req.query('page', 1)
   */
  query(key, defaultValue = null) {
    if (key === undefined) return this._req.query || {};
    return this._req.query?.[key] ?? defaultValue;
  }

  /**
   * Read from the request body only.
   *   req.body('email')
   */
  body(key, defaultValue = null) {
    if (key === undefined) return this._req.body || {};
    return this._req.body?.[key] ?? defaultValue;
  }

  /**
   * Merge body + query + params into one flat object.
   */
  all() {
    return {
      ...this._req.params,
      ...this._req.query,
      ...this._req.body,
    };
  }

  /**
   * Return only the specified keys from the merged input.
   *   req.only(['name', 'email'])
   */
  only(keys = []) {
    const all = this.all();
    return keys.reduce((acc, k) => {
      if (k in all) acc[k] = all[k];
      return acc;
    }, {});
  }

  /**
   * Return all input except the specified keys.
   *   req.except(['password', 'token'])
   */
  except(keys = []) {
    const all = this.all();
    return Object.fromEntries(
      Object.entries(all).filter(([k]) => !keys.includes(k))
    );
  }

  // ─── Headers ────────────────────────────────────────────────────────────────

  /**
   * Read a request header (case-insensitive).
   *   req.header('Authorization')
   *   req.header('content-type')
   */
  header(name, defaultValue = null) {
    if (name === undefined) return this._req.headers || {};
    return this._req.headers?.[name.toLowerCase()] ?? defaultValue;
  }

  /**
   * All request headers as a plain object.
   */
  get headers() {
    return this._req.headers || {};
  }

  // ─── Cookies ────────────────────────────────────────────────────────────────

  /**
   * Read a cookie value.
   *   req.cookie('session_id')
   */
  cookie(name, defaultValue = null) {
    return this._req.cookies?.[name] ?? defaultValue;
  }

  // ─── Files ──────────────────────────────────────────────────────────────────

  /**
   * Get an uploaded file (requires multer or similar middleware upstream).
   *   req.file('avatar')
   */
  file(name) {
    if (this._req.files && this._req.files[name]) return this._req.files[name];
    if (this._req.file  && this._req.file.fieldname === name) return this._req.file;
    return null;
  }

  /**
   * All uploaded files.
   */
  get files() {
    return this._req.files || {};
  }

  // ─── User ───────────────────────────────────────────────────────────────────

  /**
   * The authenticated user (set by AuthMiddleware).
   */
  get user() {
    return this._req.user ?? null;
  }

  /** Set the authenticated user (used by AuthMiddleware). */
  set user(value) {
    this._req.user = value;
  }

  // ─── Content negotiation ────────────────────────────────────────────────────

  /**
   * Returns true if the request expects a JSON response.
   */
  wantsJson() {
    const accept = this.header('accept', '');
    return accept.includes('application/json') || accept.includes('*/*');
  }

  /**
   * Returns true if the request body is JSON.
   */
  isJson() {
    const ct = this.header('content-type', '');
    return ct.includes('application/json');
  }

  /**
   * Returns true if this was an XMLHttpRequest / fetch call.
   */
  isAjax() {
    return this.header('x-requested-with', '').toLowerCase() === 'xmlhttprequest';
  }

  // ─── Network ────────────────────────────────────────────────────────────────

  /**
   * Client IP address.
   */
  get ip() {
    return this._req.ip || this._req.connection?.remoteAddress || null;
  }

  /**
   * Request hostname (from Host header).
   */
  get hostname() {
    return this._req.hostname || '';
  }

  /**
   * Whether the request is HTTPS.
   */
  get secure() {
    return this._req.secure || false;
  }

  // ─── Validation ─────────────────────────────────────────────────────────────

  /**
   * Validate request input against rules. Throws 422 HttpError on failure.
   * Returns the validated data on success.
   *
   *   const data = await req.validate({
   *     name:  'required|string|min:2|max:100',
   *     email: 'required|email',
   *     age:   'optional|number|min:0',
   *   });
   */
  async validate(rules) {
    const { Validator } = require('../validation/Validator');
    return Validator.validate(this.all(), rules);
  }

  // ─── Escape hatch ────────────────────────────────────────────────────────────

  /**
   * The raw underlying Express request.
   * Only use this when you genuinely need something MillasRequest doesn't expose.
   */
  get raw() {
    return this._req;
  }
}

module.exports = MillasRequest;
