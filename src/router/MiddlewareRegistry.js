'use strict';

/**
 * MiddlewareRegistry
 *
 * Maps string aliases → Millas middleware classes or instances.
 * Resolution produces adapter-native handler functions via the adapter,
 * so this class has zero knowledge of Express (or any HTTP engine).
 *
 * The adapter is injected at resolution time (not construction time)
 * so the registry can be built before the adapter exists.
 */
class MiddlewareRegistry {
  constructor() {
    this._map = {};
  }

  /**
   * Register a middleware alias.
   *
   *   registry.register('auth',     AuthMiddleware)
   *   registry.register('throttle', new ThrottleMiddleware({ max: 60 }))
   */
  register(alias, handler) {
    this._map[alias] = handler;
    return this;
  }

  /**
   * Resolve a middleware alias or class/instance into an adapter-native handler.
   * Supports parameterized aliases: 'throttle:60,1' → 60 req per 1 minute.
   *
   * @param {string|Function|object} aliasOrFn
   * @param {import('../http/adapters/HttpAdapter')} adapter
   * @param {object|null} container
   * @returns {Function}  adapter-native handler
   */
  resolve(aliasOrFn, adapter, container = null) {
    // If it's already a function, pass through
    if (typeof aliasOrFn === 'function') {
      return aliasOrFn;
    }

    // Parse parameterized alias: 'throttle:60,1' → alias='throttle', params=['60','1']
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

    return this._wrap(Handler, adapter, container, params);
  }

  /**
   * Resolve all aliases in a list.
   */
  resolveAll(list = [], adapter, container = null) {
    return list.map(m => this.resolve(m, adapter, container));
  }

  /**
   * Return a no-op passthrough handler for the given adapter.
   * Used when a middleware alias is missing but should not crash the app.
   */
  resolvePassthrough(adapter) {
    // Adapter-agnostic: return a function matching the native signature
    // by asking the adapter to wrap a no-op middleware instance.
    return adapter.wrapMiddleware({
      handle: (_ctx, next) => next(),
    }, null);
  }

  has(alias) {
    return Object.prototype.hasOwnProperty.call(this._map, alias);
  }

  all() {
    return { ...this._map };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _wrap(Handler, adapter, container, params = []) {
    // If params provided, instantiate with fromParams() or constructor
    if (params.length > 0) {
      if (
        typeof Handler === 'function' &&
        Handler.prototype &&
        typeof Handler.prototype.handle === 'function'
      ) {
        const instance = typeof Handler.fromParams === 'function'
          ? Handler.fromParams(params)
          : new Handler(...params);
        return adapter.wrapMiddleware(instance, container);
      }
    }

    // Pre-instantiated Millas middleware object with handle()
    if (
      typeof Handler === 'object' &&
      Handler !== null &&
      typeof Handler.handle === 'function'
    ) {
      return adapter.wrapMiddleware(Handler, container);
    }

    // Millas middleware class (handle on prototype)
    if (
      typeof Handler === 'function' &&
      Handler.prototype &&
      typeof Handler.prototype.handle === 'function'
    ) {
      return adapter.wrapMiddleware(new Handler(), container);
    }

    // Raw adapter-native function — pass through as-is (escape hatch)
    if (typeof Handler === 'function') {
      return Handler;
    }

    throw new Error('Middleware must be a function or a class with handle().');
  }
}

module.exports = MiddlewareRegistry;