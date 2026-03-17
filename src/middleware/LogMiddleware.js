'use strict';

const Middleware = require('./Middleware');

/**
 * LogMiddleware
 *
 * Django-style HTTP request logging via MillasLog.
 * Uses the new ctx signature: handle({ req }, next)
 */
class LogMiddleware extends Middleware {
  constructor(options = {}) {
    super();
    this.silent        = options.silent        ?? false;
    this.includeQuery  = options.includeQuery  ?? false;
    this.includeIp     = options.includeIp     ?? true;
    this.slowThreshold = options.slowThreshold ?? 1000;
    this.skip          = options.skip          ?? null;
  }

  async handle({ req }, next) {
    if (this.silent) return next();
    if (typeof this.skip === 'function' && this.skip(req)) return next();

    const start = Date.now();

    // We can't hook into the response here since next() returns undefined.
    // Instead attach a finish listener to the raw Express res.
    req.raw.res.on('finish', () => {
      try {
        const MillasLog = require('../logger/internal');
        const { LEVELS } = require('../logger/levels');
        const ms     = Date.now() - start;
        const status = req.raw.res.statusCode;
        let   url    = req.path;
        if (this.includeQuery && req.raw.url?.includes('?')) url = req.raw.url;

        let level = status >= 500 ? LEVELS.ERROR
                  : status >= 400 ? LEVELS.WARN
                  : ms > this.slowThreshold ? LEVELS.WARN
                  : LEVELS.INFO;

        const ctx = { status, ms };
        if (this.includeIp) ctx.ip = req.ip;
        if (ms > this.slowThreshold) ctx.slow = true;

        MillasLog._log(level, 'HTTP', `${req.method} ${url} ${status} ${ms}ms`, ctx);
      } catch {}
    });

    return next();
  }
}

module.exports = LogMiddleware;
