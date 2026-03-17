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
   * @param {string|Function} aliasOrFn
   * @returns {Function}
   */
  resolve(aliasOrFn) {
    if (typeof aliasOrFn === 'function') return aliasOrFn;

    const Handler = this._map[aliasOrFn];
    if (!Handler) {
      throw new Error(`Middleware "${aliasOrFn}" is not registered.`);
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
