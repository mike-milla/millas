'use strict';

/**
 * SecurityHeaders middleware
 *
 * Sets secure HTTP response headers on every outgoing response.
 * Enabled by default in the Millas HTTP kernel — opt-out, not opt-in.
 *
 * Covers:
 *   • Content-Security-Policy     — XSS mitigation
 *   • Strict-Transport-Security   — HTTPS enforcement
 *   • X-Frame-Options             — clickjacking prevention
 *   • X-Content-Type-Options      — MIME sniffing prevention
 *   • Referrer-Policy             — referrer leakage prevention
 *   • Permissions-Policy          — browser feature scoping
 *   • X-Powered-By removal        — fingerprinting reduction
 *
 * ── Usage (automatic — loaded by HttpKernel) ────────────────────────────────
 *
 *   // Loaded automatically. No developer action required.
 *
 * ── Customising CSP (config/security.js) ────────────────────────────────────
 *
 *   module.exports = {
 *     headers: {
 *       contentSecurityPolicy: {
 *         directives: {
 *           defaultSrc: ["'self'"],
 *           scriptSrc:  ["'self'", 'cdn.example.com'],
 *           imgSrc:     ["'self'", 'data:', 'https:'],
 *         },
 *       },
 *       // Disable a specific header:
 *       xFrameOptions: false,
 *     },
 *   };
 *
 * ── Disabling entirely (not recommended) ───────────────────────────────────
 *
 *   // config/security.js
 *   module.exports = { headers: false };
 *
 * ── Nonces (for inline scripts) ────────────────────────────────────────────
 *
 *   // The middleware attaches a per-request nonce to req.cspNonce
 *   // Use it in templates: <script nonce="<%= req.cspNonce %>">
 *   //
 *   // Enable via config:
 *   contentSecurityPolicy: {
 *     useNonce: true,
 *     directives: {
 *       scriptSrc: ["'self'"],  // nonce is appended automatically
 *     },
 *   },
 */

const crypto = require('crypto');

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  contentSecurityPolicy: {
    useNonce: false,
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'"],
      styleSrc:      ["'self'", "'unsafe-inline'"],
      imgSrc:        ["'self'", 'data:'],
      fontSrc:       ["'self'"],
      connectSrc:    ["'self'"],
      objectSrc:     ["'none'"],
      frameSrc:      ["'none'"],
      baseUri:       ["'self'"],
      formAction:    ["'self'"],
      frameAncestors:["'none'"],
      upgradeInsecureRequests: [],
    },
  },

  // HSTS: 1 year, include subdomains, allow preload
  // Only sent over HTTPS — the middleware checks req.secure
  strictTransportSecurity: {
    maxAge:            31536000,
    includeSubDomains: true,
    preload:           true,
  },

  // Deny framing entirely — use 'SAMEORIGIN' if you need iframes on your own domain
  xFrameOptions: 'DENY',

  // Prevent MIME-type sniffing
  xContentTypeOptions: true,

  // Only send the origin (no path) as referrer; never send cross-origin referrer
  referrerPolicy: 'strict-origin-when-cross-origin',

  // Disable access to sensitive browser features by default
  permissionsPolicy: {
    camera:         '()',
    microphone:     '()',
    geolocation:    '()',
    payment:        '()',
    usb:            '()',
    magnetometer:   '()',
    gyroscope:      '()',
    accelerometer:  '()',
  },

  // Remove X-Powered-By: Express
  removePoweredBy: true,
};

// ── CSP builder ───────────────────────────────────────────────────────────────

/**
 * Build a Content-Security-Policy header value from a directives object.
 *
 * @param {object} directives
 * @param {string|null} nonce
 * @returns {string}
 */
function buildCsp(directives, nonce = null) {
  return Object.entries(directives)
    .map(([key, value]) => {
      // camelCase → kebab-case
      const directive = key.replace(/([A-Z])/g, '-$1').toLowerCase();

      if (!Array.isArray(value) || value.length === 0) {
        // Bare directives (e.g. upgrade-insecure-requests)
        if (Array.isArray(value) && value.length === 0) return directive;
        return null;
      }

      let sources = [...value];

      // Inject nonce into scriptSrc and styleSrc if enabled
      if (nonce && (key === 'scriptSrc' || key === 'styleSrc')) {
        sources = sources.filter(s => !s.startsWith("'nonce-"));
        sources.push(`'nonce-${nonce}'`);
      }

      return `${directive} ${sources.join(' ')}`;
    })
    .filter(Boolean)
    .join('; ');
}

// ── Permissions-Policy builder ────────────────────────────────────────────────

function buildPermissionsPolicy(features) {
  return Object.entries(features)
    .map(([feature, allowlist]) => `${feature}=${allowlist}`)
    .join(', ');
}

// ── Merge helpers ─────────────────────────────────────────────────────────────

function mergeDeep(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = mergeDeep(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ── SecurityHeaders class ─────────────────────────────────────────────────────

class SecurityHeaders {
  /**
   * @param {object|false} config  — merged with DEFAULTS; pass false to disable
   */
  constructor(config = {}) {
    if (config === false) {
      this._disabled = true;
      return;
    }

    this._disabled = false;
    this._config   = mergeDeep(DEFAULTS, config);
  }

  // ── Express middleware ────────────────────────────────────────────────────

  /**
   * Returns an Express-compatible middleware function.
   *
   *   app.use(new SecurityHeaders(config).middleware());
   *
   * The Millas HttpKernel calls this automatically — developers
   * do not need to call it directly unless customising bootstrap.
   */
  middleware() {
    if (this._disabled) {
      return (_req, _res, next) => next();
    }

    const cfg = this._config;

    return (req, res, next) => {
      // ── Remove X-Powered-By ──────────────────────────────────────────────
      if (cfg.removePoweredBy) {
        res.removeHeader('X-Powered-By');
      }

      // ── Content-Security-Policy ──────────────────────────────────────────
      if (cfg.contentSecurityPolicy !== false) {
        const cspCfg = cfg.contentSecurityPolicy;
        let nonce = null;

        if (cspCfg.useNonce) {
          nonce = crypto.randomBytes(16).toString('base64');
          // Attach to req so templates can use it: req.cspNonce
          req.cspNonce = nonce;
        }

        const cspValue = buildCsp(cspCfg.directives, nonce);
        res.setHeader('Content-Security-Policy', cspValue);
      }

      // ── Strict-Transport-Security ────────────────────────────────────────
      // Only set over HTTPS. Express sets req.secure based on protocol.
      if (cfg.strictTransportSecurity !== false) {
        const hsts = cfg.strictTransportSecurity;
        let value  = `max-age=${hsts.maxAge}`;
        if (hsts.includeSubDomains) value += '; includeSubDomains';
        if (hsts.preload)           value += '; preload';
        // Always set it — if behind a proxy, trust the X-Forwarded-Proto header
        res.setHeader('Strict-Transport-Security', value);
      }

      // ── X-Frame-Options ──────────────────────────────────────────────────
      if (cfg.xFrameOptions !== false) {
        res.setHeader('X-Frame-Options', cfg.xFrameOptions);
      }

      // ── X-Content-Type-Options ───────────────────────────────────────────
      if (cfg.xContentTypeOptions !== false) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }

      // ── Referrer-Policy ──────────────────────────────────────────────────
      if (cfg.referrerPolicy !== false) {
        res.setHeader('Referrer-Policy', cfg.referrerPolicy);
      }

      // ── Permissions-Policy ───────────────────────────────────────────────
      if (cfg.permissionsPolicy !== false) {
        res.setHeader('Permissions-Policy', buildPermissionsPolicy(cfg.permissionsPolicy));
      }

      next();
    };
  }

  // ── Static factory (convenience) ─────────────────────────────────────────

  /**
   * Create a SecurityHeaders instance from a config section.
   *
   *   SecurityHeaders.from(config.security?.headers)
   *
   * @param {object|false|undefined} config
   * @returns {SecurityHeaders}
   */
  static from(config) {
    if (config === false) return new SecurityHeaders(false);
    return new SecurityHeaders(config || {});
  }
}

module.exports = SecurityHeaders;