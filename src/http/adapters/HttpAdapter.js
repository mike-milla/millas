'use strict';

/**
 * HttpAdapter
 *
 * Abstract interface between the Millas kernel and any underlying HTTP engine.
 * The kernel never imports Express (or Fastify, or Hono) directly — it only
 * calls the methods defined here.
 *
 * To add a new HTTP engine, create a class that extends HttpAdapter and
 * implements every method. The kernel works unchanged.
 *
 * ── Implemented by ───────────────────────────────────────────────────────────
 *
 *   ExpressAdapter   (default, ships with Millas)
 *   FastifyAdapter   (future)
 *   HonoAdapter      (future)
 *
 * ── Lifecycle ────────────────────────────────────────────────────────────────
 *
 *   1. adapter.applyBodyParsers()          — JSON + urlencoded
 *   2. adapter.applyMiddleware(fn)         — any raw adapter-level middleware
 *   3. adapter.mountRoute(verb, path, handlers) — register app routes
 *   4. adapter.mountWelcome(handler)       — optional dev welcome page
 *   5. adapter.mountNotFound()             — 404 handler
 *   6. adapter.mountErrorHandler()         — global error handler
 *   7. await adapter.listen(port, host)    — start accepting connections
 *   8. adapter.close()                     — graceful shutdown
 */
class HttpAdapter {

  // ── Setup ──────────────────────────────────────────────────────────────────

  /**
   * Apply JSON + urlencoded body parsers.
   * Called once during bootstrap, before any routes are mounted.
   */
  applyBodyParsers() {
    throw new Error(`${this.constructor.name} must implement applyBodyParsers()`);
  }

  /**
   * Apply a single raw middleware function at the adapter level.
   * Used for things like helmet(), compression() that are engine-specific.
   *
   * @param {Function} fn  — adapter-native middleware function
   */
  applyMiddleware(fn) {
    throw new Error(`${this.constructor.name} must implement applyMiddleware(fn)`);
  }

  // ── Route mounting ─────────────────────────────────────────────────────────

  /**
   * Register a route handler.
   *
   * @param {string}     verb      — 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'
   * @param {string}     path      — e.g. '/users/:id'
   * @param {Function[]} handlers  — [middleware..., terminalHandler]
   *                                 Each handler is a Millas kernel handler
   *                                 (expressReq, expressRes, expressNext) already
   *                                 converted by the adapter's wrapKernelHandler().
   */
  mountRoute(verb, path, handlers) {
    throw new Error(`${this.constructor.name} must implement mountRoute(verb, path, handlers)`);
  }

  /**
   * Mount the dev welcome page for GET /.
   * Only called when no user route covers GET /.
   *
   * @param {Function} handler  — adapter-native handler function
   */
  mountWelcome(handler) {
    throw new Error(`${this.constructor.name} must implement mountWelcome(handler)`);
  }

  /**
   * Mount the 404 fallback handler.
   * Must be called AFTER all routes and mountWelcome().
   */
  mountNotFound() {
    throw new Error(`${this.constructor.name} must implement mountNotFound()`);
  }

  /**
   * Mount the global error handler.
   * Must be called LAST — after mountNotFound().
   */
  mountErrorHandler() {
    throw new Error(`${this.constructor.name} must implement mountErrorHandler()`);
  }

  // ── Request / Response bridge ──────────────────────────────────────────────

  /**
   * Wrap a Millas kernel handler function into an adapter-native handler.
   *
   * The kernel handler signature is:
   *   (millaCtx: RequestContext, trackedNext: Function) => Promise<MillasResponse>
   *
   * The adapter wraps this into whatever its native handler signature is,
   * e.g. (req, res, next) for Express.
   *
   * @param {Function} kernelFn
   * @param {string}   displayName  — for error messages
   * @param {object}   container    — DI container
   * @returns {Function}  adapter-native handler
   */
  wrapKernelHandler(kernelFn, displayName, container) {
    throw new Error(`${this.constructor.name} must implement wrapKernelHandler()`);
  }

  /**
   * Wrap a Millas middleware instance into an adapter-native handler.
   *
   * @param {object} instance  — Millas Middleware instance with handle(ctx, next)
   * @param {object} container — DI container
   * @returns {Function}  adapter-native handler
   */
  wrapMiddleware(instance, container) {
    throw new Error(`${this.constructor.name} must implement wrapMiddleware()`);
  }

  /**
   * Dispatch a MillasResponse to the underlying engine's response object.
   *
   * @param {MillasResponse} response
   * @param {*}              nativeRes  — e.g. Express res
   */
  dispatch(response, nativeRes) {
    throw new Error(`${this.constructor.name} must implement dispatch(response, nativeRes)`);
  }

  // ── Server lifecycle ───────────────────────────────────────────────────────

  /**
   * Start listening on port/host.
   * Returns a Promise that resolves once the server is bound.
   *
   * @param {number} port
   * @param {string} host
   * @returns {Promise<void>}
   */
  listen(port, host) {
    throw new Error(`${this.constructor.name} must implement listen(port, host)`);
  }

  /**
   * Gracefully close the server.
   * Returns a Promise that resolves once all connections are drained.
   *
   * @returns {Promise<void>}
   */
  close() {
    throw new Error(`${this.constructor.name} must implement close()`);
  }

  /**
   * The name of this adapter, used in logs and error messages.
   * @returns {string}
   */
  get name() {
    return this.constructor.name;
  }
}

module.exports = HttpAdapter;