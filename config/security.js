'use strict';

/**
 * Security Configuration
 *
 * Controls all framework-level security features.
 * All settings default to the most secure option — only relax what you need.
 *
 * Phase 1: Security headers, cookie defaults
 * Phase 2: CSRF protection, rate limiting, input validation
 */

module.exports = {

  /*
  |--------------------------------------------------------------------------
  | HTTP Security Headers
  |--------------------------------------------------------------------------
  */
  headers: {
    contentSecurityPolicy: {
      useNonce: false,
      directives: {
        defaultSrc:             ["'self'"],
        scriptSrc:              ["'self'"],
        styleSrc:               ["'self'", "'unsafe-inline'"],
        imgSrc:                 ["'self'", 'data:'],
        fontSrc:                ["'self'"],
        connectSrc:             ["'self'"],
        objectSrc:              ["'none'"],
        frameSrc:               ["'none'"],
        baseUri:                ["'self'"],
        formAction:             ["'self'"],
        frameAncestors:         ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    strictTransportSecurity: {
      maxAge:            31536000,
      includeSubDomains: true,
      preload:           true,
    },
    xFrameOptions:      'DENY',
    xContentTypeOptions: true,
    referrerPolicy:     'strict-origin-when-cross-origin',
    permissionsPolicy: {
      camera:       '()',
      microphone:   '()',
      geolocation:  '()',
      payment:      '()',
      usb:          '()',
    },
    removePoweredBy: true,
  },

  /*
  |--------------------------------------------------------------------------
  | Cookie Defaults
  |--------------------------------------------------------------------------
  | Applied to ALL cookies set via MillasResponse.cookie().
  */
  cookies: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path:     '/',
  },

  /*
  |--------------------------------------------------------------------------
  | CSRF Protection
  |--------------------------------------------------------------------------
  | Enabled by default for all POST/PUT/PATCH/DELETE requests.
  | Set to false to disable entirely (e.g. pure API services).
  |
  | exclude: path prefixes that bypass CSRF (REST API routes, webhooks).
  | These routes should be protected by API keys or request signing instead.
  |
  | fieldName:  the hidden form field name  (default: _csrf)
  | headerName: the AJAX request header     (default: x-csrf-token)
  | cookieName: the cookie holding the token (default: _csrf)
  |
  | IMPORTANT: Set APP_SECRET in your .env file.
  | Tokens are HMAC-signed using APP_SECRET — without it they are weakly signed.
  */
  csrf: {
    cookieName:  '_csrf',
    fieldName:   '_csrf',
    headerName:  'x-csrf-token',
    tokenLength: 32,
    exclude: [
      // '/api/',         // uncomment to exempt all /api/* routes
      // '/webhooks/',    // uncomment to exempt webhook endpoints
    ],
  },

  /*
  |--------------------------------------------------------------------------
  | Rate Limiting
  |--------------------------------------------------------------------------
  | global: applied to every incoming request before routes run.
  |
  | For stricter per-route limits (e.g. login, password reset, AI chat),
  | apply RateLimiter middleware directly on those routes:
  |
  |   const { RateLimiter } = require('millas/src/http/middleware/RateLimiter');
  |
  |   Route.post('/login', [
  |     RateLimiter.perIp({ max: 5, windowMs: 10 * 60 * 1000 }).middleware(),
  |   ], loginHandler);
  |
  |   Route.post('/ai/chat', [
  |     RateLimiter.perUser({ max: 20, windowMs: 60 * 1000 }).middleware(),
  |   ], chatHandler);
  |
  | store: defaults to in-memory (single process).
  | For multi-process / multi-server deployments, use RedisRateLimitStore:
  |
  |   const { RedisRateLimitStore } = require('millas/src/http/middleware/RateLimiter');
  |   rateLimit: { global: { store: new RedisRateLimitStore(redisClient) } }
  */
  rateLimit: {
    global: {
      enabled:  true,
      max:      100,                  // requests per window per IP
      windowMs: 15 * 60 * 1000,      // 15 minutes
      message:  'Too many requests, please try again later.',
    },
  },

};