'use strict';

const Middleware = require('../middleware/Middleware');
const HttpError  = require('../errors/HttpError');

/**
 * RoleMiddleware
 *
 * Restricts access to users with specific roles.
 * Must run after AuthMiddleware (requires ctx.user).
 */
class RoleMiddleware extends Middleware {
  constructor(roles = []) {
    super();
    this.roles = Array.isArray(roles) ? roles : [roles];
  }

  async handle({ user }, next) {
    if (!user) {
      throw new HttpError(401, 'Unauthenticated — AuthMiddleware must run first');
    }

    const userRole = user.role || null;
    if (!userRole || !this.roles.includes(userRole)) {
      throw new HttpError(403,
        `Access denied. Required role: ${this.roles.join(' or ')}`
      );
    }

    return next();
  }
}

module.exports = RoleMiddleware;
