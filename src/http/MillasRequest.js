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
   * Validate request input against rules.
   * Throws a 422 ValidationError on failure.
   * Returns the validated + type-coerced data subset on success.
   *
   *   const data = await req.validate({
   *     name:     'required|string|min:2|max:100',
   *     email:    'required|email',
   *     password: 'required|string|min:8',
   *     age:      'optional|number|min:13',
   *   });
   *
   * For route-level validation (runs before the handler, result in req.validated):
   *
   *   Route.post('/register', {
   *     validate: {
   *       email:    'required|email',
   *       password: 'required|string|min:8',
   *     },
   *   }, async (req) => {
   *     const { email, password } = req.validated;
   *   });
   */
  async validate(rules) {
    const { Validator } = require('../validation/Validator');
    return Validator.validate(this.all(), rules);
  }

  /**
   * The validated + coerced input — populated by route-level validation middleware.
   * Null if no route-level validation was declared for this route.
   *
   *   Route.post('/login', { validate: { email: 'required|email' } }, async (req) => {
   *     req.validated.email  // guaranteed valid email string
   *   });
   */
  get validated() {
    return this._req.validated ?? null;
  }

  // ─── CSRF ────────────────────────────────────────────────────────────────────

  /**
   * Get the CSRF token for the current request.
   * Use this in templates to populate the hidden _csrf field.
   *
   *   <input type="hidden" name="_csrf" value="<%= req.csrfToken() %>">
   *
   * Returns an empty string if CSRF middleware is not active (e.g. API routes).
   */
  csrfToken() {
    if (typeof this._req.csrfToken === 'function') {
      return this._req.csrfToken();
    }
    return '';
  }

  // ─── Escape hatch ────────────────────────────────────────────────────────────

  /**
   * The raw underlying Express request.
   *
   * WARNING: Accessing req.raw bypasses all Millas security abstractions
   * (validation, CSRF, sanitization). Use only when MillasRequest genuinely
   * does not expose what you need, and never pass req.raw values directly
   * to database queries or HTML output without manual sanitization.
   */
  get raw() {
    if (process.env.NODE_ENV === 'development') {
      // Help developers discover missing MillasRequest features
      // rather than defaulting to raw access silently
      const stack = new Error().stack?.split('\n')[2]?.trim() || '';
      console.warn(
        `[Millas] req.raw accessed at ${stack}. ` +
        'If MillasRequest is missing a feature you need, consider opening an issue ' +
        'rather than bypassing the abstraction layer.'
      );
    }
    return this._req;
  }
}

module.exports = MillasRequest;