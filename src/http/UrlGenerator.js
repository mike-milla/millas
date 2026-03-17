'use strict';

/**
 * UrlGenerator
 *
 * Laravel-like URL generation service.
 * Registered in the container as 'url' by the framework after boot.
 *
 * Handles:
 *   - Absolute and relative URL generation
 *   - Named route URLs with parameter substitution
 *   - Asset URLs
 *   - Secure (HTTPS) URL forcing
 *   - Query string appending
 *   - Current / previous URL tracking (set by middleware)
 *   - Signed URLs with expiry
 */
class UrlGenerator {
  /**
   * @param {object} options
   * @param {string}          options.baseUrl        — e.g. 'http://localhost:3000'
   * @param {RouteRegistry}   options.routeRegistry  — registered named routes
   */
  constructor(options = {}) {
    this._baseUrl       = (options.baseUrl || '').replace(/\/$/, '');
    this._routeRegistry = options.routeRegistry || null;
    this._forcedScheme  = null;   // 'https' when forceHttps() is called
    this._assetUrl      = null;   // separate CDN / asset origin
    this._appKey        = options.appKey || process.env.APP_KEY || '';

    // Set by RequestUrlMiddleware on each request
    this._currentUrl    = null;
    this._previousUrl   = null;
  }

  // ── Base URL ───────────────────────────────────────────────────────────────

  /**
   * The configured base URL of the application.
   *   URL.base()  → 'https://myapp.com'
   */
  base() {
    return this._resolveBase();
  }

  // ── URL generation ─────────────────────────────────────────────────────────

  /**
   * Generate an absolute URL for a path.
   *
   *   URL.to('/users')           → 'https://myapp.com/users'
   *   URL.to('/users', { id: 1 })→ 'https://myapp.com/users?id=1'
   *   URL.to('https://other.com')→ 'https://other.com'  (already absolute)
   */
  to(path, query = {}) {
    if (this._isAbsolute(path)) return this._appendQuery(path, query);
    const base = this._resolveBase();
    const url  = base + '/' + path.replace(/^\//, '');
    return this._appendQuery(url, query);
  }

  /**
   * Generate a secure (HTTPS) URL for a path.
   *
   *   URL.secure('/login')  → 'https://myapp.com/login'
   */
  secure(path, query = {}) {
    const url = this.to(path, query);
    return url.replace(/^http:\/\//, 'https://');
  }

  /**
   * Generate a relative URL (path only, no origin).
   *
   *   URL.relative('/users')    → '/users'
   *   URL.relative('/users', { page: 2 }) → '/users?page=2'
   */
  relative(path, query = {}) {
    const normalized = '/' + path.replace(/^\//, '');
    return this._appendQuery(normalized, query);
  }

  // ── Named routes ───────────────────────────────────────────────────────────

  /**
   * Generate a URL for a named route, substituting parameters.
   *
   *   // Route: Route.get('/users/:id/posts/:postId', ...).name('users.posts.show')
   *   URL.route('users.posts.show', { id: 1, postId: 42 })
   *   → 'https://myapp.com/users/1/posts/42'
   *
   *   // Extra params become query string
   *   URL.route('users.index', { page: 2, search: 'alice' })
   *   → 'https://myapp.com/users?page=2&search=alice'
   *
   *   // Relative
   *   URL.route('users.show', { id: 5 }, { absolute: false })
   *   → '/users/5'
   */
  route(name, params = {}, options = {}) {
    if (!this._routeRegistry) {
      throw new Error('[URL] Route registry not available. Make sure the app is booted.');
    }

    const entry = this._routeRegistry.findByName(name);
    if (!entry) {
      throw new Error(`[URL] No route named "${name}".`);
    }

    const { path, query } = this._substituteParams(entry.path, params);
    const absolute = options.absolute !== false;

    if (!absolute) return this._appendQuery(path, query);
    return this._appendQuery(this._resolveBase() + path, query);
  }

  // ── Assets ─────────────────────────────────────────────────────────────────

  /**
   * Generate an asset URL (uses asset origin if configured, else base URL).
   *
   *   URL.asset('css/app.css')          → 'https://myapp.com/css/app.css'
   *   URL.asset('images/logo.png')      → 'https://cdn.myapp.com/images/logo.png'
   */
  asset(path) {
    const origin = this._assetUrl || this._resolveBase();
    return origin.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
  }

  /**
   * Generate a secure asset URL.
   */
  secureAsset(path) {
    return this.asset(path).replace(/^http:\/\//, 'https://');
  }

  // ── Current / previous ────────────────────────────────────────────────────

  /**
   * The full URL of the current request.
   * Populated by the request context — null outside of a request.
   */
  current() {
    return this._currentUrl;
  }

  /**
   * The full URL of the previous request (from Referer header).
   * Returns fallback if unavailable.
   *
   *   URL.previous()           → 'https://myapp.com/dashboard'
   *   URL.previous('/')        → '/' if no previous URL
   */
  previous(fallback = '/') {
    return this._previousUrl || this.to(fallback);
  }

  /**
   * The path portion of the current URL (no origin).
   */
  currentPath() {
    if (!this._currentUrl) return null;
    try {
      // If it's a full URL, extract pathname; otherwise treat as path directly
      if (this._isAbsolute(this._currentUrl)) {
        return new globalThis.URL(this._currentUrl).pathname;
      }
      return this._currentUrl.split('?')[0];
    } catch {
      return this._currentUrl;
    }
  }

  // ── Signed URLs ────────────────────────────────────────────────────────────

  /**
   * Generate a signed URL that cannot be tampered with.
   * Optionally expires after a given number of seconds.
   *
   *   URL.signedRoute('password.reset', { token }, 3600)
   *   → 'https://myapp.com/password/reset?token=...&expires=...&signature=...'
   */
  signedRoute(name, params = {}, expiresIn = null) {
    const base = this.route(name, params);
    return this._sign(base, expiresIn);
  }

  /**
   * Generate a signed URL for an arbitrary path.
   *
   *   URL.signedUrl('/download/file.pdf', 300)
   */
  signedUrl(path, expiresIn = null) {
    const url = this.to(path);
    return this._sign(url, expiresIn);
  }

  /**
   * Verify that a signed URL is valid and has not expired.
   * Returns true if valid, false otherwise.
   *
   *   URL.hasValidSignature(req)
   */
  hasValidSignature(req) {
    const rawUrl = this.to(req.path || req.url || '', req.query || {});
    return this._verifySignature(rawUrl);
  }

  // ── Scheme control ────────────────────────────────────────────────────────

  /**
   * Force all generated URLs to use HTTPS.
   *   URL.forceHttps()
   */
  forceHttps(force = true) {
    this._forcedScheme = force ? 'https' : null;
    return this;
  }

  /**
   * Force all generated URLs to use a specific scheme.
   *   URL.forceScheme('https')
   */
  forceScheme(scheme) {
    this._forcedScheme = scheme || null;
    return this;
  }

  /**
   * Set a separate origin for asset URLs (CDN, S3, etc.).
   *   URL.useAssetOrigin('https://cdn.myapp.com')
   */
  useAssetOrigin(origin) {
    this._assetUrl = origin ? origin.replace(/\/$/, '') : null;
    return this;
  }

  // ── Introspection ──────────────────────────────────────────────────────────

  /**
   * Check whether a string is a valid absolute URL.
   *   URL.isValid('https://example.com')  → true
   *   URL.isValid('/relative/path')       → false
   */
  isValid(url) {
    try { new URL(url); return true; } catch { return false; }
  }

  /**
   * Check whether the current request URL matches a pattern.
   * Supports * wildcards.
   *
   *   URL.is('/users/*')     → true on /users/1, /users/edit
   *   URL.is('/users')       → true only on /users
   */
  is(...patterns) {
    const path = this.currentPath() || '';
    return patterns.some(pattern => {
      const regex = new RegExp(
        '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
      );
      return regex.test(path);
    });
  }

  // ── Internal: called by framework ─────────────────────────────────────────

  /** Set by AppInitialiser / request middleware. @internal */
  _setCurrentUrl(url)  { this._currentUrl  = url; }
  _setPreviousUrl(url) { this._previousUrl = url; }

  // ── Private ────────────────────────────────────────────────────────────────

  _resolveBase() {
    let base = process.env.APP_URL || this._baseUrl;

    if (!base) {
      const host   = process.env.MILLAS_HOST || 'localhost';
      const port   = process.env.APP_PORT    || process.env.MILLAS_PORT || '3000';
      const scheme = this._forcedScheme || 'http';
      base = `${scheme}://${host}:${port}`;
    }

    if (this._forcedScheme) {
      base = base.replace(/^https?:\/\//, `${this._forcedScheme}://`);
    }

    return base.replace(/\/$/, '');
  }

  _isAbsolute(url) {
    return /^https?:\/\//.test(url);
  }

  _appendQuery(url, query = {}) {
    const pairs = Object.entries(query).filter(([, v]) => v !== undefined && v !== null);
    if (!pairs.length) return url;
    const qs = new URLSearchParams(pairs).toString();
    return url + (url.includes('?') ? '&' : '?') + qs;
  }

  /**
   * Replace :param and {param} placeholders in a route path.
   * Returns { path, query } where query holds leftover params.
   */
  _substituteParams(routePath, params) {
    const remaining = { ...params };
    let   path      = routePath;

    // Replace :param and {param} style placeholders
    path = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)\??|\{([a-zA-Z_][a-zA-Z0-9_]*)\??}/g, (_, p1, p2) => {
      const key = p1 || p2;
      if (key in remaining) {
        const val = remaining[key];
        delete remaining[key];
        return encodeURIComponent(val);
      }
      return '';
    });

    // Remove any trailing slash left by optional segments
    path = path.replace(/\/+$/, '') || '/';

    return { path, query: remaining };
  }

  _sign(url, expiresIn) {
    const crypto = require('crypto');
    let   target = url;

    if (expiresIn) {
      const expires = Math.floor(Date.now() / 1000) + expiresIn;
      target = this._appendQuery(url, { expires });
    }

    const signature = crypto
      .createHmac('sha256', this._appKey)
      .update(target)
      .digest('hex')
      .slice(0, 40);

    return this._appendQuery(target, { signature });
  }

  _verifySignature(url) {
    const crypto = require('crypto');
    try {
      const parsed    = new URL(url);
      const signature = parsed.searchParams.get('signature');
      const expires   = parsed.searchParams.get('expires');

      if (!signature) return false;

      if (expires && Math.floor(Date.now() / 1000) > Number(expires)) {
        return false; // expired
      }

      // Reconstruct the URL without the signature param to re-sign
      parsed.searchParams.delete('signature');
      const unsigned = parsed.toString();

      const expected = require('crypto')
        .createHmac('sha256', this._appKey)
        .update(unsigned)
        .digest('hex')
        .slice(0, 40);

      return signature === expected;
    } catch {
      return false;
    }
  }
}

module.exports = UrlGenerator;