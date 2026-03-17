'use strict';

/**
 * Router
 *
 * Bridges the Millas RouteRegistry to any HttpAdapter.
 * Zero knowledge of Express (or any HTTP engine) — it only calls
 * the adapter interface defined in HttpAdapter.js.
 *
 * Responsibilities:
 *   - Resolve route handlers from the RouteRegistry
 *   - Resolve middleware aliases from the MiddlewareRegistry
 *   - Ask the adapter to mount each route
 *   - Ask the adapter to mount the welcome page, 404, and error handler
 */
class Router {
  /**
   * @param {import('../http/adapters/HttpAdapter')} adapter
   * @param {import('./RouteRegistry')}              registry
   * @param {import('./MiddlewareRegistry')}         middlewareRegistry
   * @param {import('../container/Container')|null}  container
   */
  constructor(adapter, registry, middlewareRegistry, container = null) {
    this._adapter   = adapter;
    this._registry  = registry;
    this._mw        = middlewareRegistry;
    this._container = container;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Mount all registered routes onto the adapter.
   * Does NOT add fallbacks — call mountFallbacks() after all routes
   * and any extra middleware (e.g. Admin panel) have been added.
   */
  mountRoutes() {
    for (const route of this._registry.all()) {
      this._bindRoute(route);
    }
    return this;
  }

  /**
   * Mount the 404 + error handlers.
   * Must be called LAST — after all routes and the admin panel.
   */
  mountFallbacks() {
    this._maybeInjectWelcome();
    this._adapter.mountNotFound();
    this._adapter.mountErrorHandler();
    return this;
  }

  /**
   * Mount routes + fallbacks in one call.
   */
  mount() {
    this.mountRoutes();
    this._maybeInjectWelcome();
    this._adapter.mountNotFound();
    this._adapter.mountErrorHandler();
    return this;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _bindRoute(route) {
    const middlewareHandlers = this._resolveMiddleware(route.middleware || []);
    const terminalHandler    = this._resolveTerminalHandler(
      route.handler,
      route.method,
      route.verb,
      route.path,
      route.name
    );

    this._adapter.mountRoute(route.verb, route.path, [
      ...middlewareHandlers,
      terminalHandler,
    ]);
  }

  _resolveMiddleware(list) {
    return list.map(alias => {
      try {
        return this._mw.resolve(alias, this._adapter, this._container);
      } catch (err) {
        console.warn(`[Millas] Middleware warning: ${err.message} — skipping.`);
        return this._mw.resolvePassthrough(this._adapter);
      }
    });
  }

  _resolveTerminalHandler(handler, method, verb, path, routeName) {
    const kernelFn    = this._extractKernelFn(handler, method);
    const displayName = this._buildDisplayName(handler, method, verb, path, routeName);
    return this._adapter.wrapKernelHandler(kernelFn, displayName, this._container);
  }

  /**
   * Pull the actual function out of the handler definition.
   * Three forms:
   *   1. Bare function/arrow:          Route.get('/', () => jsonify({}))
   *   2. Controller class + method:    Route.get('/', UserController, 'index')
   *   3. Controller instance + method: Route.get('/', controllerInstance, 'index')
   */
  _extractKernelFn(handler, method) {
    if (typeof handler === 'function' && !method) {
      return handler;
    }

    if (typeof handler === 'function' && typeof method === 'string') {
      const instance = new handler();
      if (typeof instance[method] !== 'function') {
        throw new Error(
          `Method "${method}" not found on controller "${handler.name}".`
        );
      }
      return instance[method].bind(instance);
    }

    if (typeof handler === 'object' && handler !== null && typeof method === 'string') {
      if (typeof handler[method] !== 'function') {
        throw new Error(`Method "${method}" not found on handler object.`);
      }
      return handler[method].bind(handler);
    }

    if (typeof handler === 'function') {
      return handler;
    }

    throw new Error(`Invalid route handler: ${JSON.stringify(handler)}`);
  }

  _buildDisplayName(handler, method, verb, path, routeName) {
    if (routeName) return routeName;

    if (typeof handler === 'function' && method) {
      return `${handler.name}.${method}`;
    }

    if (
      typeof handler === 'function' &&
      handler.name &&
      handler.name !== 'anonymous' &&
      handler.name !== ''
    ) {
      return handler.name;
    }

    return verb && path ? `${verb.toUpperCase()} ${path}` : 'anonymous';
  }

  /**
   * If no user-defined GET / route exists, ask the adapter to serve
   * a developer-friendly welcome page.
   * Only active outside production — silently skipped in prod.
   */
  _maybeInjectWelcome() {
    if (process.env.NODE_ENV === 'production') return;

    const hasRoot = this._registry.all().some(
      r => r.verb === 'GET' && (r.path === '/' || r.path === '')
    );

    if (!hasRoot) {
      let version = '';
      try { version = require('../../package.json').version; } catch {}
      this._adapter.mountWelcome(
        this._adapter.makeWelcomeHandler(version)
      );
    }
  }
}

module.exports = Router;