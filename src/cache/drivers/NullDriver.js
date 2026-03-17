'use strict';

/**
 * NullDriver
 *
 * A no-op cache driver — always misses, never stores.
 * Use in tests to disable caching without code changes.
 *
 * CACHE_DRIVER=null
 */
class NullDriver {
  async set()               { return true; }
  async get()               { return null; }
  async has()               { return false; }
  async delete()            { return true; }
  async deletePattern()     { return 0; }
  async flush()             { return true; }
  async remember(k, t, fn)  { return fn(); }
  async increment(k, n = 1) { return n; }
  async decrement(k, n = 1) { return -n; }
  async add()               { return true; }
  async getMany(keys)       { return Object.fromEntries(keys.map(k => [k, null])); }
  async setMany()           { return true; }
  async gc()                { return 0; }
}

module.exports = NullDriver;
