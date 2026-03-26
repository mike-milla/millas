'use strict';

/**
 * RequestContext
 *
 * The single argument passed to every Millas route handler and middleware.
 * Developers destructure exactly what they need — nothing else is in scope.
 *
 * Inspired by FastAPI's parameter injection. Each key maps to a specific
 * part of the request — no more digging through a monolithic req object.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   // Route params  → params
 *   Route.get('/users/:id', ({ params }) => User.findOrFail(params.id))
 *
 *   // Query string  → query
 *   Route.get('/users', ({ query }) => User.paginate(query.page, query.per_page))
 *
 *   // Request body  → body  (alias: json)
 *   Route.post('/users', async ({ body }) => {
 *     const user = await User.create(body);
 *     return jsonify(user, { status: 201 });
 *   })
 *
 *   // Uploaded files → files
 *   Route.post('/upload', ({ files }) => {
 *     const avatar = files.avatar;
 *     return jsonify({ size: avatar.size });
 *   })
 *
 *   // Authenticated user → user
 *   Route.get('/me', ({ user }) => jsonify(user))
 *
 *   // Multiple at once — destructure only what you need
 *   Route.put('/users/:id', async ({ params, body, user }) => {
 *     if (user.id !== params.id) abort(403);
 *     return jsonify(await User.update(params.id, body));
 *   })
 *
 *   // Inline validation on body — use typed validators from millas/core/validation
 *   Route.post('/posts', async ({ body }) => {
 *     const data = await body.validate({
 *       title:   string().required().max(255),
 *       content: string().required(),
 *     });
 *     return jsonify(await Post.create(data));
 *   })
 *
 *   // DI container — for resolving services at request time
 *   Route.get('/stats', ({ container }) => {
 *     const cache = container.make('Cache');
 *     return cache.remember('stats', 60, () => Stats.compute());
 *   })
 *
 *   // Full MillasRequest escape hatch — when you need something not covered
 *   Route.get('/raw', ({ req }) => {
 *     const ip = req.ip;
 *     return jsonify({ ip });
 *   })
 *
 * ── Context shape ────────────────────────────────────────────────────────────
 *
 *   {
 *     params,     // route parameters    { id: '5' }
 *     query,      // query string        { page: '2', search: 'alice' }
 *     body,       // request body        { name: 'Alice', email: '...' }  + .validate()
 *     json,       // alias for body      (same object)
 *     files,      // uploaded files      { avatar: File, resume: File }
 *     headers,    // request headers     { authorization: 'Bearer ...' }
 *     cookies,    // cookies             { session: 'abc123' }
 *     user,       // authenticated user  (set by AuthMiddleware)
 *     req,        // full MillasRequest  (escape hatch)
 *     container,  // DI container        container.make('Cache')
 *   }
 */
class RequestContext {
  /**
   * @param {import('./MillasRequest')} millaReq
   * @param {import('../container/Container')|null} container
   */
  constructor(millaReq, container = null) {
    this._req       = millaReq;
    this._container = container;

    // ── params ────────────────────────────────────────────────────────────────
    // Route parameters — /users/:id → params.id
    this.params = millaReq.raw.params || {};

    // ── query ─────────────────────────────────────────────────────────────────
    // Query string — ?page=2&search=alice → query.page, query.search
    this.query = millaReq.raw.query || {};

    // ── body / json ───────────────────────────────────────────────────────────
    // Parsed request body (JSON, form data, etc.)
    // body and json are the same object — use whichever reads better.
    const rawBody = millaReq.raw.body || {};
    this.body = this._buildBody(rawBody, millaReq);
    this.json = this.body;   // alias

    // ── files / file ──────────────────────────────────────────────────────────
    // Uploaded files (populated by multer or similar middleware)
    // req.files → multi-file upload  { avatar: File, resume: File }
    // req.file  → single-file upload (multer .single())
    // Prefer UploadedFile-wrapped instances set by UploadMiddleware (_millaFile/_millaFiles).
    // Fall back to raw multer objects only if UploadMiddleware hasn't run.
    this.file  = millaReq.raw._millaFile  || millaReq.raw.file  || null;
    this.files = millaReq.raw._millaFiles || millaReq.raw.files || {};

    // ── headers ───────────────────────────────────────────────────────────────
    this.headers = millaReq.raw.headers || {};

    // ── cookies ───────────────────────────────────────────────────────────────
    this.cookies = millaReq.raw.cookies || {};

    // ── user ──────────────────────────────────────────────────────────────────
    // Authenticated user — set by AuthMiddleware via req.user
    Object.defineProperty(this, 'user', {
      get: () => millaReq.raw.user ?? null,
      set: (v) => { millaReq.raw.user = v; },
      enumerable: true,
    });

    // ── req ───────────────────────────────────────────────────────────────────
    // Full MillasRequest — escape hatch for anything not covered above
    this.req = millaReq;

    // ── container ─────────────────────────────────────────────────────────────
    // DI container — resolve services at request time
    this.container = container;
  }

  // ─── Body with validation ──────────────────────────────────────────────────

  /**
   * Build the body object with an attached .validate() method.
   *
   *   const { string, email } = require('millas/core/validation');
   *
   *   const data = await body.validate({
   *     name:  string().required().max(100),
   *     email: email().required(),
   *   });
   *
   * When a route has .shape({ in: {...} }), validation already ran before
   * the handler — body is pre-validated and body.validate() is not needed.
   */
  _buildBody(rawBody, millaReq) {
    // Start with the raw body data
    const body = Object.assign(Object.create(null), rawBody);

    // Attach validate() directly on the body object
    Object.defineProperty(body, 'validate', {
      enumerable: false,   // doesn't show up in Object.keys / JSON.stringify
      value: async function validate(rules) {
        const { Validator } = require('../validation/Validator');
        return Validator.validate(rawBody, rules);
      },
    });

    // Attach only() and except() helpers too
    Object.defineProperty(body, 'only', {
      enumerable: false,
      value: function only(keys) {
        return keys.reduce((acc, k) => {
          if (k in rawBody) acc[k] = rawBody[k];
          return acc;
        }, {});
      },
    });

    Object.defineProperty(body, 'except', {
      enumerable: false,
      value: function except(keys) {
        return Object.fromEntries(
          Object.entries(rawBody).filter(([k]) => !keys.includes(k))
        );
      },
    });

    return body;
  }
}

module.exports = RequestContext;