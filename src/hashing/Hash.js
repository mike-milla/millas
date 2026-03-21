'use strict';

const bcrypt = require('bcryptjs');

// ── BcryptDriver ──────────────────────────────────────────────────────────────

class BcryptDriver {
  /**
   * @param {object} config
   * @param {number} config.rounds  — cost factor (default 12)
   */
  constructor(config = {}) {
    this.rounds = config.rounds ?? 12;
  }

  /**
   * Hash a plain-text value.
   *
   *   await Hash.make('secret');
   *   await Hash.make('secret', { rounds: 14 });
   *
   * @param {string} value
   * @param {object} options
   * @returns {Promise<string>}
   */
  async make(value, options = {}) {
    const rounds = options.rounds ?? this.rounds;
    return bcrypt.hash(String(value), rounds);
  }

  /**
   * Verify a plain-text value against a stored hash.
   *
   *   const ok = await Hash.check('secret', storedHash);
   *
   * @param {string} value
   * @param {string} hashedValue
   * @returns {Promise<boolean>}
   */
  async check(value, hashedValue) {
    if (!value || !hashedValue) return false;
    return bcrypt.compare(String(value), String(hashedValue));
  }

  /**
   * Determine if a hash needs to be rehashed.
   * Returns true if the hash was made with fewer rounds than currently configured.
   *
   *   if (Hash.needsRehash(user.password)) {
   *     user.password = await Hash.make(plaintext);
   *     await user.save();
   *   }
   *
   * @param {string} hashedValue
   * @returns {boolean}
   */
  needsRehash(hashedValue) {
    try {
      return bcrypt.getRounds(hashedValue) !== this.rounds;
    } catch {
      return true;
    }
  }

  /**
   * Return info about a hash: algorithm, rounds.
   *
   *   Hash.info(hash)
   *   // → { alg: 'bcrypt', rounds: 12 }
   *
   * @param {string} hashedValue
   * @returns {{ alg: string, rounds: number }}
   */
  info(hashedValue) {
    try {
      return { alg: 'bcrypt', rounds: bcrypt.getRounds(hashedValue) };
    } catch {
      return { alg: 'unknown', rounds: null };
    }
  }

  /**
   * Check whether a value is already hashed (not plain-text).
   * Detects bcrypt hash format: $2a$, $2b$, $2y$ prefixes.
   *
   * @param {string} value
   * @returns {boolean}
   */
  isHashed(value) {
    return /^\$2[aby]\$\d{2}\$/.test(String(value));
  }
}

// ── HashManager ───────────────────────────────────────────────────────────────

/**
 * HashManager
 *
 * Laravel-style hashing service. Manages multiple drivers (currently bcrypt)
 * and delegates all calls to the active driver.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const { Hash } = require('millas/facades/Hash');
 *
 *   // Hash a password
 *   const hashed = await Hash.make('my-password');
 *
 *   // Verify
 *   const ok = await Hash.check('my-password', hashed);   // true
 *
 *   // Rehash check (e.g. rounds changed in config)
 *   if (Hash.needsRehash(user.password)) {
 *     user.password = await Hash.make(plainPassword);
 *     await user.save();
 *   }
 *
 *   // Info
 *   Hash.info(hashed);  // { alg: 'bcrypt', rounds: 12 }
 *
 *   // Guard against double-hashing
 *   if (!Hash.isHashed(value)) {
 *     value = await Hash.make(value);
 *   }
 *
 *   // Use a different driver temporarily
 *   Hash.driver('bcrypt').make('secret', { rounds: 14 });
 *
 *   // Adjust rounds globally (e.g. in tests)
 *   Hash.setRounds(4);
 *
 * ── Service provider registration ─────────────────────────────────────────────
 *
 *   container.singleton('hash', () => new HashManager({ default: 'bcrypt', bcrypt: { rounds: 12 } }));
 *   container.alias('Hash', 'hash');
 */
class HashManager {
  /**
   * @param {object} config
   * @param {string} config.default      — driver name (default: 'bcrypt')
   * @param {object} config.bcrypt       — bcrypt driver config
   * @param {number} config.bcrypt.rounds
   */
  constructor(config = {}) {
    this._config  = config;
    this._default = config.default || 'bcrypt';
    this._drivers = new Map();
  }

  // ── Driver resolution ──────────────────────────────────────────────────────

  /**
   * Get a named driver instance (cached).
   *
   * @param {string} [name]
   * @returns {BcryptDriver}
   */
  driver(name) {
    const driverName = name || this._default;
    if (!this._drivers.has(driverName)) {
      this._drivers.set(driverName, this._createDriver(driverName));
    }
    return this._drivers.get(driverName);
  }

  _createDriver(name) {
    if (name === 'bcrypt') {
      return new BcryptDriver(this._config.bcrypt || {});
    }
    throw new Error(`[Hash] Unknown driver: "${name}". Only 'bcrypt' is supported.`);
  }

  // ── Configuration helpers ──────────────────────────────────────────────────

  /**
   * Change the bcrypt rounds at runtime.
   * Useful for lowering cost in test environments:
   *
   *   Hash.setRounds(4);  // fast in tests
   *
   * @param {number} rounds
   * @returns {this}
   */
  setRounds(rounds) {
    this._config.bcrypt      = this._config.bcrypt || {};
    this._config.bcrypt.rounds = rounds;
    // Bust the cached driver so next call picks up the new config
    this._drivers.delete('bcrypt');
    return this;
  }

  /**
   * Return the currently configured bcrypt rounds.
   *
   * @returns {number}
   */
  getRounds() {
    return (this._config.bcrypt || {}).rounds ?? 12;
  }

  // ── Delegated methods (forward to the default driver) ─────────────────────

  /**
   * Hash a value using the default driver.
   *
   * @param {string}  value
   * @param {object}  [options]
   * @param {number}  [options.rounds]   — override rounds for this call only
   * @returns {Promise<string>}
   */
  make(value, options = {}) {
    return this.driver().make(value, options);
  }

  /**
   * Check a plain value against a stored hash.
   *
   * @param {string} value
   * @param {string} hashedValue
   * @returns {Promise<boolean>}
   */
  check(value, hashedValue) {
    return this.driver().check(value, hashedValue);
  }

  /**
   * Determine whether a hash needs to be rehashed (e.g. rounds have changed).
   *
   * @param {string} hashedValue
   * @returns {boolean}
   */
  needsRehash(hashedValue) {
    return this.driver().needsRehash(hashedValue);
  }

  /**
   * Return metadata about a hash.
   *
   * @param {string} hashedValue
   * @returns {{ alg: string, rounds: number }}
   */
  info(hashedValue) {
    return this.driver().info(hashedValue);
  }

  /**
   * Detect whether a value is already hashed (guards against double-hashing).
   *
   * @param {string} value
   * @returns {boolean}
   */
  isHashed(value) {
    return this.driver().isHashed(value);
  }
}

// ── Singleton with default config ─────────────────────────────────────────────
const defaultHash = new HashManager({ default: 'bcrypt', bcrypt: { rounds: 12 } });

module.exports             = defaultHash;
module.exports.HashManager = HashManager;
module.exports.BcryptDriver = BcryptDriver;