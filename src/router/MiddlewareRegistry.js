'use strict';

/**
 * MiddlewareRegistry
 *
 * Maps string aliases → middleware handler classes or functions.
 *
 * Usage:
 *   MiddlewareRegistry.register('auth', AuthMiddleware);
 *   MiddlewareRegistry.register('throttle', ThrottleMiddleware);
 *
 * Registered automatically by AppServiceProvider (Phase 3+).
 */
class MiddlewareRegistry {
  constructor() {
    this._map = {};
  }

  /**
   * Register a middleware alias.
   * @param {string} alias
   * @param {Function|object} handler  — class with handle() or raw Express fn
   */
  register(alias, handler) {
    this._map[alias] = handler;
  }

  /**
   * Resolve a single alias to an Express-compatible function.
   * Supports parameterised aliases: 'throttle:60,1' → 60 req per 1 minute.
   *
   * @param {string|Function} aliasOrFn
   * @returns {Function}
   */
  resolve(aliasOrFn) {
    if (typeof aliasOrFn === 'function') return aliasOrFn;

    // Parse parameterised alias: 'throttle:60,1' → alias='throttle', params=['60','1']
    let alias  = aliasOrFn;
    let params = [];
    if (typeof aliasOrFn === 'string' && aliasOrFn.includes(':')) {
      const colonIdx = aliasOrFn.indexOf(':');
      alias  = aliasOrFn.slice(0, colonIdx);
      params = aliasOrFn.slice(colonIdx + 1).split(',').map(s => s.trim());
    }

    const Handler = this._map[alias];
    if (!Handler) {
      throw new Error(`Middleware "${aliasOrFn}" is not registered.`);
    }

    // If params provided, instantiate the class with them via fromParams() or constructor
    if (params.length > 0) {
      if (typeof Handler === 'function' && Handler.prototype &&
          typeof Handler.prototype.handle === 'function') {
        const instance = typeof Handler.fromParams === 'function'
          ? Handler.fromParams(params)
          : new Handler(...params);
        return (req, res, next) => {
          const result = instance.handle(req, res, next);
          if (result && typeof result.catch === 'function') result.catch(next);
        };
      }
    }

    // Pre-instantiated object with handle() method (e.g. new ThrottleMiddleware())
    if (typeof Handler === 'object' && Handler !== null && typeof Handler.handle === 'function') {
      return (req, res, next) => {
        const result = Handler.handle(req, res, next);
        if (result && typeof result.catch === 'function') result.catch(next);
      };
    }

    // Class with handle() on prototype
    if (typeof Handler === 'function' && Handler.prototype && typeof Handler.prototype.handle === 'function') {
      const instance = new Handler();
      return (req, res, next) => {
        const result = instance.handle(req, res, next);
        if (result && typeof result.catch === 'function') result.catch(next);
      };
    }

    // Raw Express function
    if (typeof Handler === 'function') return Handler;

    throw new Error(`Middleware "${aliasOrFn}" must be a function or class with handle().`);
  }

  /**
   * Resolve an array of aliases/functions.
   * @param {Array} list
   * @returns {Function[]}
   */
  resolveAll(list = []) {
    return list.map(m => this.resolve(m));
  }

  has(alias) {
    return Object.prototype.hasOwnProperty.call(this._map, alias);
  }

  all() {
    return { ...this._map };
  }
}

module.exports = MiddlewareRegistry;