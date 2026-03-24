'use strict';

/**
 * Serializer
 *
 * Controls the exact shape of API output — what fields go out, what's
 * nested, and what's hidden. Sits between your model and your JSON response.
 *
 * ── Why use a Serializer instead of jsonify(model) ───────────────────────────
 *
 *   jsonify(user)            — dumps every column, relies on model.hidden
 *   UserSerializer.one(user) — precise whitelist, nested relations, custom fields
 *
 * ── Defining a Serializer ────────────────────────────────────────────────────
 *
 *   const { Serializer } = require('millas/src/serializer/Serializer');
 *
 *   class UserSerializer extends Serializer {
 *     // Whitelist of fields to include. If omitted, all fields are included
 *     // (minus model.hidden and any fields listed in static hidden below).
 *     static fields = ['id', 'name', 'email', 'role', 'created_at'];
 *
 *     // Extra fields to exclude on top of model.hidden.
 *     // Only needed when static fields is not set.
 *     static hidden = ['internal_notes', 'stripe_customer_id'];
 *
 *     // Nested serializers — keyed by the relation name on the model.
 *     // The relation must be eager-loaded (.with('roles')) before serializing.
 *     // If the relation is not loaded, the key is silently omitted.
 *     static nested = {
 *       roles:   RoleSerializer,
 *       profile: ProfileSerializer,
 *     };
 *
 *     // Computed fields — functions that receive the model instance and
 *     // return an additional value not stored on the model.
 *     static computed = {
 *       full_name: (user) => `${user.first_name} ${user.last_name}`,
 *       is_admin:  (user) => user.role === 'admin',
 *     };
 *   }
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   // Single record
 *   const user = await User.with('roles', 'profile').find(id);
 *   return jsonify(UserSerializer.one(user));
 *
 *   // Collection
 *   const users = await User.with('roles').all();
 *   return jsonify(UserSerializer.many(users));
 *
 *   // Paginated
 *   const result = await User.with('roles').paginate(page, perPage);
 *   return jsonify(UserSerializer.paginate(result));
 *
 *   // With request context (for conditional fields)
 *   return jsonify(UserSerializer.one(user, { req }));
 *
 * ── Nested relations ──────────────────────────────────────────────────────────
 *
 *   The relation must be eager-loaded first. If not loaded, it is skipped.
 *
 *   // WRONG — roles not loaded, will be silently omitted
 *   const user = await User.find(id);
 *   UserSerializer.one(user);
 *
 *   // CORRECT — roles eager-loaded, will be serialized through RoleSerializer
 *   const user = await User.with('roles').find(id);
 *   UserSerializer.one(user);
 *
 * ── Conditional fields ────────────────────────────────────────────────────────
 *
 *   Override the instance method serialize(instance, ctx) for per-request logic:
 *
 *   class UserSerializer extends Serializer {
 *     static fields = ['id', 'name', 'email'];
 *
 *     serialize(instance, ctx = {}) {
 *       const data = super.serialize(instance, ctx);
 *       if (ctx.req?.user?.is_admin) {
 *         data.internal_notes = instance.internal_notes;
 *       }
 *       return data;
 *     }
 *   }
 */
class Serializer {
  /**
   * Whitelist of field names to include.
   * When set, ONLY these fields appear in output (plus computed + nested).
   * When null/undefined, all fields are included minus hidden ones.
   *
   * @type {string[]|null}
   */
  static fields = null;

  /**
   * Extra fields to exclude, on top of the model's static hidden list.
   * Only relevant when static fields is not set.
   *
   * @type {string[]}
   */
  static hidden = [];

  /**
   * Nested serializers, keyed by relation name.
   * The relation must be eager-loaded before calling serialize().
   * If the value on the instance is a function (lazy-loaded), it is skipped.
   *
   * @type {Object.<string, typeof Serializer>}
   */
  static nested = {};

  /**
   * Computed fields — functions that receive the model instance and
   * optional context, returning a value to include in output.
   *
   * @type {Object.<string, function(instance, ctx): *>}
   */
  static computed = {};

  // ── Core serialization ─────────────────────────────────────────────────────

  /**
   * Serialize a single model instance.
   * Override this instance method for per-request conditional logic.
   *
   * @param {object} instance  — model instance or plain object
   * @param {object} [ctx]     — optional context (e.g. { req })
   * @returns {object}
   */
  serialize(instance, ctx = {}) {
    if (!instance) return null;

    const ctor   = this.constructor;
    const raw    = typeof instance.toJSON === 'function' ? instance.toJSON() : { ...instance };
    const result = {};

    // ── Field whitelist or full set ─────────────────────────────────────────
    if (ctor.fields && ctor.fields.length) {
      // Whitelist mode — only declared fields
      for (const key of ctor.fields) {
        if (key in raw) {
          result[key] = raw[key];
        }
      }
    } else {
      // All-fields mode — exclude serializer.hidden on top of model.hidden
      // (model.hidden is already applied by toJSON())
      const hiddenSet = new Set(ctor.hidden || []);
      for (const [key, value] of Object.entries(raw)) {
        if (!hiddenSet.has(key)) {
          result[key] = value;
        }
      }
    }

    // ── Computed fields ─────────────────────────────────────────────────────
    for (const [key, fn] of Object.entries(ctor.computed || {})) {
      result[key] = fn(instance, ctx);
    }

    // ── Nested serializers ──────────────────────────────────────────────────
    for (const [key, NestedSerializer] of Object.entries(ctor.nested || {})) {
      const value = instance[key];

      // Skip if not loaded (still a function = lazy-load accessor)
      if (typeof value === 'function') continue;
      // Skip if not present
      if (value === undefined) continue;

      const nested = new NestedSerializer();

      if (value === null) {
        result[key] = null;
      } else if (Array.isArray(value)) {
        result[key] = value.map(item => nested.serialize(item, ctx));
      } else {
        result[key] = nested.serialize(value, ctx);
      }
    }

    return result;
  }

  // ── Static convenience methods ─────────────────────────────────────────────

  /**
   * Serialize a single model instance.
   *
   *   UserSerializer.one(user)
   *   UserSerializer.one(user, { req })
   *
   * @param {object} instance
   * @param {object} [ctx]
   * @returns {object|null}
   */
  static one(instance, ctx = {}) {
    if (!instance) return null;
    return new this().serialize(instance, ctx);
  }

  /**
   * Serialize an array of model instances.
   *
   *   UserSerializer.many(users)
   *   UserSerializer.many(users, { req })
   *
   * @param {object[]} instances
   * @param {object}   [ctx]
   * @returns {object[]}
   */
  static many(instances, ctx = {}) {
    if (!instances || !instances.length) return [];
    const s = new this();
    return instances.map(i => s.serialize(i, ctx));
  }

  /**
   * Serialize a paginated result from Model.paginate() or QueryBuilder.paginate().
   * Preserves the pagination meta and wraps data through the serializer.
   *
   *   const result = await User.with('roles').paginate(page, perPage);
   *   return jsonify(UserSerializer.paginate(result));
   *
   * @param {{ data: object[], meta: object }} result
   * @param {object} [ctx]
   * @returns {{ data: object[], meta: object }}
   */
  static paginate(result, ctx = {}) {
    return {
      data: this.many(result.data || [], ctx),
      meta: result.meta || {},
    };
  }
}

module.exports = { Serializer };