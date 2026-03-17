'use strict';

const RouteGroup = require('./RouteGroup');
const RouteRegistry = require('./RouteRegistry');

/**
 * Route
 *
 * The primary developer-facing API for defining routes.
 *
 * Usage:
 *   Route.get('/users', UserController, 'index')
 *   Route.post('/users', UserController, 'store')
 *   Route.resource('/users', UserController)
 *   Route.group({ prefix: '/api', middleware: ['auth'] }, () => { ... })
 *   Route.prefix('/v1').group(() => { ... })
 */
class Route {
  constructor() {
    this._registry = new RouteRegistry();
    this._groupStack = [];   // stack of active group contexts
  }

  // ─── HTTP Verbs ─────────────────────────────────────────────────────────────

  get(path, handler, method) {
    return this._add('GET', path, handler, method);
  }

  post(path, handler, method) {
    return this._add('POST', path, handler, method);
  }

  put(path, handler, method) {
    return this._add('PUT', path, handler, method);
  }

  patch(path, handler, method) {
    return this._add('PATCH', path, handler, method);
  }

  delete(path, handler, method) {
    return this._add('DELETE', path, handler, method);
  }

  options(path, handler, method) {
    return this._add('OPTIONS', path, handler, method);
  }

  any(path, handler, method) {
    const verbs = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    verbs.forEach(v => this._add(v, path, handler, method));
  }

  // ─── Resource Routes ─────────────────────────────────────────────────────────
  // Generates 5 conventional RESTful routes for a controller.

  resource(path, ControllerClass, options = {}) {
    const only   = options.only;
    const except = options.except || [];

    const map = [
      { verb: 'GET',    suffix: '',       action: 'index',   name: `${path}.index`   },
      { verb: 'GET',    suffix: '/:id',   action: 'show',    name: `${path}.show`    },
      { verb: 'POST',   suffix: '',       action: 'store',   name: `${path}.store`   },
      { verb: 'PUT',    suffix: '/:id',   action: 'update',  name: `${path}.update`  },
      { verb: 'DELETE', suffix: '/:id',   action: 'destroy', name: `${path}.destroy` },
    ];

    for (const route of map) {
      if (only && !only.includes(route.action)) continue;
      if (except.includes(route.action)) continue;
      this._add(route.verb, path + route.suffix, ControllerClass, route.action, route.name);
    }

    return this;
  }

  // ─── Route Groups ────────────────────────────────────────────────────────────

  /**
   * Route.group({ prefix, middleware, name }, callback)
   * Route.group(callback)  — shorthand, no attributes
   */
  group(attributes, callback) {
    if (typeof attributes === 'function') {
      callback = attributes;
      attributes = {};
    }

    const group = new RouteGroup(attributes, this._groupStack);
    this._groupStack.push(group);
    callback();
    this._groupStack.pop();

    return this;
  }

  /**
   * Fluent prefix() — returns a builder that defers to group()
   *   Route.prefix('/api/v1').middleware(['auth']).group(() => { ... })
   */
  prefix(prefix) {
    return new RouteGroupBuilder(this, { prefix });
  }

  /**
   * Attach middleware to the next group or route
   */
  middleware(middleware) {
    return new RouteGroupBuilder(this, { middleware });
  }

  /**
   * Named route prefix
   */
  name(name) {
    return new RouteGroupBuilder(this, { name });
  }

  // ─── Auth convenience ────────────────────────────────────────────────────────

  /**
   * Register all standard auth routes under a given prefix.
   *
   * Route.auth()              // registers under /auth
   * Route.auth('/api/auth')   // custom prefix
   *
   * Registers:
   *   POST   /auth/register
   *   POST   /auth/login
   *   POST   /auth/logout
   *   GET    /auth/me
   *   POST   /auth/refresh
   *   POST   /auth/forgot-password
   *   POST   /auth/reset-password
   */
  auth(prefix = '/auth') {
    const AuthController = require('../auth/AuthController');
    this.group({ prefix }, () => {
      this.post('/register',        AuthController, 'register');
      this.post('/login',           AuthController, 'login');
      this.post('/logout',          AuthController, 'logout');
      this.get('/me',               AuthController, 'me');
      this.post('/refresh',         AuthController, 'refresh');
      this.post('/forgot-password', AuthController, 'forgotPassword');
      this.post('/reset-password',  AuthController, 'resetPassword');
    });
    return this;
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  _add(verb, path, handler, method, routeName) {
    // Merge active group context
    const context = this._mergeGroupStack();

    // Build full path
    const fullPath = this._joinPaths(context.prefix || '', path);

    // Resolve middleware
    const middleware = [
      ...(context.middleware || []),
    ];

    // Build route name
    const name = routeName
      ? (context.name ? context.name + '.' + routeName : routeName)
      : null;

    const entry = {
      verb,
      path: fullPath,
      handler,
      method,      // string method name OR raw function
      middleware,
      name,
    };

    this._registry.register(entry);
    return this;
  }

  _mergeGroupStack() {
    return this._groupStack.reduce((merged, group) => {
      // Prefix: concatenate
      merged.prefix = this._joinPaths(merged.prefix || '', group.prefix || '');
      // Middleware: accumulate
      merged.middleware = [
        ...(merged.middleware || []),
        ...(group.middleware || []),
      ];
      // Name: concatenate
      merged.name = [merged.name, group.name].filter(Boolean).join('');
      return merged;
    }, {});
  }

  _joinPaths(...parts) {
    return '/' + parts
      .map(p => p.replace(/^\/|\/$/g, ''))
      .filter(Boolean)
      .join('/');
  }

  // ─── Public Accessors ────────────────────────────────────────────────────────

  getRegistry() {
    return this._registry;
  }

  list() {
    return this._registry.all();
  }
}

// ─── RouteGroupBuilder (fluent chain) ────────────────────────────────────────

class RouteGroupBuilder {
  constructor(router, attrs) {
    this._router = router;
    this._attrs  = attrs;
  }

  prefix(prefix) {
    this._attrs.prefix = this._joinPaths(this._attrs.prefix || '', prefix);
    return this;
  }

  middleware(middleware) {
    this._attrs.middleware = [
      ...(this._attrs.middleware || []),
      ...(Array.isArray(middleware) ? middleware : [middleware]),
    ];
    return this;
  }

  name(name) {
    this._attrs.name = (this._attrs.name || '') + name;
    return this;
  }

  group(callback) {
    return this._router.group(this._attrs, callback);
  }

  _joinPaths(...parts) {
    return '/' + parts
      .map(p => p.replace(/^\/|\/$/g, ''))
      .filter(Boolean)
      .join('/');
  }
}

module.exports = Route;
