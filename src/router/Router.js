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

    // ── Shape validation middleware ────────────────────────────────────────
    // If the route has a .shape() / .fromShape() declaration, inject a
    // validation middleware that runs BEFORE the handler.
    // On failure → 422 immediately, handler never runs.
    // On success → ctx.body is replaced with coerced, validated output.
    //
    // When the shape declares encoding:'multipart' or contains any file()
    // field, UploadMiddleware is injected first (before validation) so that
    // multer parses the multipart body and populates req.file / req.files /
    // req.body before the validation step reads them.
    const uploadMiddlewares = route.shape && this._shapeNeedsUpload(route.shape)
      ? this._buildUploadMiddleware(route.shape)
      : [];

    const shapeMiddlewares = route.shape
      ? this._buildShapeMiddleware(route.shape)
      : [];

    const terminalHandler = this._resolveTerminalHandler(
      route.handler,
      route.method,
      route.verb,
      route.path,
      route.name
    );

    this._adapter.mountRoute(route.verb, route.path, [
      ...middlewareHandlers,
      ...uploadMiddlewares,
      ...shapeMiddlewares,
      terminalHandler,
    ]);
  }

  /**
   * Returns true if the shape requires multipart parsing —
   * either because encoding is explicitly set to 'multipart', or because
   * the "in" schema contains at least one file() validator.
   *
   * @param {import('../http/Shape').ShapeDefinition} shape
   * @returns {boolean}
   */
  _shapeNeedsUpload(shape) {
    if (shape.encoding === 'multipart') return true;
    if (!shape.in) return false;
    return Object.values(shape.in).some(v => v?._type === 'file');
  }

  /**
   * Build an Express middleware array that runs UploadMiddleware before
   * the shape validation step. The UploadMiddleware is configured from
   * the shape (field names, maxSize, mimeTypes) so developers don't have
   * to configure it separately.
   *
   * @param {import('../http/Shape').ShapeDefinition} shape
   * @returns {Function[]}
   */
  _buildUploadMiddleware(shape) {
    const UploadMiddleware = require('../http/middleware/UploadMiddleware');
    const instance = UploadMiddleware.fromShape(shape);
    // Wrap it through the adapter so it becomes an Express (req,res,next) fn
    return [this._adapter.wrapMiddleware(instance, this._container)];
  }

  /**
   * Build Express middleware functions from a shape definition.
   * Returns an array of 0, 1, or 2 middleware functions
   * (one for body/in, one for query) depending on what the shape declares.
   *
   * For multipart routes, file fields from req.file / req.files are merged
   * into the validation input so file() validators in the schema run correctly.
   *
   * @param {import('../http/Shape').ShapeDefinition} shape
   * @returns {Function[]}
   */
  _buildShapeMiddleware(shape) {
    const { Validator } = require('../validation/Validator');
    const middlewares   = [];
    const isMultipart   = this._shapeNeedsUpload(shape);

    // ── Body / in validation ───────────────────────────────────────────────
    if (shape.in && Object.keys(shape.in).length) {
      middlewares.push(async (req, res, next) => {
        try {
          // For multipart requests, merge uploaded files into the validation
          // input so file() validators in the shape's "in" schema can run.
          // req.file  → single file (multer .single())
          // req.files → multiple files (multer .fields() or .any())
          let rawBody = req.body || {};
          if (isMultipart) {
            const fileInputs = {};
            // Prefer the already-wrapped UploadedFile instances written by
            // UploadMiddleware so FileValidator receives the same UploadedFile
            // objects that the handler will destructure.
            if (req._millaFile) {
              fileInputs[req._millaFile.fieldName] = req._millaFile;
            }
            if (req._millaFiles) {
              for (const [fieldname, f] of Object.entries(req._millaFiles)) {
                fileInputs[fieldname] = f;
              }
            }
            // Fallback to raw multer objects if UploadMiddleware hasn't run
            // (e.g. manual upload middleware setup without UploadMiddleware)
            if (!Object.keys(fileInputs).length) {
              if (req.file) fileInputs[req.file.fieldname] = req.file;
              if (req.files) {
                if (Array.isArray(req.files)) {
                  for (const f of req.files) fileInputs[f.fieldname] = f;
                } else {
                  for (const [fieldname, arr] of Object.entries(req.files)) {
                    fileInputs[fieldname] = arr.length === 1 ? arr[0] : arr;
                  }
                }
              }
            }
            rawBody = { ...rawBody, ...fileInputs };
          }

          const clean = await Validator.validate(rawBody, shape.in);
          // Replace req.body with the coerced, validated subset so the
          // handler's { body } destructure gets clean data automatically.
          req.body = clean;
          next();
        } catch (err) {
          // ValidationError → 422, any other error → pass to error handler
          if (err.code === 'EVALIDATION' || err.name === 'ValidationError') {
            return res.status(422).json({
              status:  422,
              message: 'Validation failed',
              errors:  err.errors || {},
            });
          }
          next(err);
        }
      });
    }

    // ── Query validation ───────────────────────────────────────────────────
    if (shape.query && Object.keys(shape.query).length) {
      middlewares.push(async (req, res, next) => {
        try {
          const clean = await Validator.validate(req.query || {}, shape.query);
          req.query   = clean;
          next();
        } catch (err) {
          if (err.code === 'EVALIDATION' || err.name === 'ValidationError') {
            return res.status(422).json({
              status:  422,
              message: 'Validation failed',
              errors:  err.errors || {},
            });
          }
          next(err);
        }
      });
    }

    return middlewares;
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