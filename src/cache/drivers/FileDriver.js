'use strict';

const fs   = require('fs-extra');
const path = require('path');

/**
 * FileDriver
 *
 * Filesystem-backed cache. Persists across restarts.
 * Stores each key as a JSON file inside the cache directory.
 *
 * CACHE_DRIVER=file
 */
class FileDriver {
  constructor(config = {}) {
    this._dir = config.path || path.join(process.cwd(), 'storage/cache');
    fs.ensureDirSync(this._dir);
  }

  async set(key, value, ttl = 0) {
    const payload = {
      value,
      expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
      storedAt:  Date.now(),
    };
    await fs.writeJson(this._filePath(key), payload);
    return true;
  }

  async get(key) {
    const file = this._filePath(key);
    if (!(await fs.pathExists(file))) return null;

    try {
      const payload = await fs.readJson(file);
      if (payload.expiresAt && Date.now() > payload.expiresAt) {
        await fs.remove(file);
        return null;
      }
      return payload.value;
    } catch {
      return null;
    }
  }

  async has(key) {
    return (await this.get(key)) !== null;
  }

  async delete(key) {
    const file = this._filePath(key);
    if (await fs.pathExists(file)) {
      await fs.remove(file);
      return true;
    }
    return false;
  }

  async deletePattern(prefix) {
    const files = await fs.readdir(this._dir);
    let count   = 0;
    for (const file of files) {
      if (file.startsWith(this._hash(prefix))) {
        await fs.remove(path.join(this._dir, file));
        count++;
      }
    }
    return count;
  }

  async flush() {
    const files = await fs.readdir(this._dir);
    for (const file of files) {
      if (file.endsWith('.json')) await fs.remove(path.join(this._dir, file));
    }
    return true;
  }

  async remember(key, ttl, fn) {
    const cached = await this.get(key);
    if (cached !== null) return cached;
    const value = await fn();
    await this.set(key, value, ttl);
    return value;
  }

  async increment(key, amount = 1) {
    const current = (await this.get(key)) ?? 0;
    const next    = Number(current) + amount;
    await this.set(key, next);
    return next;
  }

  async decrement(key, amount = 1) {
    return this.increment(key, -amount);
  }

  async add(key, value, ttl = 0) {
    if (await this.has(key)) return false;
    await this.set(key, value, ttl);
    return true;
  }

  async getMany(keys) {
    const result = {};
    for (const key of keys) result[key] = await this.get(key);
    return result;
  }

  async setMany(entries, ttl = 0) {
    for (const [key, value] of Object.entries(entries)) {
      await this.set(key, value, ttl);
    }
    return true;
  }

  async gc() {
    const files = await fs.readdir(this._dir);
    const now   = Date.now();
    let count   = 0;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const p = await fs.readJson(path.join(this._dir, file));
        if (p.expiresAt && now > p.expiresAt) {
          await fs.remove(path.join(this._dir, file));
          count++;
        }
      } catch { /* skip */ }
    }
    return count;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _filePath(key) {
    return path.join(this._dir, `${this._hash(key)}.json`);
  }

  _hash(key) {
    // Simple deterministic hash for filenames
    let h = 5381;
    for (let i = 0; i < key.length; i++) {
      h = ((h << 5) + h) ^ key.charCodeAt(i);
      h = h >>> 0;
    }
    return h.toString(16).padStart(8, '0') + '_' +
      key.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
  }
}

module.exports = FileDriver;
