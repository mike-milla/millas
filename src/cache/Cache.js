'use strict';

const MemoryDriver = require('./drivers/MemoryDriver');

/**
 * Cache
 *
 * The primary caching facade.
 *
 * Usage:
 *   const { Cache } = require('millas/src');
 *
 *   await Cache.set('user:1', user, 300);         // cache for 5 minutes
 *   const user = await Cache.get('user:1');        // retrieve
 *   await Cache.delete('user:1');
 *
 *   // remember() — get or compute
 *   const posts = await Cache.remember('posts:all', 60, async () => {
 *     return Post.all();
 *   });
 *
 *   // Tags — group related keys
 *   await Cache.tags('users').set('user:1', user, 300);
 *   await Cache.tags('users').flush();  // clear all user keys
 */
class Cache {
  constructor() {
    this._driver = null;
    this._config = null;
    this._prefix = '';
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  configure(config) {
    this._config = config;
    this._prefix = config.prefix || '';
    this._driver = null; // reset so driver is rebuilt
  }

  // ─── Core API ──────────────────────────────────────────────────────────────

  /**
   * Store a value in the cache.
   * @param {string} key
   * @param {*}      value   — must be JSON-serialisable
   * @param {number} ttl     — seconds (0 = forever)
   */
  async set(key, value, ttl = 0) {
    return this._getDriver().set(this._k(key), value, ttl);
  }

  /**
   * Retrieve a value. Returns null if missing or expired.
   */
  async get(key, defaultValue = null) {
    const val = await this._getDriver().get(this._k(key));
    return val !== null ? val : defaultValue;
  }

  /**
   * Check if a key exists and is not expired.
   */
  async has(key) {
    return this._getDriver().has(this._k(key));
  }

  /**
   * Delete a key.
   */
  async delete(key) {
    return this._getDriver().delete(this._k(key));
  }

  /**
   * Delete all keys matching a prefix pattern.
   */
  async deletePattern(prefix) {
    return this._getDriver().deletePattern(this._k(prefix));
  }

  /**
   * Flush the entire cache.
   */
  async flush() {
    return this._getDriver().flush();
  }

  /**
   * Get or compute and cache.
   *
   * const data = await Cache.remember('key', 300, () => fetchExpensiveData());
   */
  async remember(key, ttl, fn) {
    return this._getDriver().remember(this._k(key), ttl, fn);
  }

  /**
   * Get once and delete — useful for flash messages / one-time tokens.
   */
  async pull(key) {
    const value = await this.get(key);
    if (value !== null) await this.delete(key);
    return value;
  }

  /**
   * Increment a numeric value.
   */
  async increment(key, amount = 1) {
    return this._getDriver().increment(this._k(key), amount);
  }

  /**
   * Decrement a numeric value.
   */
  async decrement(key, amount = 1) {
    return this._getDriver().decrement(this._k(key), amount);
  }

  /**
   * Add only if key does not exist. Returns true if stored, false if skipped.
   */
  async add(key, value, ttl = 0) {
    return this._getDriver().add(this._k(key), value, ttl);
  }

  /**
   * Retrieve multiple keys at once.
   * Returns { key: value|null, ... }
   */
  async getMany(keys) {
    return this._getDriver().getMany(keys.map(k => this._k(k)));
  }

  /**
   * Set multiple key/value pairs at once.
   */
  async setMany(entries, ttl = 0) {
    const prefixed = Object.fromEntries(
      Object.entries(entries).map(([k, v]) => [this._k(k), v])
    );
    return this._getDriver().setMany(prefixed, ttl);
  }

  /**
   * Cache with tag grouping — lets you flush groups of related keys.
   *
   * await Cache.tags('users').set('user:1', user, 300);
   * await Cache.tags('users', 'posts').flush(); // flush all tagged keys
   */
  tags(...tagNames) {
    return new TaggedCache(this, tagNames.flat());
  }

  /**
   * Return the underlying driver instance.
   */
  driver() {
    return this._getDriver();
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _k(key) {
    return this._prefix ? `${this._prefix}:${key}` : String(key);
  }

  _getDriver() {
    if (this._driver) return this._driver;

    const name = this._config?.default || process.env.CACHE_DRIVER || 'memory';
    const conf = this._config?.drivers?.[name] || {};

    switch (name) {
      case 'file': {
        const FileDriver = require('./drivers/FileDriver');
        this._driver = new FileDriver(conf);
        break;
      }
      case 'null': {
        const NullDriver = require('./drivers/NullDriver');
        this._driver = new NullDriver();
        break;
      }
      case 'memory':
      default:
        this._driver = new MemoryDriver();
    }

    return this._driver;
  }
}

// ── TaggedCache ───────────────────────────────────────────────────────────────

/**
 * TaggedCache
 *
 * Wraps a Cache instance and prefixes every key with a tag namespace.
 * Flush all keys for a tag group with .flush().
 */
class TaggedCache {
  constructor(cache, tags) {
    this._cache  = cache;
    this._tags   = tags;
    this._prefix = tags.join(':');
  }

  _k(key) { return `tag:${this._prefix}:${key}`; }

  async set(key, value, ttl = 0) { return this._cache.set(this._k(key), value, ttl); }
  async get(key, def = null)     { return this._cache.get(this._k(key), def); }
  async has(key)                 { return this._cache.has(this._k(key)); }
  async delete(key)              { return this._cache.delete(this._k(key)); }
  async remember(key, ttl, fn)   { return this._cache.remember(this._k(key), ttl, fn); }
  async pull(key)                { return this._cache.pull(this._k(key)); }

  /**
   * Flush all keys belonging to these tags.
   */
  async flush() {
    return this._cache.deletePattern(`tag:${this._prefix}:`);
  }
}

// Singleton
const cache = new Cache();
module.exports = cache;
module.exports.Cache       = Cache;
module.exports.TaggedCache = TaggedCache;
