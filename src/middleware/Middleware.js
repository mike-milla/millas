'use strict';

/**
 * Middleware
 *
 * Base class for all Millas middleware.
 *
 * Middleware receives a RequestContext and a next() function.
 * Destructure exactly what you need from the context — same as route handlers.
 *
 *   class AuthMiddleware extends Middleware {
 *     async handle({ headers, user }, next) {
 *       if (!headers.authorization) {
 *         return jsonify({ error: 'Unauthorized' }, { status: 401 });
 *       }
 *       return next();
 *     }
 *   }
 *
 *   class LogMiddleware extends Middleware {
 *     async handle({ req }, next) {
 *       Log.i('HTTP', `${req.method} ${req.path}`);
 *       return next();
 *     }
 *   }
 */
class Middleware {
  /**
   * @param {import('../http/RequestContext')} ctx
   * @param {Function} next
   * @returns {import('../http/MillasResponse')|Promise<import('../http/MillasResponse')>}
   */
  async handle(ctx, next) {
    throw new Error(`${this.constructor.name} must implement handle(ctx, next).`);
  }

  /**
   * Called after the response is dispatched.
   * @param {import('../http/RequestContext')}  ctx
   * @param {import('../http/MillasResponse')}  response
   */
  async terminate(ctx, response) {}
}

module.exports = Middleware;
