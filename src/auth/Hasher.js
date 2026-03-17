'use strict';

const bcrypt = require('bcryptjs');

/**
 * Hasher
 *
 * Wraps bcrypt for password hashing and verification.
 *
 * Usage:
 *   const hash = await Hasher.make('my-password');
 *   const ok   = await Hasher.check('my-password', hash);
 */
class Hasher {
  constructor(rounds = 12) {
    this.rounds = rounds;
  }

  /**
   * Hash a plain-text password.
   * @param {string} plain
   * @returns {Promise<string>}
   */
  async make(plain) {
    return bcrypt.hash(String(plain), this.rounds);
  }

  /**
   * Verify a plain-text password against a hash.
   * @param {string} plain
   * @param {string} hash
   * @returns {Promise<boolean>}
   */
  async check(plain, hash) {
    if (!plain || !hash) return false;
    return bcrypt.compare(String(plain), String(hash));
  }

  /**
   * Determine if a value needs to be re-hashed
   * (e.g. rounds have changed).
   */
  needsRehash(hash) {
    const rounds = bcrypt.getRounds(hash);
    return rounds !== this.rounds;
  }
}

// Singleton with default rounds
module.exports = new Hasher(12);
module.exports.Hasher = Hasher;
