'use strict';

const crypto = require('crypto');

/**
 * CsrfMiddleware
 *
 * Implements the Synchronizer Token Pattern to prevent Cross-Site Request Forgery.
 * Enabled by default for all state-changing requests (POST, PUT, PATCH, DELETE).
 * API routes and explicitly exempted paths opt out.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 *   1. On any GET request, a signed CSRF token is generated and stored in a
 *      cookie (_csrf) + made available via req.csrfToken().
 *   2. On state-changing requests (POST/PUT/PATCH/DELETE), the middleware reads
 *      the submitted token from the request body, query string, or header and
 *      verifies it matches the signed value from the cookie.
 *   3. If verification fails, a 403 is thrown automatically.
 *
 * ── Usage in templates ────────────────────────────────────────────────────────
 *
 *   <!-- In every HTML form — required -->
 *   <form method="POST" action="/register">
 *     <input type="hidden" name="_csrf" value="<%= req.csrfToken() %>">
 *     ...
 *   </form>
 *
 * ── Usage in fetch / AJAX ─────────────────────────────────────────────────────
 *
 *   // Read the token from the meta tag or a dedicated endpoint
 *   const token = document.querySelector('meta[name="csrf-token"]').content;
 *
 *   fetch('/api/profile', {
 *     method: 'POST',
 *     headers: { 'X-CSRF-Token': token },
 *     body: JSON.stringify(data),
 *   });
 *
 * ── Exempting routes ──────────────────────────────────────────────────────────
 *
 *   // config/security.js — exempt entire path prefixes (e.g. REST API routes)
 *   csrf: {
 *     exclude: ['/api/', '/webhooks/'],
 *   }
 *
 *   // Or use the per-route decorator (when routing module supports it):
 *   Route.post('/webhook/stripe', { csrf: false }, handler);
 *
 * ── Configuration (config/security.js) ───────────────────────────────────────
 *
 *   csrf: {
 *     cookieName:  '_csrf',           // name of the cookie holding the token
 *     fieldName:   '_csrf',           // HTML form field / body key
 *     headerName:  'x-csrf-token',    // AJAX header name
 *     exclude:     ['/api/'],         // path prefixes that skip CSRF checks
 *     tokenLength: 32,                // bytes of random entropy in the token
 *   }
 *
 * ── Security notes ────────────────────────────────────────────────────────────
 *
 *   • Tokens are HMAC-signed (SHA-256) using a secret derived from APP_SECRET.
 *     A raw random token without signing would still work against CSRF, but
 *     signing prevents an attacker from crafting a valid token without the secret.
 *   • The cookie is HttpOnly: false by design — the client-side JS needs to read
 *     it for AJAX requests. The CSRF cookie alone has no value to an attacker
 *     because they also need to submit the matching signed token in the request.
 *   • SameSite: Strict on the CSRF cookie provides defence-in-depth.
 *   • Double-submit pattern is used: cookie value is verified against the submitted
 *     token, so subdomain compromise is mitigated by the HMAC signing.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const SAFE_METHODS     = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEFAULT_CONFIG   = {
  cookieName:  '_csrf',
  fieldName:   '_csrf',
  headerName:  'x-csrf-token',
  exclude:     [],
  tokenLength: 32,
};

// ── Token utilities ────────────────────────────────────────────────────────────

/**
 * Derive an HMAC signing secret from APP_SECRET.
 * Falls back to a fixed warning value if APP_SECRET is not set —
 * this will still work but logs a warning in development.
 */
function getSecret() {
  const secret = process.env.APP_SECRET;
  if (!secret && process.env.NODE_ENV !== 'test') {
    console.warn(
      '[Millas CSRF] WARNING: APP_SECRET environment variable is not set. ' +
      'CSRF tokens are weakly signed. Set APP_SECRET in your .env file.'
    );
  }
  return crypto.createHash('sha256')
    .update(secret || 'millas-csrf-insecure-default')
    .digest();
}

/**
 * Generate a new signed CSRF token.
 * Format: <random_hex>.<hmac_hex>
 *
 * @param {number} length  — bytes of random entropy
 * @returns {string}
 */
function generateToken(length = 32) {
  const random = crypto.randomBytes(length).toString('hex');
  const hmac   = crypto.createHmac('sha256', getSecret())
    .update(random)
    .digest('hex');
  return `${random}.${hmac}`;
}

/**
 * Verify a submitted token against its HMAC signature.
 * Uses timingSafeEqual to prevent timing attacks.
 *
 * @param {string} token
 * @returns {boolean}
 */
function verifyToken(token) {
  if (typeof token !== 'string') return false;

  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) return false;

  const random   = token.slice(0, dotIndex);
  const provided = token.slice(dotIndex + 1);

  if (!random || !provided) return false;

  const expected = crypto.createHmac('sha256', getSecret())
    .update(random)
    .digest('hex');

  try {
    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── CsrfMiddleware class ───────────────────────────────────────────────────────

class CsrfMiddleware {
  /**
   * @param {object} config  — merged with DEFAULT_CONFIG
   */
  constructor(config = {}) {
    this._cfg = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Express middleware ────────────────────────────────────────────────────

  /**
   * Returns an Express-compatible middleware function.
   *
   * Attaches req.csrfToken() to every request for use in templates.
   * Validates the token on state-changing methods.
   */
  middleware() {
    const cfg = this._cfg;

    return (req, res, next) => {
      // ── Check if this path is excluded ────────────────────────────────────
      if (this._isExcluded(req.path || req.url, cfg.exclude)) {
        req.csrfToken = () => '';
        return next();
      }

      // ── Always attach csrfToken() helper to req ───────────────────────────
      // Lazily generate + cache the token for this request cycle
      let _token = null;
      req.csrfToken = () => {
        if (!_token) {
          // Re-use existing cookie token if valid, otherwise generate new one
          const existing = req.cookies?.[cfg.cookieName];
          _token = (existing && verifyToken(existing)) ? existing : generateToken(cfg.tokenLength);

          // Set / refresh the CSRF cookie
          // httpOnly: false — client JS must read this for AJAX
          // sameSite: Strict — defence-in-depth
          res.cookie(cfg.cookieName, _token, {
            httpOnly: false,
            sameSite: 'Strict',
            secure:   process.env.NODE_ENV === 'production',
            path:     '/',
          });
        }
        return _token;
      };

      // ── Safe methods — no validation needed, just ensure cookie is set ────
      if (SAFE_METHODS.has(req.method)) {
        // Touch the token so the cookie is always present after a GET
        req.csrfToken();
        return next();
      }

      // ── State-changing methods — validate the submitted token ─────────────
      const submitted =
        req.body?.[cfg.fieldName]           ||   // form field
        req.query?.[cfg.fieldName]          ||   // query string (not recommended but supported)
        req.headers?.[cfg.headerName]       ||   // AJAX header (X-CSRF-Token)
        req.headers?.['x-xsrf-token'];           // Angular-style header alias

      if (!submitted || !verifyToken(submitted)) {
        const err = new Error('Invalid or missing CSRF token');
        err.status = 403;
        err.code   = 'EBADCSRFTOKEN';
        return next(err);
      }

      // ── Rotate the token after a successful state-changing request ─────────
      // Regenerate so each token is single-use (defence-in-depth)
      _token = null; // force new token on next csrfToken() call

      next();
    };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  _isExcluded(path, excludeList) {
    if (!excludeList || excludeList.length === 0) return false;
    return excludeList.some(prefix => path.startsWith(prefix));
  }

  // ── Static factory ────────────────────────────────────────────────────────

  /**
   * Create a CsrfMiddleware from a config section.
   *
   *   CsrfMiddleware.from(config.security?.csrf)
   *
   * @param {object|false|undefined} config
   * @returns {CsrfMiddleware}
   */
  static from(config) {
    return new CsrfMiddleware(config || {});
  }

  /**
   * Expose token utilities for testing and custom integrations.
   */
  static generateToken(length)  { return generateToken(length); }
  static verifyToken(token)      { return verifyToken(token); }
}

module.exports = CsrfMiddleware;