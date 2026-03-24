'use strict';

/**
 * Shape — route input/output contract
 *
 * A shape defines what a route accepts and what it returns.
 * It serves two purposes simultaneously — zero duplication:
 *
 *   1. Runtime validation middleware
 *      When a route has .shape() or .fromShape(), the framework validates
 *      incoming data BEFORE the handler runs. Bad requests are rejected
 *      with 422 automatically — the handler only runs with clean data.
 *
 *   2. API docs generation
 *      The docs panel reads the shape to render the body schema, query
 *      params, expected responses, and "Try it" form — no separate
 *      ApiResource declaration needed.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const { shape }  = require('millas/core/http');
 *   const { string, number, email, boolean, array } = require('millas/core/validation');
 *
 *   // Inline on a route:
 *   Route.post('/properties', PropertyController, 'store')
 *     .shape({
 *       label: 'Create property',
 *       group: 'Properties & Units',
 *       in: {
 *         name: string().required().max(200).example('Sunset Apartments'),
 *         city: string().required().example('Nairobi'),
 *         type: string().required().oneOf(['apartment','house','commercial']),
 *       },
 *       out: {
 *         201: { id: 1, name: 'Sunset Apartments' },
 *         422: { message: 'Validation failed', errors: {} },
 *       },
 *     });
 *
 *   // From a shared shape file:
 *   Route.post('/properties', PropertyController, 'store')
 *     .fromShape(CreatePropertyShape);
 *
 * ── Shape file convention ─────────────────────────────────────────────────────
 *
 *   Scaffold with:  millas make:shape PropertyShape
 *   Outputs to:     app/shapes/PropertyShape.js
 *
 *   const { shape }  = require('millas/core/http');
 *   const { string, number, array } = require('millas/core/validation');
 *
 *   const CreatePropertyShape = shape({
 *     label: 'Create property',
 *     group: 'Properties & Units',
 *     in: {
 *       name: string().required().max(200).example('Sunset Apartments'),
 *       city: string().required().example('Nairobi'),
 *     },
 *     out: { 201: { id: 1 } },
 *   });
 *
 *   const UpdatePropertyShape = shape({
 *     label: 'Update property',
 *     group: 'Properties & Units',
 *     in: {
 *       name: string().optional().max(200),
 *       city: string().optional(),
 *     },
 *     out: { 200: { id: 1 } },
 *   });
 *
 *   module.exports = { CreatePropertyShape, UpdatePropertyShape };
 *
 * ── Handler access ────────────────────────────────────────────────────────────
 *
 *   The handler receives clean, coerced data via the normal context keys:
 *
 *     async store({ body, user }) {
 *       // body is already validated and coerced — guaranteed clean
 *       return this.created(await Property.create(body));
 *     }
 *
 *   If validation fails the handler never runs — 422 is returned immediately.
 */

'use strict';

const { BaseValidator } = require('../validation/BaseValidator');

const SHAPE_BRAND = Symbol('MillasShape');

/**
 * shape(def) — create a sealed, validated shape definition.
 *
 * Validates the definition at module load time so mistakes surface
 * immediately, not at request time.
 *
 * @param {object} def
 * @returns {ShapeDefinition}
 */
function shape(def) {
  if (!def || typeof def !== 'object') {
    throw new Error('[shape] shape() requires a definition object.');
  }

  // Dev-time validation of the "in" schema
  if (def.in) {
    if (typeof def.in !== 'object' || Array.isArray(def.in)) {
      throw new Error('[shape] "in" must be a plain object of field validators.');
    }
    for (const [field, v] of Object.entries(def.in)) {
      if (!(v instanceof BaseValidator)) {
        throw new Error(
          `[shape] Field "${field}" in "in" must be a validator instance.\n` +
          `  Use: string(), number(), email(), boolean(), array(), date(), file()\n` +
          `  from millas/core/validation.\n` +
          `  Got: ${typeof v}`
        );
      }
    }
  }

  // Dev-time validation of the "query" schema
  if (def.query) {
    for (const [field, v] of Object.entries(def.query)) {
      if (!(v instanceof BaseValidator)) {
        throw new Error(
          `[shape] Field "${field}" in "query" must be a validator instance. Got: ${typeof v}`
        );
      }
    }
  }

  // Dev-time validation of "out"
  if (def.out) {
    for (const [status] of Object.entries(def.out)) {
      if (isNaN(Number(status))) {
        throw new Error(
          `[shape] Keys in "out" must be HTTP status codes (numbers). Got: "${status}"`
        );
      }
    }
  }

  const built = {
    [SHAPE_BRAND]: true,
    label:       def.label       || null,
    group:       def.group       || null,
    icon:        def.icon        || null,
    description: def.description || null,
    encoding:    def.encoding    || 'json',     // 'json' | 'form' | 'multipart'
    in:          Object.freeze(def.in    || {}),
    query:       Object.freeze(def.query || {}),
    out:         Object.freeze(def.out   || {}),
  };

  return Object.freeze(built);
}

/**
 * Returns true if the value is a shape definition built by shape().
 * @param {*} val
 */
function isShape(val) {
  return val && typeof val === 'object' && val[SHAPE_BRAND] === true;
}

module.exports = { shape, isShape, SHAPE_BRAND };