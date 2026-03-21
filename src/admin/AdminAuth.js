'use strict';

const crypto = require('crypto');

/**
 * AdminAuth
 *
 * Authentication for the Millas admin panel.
 *
 * ── How it works (Django parity) ─────────────────────────────────────────────
 *
 *  1. Login: find user by email in the app's User model (same table the API uses).
 *     Check password with bcrypt. Require is_active=true AND is_staff=true.
 *     On success, store only { id } in a signed, httpOnly cookie — never the
 *     full user object.
 *
 *  2. Every request: read { id } from the cookie, call User.find(id) to get a
 *     live user record. Attach it as req.adminUser. If the user has been
 *     deactivated since their last request, they are immediately locked out —
 *     no need to wait for session expiry.
 *
 *  3. is_staff gate: only users with is_staff=true can enter the admin.
 *     is_superuser=true bypasses all resource-level permission checks (Phase 6).
 *
 * ── Configuration ────────────────────────────────────────────────────────────
 *
 *   Admin.configure({
 *     auth: {
 *       // Optional — AdminServiceProvider resolves this automatically from
 *       // app/models/User (falling back to the built-in AuthUser).
 *       // Only set this if you want to override the model explicitly.
 *       model: UserModel,
 *
 *       cookieName:   'millas_admin',     // default
 *       cookieMaxAge: 60 * 60 * 8,        // 8 hours (seconds)
 *       rememberAge:  60 * 60 * 24 * 30,  // 30 days ("remember me")
 *       maxAttempts:    5,
 *       lockoutMinutes: 15,
 *     }
 *   });
 *
 * Disable auth entirely (not recommended):
 *   Admin.configure({ auth: false });
 */
class AdminAuth {
  constructor() {
    this._config     = null;
    this._UserModel  = null;  // resolved by AdminServiceProvider
    this._basePath   = null;  // resolved by AdminServiceProvider.setBasePath()
    this._attempts   = new Map();
  }

  // ─── Configuration ────────────────────────────────────────────────────────

  configure(authConfig) {
    if (authConfig === false) {
      this._config = false;
      return;
    }

    this._config = {
      model:          null,   // overridden by setUserModel() or config
      cookieName:     'millas_admin',
      cookieMaxAge:   60 * 60 * 8,
      rememberAge:    60 * 60 * 24 * 30,
      maxAttempts:    5,
      lockoutMinutes: 15,
      ...authConfig,
    };

    // If the config block supplied an explicit model, use it
    if (this._config.model) {
      this._UserModel = this._config.model;
    }

    this._attempts = new Map();
  }

  /**
   * Called by AdminServiceProvider after Auth is booted.
   * Provides the resolved User model (app/models/User or AuthUser fallback).
   * Only applied if no explicit model was set in the auth config block.
   */
  setUserModel(UserModel) {
    if (!this._UserModel) {
      this._UserModel = UserModel;
    }
  }

  /**
   * Called by AdminServiceProvider to provide the project basePath.
   * Used by _resolveUserModel() so it never calls process.cwd() at request time.
   */
  setBasePath(basePath) {
    this._basePath = basePath || null;
  }

  /** Returns true if auth is enabled. */
  get enabled() {
    return this._config !== null && this._config !== false;
  }

  // ─── Middleware ────────────────────────────────────────────────────────────

  /**
   * Express middleware — runs before every admin route.
   *
   * Verifies the signed session cookie, loads the live user from DB,
   * checks is_active + is_staff, attaches to req.adminUser.
   * Redirects to login if any check fails.
   */
  middleware(prefix) {
    return async (req, res, next) => {
      if (!this.enabled) return next();

      const loginPath = `${prefix}/login`;
      const p = req.path;

      // Always let login/logout through
      if (p === '/login' || p === '/logout') return next();

      const session = this._getSession(req);
      if (!session) {
        const returnTo = encodeURIComponent(req.originalUrl);
        return res.redirect(`${loginPath}?next=${returnTo}`);
      }

      // Live user lookup — deactivated users are locked out immediately
      const user = await this._loadUser(session.id);
      if (!user) {
        this._clearSessionCookie(res);
        return res.redirect(`${loginPath}?next=${encodeURIComponent(req.originalUrl)}`);
      }

      if (!user.is_active) {
        this._clearSessionCookie(res);
        this.setFlash(res, 'error', 'This account is inactive.');
        return res.redirect(loginPath);
      }

      if (!user.is_staff) {
        this._clearSessionCookie(res);
        this.setFlash(res, 'error', 'You do not have staff access to this admin.');
        return res.redirect(loginPath);
      }

      req.adminUser = user;
      next();
    };
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  /**
   * Attempt to log in with email + password.
   * Enforces is_active + is_staff. Throws on failure.
   * On success, writes a signed session cookie containing only { id }.
   */
  async login(req, res, { email, password, remember = false }) {
    if (!this.enabled) return null;

    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    this._checkRateLimit(ip);

    const normalised = (email || '').trim().toLowerCase();
    const user       = await this._loadUserByEmail(normalised);

    // Always check password first — avoids leaking account existence
    const Hasher = require('../auth/Hasher');
    const validPassword = user ? await Hasher.check(password, user.password) : false;

    if (!user || !validPassword) {
      this._recordFailedAttempt(ip);
      throw new Error('Please enter the correct email and password for a staff account. Note that both fields may be case-sensitive.');
    }

    if (!user.is_active) {
      throw new Error('This account is inactive.');
    }

    if (!user.is_staff) {
      // Exactly what Django says
      throw new Error('Please enter the correct email and password for a staff account. Note that both fields may be case-sensitive.');
    }

    this._clearAttempts(ip);

    // Update last_login (fire-and-forget)
    try {
      await this._UserModel.where('id', user.id).update({ last_login: new Date().toISOString() });
    } catch { /* non-fatal */ }

    const maxAge = remember ? this._config.rememberAge : this._config.cookieMaxAge;
    // Store only the PK — everything else is loaded fresh per request
    this._setSession(res, { id: user.id }, maxAge);

    return user;
  }

  /** Destroy the admin session cookie. */
  logout(res) {
    this._clearSessionCookie(res);
  }

  // ─── Flash (cookie-based) ─────────────────────────────────────────────────

  setFlash(res, type, message) {
    const payload = JSON.stringify({ type, message });
    res.cookie('millas_flash', Buffer.from(payload).toString('base64'), {
      httpOnly: true,
      maxAge:   10 * 1000,
      path:     '/',
      sameSite: 'lax',
    });
  }

  getFlash(req, res) {
    const raw = this._parseCookies(req)['millas_flash'];
    if (!raw) return {};
    res.clearCookie('millas_flash', { path: '/' });
    try {
      const { type, message } = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      return { [type]: message };
    } catch { return {}; }
  }

  // ─── Session ──────────────────────────────────────────────────────────────

  _setSession(res, payload, maxAge) {
    const name  = this._config.cookieName;
    const data  = Buffer.from(JSON.stringify(payload)).toString('base64');
    const sig   = this._sign(data);
    res.cookie(name, `${data}.${sig}`, {
      httpOnly: true,
      maxAge:   maxAge * 1000,
      path:     '/',
      sameSite: 'lax',
      // secure: true — enable in production behind HTTPS
    });
  }

  _getSession(req) {
    const name = this._config?.cookieName || 'millas_admin';
    const raw  = this._parseCookies(req)[name];
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

  _clearSessionCookie(res) {
    const name = this._config?.cookieName || 'millas_admin';
    res.clearCookie(name, { path: '/' });
  }

  _sign(data) {
    const secret = process.env.APP_KEY || 'millas-admin-secret-change-me';
    return crypto.createHmac('sha256', secret).update(data).digest('hex').slice(0, 32);
  }

  // ─── CSRF ─────────────────────────────────────────────────────────────────

  /**
   * Generate a CSRF token tied to the current session.
   * Token = HMAC(sessionId + timestamp_hour) so it rotates hourly
   * but stays valid for the full hour — no per-request token storage needed.
   *
   * @param {object} req
   * @returns {string}
   */
  csrfToken(req) {
    const session = this._getSession(req);
    const hourSlot = Math.floor(Date.now() / (1000 * 60 * 60)); // changes every hour
    const payload  = `csrf:${session?.id || 'anon'}:${hourSlot}`;
    return this._sign(payload);
  }

  /**
   * Verify a CSRF token submitted with a form.
   * Accepts tokens from the current hour OR the previous hour (grace period).
   *
   * @param {object} req
   * @param {string} token — value from req.body._csrf or X-CSRF-Token header
   * @returns {boolean}
   */
  verifyCsrf(req, token) {
    if (!token) return false;
    const session  = this._getSession(req);
    const hourSlot = Math.floor(Date.now() / (1000 * 60 * 60));
    // Check current hour and previous hour (grace period for forms submitted near the boundary)
    for (const slot of [hourSlot, hourSlot - 1]) {
      const payload  = `csrf:${session?.id || 'anon'}:${slot}`;
      if (token === this._sign(payload)) return true;
    }
    return false;
  }

  _parseCookies(req) {
    const result = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k) result[k.trim()] = decodeURIComponent(v.join('='));
    }
    return result;
  }

  // ─── User loading ──────────────────────────────────────────────────────────

  /**
   * Load a user by PK. Returns null if not found or model not ready.
   * Used by middleware on every admin request.
   */
  async _loadUser(id) {
    const M = this._resolveUserModel();
    if (!M || !id) return null;
    try {
      return await M.find(id) || null;
    } catch { return null; }
  }

  /**
   * Load a user by email. Returns null if not found.
   * Used during login.
   */
  async _loadUserByEmail(email) {
    const M = this._resolveUserModel();
    if (!M) return null;
    try {
      return await M.findBy('email', email) || null;
    } catch { return null; }
  }

  /**
   * Resolve the User model.
   * Priority: explicitly set via setUserModel() / config.model
   *           → app/models/User → built-in AuthUser
   */
  _resolveUserModel() {
    if (this._UserModel) return this._UserModel;

    // Lazy fallback — allows AdminAuth to work even if boot order is unusual
    try {
      const nodePath = require('path');
      const base     = this._basePath || process.cwd();
      const appUser  = nodePath.join(base, 'app/models/User');
      this._UserModel = require(appUser);
      return this._UserModel;
    } catch {}

    try {
      this._UserModel = require('../auth/AuthUser');
      return this._UserModel;
    } catch { return null; }
  }

  // ─── Rate limiting ────────────────────────────────────────────────────────

  _checkRateLimit(ip) {
    const entry = this._attempts.get(ip);
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
    const entry = this._attempts.get(ip) || { count: 0, lockedUntil: null };
    entry.count++;
    if (entry.count >= (this._config.maxAttempts || 5)) {
      const mins = this._config.lockoutMinutes || 15;
      entry.lockedUntil = Date.now() + mins * 60 * 1000;
    }
    this._attempts.set(ip, entry);
  }

  _clearAttempts(ip) {
    this._attempts.delete(ip);
  }
}

// Singleton
const adminAuth = new AdminAuth();
module.exports = adminAuth;
module.exports.AdminAuth = AdminAuth;