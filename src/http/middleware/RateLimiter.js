'use strict';

/**
 * RateLimiter
 *
 * Per-IP and per-user rate limiting with an in-memory store by default
 * and a pluggable store interface for Redis in production.
 *
 * ── Quick usage ───────────────────────────────────────────────────────────────
 *
 *   const { RateLimiter } = require('millas/src/http/middleware/RateLimiter');
 *
 *   // Global: 100 requests per 15 minutes per IP (applied in SecurityBootstrap)
 *   app.use(RateLimiter.perIp({ max: 100, windowMs: 15 * 60 * 1000 }).middleware());
 *
 *   // Route-level: 5 login attempts per 10 minutes per IP
 *   Route.post('/login', [
 *     RateLimiter.perIp({ max: 5, windowMs: 10 * 60 * 1000, message: 'Too many login attempts' }).middleware(),
 *   ], loginHandler);
 *
 *   // Authenticated routes: per-user limiting
 *   Route.post('/ai/chat', [
 *     RateLimiter.perUser({ max: 20, windowMs: 60 * 1000 }).middleware(),
 *   ], chatHandler);
 *
 *   // Combined: per-IP first, then per-user
 *   Route.post('/api/messages', [
 *     RateLimiter.perIp({ max: 60, windowMs: 60 * 1000 }).middleware(),
 *     RateLimiter.perUser({ max: 30, windowMs: 60 * 1000 }).middleware(),
 *   ], handler);
 *
 * ── Redis store (production) ──────────────────────────────────────────────────
 *
 *   const { RedisRateLimitStore } = require('millas/src/http/middleware/RateLimiter');
 *   const redis = require('ioredis');
 *
 *   const store = new RedisRateLimitStore(new redis(process.env.REDIS_URL));
 *
 *   RateLimiter.perIp({ max: 100, windowMs: 60000, store }).middleware();
 *
 * ── Configuration (config/security.js) ───────────────────────────────────────
 *
 *   rateLimit: {
 *     global: {
 *       enabled:  true,
 *       max:      100,
 *       windowMs: 15 * 60 * 1000,   // 15 minutes
 *     },
 *   }
 *
 * ── Response headers ──────────────────────────────────────────────────────────
 *
 *   Every rate-limited response includes:
 *     X-RateLimit-Limit:     100        — max requests in window
 *     X-RateLimit-Remaining: 42         — requests left in current window
 *     X-RateLimit-Reset:     1711234567 — UNIX timestamp when window resets
 *
 *   On 429:
 *     Retry-After: 300                  — seconds until the window resets
 */

// ── In-memory store ────────────────────────────────────────────────────────────

/**
 * MemoryRateLimitStore
 *
 * Simple in-memory store using a Map.
 * Fine for single-process deployments and development.
 * For multi-process or multi-server deployments, use RedisRateLimitStore.
 *
 * Entries expire automatically — a cleanup sweep runs every 5 minutes
 * to prevent unbounded memory growth.
 */
class MemoryRateLimitStore {
  constructor() {
    this._store   = new Map();
    this._cleanup = setInterval(() => this._sweep(), 5 * 60 * 1000);
    // Don't hold the process open just for cleanup
    if (this._cleanup.unref) this._cleanup.unref();
  }

  /**
   * Increment hit count for a key within a window.
   *
   * @param {string} key
   * @param {number} windowMs
   * @returns {{ count: number, resetAt: number }}
   */
  async increment(key, windowMs) {
    const now     = Date.now();
    const entry   = this._store.get(key);
    const resetAt = entry && entry.resetAt > now ? entry.resetAt : now + windowMs;
    const count   = entry && entry.resetAt > now ? entry.count + 1 : 1;

    this._store.set(key, { count, resetAt });
    return { count, resetAt };
  }

  /**
   * Reset the counter for a key (e.g. after successful login).
   *
   * @param {string} key
   */
  async reset(key) {
    this._store.delete(key);
  }

  /**
   * Stop the background cleanup interval.
   * Call this in tests or on graceful shutdown to allow the process to exit.
   */
  destroy() {
    clearInterval(this._cleanup);
  }

  /** Remove expired entries */
  _sweep() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (entry.resetAt <= now) this._store.delete(key);
    }
  }
}

// ── Redis store ────────────────────────────────────────────────────────────────

/**
 * RedisRateLimitStore
 *
 * Production store backed by Redis. Requires an ioredis (or node-redis) client.
 * Uses atomic INCR + PEXPIRE so it works correctly across multiple processes.
 *
 * @example
 *   const redis = new Redis(process.env.REDIS_URL);
 *   const store = new RedisRateLimitStore(redis);
 *   RateLimiter.perIp({ max: 100, windowMs: 60000, store });
 */
class RedisRateLimitStore {
  /**
   * @param {object} redisClient  — ioredis or node-redis client instance
   * @param {string} [prefix]     — key prefix (default: 'rl:')
   */
  constructor(redisClient, prefix = 'rl:') {
    this._redis  = redisClient;
    this._prefix = prefix;
  }

  async increment(key, windowMs) {
    const redisKey = `${this._prefix}${key}`;

    // Atomic pipeline: INCR then set expiry only on first hit
    const [[, count], [, ttlMs]] = await this._redis
      .pipeline()
      .incr(redisKey)
      .pttl(redisKey)
      .exec();

    // If this is the first hit (or key had no TTL), set the window expiry
    if (count === 1 || ttlMs < 0) {
      await this._redis.pexpire(redisKey, windowMs);
    }

    const resetAt = Date.now() + (ttlMs > 0 ? ttlMs : windowMs);
    return { count, resetAt };
  }

  async reset(key) {
    await this._redis.del(`${this._prefix}${key}`);
  }
}

// ── RateLimiter class ──────────────────────────────────────────────────────────

const DEFAULT_OPTIONS = {
  max:        100,
  windowMs:   15 * 60 * 1000,   // 15 minutes
  message:    'Too many requests, please try again later.',
  statusCode: 429,
  keyBy:      'ip',              // 'ip' | 'user' | function(req) => string
  store:      null,              // defaults to MemoryRateLimitStore
  skip:       null,              // optional function(req) => bool — return true to skip
  onLimitReached: null,          // optional function(req, res, options) — called on 429
};

class RateLimiter {
  /**
   * @param {object} options
   */
  constructor(options = {}) {
    this._opts  = { ...DEFAULT_OPTIONS, ...options };
    this._store = options.store || new MemoryRateLimitStore();
  }

  // ── Express middleware ────────────────────────────────────────────────────

  middleware() {
    const opts  = this._opts;
    const store = this._store;

    return async (req, res, next) => {
      try {
        // ── Skip check ─────────────────────────────────────────────────────
        if (opts.skip && opts.skip(req)) return next();

        // ── Resolve key ────────────────────────────────────────────────────
        const key = this._resolveKey(req, opts.keyBy);
        if (!key) return next(); // can't rate-limit without a key (e.g. no user yet)

        // ── Increment counter ──────────────────────────────────────────────
        const { count, resetAt } = await store.increment(key, opts.windowMs);
        const remaining           = Math.max(0, opts.max - count);
        const resetSec            = Math.ceil(resetAt / 1000);

        // ── Set rate-limit headers (always, even on 429) ───────────────────
        res.setHeader('X-RateLimit-Limit',     opts.max);
        res.setHeader('X-RateLimit-Remaining', remaining);
        res.setHeader('X-RateLimit-Reset',     resetSec);

        // ── Attach store reset helper to req for auth flows ────────────────
        // e.g. after successful login: await req.resetRateLimit()
        req.resetRateLimit = () => store.reset(key);

        // ── Enforce limit ──────────────────────────────────────────────────
        if (count > opts.max) {
          const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
          res.setHeader('Retry-After', retryAfter);

          if (opts.onLimitReached) {
            opts.onLimitReached(req, res, opts);
          }

          // Return JSON for API requests, plain text for others
          const isApi = (req.headers?.accept || '').includes('application/json') ||
                        (req.headers?.['content-type'] || '').includes('application/json');

          res.status(opts.statusCode);
          if (isApi) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ error: opts.message, retryAfter }));
          }
          return res.end(opts.message);
        }

        next();
      } catch (err) {
        // Store errors must never block requests — fail open
        console.error('[Millas RateLimit] Store error:', err.message);
        next();
      }
    };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  _resolveKey(req, keyBy) {
    if (typeof keyBy === 'function') return keyBy(req);

    if (keyBy === 'user') {
      // req.user is set by AuthMiddleware — if not authenticated, fall back to IP
      const userId = req.user?.id || req.user?._id;
      return userId ? `user:${userId}` : this._resolveKey(req, 'ip');
    }

    if (keyBy === 'ip') {
      const ip = req.ip ||
                 req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
                 req.connection?.remoteAddress;
      return ip ? `ip:${ip}` : null;
    }

    return null;
  }

  // ── Static factories (fluent API) ─────────────────────────────────────────

  /**
   * Limit by IP address.
   *
   *   RateLimiter.perIp({ max: 5, windowMs: 10 * 60 * 1000 }).middleware()
   */
  static perIp(options = {}) {
    return new RateLimiter({ ...options, keyBy: 'ip' });
  }

  /**
   * Limit by authenticated user (falls back to IP if not authenticated).
   *
   *   RateLimiter.perUser({ max: 20, windowMs: 60 * 1000 }).middleware()
   */
  static perUser(options = {}) {
    return new RateLimiter({ ...options, keyBy: 'user' });
  }

  /**
   * Limit by a custom key resolver.
   *
   *   RateLimiter.by(req => req.headers['x-api-key'], { max: 1000 }).middleware()
   */
  static by(keyFn, options = {}) {
    return new RateLimiter({ ...options, keyBy: keyFn });
  }

  /**
   * Create from config section.
   *
   *   RateLimiter.from(config.security?.rateLimit?.global)
   */
  static from(options) {
    if (options === false || options?.enabled === false) return null;
    return RateLimiter.perIp(options || {});
  }
}

module.exports = { RateLimiter, MemoryRateLimitStore, RedisRateLimitStore };