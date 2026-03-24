'use strict';

/**
 * ApiResource / ApiEndpoint / ApiField
 *
 * The three classes developers use to document their API.
 * Mirrors the Admin panel's AdminResource/AdminField pattern.
 *
 * ── Minimal (grouping only, zero boilerplate) ────────────────────────────────
 *
 *   class UserApiResource extends ApiResource {
 *     static controller = UserController;
 *     static label      = 'Users';
 *     static group      = 'Auth & Users';
 *   }
 *
 * ── Full ─────────────────────────────────────────────────────────────────────
 *
 *   class UserApiResource extends ApiResource {
 *     static controller  = UserController;
 *     static label       = 'Users';
 *     static group       = 'Auth & Users';
 *     static prefix      = '/api/v1';
 *     static description = 'Manage users and sessions.';
 *
 *     static endpoints() {
 *       return [
 *         ApiEndpoint.post('/auth/register')
 *           .label('Register')
 *           .body({
 *             name:     ApiField.text().required().example('Jane Doe'),
 *             email:    ApiField.email().required().example('jane@example.com'),
 *             password: ApiField.password().required(),
 *           })
 *           .response(201, { id: 1, name: 'Jane Doe', token: 'eyJ...' }),
 *
 *         ApiEndpoint.get('/users/me')
 *           .label('Get current user')
 *           .auth()
 *           .response(200, { id: 1, name: 'Jane Doe' }),
 *
 *         ApiEndpoint.patch('/users/:id')
 *           .label('Update user')
 *           .auth()
 *           .param('id', ApiField.number().example(1).description('User ID'))
 *           .body({ name: ApiField.text().example('Jane') }),
 *
 *         ApiEndpoint.get('/users')
 *           .label('List users')
 *           .auth()
 *           .query({
 *             page:   ApiField.number().example(1),
 *             search: ApiField.text().example('alice'),
 *           }),
 *       ];
 *     }
 *   }
 *
 *   Docs.register(UserApiResource);
 *
 * ── Auto-discovery ────────────────────────────────────────────────────────────
 *
 * Routes are always auto-discovered from RouteRegistry.
 * ApiResource enriches them — you never re-declare paths manually.
 * If no ApiResource matches a route, it still appears in the docs panel
 * under an "Undocumented" group with its method, path, and auth badge.
 */
class ApiResource {
  /** Controller class this resource documents. Drives auto-matching. */
  static controller  = null;

  /** Sidebar label */
  static label       = null;

  /** Sidebar group — resources sharing the same group collapse together */
  static group       = null;

  /** Bootstrap Icons name */
  static icon        = 'code-slash';

  /**
   * Path prefix applied to all endpoint paths in this resource.
   * Allows short paths in endpoints():
   *   prefix = '/api/v1'  →  .post('/auth/login')  resolves to /api/v1/auth/login
   */
  static prefix      = '';

  /** Short description shown at the top of the resource section */
  static description = null;

  /**
   * Base URL override for "Try it" requests in this resource.
   * Falls back to the global env base_url.
   */
  static baseUrl     = null;

  /**
   * Define enriched endpoint declarations.
   * Return an array of ApiEndpoint instances.
   */
  static endpoints() { return []; }

  /**
   * Build the merged endpoint list by combining declared endpoints
   * with auto-discovered routes from the live RouteRegistry.
   * @internal — called by Docs
   */
  static _build(routeRegistry) {
    const declared  = this.endpoints();
    const prefix    = this.prefix || '';

    // Index declared endpoints by (verb, normalised path)
    const byKey = new Map();
    for (const ep of declared) {
      byKey.set(`${ep._verb}:${_norm(prefix + ep._path)}`, ep);
    }

    const routes  = routeRegistry ? routeRegistry.all() : [];
    const merged  = [];

    for (const route of routes) {
      if (_isFrameworkRoute(route.path)) continue;
      // If controller is set, only pick up routes handled by that controller
      if (this.controller && route.handler !== this.controller) continue;

      const key  = `${route.verb.toLowerCase()}:${_norm(route.path)}`;
      const decl = byKey.get(key);

      // Declared entry wins; otherwise create a bare auto-discovered one
      const ep = decl || new ApiEndpoint(route.verb.toLowerCase(), route.path);

      if (!ep._label) ep._label = _autoLabel(route.path, route.verb);

      // Auto-detect auth from registered middleware
      if (ep._auth === null) {
        ep._auth = (route.middleware || []).includes('auth');
      }

      ep._autoDiscovered = !decl;
      ep._routeName      = route.name || null;
      ep._resource       = this;
      merged.push(ep);
      byKey.delete(key);
    }

    // Any declared endpoint not matched to a live route → show as "pending"
    for (const ep of byKey.values()) {
      ep._unmatched = true;
      ep._resource  = this;
      merged.push(ep);
    }

    // Sort: alphabetical path, then verb order within the same path
    merged.sort((a, b) => {
      const pa = _norm(a._path), pb = _norm(b._path);
      if (pa !== pb) return pa.localeCompare(pb);
      return _verbOrder(a._verb) - _verbOrder(b._verb);
    });

    return merged;
  }

  static get slug() {
    return (this.label || this.controller?.name || 'api')
      .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }
}

// ── ApiEndpoint ────────────────────────────────────────────────────────────────

class ApiEndpoint {
  constructor(verb, path) {
    this._verb          = verb.toLowerCase();
    this._path          = path;
    this._label         = null;
    this._description   = null;
    this._auth          = null;        // null=auto-detect  true=required  false=public
    this._body          = {};          // { name: ApiField }
    this._params        = {};          // path params
    this._query         = {};          // query string params
    this._headers       = {};          // custom headers
    this._responses     = [];          // [{ status, description, example }]
    this._tags          = [];
    this._deprecated    = false;
    this._bodyEncoding  = 'json';      // 'json' | 'form' | 'multipart'
    this._autoDiscovered = false;
    this._unmatched     = false;
    this._routeName     = null;
    this._resource      = null;
  }

  // ── HTTP verb factories ────────────────────────────────────────────────────

  static get(p)    { return new ApiEndpoint('get',    p); }
  static post(p)   { return new ApiEndpoint('post',   p); }
  static put(p)    { return new ApiEndpoint('put',    p); }
  static patch(p)  { return new ApiEndpoint('patch',  p); }
  static delete(p) { return new ApiEndpoint('delete', p); }

  // ── Fluent modifiers ───────────────────────────────────────────────────────

  /** Human-readable label in sidebar and panel header */
  label(l)           { this._label = l;           return this; }

  /** Paragraph description shown in endpoint detail */
  description(d)     { this._description = d;     return this; }

  /**
   * Mark as requiring authentication.
   * The "Try it" panel injects the env Bearer token automatically.
   * Pass 'bearer' | 'api-key' | 'basic' to override the type.
   */
  auth(type = true)  { this._auth = type;         return this; }

  /** Explicitly mark as public — overrides auto-detection */
  public()           { this._auth = false;        return this; }

  /**
   * Declare request body fields.
   *
   *   .body({
   *     email:    ApiField.email().required().example('jane@example.com'),
   *     password: ApiField.password().required(),
   *   })
   */
  body(fields)       { this._body = fields;       return this; }

  /**
   * Declare a path parameter with description / example.
   *
   *   .param('id', ApiField.number().example(1).description('User ID'))
   */
  param(name, field) { this._params[name] = field; return this; }

  /**
   * Declare query string parameters.
   *
   *   .query({
   *     page:   ApiField.number().example(1),
   *     search: ApiField.text().example('alice'),
   *   })
   */
  query(fields)      { this._query = fields;      return this; }

  /** Declare custom request headers */
  headers(fields)    { this._headers = fields;    return this; }

  /**
   * Document a response.
   * Call multiple times for different status codes.
   *
   *   .response(200, { id: 1, name: 'Jane' })
   *   .response(422, { message: 'Validation failed', errors: {} })
   */
  response(status, example, description = null) {
    this._responses.push({ status, example, description });
    return this;
  }

  /** Tag for future filtering */
  tag(...tags)       { this._tags.push(...tags);  return this; }

  /** Show a deprecated badge */
  deprecated()       { this._deprecated = true;   return this; }

  /**
   * Set request body encoding.
   * 'json' (default) | 'form' | 'multipart' (file uploads)
   */
  encoding(type)     { this._bodyEncoding = type; return this; }

  toJSON() {
    // _resource is set by ApiResource._build() — use its prefix to build the
    // full path the client uses for "Try it" URLs and code snippets.
    const resourcePrefix = this._resource?.prefix || '';
    const fullPath       = resourcePrefix + this._path;

    return {
      verb:           this._verb,
      path:           fullPath,        // full path incl. prefix — used for Try it & URL bar
      shortPath:      this._path,      // short path without prefix — for matching & display
      label:          this._label || _autoLabel(this._path, this._verb),
      description:    this._description,
      auth:           this._auth,
      body:           _serFields(this._body),
      params:         _serFields(this._params),
      query:          _serFields(this._query),
      headers:        _serFields(this._headers),
      responses:      this._responses,
      tags:           this._tags,
      deprecated:     this._deprecated,
      bodyEncoding:   this._bodyEncoding,
      autoDiscovered: this._autoDiscovered,
      unmatched:      this._unmatched,
      routeName:      this._routeName,
      pathParams:     _extractPathParams(fullPath),
    };
  }
}

// ── ApiField ───────────────────────────────────────────────────────────────────

class ApiField {
  constructor(type) {
    this._type        = type;
    this._required    = false;
    this._nullable    = true;
    this._example     = undefined;
    this._description = null;
    this._default     = undefined;
    this._enum        = null;
    this._min         = null;
    this._max         = null;
    this._format      = null;
  }

  static text()     { return new ApiField('string');   }
  static email()    { return new ApiField('email');    }
  static password() { return new ApiField('password'); }
  static number()   { return new ApiField('number');   }
  static integer()  { return new ApiField('integer');  }
  static boolean()  { return new ApiField('boolean');  }
  static date()     { return new ApiField('date');     }
  static datetime() { return new ApiField('datetime'); }
  static url()      { return new ApiField('url');      }
  static phone()    { return new ApiField('phone');    }
  static uuid()     { return new ApiField('uuid');     }
  static json()     { return new ApiField('json');     }
  static file()     { return new ApiField('file');     }
  static array()    { return new ApiField('array');    }

  static select(opts) {
    const f = new ApiField('select');
    f._enum = (opts || []).map(o => typeof o === 'string' ? { value: o, label: o } : o);
    return f;
  }

  required()     { this._required = true; this._nullable = false; return this; }
  nullable()     { this._nullable = true; this._required = false; return this; }
  example(v)     { this._example = v;     return this; }
  description(d) { this._description = d; return this; }
  default(v)     { this._default = v;     return this; }
  min(n)         { this._min = n;         return this; }
  max(n)         { this._max = n;         return this; }
  format(f)      { this._format = f;      return this; }
  enum(vals)     { this._enum = vals;     return this; }

  toJSON() {
    return {
      type: this._type, required: this._required, nullable: this._nullable,
      example: this._example, description: this._description,
      default: this._default, enum: this._enum,
      min: this._min, max: this._max, format: this._format,
    };
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _norm(p) {
  return (p || '').replace(/\/+$/, '').toLowerCase();
}

function _isFrameworkRoute(p) {
  return /^\/(admin|docs)(\/|$)/.test(p || '');
}

function _verbOrder(v) {
  return { get: 0, post: 1, put: 2, patch: 3, delete: 4 }[v] ?? 5;
}

function _autoLabel(path, verb) {
  const parts = (path || '')
    .split('/')
    .filter(p => p && !p.startsWith(':') && !/^v\d+$/.test(p) && p !== 'api');
  const base = (parts[parts.length - 1] || 'Endpoint')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  const hasId = (path || '').includes(':');
  const v = (verb || '').toUpperCase();
  if (v === 'GET'   && hasId)  return `Get ${base}`;
  if (v === 'GET')             return `List ${base}`;
  if (v === 'POST')            return `Create ${base}`;
  if (v === 'PUT'  || v === 'PATCH') return `Update ${base}`;
  if (v === 'DELETE')          return `Delete ${base}`;
  return base;
}

function _extractPathParams(path) {
  return ((path || '').match(/:([a-zA-Z_][a-zA-Z0-9_]*)/g) || []).map(m => m.slice(1));
}

function _serFields(fields) {
  if (!fields || typeof fields !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = (v && typeof v.toJSON === 'function') ? v.toJSON() : v;
  }
  return out;
}

module.exports = { ApiResource, ApiEndpoint, ApiField };