'use strict';

const { LEVELS } = require('./levels');

/**
 * Logger
 *
 * The Millas application logger. Inspired by Android's Timber library —
 * a small, extensible logging tree where you plant channels ("trees")
 * and log through a unified facade.
 *
 * ── Quick start ────────────────────────────────────────────────────────────
 *
 *   const { Log } = require('millas');
 *
 *   Log.i('Server started on port 3000');
 *   Log.d('QueryBuilder', 'SELECT * FROM users', { duration: '4ms' });
 *   Log.w('Auth', 'Token expiring soon', { userId: 5 });
 *   Log.e('Database', 'Connection failed', error);
 *   Log.wtf('Payment', 'Stripe returned null transaction');
 *
 * ── Tag chaining (like Timber.tag()) ───────────────────────────────────────
 *
 *   Log.tag('UserService').i('User created', { id: 5 });
 *   Log.tag('Mailer').d('Sending email', { to: 'a@b.com' });
 *
 * ── Full signatures ────────────────────────────────────────────────────────
 *
 *   Log.v(message)
 *   Log.v(tag, message)
 *   Log.v(tag, message, context)        // context = object | primitive
 *   Log.v(tag, message, error)          // error = Error instance
 *   Log.v(tag, message, context, error)
 *
 * ── Configuration ──────────────────────────────────────────────────────────
 *
 *   Log.configure({
 *     minLevel: LEVELS.INFO,     // filter out VERBOSE + DEBUG in production
 *     channel:  new StackChannel([
 *       new ConsoleChannel({ formatter: new PrettyFormatter() }),
 *       new FileChannel({ formatter: new SimpleFormatter(), minLevel: LEVELS.WARN }),
 *     ]),
 *   });
 *
 * ── Request logging (Django-style) ─────────────────────────────────────────
 *
 *   // In bootstrap/app.js — installed automatically by LogServiceProvider
 *   app.use(Log.requestMiddleware());
 *   // Logs: [2026-03-15 12:00:00] I  HTTP  POST /api/users 201 14ms
 */
class Logger {
  constructor() {
    this._channel    = null;      // primary channel (StackChannel in production)
    this._minLevel   = LEVELS.DEBUG;
    this._tag        = null;      // set by .tag() for a single chained call
    this._defaultTag = 'App';
  }

  // ─── Configuration ────────────────────────────────────────────────────────

  /**
   * Configure the logger.
   *
   * @param {object} options
   * @param {object}  [options.channel]    — a channel or StackChannel instance
   * @param {number}  [options.minLevel]   — minimum level to emit (LEVELS.*)
   * @param {string}  [options.defaultTag] — fallback tag when none supplied
   */
  configure(options = {}) {
    if (options.channel  !== undefined) this._channel    = options.channel;
    if (options.minLevel !== undefined) this._minLevel   = options.minLevel;
    if (options.defaultTag !== undefined) this._defaultTag = options.defaultTag;
    return this;
  }

  /**
   * Set a one-shot tag for the next log call.
   * Returns a proxy that resets the tag after the call.
   *
   *   Log.tag('UserService').i('Created user', { id: 5 });
   */
  tag(name) {
    // Return a lightweight proxy that carries the tag
    return new TaggedLogger(this, name);
  }

  // ─── Timber-style level methods ───────────────────────────────────────────

  /** VERBOSE — very detailed tracing, usually disabled in production */
  v(...args) { return this._log(LEVELS.VERBOSE, null, ...args); }

  /** DEBUG — development diagnostics */
  d(...args) { return this._log(LEVELS.DEBUG, null, ...args); }

  /** INFO — normal operational messages */
  i(...args) { return this._log(LEVELS.INFO, null, ...args); }

  /** WARN — unexpected but recoverable */
  w(...args) { return this._log(LEVELS.WARN, null, ...args); }

  /** ERROR — something failed */
  e(...args) { return this._log(LEVELS.ERROR, null, ...args); }

  /**
   * WTF — "What a Terrible Failure"
   * A condition that should NEVER happen. Always logged regardless of minLevel.
   * Triggers a big visual warning in the console.
   */
  wtf(...args) { return this._log(LEVELS.WTF, null, ...args); }

  // ─── Verbose aliases (for readability) ────────────────────────────────────

  /** Alias for i() */
  info(...args)    { return this.i(...args); }
  /** Alias for d() */
  debug(...args)   { return this.d(...args); }
  /** Alias for w() */
  warn(...args)    { return this.w(...args); }
  /** Alias for e() */
  error(...args)   { return this.e(...args); }
  /** Alias for v() */
  verbose(...args) { return this.v(...args); }

  // ─── Request middleware (Django-style) ────────────────────────────────────

  /**
   * Returns an Express middleware that logs every HTTP request.
   *
   * Log format:
   *   POST /api/users 201 14ms  (coloured by status)
   *
   * @param {object} [options]
   * @param {boolean} [options.includeQuery=false]   — append ?query to path
   * @param {boolean} [options.includeBody=false]    — log request body (be careful with PII)
   * @param {number}  [options.slowThreshold=1000]   — warn if response > Nms
   * @param {Function} [options.skip]                — (req, res) => bool — skip certain routes
   */
  requestMiddleware(options = {}) {
    const self = this;
    const {
      includeQuery   = false,
      includeBody    = false,
      slowThreshold  = 1000,
      skip,
    } = options;

    return function millaRequestLogger(req, res, next) {
      if (typeof skip === 'function' && skip(req, res)) return next();

      const start = Date.now();

      res.on('finish', () => {
        const ms     = Date.now() - start;
        const status = res.statusCode;
        const method = req.method;
        let   url    = req.path || req.url || '/';

        if (includeQuery && req.url && req.url.includes('?')) {
          url = req.url;
        }

        // Determine log level from status code — mirrors Django's request logging
        let level;
        if      (status >= 500) level = LEVELS.ERROR;
        else if (status >= 400) level = LEVELS.WARN;
        else if (ms > slowThreshold) level = LEVELS.WARN;
        else                    level = LEVELS.INFO;

        const ctx = {
          method,
          status,
          ms,
          ip: req.ip || req.connection?.remoteAddress,
        };

        if (includeBody && req.body && Object.keys(req.body).length) {
          ctx.body = req.body;
        }

        if (ms > slowThreshold) {
          ctx.slow = true;
        }

        self._log(level, 'HTTP', `${method} ${url} ${status} ${ms}ms`, ctx);
      });

      next();
    };
  }

  // ─── Timer utility ────────────────────────────────────────────────────────

  /**
   * Start a named timer. Returns a function that logs the elapsed time.
   *
   *   const done = Log.time('Database query');
   *   await db.query(...);
   *   done(); // → I  Timer  Database query: 42ms
   */
  time(label) {
    const start = Date.now();
    return (extraTag) => {
      const ms = Date.now() - start;
      this._log(LEVELS.DEBUG, extraTag || 'Timer', `${label}: ${ms}ms`, { ms });
      return ms;
    };
  }

  /**
   * Wrap an async function and log its execution time.
   *
   *   const result = await Log.timed('fetchUsers', () => User.all());
   */
  async timed(label, fn, tag) {
    const done = this.time(label);
    try {
      const result = await fn();
      done(tag);
      return result;
    } catch (err) {
      this._log(LEVELS.ERROR, tag || 'Timer', `${label} threw`, err);
      throw err;
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Core dispatch method.
   *
   * Signatures:
   *   _log(level, forcedTag, message)
   *   _log(level, forcedTag, tag, message)
   *   _log(level, forcedTag, tag, message, context)
   *   _log(level, forcedTag, tag, message, context, error)
   *   _log(level, forcedTag, tag, message, error)          // Error as 4th arg
   */
  _log(level, forcedTag, ...args) {
    // WTF is always emitted regardless of minLevel
    if (level !== LEVELS.WTF && level < this._minLevel) return;

    const entry = this._parse(level, forcedTag, args);
    this._emit(entry);
  }

  _parse(level, forcedTag, args) {
    let tag, message, context, error;

    // Normalise arguments
    if (args.length === 0) {
      message = '';
    } else if (args.length === 1) {
      // Single arg — could be a string message or an Error
      if (args[0] instanceof Error) {
        error   = args[0];
        message = error.message;
      } else {
        message = String(args[0]);
      }
    } else if (args.length === 2) {
      // (tag, message) OR (message, context/error)
      if (typeof args[0] === 'string' && typeof args[1] === 'string') {
        // Both strings: tag + message
        tag     = args[0];
        message = args[1];
      } else if (args[1] instanceof Error) {
        message = String(args[0]);
        error   = args[1];
      } else if (typeof args[0] === 'string') {
        message = args[0];
        context = args[1];
      } else {
        message = String(args[0]);
        context = args[1];
      }
    } else if (args.length === 3) {
      // (tag, message, context/error)
      tag     = String(args[0]);
      message = String(args[1]);
      if (args[2] instanceof Error) error   = args[2];
      else                          context = args[2];
    } else {
      // (tag, message, context, error)
      tag     = String(args[0]);
      message = String(args[1]);
      context = args[2];
      error   = args[3] instanceof Error ? args[3] : undefined;
    }

    return {
      level,
      tag:       forcedTag || tag || this._defaultTag,
      message:   message   || '',
      context,
      error,
      timestamp: new Date().toISOString(),
      pid:       process.pid,
    };
  }

  _emit(entry) {
    if (!this._channel) {
      // No channel configured — fall back to raw console so nothing is lost
      const prefix = `[${entry.level}] ${entry.tag}: ${entry.message}`;
      if (entry.level >= 4) process.stderr.write(prefix + '\n');
      else                  process.stdout.write(prefix + '\n');
      return;
    }

    try {
      this._channel.write(entry);
    } catch (err) {
      // Never crash the app because of a logging failure
      process.stderr.write(`[millas logger] channel error: ${err.message}\n`);
    }
  }
}

// ─── TaggedLogger — returned by Log.tag() ─────────────────────────────────────

class TaggedLogger {
  constructor(logger, tag) {
    this._logger = logger;
    this._tag    = tag;
  }

  v(...args) { return this._logger._log(LEVELS.VERBOSE, this._tag, ...args); }
  d(...args) { return this._logger._log(LEVELS.DEBUG,   this._tag, ...args); }
  i(...args) { return this._logger._log(LEVELS.INFO,    this._tag, ...args); }
  w(...args) { return this._logger._log(LEVELS.WARN,    this._tag, ...args); }
  e(...args) { return this._logger._log(LEVELS.ERROR,   this._tag, ...args); }
  wtf(...args) { return this._logger._log(LEVELS.WTF,  this._tag, ...args); }

  info(...args)    { return this.i(...args); }
  debug(...args)   { return this.d(...args); }
  warn(...args)    { return this.w(...args); }
  error(...args)   { return this.e(...args); }
  verbose(...args) { return this.v(...args); }
}

module.exports = Logger;
