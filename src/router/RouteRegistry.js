'use strict';

/**
 * RouteRegistry
 *
 * Central store for all registered routes.
 * Used by the Router to bind to Express, and by `millas route:list`.
 */
class RouteRegistry {
  constructor() {
    this._routes = [];
    this._namedRoutes = {};
  }

  register(entry) {
    this._routes.push(entry);

    if (entry.name) {
      this._namedRoutes[entry.name] = entry;
    }
  }

  all() {
    return [...this._routes];
  }

  findByName(name) {
    return this._namedRoutes[name] || null;
  }

  findByPath(verb, path) {
    return this._routes.find(
      r => r.verb === verb.toUpperCase() && r.path === path
    ) || null;
  }

  /**
   * Return a formatted table for `millas route:list`
   */
  toTable() {
    return this._routes.map(r => ({
      Method:     r.verb.padEnd(7),
      Path:       r.path,
      Handler:    r.handler
        ? (typeof r.handler === 'function'
            ? r.handler.name || '<closure>'
            : (r.handler.name || r.handler.toString()) + (r.method ? `@${r.method}` : ''))
        : '<none>',
      Middleware: (r.middleware || []).join(', ') || '—',
      Name:       r.name || '—',
    }));
  }
}

module.exports = RouteRegistry;
