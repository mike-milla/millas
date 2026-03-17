'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

/**
 * AdminAuth
 *
 * Handles authentication for the Millas admin panel.
 *
 * Uses a signed, httpOnly cookie for sessions — no express-session
 * or database required. The cookie payload is HMAC-signed with
 * APP_KEY so it cannot be forged.
 *
 * Configuration (in Admin.configure or config/admin.js):
 *
 *   Admin.configure({
 *     auth: {
 *       // Static user list — good for simple setups
 *       users: [
 *         { email: 'admin@example.com', password: 'plain-or-bcrypt-hash', name: 'Admin' },
 *       ],
 *
 *       // OR: use a Model — any model with email + password fields
 *       model: UserModel,
 *
 *       // Cookie settings
 *       cookieName:  'millas_admin',   // default
 *       cookieMaxAge: 60 * 60 * 8,     // 8 hours (seconds), default
 *       rememberAge:  60 * 60 * 24 * 30, // 30 days when "remember me" checked
 *
 *       // Rate limiting (per IP)
 *       maxAttempts: 5,
 *       lockoutMinutes: 15,
 *     }
 *   });
 *
 * Disable auth entirely:
 *   Admin.configure({ auth: false });
 */
class AdminAuth {
  constructor() {
    this._config = null;
  }

  configure(authConfig) {
    if (authConfig === false) {
      this._config = false;
      return;
    }

    this._config = {
      users:          [],
      model:          null,
      cookieName:     'millas_admin',
      cookieMaxAge:   60 * 60 * 8,
      rememberAge:    60 * 60 * 24 * 30,
      maxAttempts:    5,
      lockoutMinutes: 15,
      ...authConfig,
    };

    // Rate limit store: Map<ip, { count, lockedUntil }>
    this._attempts = new Map();
  }

  /** Returns true if auth is enabled. */
  get enabled() {
    return this._config !== null && this._config !== false;
  }

  // ─── Middleware ────────────────────────────────────────────────────────────

  /**
   * Express middleware — allows the request through if the admin session
   * cookie is valid. Redirects to the login page otherwise.
   */
  middleware(prefix) {
    return (req, res, next) => {
      if (!this.enabled) return next();

      const loginPath = `${prefix}/login`;

      // Always allow login page and logout
      if (req.path === '/login' || req.path === `${prefix}/login`) return next();
      if (req.path === '/logout' || req.path === `${prefix}/logout`) return next();

      const user = this._getSession(req);
      if (!user) {
        const returnTo = encodeURIComponent(req.originalUrl);
        return res.redirect(`${loginPath}?next=${returnTo}`);
      }

      req.adminUser = user;
      next();
    };
  }

  // ─── Login ─────────────────────────────────────────────────────────────────

  /**
   * Attempt to log in with email + password.
   * Returns the user object on success, throws on failure.
   */
  async login(req, res, { email, password, remember = false }) {
    if (!this.enabled) return { email: 'admin', name: 'Admin' };

    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    this._checkRateLimit(ip);

    const user = await this._findUser(email);

    if (!user || !await this._checkPassword(password, user.password)) {
      this._recordFailedAttempt(ip);
      throw new Error('Invalid email or password.');
    }

    this._clearAttempts(ip);

    const maxAge = remember
      ? this._config.rememberAge
      : this._config.cookieMaxAge;

    this._setSession(res, { email: user.email, name: user.name || user.email }, maxAge);

    return user;
  }

  /** Destroy the admin session cookie. */
  logout(res) {
    res.clearCookie(this._config.cookieName, { path: '/' });
  }

  // ─── Flash (cookie-based) ─────────────────────────────────────────────────

  /** Store a flash message in a short-lived cookie. */
  setFlash(res, type, message) {
    const payload = JSON.stringify({ type, message });
    res.cookie('millas_flash', Buffer.from(payload).toString('base64'), {
      httpOnly: true,
      maxAge:   10 * 1000, // 10 seconds — survives exactly one redirect
      path:     '/',
      sameSite: 'lax',
    });
  }

  /** Read and clear the flash cookie. */
  getFlash(req, res) {
    const raw = this._parseCookies(req)['millas_flash'];
    if (!raw) return {};
    // Clear it immediately
    res.clearCookie('millas_flash', { path: '/' });
    try {
      const { type, message } = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      return { [type]: message };
    } catch { return {}; }
  }

  // ─── Session internals ────────────────────────────────────────────────────

  _setSession(res, payload, maxAge) {
    const name = this._config.cookieName;
    const data = Buffer.from(JSON.stringify(payload)).toString('base64');
    const sig  = this._sign(data);
    const value = `${data}.${sig}`;

    res.cookie(name, value, {
      httpOnly: true,
      maxAge:   maxAge * 1000,
      path:     '/',
      sameSite: 'lax',
      // secure: true  — uncomment in production behind HTTPS
    });
  }

  _getSession(req) {
    const name  = this._config.cookieName;
    const raw   = this._parseCookies(req)[name];
    if (!raw) return null;

    const dot = raw.lastIndexOf('.');
    if (dot === -1) return null;

    const data = raw.slice(0, dot);
    const sig  = raw.slice(dot + 1);

    if (sig !== this._sign(data)) return null;

    try {
      return JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    } catch { return null; }
  }

  _sign(data) {
    const secret = process.env.APP_KEY || 'millas-admin-secret-change-me';
    return crypto.createHmac('sha256', secret).update(data).digest('hex').slice(0, 32);
  }

  _parseCookies(req) {
    const header = req.headers.cookie || '';
    const result = {};
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k) result[k.trim()] = decodeURIComponent(v.join('='));
    }
    return result;
  }

  // ─── User lookup ──────────────────────────────────────────────────────────

  async _findUser(email) {
    const cfg = this._config;
    const normalised = (email || '').trim().toLowerCase();

    // Model-based lookup
    if (cfg.model) {
      try {
        return await cfg.model.findBy('email', normalised);
      } catch { return null; }
    }

    // Static user list
    if (cfg.users && cfg.users.length) {
      return cfg.users.find(u =>
        (u.email || '').trim().toLowerCase() === normalised
      ) || null;
    }

    return null;
  }

  async _checkPassword(plain, hash) {
    if (!plain || !hash) return false;
    // Support both plain-text passwords (dev) and bcrypt hashes (prod)
    if (hash.startsWith('$2')) {
      return bcrypt.compare(String(plain), hash);
    }
    // Plain text comparison — warn in development
    if (process.env.NODE_ENV !== 'production') {
      process.stderr.write(
        '[millas admin] Warning: using plain-text password. Use a bcrypt hash in production.\n'
      );
    }
    return plain === hash;
  }

  // ─── Rate limiting ────────────────────────────────────────────────────────

  _checkRateLimit(ip) {
    const entry = this._attempts?.get(ip);
    if (!entry) return;

    if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
      const mins = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
      throw new Error(`Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`);
    }

    if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
      this._attempts.delete(ip);
    }
  }

  _recordFailedAttempt(ip) {
    const entry = this._attempts?.get(ip) || { count: 0, lockedUntil: null };
    entry.count++;
    if (entry.count >= (this._config.maxAttempts || 5)) {
      const mins = this._config.lockoutMinutes || 15;
      entry.lockedUntil = Date.now() + mins * 60 * 1000;
    }
    this._attempts?.set(ip, entry);
  }

  _clearAttempts(ip) {
    this._attempts?.delete(ip);
  }
}

// Singleton
const adminAuth = new AdminAuth();
module.exports = adminAuth;
module.exports.AdminAuth = AdminAuth;
