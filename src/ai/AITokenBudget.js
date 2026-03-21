'use strict';

/**
 * AITokenBudget
 *
 * Per-user token budget enforcement for AI endpoints.
 * Prevents a single user from exhausting API credits through the chat API.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 *   1. Before the request: check if the user has budget remaining.
 *      If not, return 429 with a Retry-After header.
 *   2. After the AI responds: deduct the tokens used from the user's budget.
 *      Token deduction is async and non-blocking (fire and forget).
 *
 * ── Usage (route-level middleware) ───────────────────────────────────────────
 *
 *   const { AITokenBudget } = require('millas/src/ai/AITokenBudget');
 *
 *   // 100,000 tokens per user per day
 *   Route.post('/ai/chat', [
 *     AITokenBudget.perUser({ daily: 100_000 }).middleware(),
 *   ], chatHandler);
 *
 *   // Hourly + daily limits
 *   Route.post('/ai/chat', [
 *     AITokenBudget.perUser({ hourly: 10_000, daily: 100_000 }).middleware(),
 *   ], chatHandler);
 *
 *   // Deduct tokens after AI response in route handler:
 *   Route.post('/ai/chat', [
 *     AITokenBudget.perUser({ daily: 100_000 }).middleware(),
 *   ], async (req) => {
 *     const res = await AI.chat(req.validated.message, { userId: req.user.id });
 *     await req.deductTokens(res.totalTokens);   // <-- deduct after response
 *     return jsonify({ reply: res.text });
 *   });
 *
 * ── Redis store (production) ──────────────────────────────────────────────────
 *
 *   Same store interface as RateLimiter — use RedisRateLimitStore:
 *
 *   const { RedisRateLimitStore } = require('millas/src/http/middleware/RateLimiter');
 *   const store = new RedisRateLimitStore(redisClient, 'aitokens:');
 *   AITokenBudget.perUser({ daily: 100_000, store });
 *
 * ── Configuration (config/security.js) ───────────────────────────────────────
 *
 *   aiTokenBudget: {
 *     daily:  100_000,    // tokens per user per 24h
 *     hourly: 10_000,     // tokens per user per hour (optional)
 *   }
 */

const { MemoryRateLimitStore } = require('../http/middleware/RateLimiter');

// ── TokenStore wrapper ────────────────────────────────────────────────────────
// Wraps a RateLimitStore with token-specific semantics

class TokenStore {
  constructor(store) {
    this._store = store;
  }

  /**
   * Get current token usage for a key.
   * Returns { used, resetAt } or { used: 0, resetAt: Date.now() + windowMs }.
   */
  async getUsage(key, windowMs) {
    // We use increment(key, 0) to read without incrementing,
    // but most stores don't support 0-increment cleanly.
    // Instead we track usage as a straight counter.
    const result = await this._store.increment(`tokens:${key}`, windowMs);
    // Undo the increment — we just wanted to peek
    // This is a read-then-undo which isn't atomic, but token budgets
    // don't need strict atomicity for this check.
    // For Redis, use a dedicated GET command instead.
    return result;
  }

  /**
   * Add tokens to usage counter.
   * @param {string} key
   * @param {number} tokens
   * @param {number} windowMs
   */
  async addUsage(key, tokens, windowMs) {
    const results = [];
    for (let i = 0; i < tokens; i += Math.ceil(tokens / 10)) {
      // Bulk increment by chunks to avoid N individual calls
      // For MemoryRateLimitStore: just call increment once with a fake count
      break;
    }
    // Simpler: store a raw value. We extend MemoryRateLimitStore semantics.
    return this._storeRaw(key, tokens, windowMs);
  }

  async _storeRaw(key, tokensToAdd, windowMs) {
    // MemoryRateLimitStore increments by 1 per call.
    // For token tracking we need to add arbitrary amounts.
    // Use the store's internal Map directly when available (MemoryRateLimitStore),
    // or fall back to calling increment() tokensToAdd times (expensive but simple).
    if (this._store._store instanceof Map) {
      const fullKey = `tokens:${key}`;
      const now     = Date.now();
      const entry   = this._store._store.get(fullKey);
      const resetAt = entry && entry.resetAt > now ? entry.resetAt : now + windowMs;
      const count   = entry && entry.resetAt > now ? entry.count + tokensToAdd : tokensToAdd;
      this._store._store.set(fullKey, { count, resetAt });
      return { count, resetAt };
    }
    // Fallback for opaque stores (e.g. Redis-backed):
    // Call the store's increment once with tokensToAdd as the increment amount.
    // This requires the store to support arbitrary increments.
    // For Redis use INCRBY instead of INCR — implement RedisTokenStore if needed.
    return this._store.increment(`tokens:${key}`, windowMs);
  }

  async checkBudget(key, limit, windowMs) {
    if (!this._store._store) {
      // Opaque store — call increment to read current count
      const result = await this._store.increment(`tokens:${key}`, windowMs);
      // Undo: can't easily undo, so just check the count
      return { used: result.count, remaining: Math.max(0, limit - result.count), resetAt: result.resetAt };
    }
    const fullKey = `tokens:${key}`;
    const now     = Date.now();
    const entry   = this._store._store.get(fullKey);
    if (!entry || entry.resetAt <= now) {
      return { used: 0, remaining: limit, resetAt: now + windowMs };
    }
    return {
      used:      entry.count,
      remaining: Math.max(0, limit - entry.count),
      resetAt:   entry.resetAt,
    };
  }
}

// ── AITokenBudget ─────────────────────────────────────────────────────────────

class AITokenBudget {
  /**
   * @param {object} opts
   * @param {number}  [opts.daily]    — max tokens per 24 hours per user
   * @param {number}  [opts.hourly]   — max tokens per hour per user
   * @param {object}  [opts.store]    — custom store (RateLimitStore interface)
   * @param {string}  [opts.message]  — 429 message
   */
  constructor(opts = {}) {
    this._daily   = opts.daily   || null;
    this._hourly  = opts.hourly  || null;
    this._message = opts.message || 'AI token budget exceeded. Please try again later.';
    this._store   = new TokenStore(opts.store || new MemoryRateLimitStore());
  }

  // ── Express middleware ────────────────────────────────────────────────────

  middleware() {
    const self = this;

    return async (req, res, next) => {
      // Require authenticated user — skip if not available
      const userId = req.user?.id || req.user?._id;
      if (!userId) return next();

      try {
        // ── Check hourly budget ─────────────────────────────────────────────
        if (self._daily !== null) {
          const dailyKey    = `daily:${userId}`;
          const dailyWindow = 24 * 60 * 60 * 1000;
          const daily       = await self._store.checkBudget(dailyKey, self._daily, dailyWindow);

          res.setHeader('X-AI-Tokens-Daily-Limit',     self._daily);
          res.setHeader('X-AI-Tokens-Daily-Remaining', daily.remaining);
          res.setHeader('X-AI-Tokens-Daily-Reset',     Math.ceil(daily.resetAt / 1000));

          if (daily.remaining <= 0) {
            const retryAfter = Math.ceil((daily.resetAt - Date.now()) / 1000);
            res.setHeader('Retry-After', retryAfter);
            res.status(429);
            return res.end(JSON.stringify({ error: self._message, retryAfter }));
          }
        }

        if (self._hourly !== null) {
          const hourlyKey    = `hourly:${userId}`;
          const hourlyWindow = 60 * 60 * 1000;
          const hourly       = await self._store.checkBudget(hourlyKey, self._hourly, hourlyWindow);

          res.setHeader('X-AI-Tokens-Hourly-Limit',     self._hourly);
          res.setHeader('X-AI-Tokens-Hourly-Remaining', hourly.remaining);
          res.setHeader('X-AI-Tokens-Hourly-Reset',     Math.ceil(hourly.resetAt / 1000));

          if (hourly.remaining <= 0) {
            const retryAfter = Math.ceil((hourly.resetAt - Date.now()) / 1000);
            res.setHeader('Retry-After', retryAfter);
            res.status(429);
            return res.end(JSON.stringify({ error: self._message, retryAfter }));
          }
        }

        // ── Attach deduction helper to req ──────────────────────────────────
        // Called by the route handler after the AI response:
        //   await req.deductTokens(res.totalTokens)
        req.deductTokens = async (tokenCount) => {
          if (!tokenCount || tokenCount <= 0) return;
          const tc = Math.ceil(tokenCount);

          if (self._daily !== null) {
            await self._store._storeRaw(`daily:${userId}`,  tc, 24 * 60 * 60 * 1000);
          }
          if (self._hourly !== null) {
            await self._store._storeRaw(`hourly:${userId}`, tc, 60 * 60 * 1000);
          }
        };

        next();
      } catch (err) {
        // Budget check errors must never block requests — fail open
        console.error('[Millas AITokenBudget] Store error:', err.message);
        next();
      }
    };
  }

  // ── Static factories ──────────────────────────────────────────────────────

  /**
   * Create a per-user token budget middleware.
   *
   *   AITokenBudget.perUser({ daily: 100_000 }).middleware()
   *   AITokenBudget.perUser({ hourly: 10_000, daily: 100_000 }).middleware()
   */
  static perUser(opts = {}) {
    return new AITokenBudget(opts);
  }

  /**
   * Create from config section.
   *
   *   AITokenBudget.from(config.security?.aiTokenBudget)
   */
  static from(opts) {
    if (!opts || opts.enabled === false) return null;
    return new AITokenBudget(opts);
  }
}

module.exports = { AITokenBudget };