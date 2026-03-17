'use strict';

const jwt = require('jsonwebtoken');

/**
 * JwtDriver
 *
 * Issues and verifies JSON Web Tokens.
 *
 * Config (config/auth.js):
 *   guards: {
 *     jwt: {
 *       driver:    'jwt',
 *       secret:    process.env.APP_KEY,
 *       expiresIn: '7d',
 *     }
 *   }
 */
class JwtDriver {
  constructor(config = {}) {
    this.secret    = config.secret    || process.env.APP_KEY || 'millas-secret-change-me';
    this.expiresIn = config.expiresIn || '7d';
    this.algorithm = config.algorithm || 'HS256';
  }

  /**
   * Sign a payload and return a token string.
   * @param {object} payload  — data to encode (e.g. { id, email, role })
   * @param {object} options  — override expiresIn etc.
   */
  sign(payload, options = {}) {
    return jwt.sign(payload, this.secret, {
      algorithm: this.algorithm,
      expiresIn: options.expiresIn || this.expiresIn,
      ...options,
    });
  }

  /**
   * Verify a token and return the decoded payload.
   * Throws if expired or invalid.
   * @param {string} token
   * @returns {object} decoded payload
   */
  verify(token) {
    return jwt.verify(token, this.secret, { algorithms: [this.algorithm] });
  }

  /**
   * Decode a token WITHOUT verifying the signature.
   * Useful for inspecting expired tokens.
   * @param {string} token
   * @returns {object|null}
   */
  decode(token) {
    return jwt.decode(token);
  }

  /**
   * Sign a short-lived token for password resets.
   */
  signResetToken(payload) {
    return this.sign(payload, { expiresIn: '1h' });
  }

  /**
   * Sign a refresh token with a longer lifetime.
   */
  signRefreshToken(payload) {
    return this.sign(payload, { expiresIn: '30d' });
  }
}

module.exports = JwtDriver;
