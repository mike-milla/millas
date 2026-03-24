'use strict';

const path    = require('path');
const express = require('express');
const { ApiResource } = require('./resources/ApiResource');

/**
 * Docs
 *
 * The singleton that owns all ApiResources, configuration,
 * and the Express mount logic.
 *
 * Lifecycle (mirrors Admin):
 *   1. DocsServiceProvider.boot() calls Docs.configure({ prefix, title, ... })
 *   2. Developer calls Docs.register() / Docs.registerMany() in
 *      AppServiceProvider.boot() or bootstrap/docs.js
 *   3. AppInitializer._serve() calls Docs.mount(expressApp) after routes are mounted
 *
 * Usage in AppServiceProvider.boot():
 *
 *   const { Docs } = require('millas/src/docs');
 *   Docs.registerMany([ UserApiResource, PropertyApiResource ]);
 */
class Docs {
  constructor() {
    this._resources = new Map();   // slug → ApiResource class
    this._config    = {
      prefix:   '/docs',
      title:    'API Docs',
      enabled:  true,
      auth:     false,   // require admin session to view docs
    };
    this._routeRegistry = null;    // injected by DocsServiceProvider
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  configure(config = {}) {
    Object.assign(this._config, config);
    return this;
  }

  setRouteRegistry(registry) {
    this._routeRegistry = registry;
    return this;
  }

  // ── Resource registration ──────────────────────────────────────────────────

  register(ResourceClass) {
    // Accept raw ApiResource subclass or auto-wrap anything with a controller property
    if (!(ResourceClass.prototype instanceof ApiResource) &&
        ResourceClass !== ApiResource) {
      // Developer passed something that isn't an ApiResource — ignore
      process.stderr.write(`[Docs] Skipping non-ApiResource: ${ResourceClass?.name}\n`);
      return this;
    }
    this._resources.set(ResourceClass.slug, ResourceClass);
    return this;
  }

  registerMany(list = []) {
    list.forEach(r => this.register(r));
    return this;
  }

  resources() {
    return [...this._resources.values()];
  }

  // ── Mount ──────────────────────────────────────────────────────────────────

  /**
   * Mount the docs panel onto an Express app.
   * Called automatically by AppInitializer when .withDocs() was used.
   */
  mount(expressApp) {
    if (!this._config.enabled) return this;

    const prefix = this._config.prefix;

    // Static assets
    const staticPath = path.join(__dirname, 'static');
    expressApp.use(
      prefix + '/static',
      express.static(staticPath, { maxAge: '1h' })
    );

    const PageHandler = require('./handlers/PageHandler');
    const ApiHandler  = require('./handlers/ApiHandler');

    const page = new PageHandler(this);
    const api  = new ApiHandler(this);

    // ── UI routes ─────────────────────────────────────────────────────────
    expressApp.get(prefix,          (q, s) => page.index(q, s));
    expressApp.get(prefix + '/',    (q, s) => page.index(q, s));

    // ── Internal API routes (used by the "Try it" panel) ──────────────────
    // Returns the full docs manifest as JSON — all groups, endpoints, schemas
    expressApp.get(`${prefix}/_api/manifest`,           (q, s) => api.manifest(q, s));
    // Proxy a real request so the browser never has CORS issues
    expressApp.post(`${prefix}/_api/try`,               (q, s) => api.tryRequest(q, s));
    // Export: Postman collection
    expressApp.get(`${prefix}/_api/export/postman`,     (q, s) => api.exportPostman(q, s));
    // Export: OpenAPI 3.0
    expressApp.get(`${prefix}/_api/export/openapi`,     (q, s) => api.exportOpenApi(q, s));

    return this;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Build the full manifest: all groups with their endpoints.
   * Merges declared ApiResources with auto-discovered routes.
   */
  buildManifest() {
    const registry = this._routeRegistry;
    const { inferFields } = require('./SchemaInferrer');
    const { ApiEndpoint } = require('./resources/ApiResource');

    // ── Phase 1: Build groups from route-level shapes ─────────────────────
    // Routes with .shape() / .fromShape() are the primary source of truth.
    // Grouped by shape.group, then shape.label within each group.
    const shapeGroups = new Map();   // groupName → [endpoint, ...]
    const claimedPaths = new Set();

    if (registry) {
      for (const route of registry.all()) {
        if (_isFrameworkRoute(route.path)) continue;
        if (!route.shape) continue;

        const shape  = route.shape;
        const verb   = route.verb.toLowerCase();
        const group  = shape.group || 'General';
        const isAuth = (route.middleware || []).includes('auth');

        // Infer body + query fields from the shape validators
        const bodyFields  = inferFields(shape.in    || {});
        const queryFields = inferFields(shape.query || {});

        // Build out responses
        const responses = Object.entries(shape.out || {}).map(([status, example]) => ({
          status:  Number(status),
          example: example || null,
          description: null,
        }));

        const endpointJson = {
          verb:           verb,
          path:           route.path,
          shortPath:      route.path,
          label:          shape.label  || _autoLabel(route.path, verb),
          description:    shape.description || null,
          auth:           isAuth,
          body:           bodyFields,
          query:          queryFields,
          params:         {},
          headers:        {},
          responses,
          tags:           [],
          deprecated:     false,
          bodyEncoding:   shape.encoding || 'json',
          autoDiscovered: false,
          unmatched:      false,
          routeName:      route.name || null,
          pathParams:     _extractPathParams(route.path),
        };

        if (!shapeGroups.has(group)) shapeGroups.set(group, []);
        shapeGroups.get(group).push(endpointJson);
        claimedPaths.add(`${verb}:${route.path}`);
      }
    }

    const groups = [];

    // Convert shapeGroups map → groups array (sorted alphabetically)
    for (const [groupName, endpoints] of [...shapeGroups.entries()].sort()) {
      groups.push({
        slug:        groupName.toLowerCase().replace(/\s+/g, '-'),
        label:       groupName,
        group:       groupName,
        icon:        'code-slash',
        description: null,
        endpoints:   endpoints.sort((a, b) => a.path.localeCompare(b.path)),
      });
    }

    // ── Phase 2: ApiResource declarations (override / enrich) ────────────
    for (const R of this._resources.values()) {
      const endpoints = R._build(registry).map(ep => {
        const j = ep.toJSON();
        claimedPaths.add(`${j.verb}:${j.path}`);
        return j;
      });

      groups.push({
        slug:        R.slug,
        label:       R.label || R.controller?.name || R.slug,
        group:       R.group,
        icon:        R.icon,
        description: R.description,
        endpoints,
      });
    }

    // ── Phase 3: Auto-discovered routes (no shape, no ApiResource) ────────
    const undocumented = [];
    if (registry) {
      for (const route of registry.all()) {
        if (_isFrameworkRoute(route.path)) continue;
        const key = `${route.verb.toLowerCase()}:${route.path}`;
        if (claimedPaths.has(key)) continue;

        const ep = new ApiEndpoint(route.verb.toLowerCase(), route.path);
        ep._auth           = (route.middleware || []).includes('auth');
        ep._autoDiscovered = true;
        ep._routeName      = route.name || null;
        undocumented.push(ep.toJSON());
      }
    }

    if (undocumented.length) {
      groups.push({
        slug:        '_undocumented',
        label:       'Undocumented',
        group:       null,
        icon:        'question-circle',
        description: 'Routes with no .shape() declaration. Add .shape() to document them.',
        endpoints:   undocumented,
      });
    }

    return {
      title:  this._config.title,
      prefix: this._config.prefix,
      groups,
    };
  }
}

function _isFrameworkRoute(p) {
  return /^\/(admin|docs)(\/|$)/.test(p || '');
}

function _autoLabel(path, verb) {
  const parts = (path || '')
    .split('/').filter(p => p && !p.startsWith(':') && !/^v\d+$/.test(p) && p !== 'api');
  const base = (parts[parts.length - 1] || 'Endpoint')
    .replace(/-/g, ' ').replace(/\w/g, c => c.toUpperCase());
  const hasId = (path || '').includes(':');
  const v     = (verb || '').toUpperCase();
  if (v === 'GET'   && hasId)         return 'Get '    + base;
  if (v === 'GET')                    return 'List '   + base;
  if (v === 'POST')                   return 'Create ' + base;
  if (v === 'PUT'  || v === 'PATCH')  return 'Update ' + base;
  if (v === 'DELETE')                 return 'Delete ' + base;
  return base;
}

function _extractPathParams(path) {
  return ((path || '').match(/:([a-zA-Z_][a-zA-Z0-9_]*)/g) || []).map(function(m) { return m.slice(1); });
}

// Singleton export — mirrors Admin
module.exports = new Docs();