'use strict';

const ServiceProvider = require('../providers/ServiceProvider');
const Docs            = require('./Docs');
const { ApiResource, ApiEndpoint, ApiField } = require('./resources/ApiResource');

/**
 * DocsServiceProvider
 *
 * Boots the docs panel and wires it to the live RouteRegistry.
 *
 * ── Usage (bootstrap/app.js) ─────────────────────────────────────────────────
 *
 *   module.exports = Millas.config()
 *     .providers([AppServiceProvider])
 *     .withDocs()
 *     .create();
 *
 * ── Optional config/docs.js ──────────────────────────────────────────────────
 *
 *   module.exports = {
 *     prefix:  '/docs',
 *     title:   'My App API',
 *     enabled: process.env.NODE_ENV !== 'production',
 *     auth:    false,   // set true to require admin login
 *   };
 *
 * ── Registering ApiResources ─────────────────────────────────────────────────
 *
 *   // In AppServiceProvider.boot():
 *   const { Docs } = require('millas/src/docs');
 *   Docs.registerMany([ UserApiResource, PropertyApiResource ]);
 *
 *   // Or in a dedicated bootstrap/docs.js:
 *   const { Docs } = require('millas/src/docs');
 *   require('../app/docs')(Docs);   // passes Docs to a registration file
 */
class DocsServiceProvider extends ServiceProvider {
  register(container) {
    container.instance('Docs',        Docs);
    container.instance('ApiResource', ApiResource);
    container.instance('ApiEndpoint', ApiEndpoint);
    container.instance('ApiField',    ApiField);
  }

  async boot(container) {
    const basePath = container.make('basePath') || process.cwd();

    // Load optional config/docs.js
    let docsConfig = {};
    try { docsConfig = require(basePath + '/config/docs'); } catch { /* optional */ }

    // Resolve the admin prefix so PageHandler can point BI CSS at the
    // admin's local vendor directory instead of an external CDN.
    let adminPrefix = '/admin';
    try {
      const adminConfig = require(basePath + '/config/admin');
      if (adminConfig.prefix) adminPrefix = adminConfig.prefix;
    } catch { /* no config/admin.js — use default */ }

    Docs.configure({
      prefix:      docsConfig.prefix  || '/docs',
      title:       docsConfig.title   || process.env.APP_NAME || 'API Docs',
      enabled:     docsConfig.enabled !== undefined ? docsConfig.enabled : (process.env.NODE_ENV !== 'production'),
      auth:        docsConfig.auth    || false,
      adminPrefix,
      ...docsConfig,
    });

    // Wire the live RouteRegistry so Docs can auto-discover routes at mount time
    try {
      const app = container.make('app');
      if (app && app.route && typeof app.route.getRegistry === 'function') {
        Docs.setRouteRegistry(app.route.getRegistry());
      }
    } catch { /* app not yet fully wired — will be set during mount */ }
  }
}

module.exports = DocsServiceProvider;