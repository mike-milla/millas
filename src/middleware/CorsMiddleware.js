'use strict';

const Middleware     = require('./Middleware');
const MillasResponse = require('../http/MillasResponse');

/**
 * CorsMiddleware
 *
 * Adds CORS headers. Uses the new ctx signature.
 */
class CorsMiddleware extends Middleware {
  constructor(options = {}) {
    super();
    this.origins     = options.origins     || ['*'];
    this.methods     = options.methods     || ['GET','POST','PUT','PATCH','DELETE','OPTIONS'];
    this.headers     = options.headers     || ['Content-Type','Authorization','X-Requested-With'];
    this.credentials = options.credentials ?? false;
    this.maxAge      = options.maxAge      || 86400;
  }

  async handle({ req }, next) {
    const origin = req.header('origin');

    // Build headers map
    const h = {};
    if (this.origins.includes('*')) {
      h['Access-Control-Allow-Origin'] = '*';
    } else if (origin && this.origins.includes(origin)) {
      h['Access-Control-Allow-Origin'] = origin;
      h['Vary'] = 'Origin';
    }
    h['Access-Control-Allow-Methods']  = this.methods.join(', ');
    h['Access-Control-Allow-Headers']  = this.headers.join(', ');
    h['Access-Control-Max-Age']        = String(this.maxAge);
    if (this.credentials) {
      h['Access-Control-Allow-Credentials'] = 'true';
    }

    // Preflight — short-circuit with 204
    if (req.method === 'OPTIONS') {
      return MillasResponse.empty(204).withHeaders(h);
    }

    // Proceed — but we still need headers on the eventual response.
    // Store on raw req so ResponseDispatcher can pick them up.
    req.raw._corsHeaders = h;
    return next();
  }
}

module.exports = CorsMiddleware;
