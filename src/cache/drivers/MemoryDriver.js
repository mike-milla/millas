'use strict';

/**
 * MemoryDriver
 *
 * In-memory cache with TTL support.
 * Data does not persist across restarts.
 * Default driver — zero config required.
 *
 * CACHE_DRIVER=memory
 */
class MemoryDriver {
  constructor() {
    this._store = new Map(); // key → { value, expiresAt }
  }

  /**
   * Store a value. ttl = seconds (0 = no expiry).
   */
  async set(key, value, ttl = 0) {
    const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : null;
    this._store.set(String(key), {
      value:     JSON.stringify(value),
      expiresAt,
    });
    return true;
  }

  /**
   * Retrieve a value. Returns null if missing or expired.
   */
  async get(key) {
    const entry = this._store.get(String(key));
    if (!entry) return null;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this._store.delete(String(key));
      return null;
    }

    return JSON.parse(entry.value);
  }

  /**
   * Check if a key exists and has not expired.
   */
  async has(key) {
    return (await this.get(key)) !== null;
  }

  /**
   * Delete a key.
   */
  async delete(key) {
    return this._store.delete(String(key));
  }

  /**
   * Delete multiple keys matching a prefix.
   */
  async deletePattern(prefix) {
    let count = 0;
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) {
        this._store.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Flush the entire cache.
   */
  async flush() {
    this._store.clear();
    return true;
  }

  /**
   * Get or set — return cached value, or run fn() and cache its result.
   */
  async remember(key, ttl, fn) {
    const cached = await this.get(key);
    if (cached !== null) return cached;
    const value = await fn();
    await this.set(key, value, ttl);
    return value;
  }

  /**
   * Increment a numeric value.
   */
  async increment(key, amount = 1) {
    const current = (await this.get(key)) ?? 0;
    const next    = Number(current) + amount;
    await this.set(key, next);
    return next;
  }

  /**
   * Decrement a numeric value.
   */
  async decrement(key, amount = 1) {
    return this.increment(key, -amount);
  }

  /**
   * Add only if the key does not exist.
   */
  async add(key, value, ttl = 0) {
    if (await this.has(key)) return false;
    await this.set(key, value, ttl);
    return true;
  }

  /**
   * Get multiple keys at once.
   */
  async getMany(keys) {
    const result = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }

  /**
   * Set multiple key/value pairs at once.
   */
  async setMany(entries, ttl = 0) {
    for (const [key, value] of Object.entries(entries)) {
      await this.set(key, value, ttl);
    }
    return true;
  }

  /**
   * Return the number of entries (including expired).
   */
  size() {
    return this._store.size;
  }

  /**
   * Purge all expired entries.
   */
  gc() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this._store.delete(key);
      }
    }
  }
}

module.exports = MemoryDriver;
