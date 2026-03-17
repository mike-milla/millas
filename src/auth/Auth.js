'use strict';

const Hasher    = require('./Hasher');
const JwtDriver = require('./JwtDriver');
const HttpError = require('../errors/HttpError');

/**
 * Auth
 *
 * The primary authentication facade.
 *
 * Usage:
 *   const { Auth } = require('millas/src');
 *
 *   // Register a new user
 *   const user = await Auth.register({
 *     name:     'Alice',
 *     email:    'alice@example.com',
 *     password: 'secret123',
 *   });
 *
 *   // Login
 *   const { user, token } = await Auth.login('alice@example.com', 'secret123');
 *
 *   // Verify a token
 *   const payload = Auth.verify(token);
 *
 *   // Get logged-in user from a request
 *   const user = await Auth.user(req);
 *
 *   // Check password
 *   const ok = await Auth.checkPassword('plain', user.password);
 */
class Auth {
  constructor() {
    this._jwt    = null;
    this._config = null;
    this._UserModel = null;
  }

  // ─── Configuration ───────────────────────────────────────────────────────

  /**
   * Configure Auth with config/auth.js settings.
   * Called automatically by AuthServiceProvider.
   */
  configure(config, UserModel = null) {
    this._config    = config;
    this._UserModel = UserModel;

    const jwtConfig = config?.guards?.jwt || {};
    this._jwt = new JwtDriver(jwtConfig);
  }

  /**
   * Set the User model used for lookups.
   */
  setUserModel(UserModel) {
    this._UserModel = UserModel;
  }

  // ─── Core auth operations ─────────────────────────────────────────────────

  /**
   * Register a new user.
   *
   * Automatically hashes the password before saving.
   * Returns the created user instance.
   *
   * @param {object} data — { name, email, password, ...rest }
   */
  async register(data) {
    this._requireUserModel();

    if (!data.password) throw new HttpError(422, 'Password is required');
    if (!data.email)    throw new HttpError(422, 'Email is required');

    // Check for duplicate email
    const existing = await this._UserModel.findBy('email', data.email);
    if (existing) throw new HttpError(422, 'Email already in use');

    const hashed = await Hasher.make(data.password);
    return this._UserModel.create({ ...data, password: hashed });
  }

  /**
   * Attempt to log in with email + password.
   *
   * Returns { user, token, refreshToken } on success.
   * Throws 401 on failure.
   *
   * @param {string} email
   * @param {string} password
   */
  async login(email, password) {
    this._requireUserModel();

    const user = await this._UserModel.findBy('email', email);
    if (!user) throw new HttpError(401, 'Invalid credentials');

    const ok = await Hasher.check(password, user.password);
    if (!ok)  throw new HttpError(401, 'Invalid credentials');

    const payload = this._buildTokenPayload(user);
    const token   = this._jwt.sign(payload);
    const refreshToken = this._jwt.signRefreshToken(payload);

    return { user, token, refreshToken };
  }

  /**
   * Verify and decode a token string.
   * Throws 401 if expired or invalid.
   *
   * @param {string} token
   * @returns {object} decoded payload
   */
  verify(token) {
    try {
      return this._jwt.verify(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new HttpError(401, 'Token has expired');
      }
      throw new HttpError(401, 'Invalid token');
    }
  }

  /**
   * Resolve the authenticated user from a request.
   * Reads the Bearer token from Authorization header.
   *
   * Returns null if no token present or invalid.
   *
   * @param {object} req — Express request
   * @returns {object|null} user model instance
   */
  async user(req) {
    this._requireUserModel();

    const token = this._extractToken(req);
    if (!token) return null;

    let payload;
    try {
      payload = this._jwt.verify(token);
    } catch {
      return null;
    }

    return this._UserModel.find(payload.id || payload.sub);
  }

  /**
   * Resolve the authenticated user and throw 401 if not found.
   */
  async userOrFail(req) {
    const u = await this.user(req);
    if (!u) throw new HttpError(401, 'Unauthenticated');
    return u;
  }

  /**
   * Hash a plain-text password.
   */
  async hashPassword(plain) {
    return Hasher.make(plain);
  }

  /**
   * Check a plain-text password against a hash.
   */
  async checkPassword(plain, hash) {
    return Hasher.check(plain, hash);
  }

  /**
   * Issue a new token for a user directly.
   * Useful for token refresh flows.
   */
  issueToken(user, options = {}) {
    const payload = this._buildTokenPayload(user);
    return this._jwt.sign(payload, options);
  }

  /**
   * Decode a token without verifying (inspect expired tokens).
   */
  decode(token) {
    return this._jwt.decode(token);
  }

  /**
   * Generate a secure password reset token for a user.
   */
  generateResetToken(user) {
    return this._jwt.signResetToken({
      sub:   user.id,
      email: user.email,
      type:  'password_reset',
    });
  }

  /**
   * Verify a password reset token.
   * Returns the payload or throws 400.
   */
  verifyResetToken(token) {
    try {
      const payload = this._jwt.verify(token);
      if (payload.type !== 'password_reset') {
        throw new HttpError(400, 'Invalid reset token type');
      }
      return payload;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, 'Invalid or expired reset token');
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _extractToken(req) {
    const header = req.headers?.['authorization'] || '';
    if (header.startsWith('Bearer ')) {
      return header.slice(7);
    }
    // Also check query param for websocket / download links
    return req.query?.token || null;
  }

  _buildTokenPayload(user) {
    // If the model defines tokenPayload(), use it — allows custom JWT claims.
    // Otherwise fall back to the standard shape.
    const base = typeof user.tokenPayload === 'function'
      ? user.tokenPayload()
      : {
          id:    user.id,
          sub:   user.id,
          email: user.email,
          role:  user.role || null,
        };

    return { ...base, iat: Math.floor(Date.now() / 1000) };
  }

  _requireUserModel() {
    if (!this._UserModel) {
      throw new Error(
        'Auth has no User model. ' +
        'Call Auth.setUserModel(User) or boot AuthServiceProvider.'
      );
    }
  }
}

// Singleton facade
module.exports = new Auth();
module.exports.Auth = Auth;