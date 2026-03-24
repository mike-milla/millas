'use strict';

const { isShape } = require('../http/Shape');

/**
 * RouteEntry
 *
 * A thin wrapper returned by Route.get/post/put/patch/delete/resource.
 * Exposes .shape() and .fromShape() for attaching a shape definition,
 * then writes it back to the registry entry.
 *
 * The Route instance itself is passed in so group-level chaining still
 * works — .shape() returns the RouteEntry, but the Route is unaffected.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   Route.post('/properties', PropertyController, 'store')
 *     .shape({ label: 'Create property', in: { name: string().required() }, out: {} });
 *
 *   Route.post('/properties', PropertyController, 'store')
 *     .fromShape(CreatePropertyShape);
 */
class RouteEntry {
  /**
   * @param {object} entry   — the raw entry object stored in RouteRegistry
   * @param {Route}  router  — the Route instance (for method chaining back)
   */
  constructor(entry, router) {
    this._entry  = entry;
    this._router = router;
  }

  /**
   * Attach an inline shape definition to this route.
   *
   *   Route.post('/users', UserController, 'store')
   *     .shape({
   *       label: 'Create user',
   *       group: 'Users',
   *       in:  { email: email().required() },
   *       out: { 201: { id: 1 } },
   *     });
   *
   * The "in" schema runs as validation middleware before the handler.
   * If validation fails, 422 is returned immediately.
   * The handler receives clean, coerced data via { body }.
   *
   * @param {object} def — plain shape definition OR a shape() result
   * @returns {RouteEntry}
   */
  shape(def) {
    // Accept both raw objects and shape() factory results
    // If raw object, wrap through shape() for validation + freezing
    if (!isShape(def)) {
      const { shape: makeShape } = require('../http/Shape');
      def = makeShape(def);
    }
    this._entry.shape = def;
    return this;
  }

  /**
   * Attach a pre-built shape from a shapes file.
   * Identical to .shape() — exists for readability and convention.
   *
   *   const { CreatePropertyShape } = require('../app/shapes/PropertyShape');
   *   Route.post('/properties', PropertyController, 'store')
   *     .fromShape(CreatePropertyShape);
   *
   * @param {object} shapeDefinition — result of shape() factory
   * @returns {RouteEntry}
   */
  fromShape(shapeDefinition) {
    return this.shape(shapeDefinition);
  }

  /**
   * Add extra middleware to this specific route after registration.
   * Middleware aliases are appended to the existing list.
   *
   * @param {string|string[]} middleware
   * @returns {RouteEntry}
   */
  middleware(mw) {
    const list = Array.isArray(mw) ? mw : [mw];
    this._entry.middleware = [...(this._entry.middleware || []), ...list];
    return this;
  }
}

module.exports = RouteEntry;