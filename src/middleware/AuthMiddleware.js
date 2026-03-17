'use strict';

const Middleware = require('./Middleware');
const HttpError  = require('../errors/HttpError');

/**
 * AuthMiddleware
 *
 * Guards routes from unauthenticated access.
 * Full JWT/session implementation unlocked in Phase 7.
 *
 * For now: checks for presence of Authorization header.
 * Replace the verify() method with real token logic in Phase 7.
 *
 * Register:
 *   middlewareRegistry.register('auth', AuthMiddleware);
 *
 * Apply:
 *   Route.prefix('/api').middleware(['auth']).group(() => { ... });
 */
class AuthMiddleware extends Middleware {
  async handle(req, res, next) {
    const header = req.headers['authorization'];

    if (!header) {
      throw new HttpError(401, 'No authorization token provided');
    }

    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new HttpError(401, 'Invalid authorization format. Use: Bearer <token>');
    }

    // Phase 7 will replace this with real JWT verification:
    // const user = await Auth.verifyToken(token);
    // req.user = user;

    // For now: attach a stub user so downstream handlers don't break
    req.user = { id: null, token, authenticated: false, _stub: true };

    next();
  }
}

module.exports = AuthMiddleware;
