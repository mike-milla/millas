'use strict';

const Middleware = require('../middleware/Middleware');
const HttpError  = require('../errors/HttpError');
const Auth       = require('./Auth');

/**
 * AuthMiddleware
 *
 * Guards routes from unauthenticated access using JWT.
 * Reads the Bearer token from the Authorization header,
 * verifies it, loads the user, and attaches them to req.user.
 *
 * Uses the Millas middleware signature: handle(ctx, next)
 * No Express res — returns a MillasResponse or calls next().
 */
class AuthMiddleware extends Middleware {
  async handle({ req, headers }, next) {
    const header = headers?.authorization || headers?.Authorization;
    //
    if (!header) {
      throw new HttpError(401, 'Authorization header missing');
    }
    //
    if (!header.startsWith('Bearer ')) {
      throw new HttpError(401, 'Invalid authorization format. Use: Bearer <token>');
    }
    //
    const token = header.slice(7);
    if (!token) {
      throw new HttpError(401, 'Token is empty');
    }
    //
    if (Auth.isRevoked(token)) {
      throw new HttpError(401, 'Token has been revoked');
    }
    //
    const payload = Auth.verify(token);
    //
    let user;
    try {
      user = await Auth.user(req);
    } catch (err) {
      throw new HttpError(401, 'Authentication failed: ' + err.message);
    }
    //
    if (!user) {
      throw new HttpError(401, 'User not found or has been deleted');
    }
    //
    req.raw.user         = user;
    req.raw.token        = token;
    req.raw.tokenPayload = payload;

    return next();
  }
}

module.exports = AuthMiddleware;