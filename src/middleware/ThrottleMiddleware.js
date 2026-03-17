'use strict';

const Middleware     = require('./Middleware');
const MillasResponse = require('../http/MillasResponse');
const { jsonify }    = require('../http/helpers');

/**
 * ThrottleMiddleware
 *
 * Simple in-memory rate limiter.
 * Uses the Millas middleware signature: handle(req, next).
 */
class ThrottleMiddleware extends Middleware {
  constructor(options = {}) {
    super();
    this.max    = options.max    || 60;
    this.window = options.window || 60;
    this.keyBy  = options.keyBy  || ((req) => req.ip || 'anonymous');
    this._store = new Map();
  }

  async handle(req, next) {
    const key    = this.keyBy(req);
    const now    = Date.now();
    let   record = this._store.get(key);

    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + this.window * 1000 };
      this._store.set(key, record);
    }

    record.count++;

    const remaining = Math.max(0, this.max - record.count);
    const resetIn   = Math.ceil((record.resetAt - now) / 1000);

    // Rate limit headers — added to whatever response comes back
    // We set them on the raw Express res since we don't have the final response yet.
    // These headers will be present on all responses from throttled routes.
    req.raw.res.setHeader('X-RateLimit-Limit',     String(this.max));
    req.raw.res.setHeader('X-RateLimit-Remaining', String(remaining));
    req.raw.res.setHeader('X-RateLimit-Reset',     String(Math.ceil(record.resetAt / 1000)));

    if (record.count > this.max) {
      return jsonify({
        error:      'Too Many Requests',
        message:    `Rate limit exceeded. Try again in ${resetIn}s.`,
        status:     429,
        retryAfter: resetIn,
      }, { status: 429 });
    }

    return next();
  }
}

module.exports = ThrottleMiddleware;
