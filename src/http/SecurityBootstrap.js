'use strict';

const SecurityHeaders  = require('./middleware/SecurityHeaders');
const CsrfMiddleware   = require('./middleware/CsrfMiddleware');
const { RateLimiter }  = require('./middleware/RateLimiter');
const MillasResponse   = require('./MillasResponse');

class SecurityBootstrap {
  static apply(app, config = {}) {
    const headerConfig = config.headers !== undefined ? config.headers : {};
    app.use(SecurityHeaders.from(headerConfig).middleware());

    if (config.cookies) {
      MillasResponse.configureCookieDefaults(config.cookies);
    }

    const globalRateLimit = RateLimiter.from(config.rateLimit?.global);
    if (globalRateLimit) {
      app.use(globalRateLimit.middleware());
    }

    // ── CSRF ──────────────────────────────────────────────────────────────────
    // The admin panel (/admin) manages its own CSRF via AdminAuth.
    // Auto-exclude it so the framework CSRF doesn't double-protect it.
    if (config.csrf !== false) {
      const csrfConfig  = config.csrf || {};
      const adminPrefix = config.adminPrefix || '/admin';
      const docsPrefix  = config.docsPrefix  || '/docs';
      const excluded    = [...(csrfConfig.exclude || [])];

      // Auto-exclude the admin panel — it manages its own CSRF via AdminAuth
      if (!excluded.some(p => p === adminPrefix || p.startsWith(adminPrefix + '/'))) {
        excluded.push(adminPrefix + '/');
      }

      // Auto-exclude the docs internal API — /_api/try is a dev-time proxy,
      // not a state-changing endpoint on user data. It is already protected by
      // the docs.enabled flag (off in production by default).
      const docsApiPrefix = docsPrefix + '/_api/';
      if (!excluded.some(p => p === docsApiPrefix || docsApiPrefix.startsWith(p))) {
        excluded.push(docsApiPrefix);
      }

      app.use(CsrfMiddleware.from({ ...csrfConfig, exclude: excluded }).middleware());
    }

    SecurityBootstrap._registerErrorHandler(app);

    if (process.env.MILLAS_DEBUG_SECURITY === 'true') {
      console.log('[Millas Security] Controls applied:');
      console.log('  ✓ Security headers:  ', headerConfig === false ? 'DISABLED' : 'enabled');
      console.log('  ✓ Cookie defaults:   ', JSON.stringify(MillasResponse.getCookieDefaults()));
      console.log('  ✓ Global rate limit: ', globalRateLimit ? `${config.rateLimit?.global?.max || 100} req/window` : 'disabled');
      console.log('  ✓ CSRF:              ', config.csrf === false ? 'DISABLED' : `enabled (excluding: ${adminPrefix}/, ${docsPrefix}/_api/)`);
    }
  }

  static _registerErrorHandler(app) {
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
      if (err.code === 'EBADCSRFTOKEN') {
        const isApi = (req.headers?.accept || '').includes('application/json') ||
                      (req.headers?.['content-type'] || '').includes('application/json');
        res.status(403);
        return isApi
          ? res.json({ error: 'Invalid or missing CSRF token' })
          : res.send('Forbidden: Invalid CSRF token. Please go back and try again.');
      }
      if (err.code === 'EVALIDATION' || err.name === 'ValidationError') {
        return res.status(422).json({ message: 'Validation failed', errors: err.errors || {} });
      }
      next(err);
    });
  }

  static loadConfig(configPath) {
    const path = require('path');
    const fs   = require('fs');
    // Accept either a full path to app.js or a directory (falls back to config/app.js)
    const target = configPath
      ? (configPath.endsWith('.js') ? configPath : configPath + '.js').replace(/\.js\.js$/, '.js')
      : path.join(process.cwd(), 'config', 'app.js');
    if (fs.existsSync(target)) {
      try { return require(target); } catch (err) {
        console.warn(`[Millas] Failed to load ${target}: ${err.message}. Using built-in defaults.`);
      }
    }
    return {};
  }
}

module.exports = SecurityBootstrap;