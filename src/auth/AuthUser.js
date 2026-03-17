'use strict';

const Model  = require('../orm/model/Model');
const fields = require('../orm/fields/index').fields;

/**
 * AuthUser
 *
 * Base model for authentication. Ships with Millas.
 * Covers the exact contract that Auth, AuthMiddleware, and AuthController expect:
 *   - email       (unique, required for login)
 *   - password    (hashed by Auth.register / Auth.hashPassword)
 *   - role        (read by RoleMiddleware)
 *
 * ── Extending ────────────────────────────────────────────────────────────────
 *
 * Extend this instead of writing a User model from scratch.
 * Add your own fields on top — all Auth behaviour is inherited.
 *
 *   class User extends AuthUser {
 *     static table = 'users';
 *     static fields = {
 *       ...AuthUser.fields,
 *       phone:      fields.string({ nullable: true }),
 *       avatar_url: fields.string({ nullable: true }),
 *       bio:        fields.text({ nullable: true }),
 *     };
 *   }
 *
 * ── Customising the token payload ─────────────────────────────────────────
 *
 * Override tokenPayload() to add custom claims to the JWT:
 *
 *   class User extends AuthUser {
 *     tokenPayload() {
 *       return {
 *         ...super.tokenPayload(),
 *         plan:  this.plan,
 *         orgId: this.org_id,
 *       };
 *     }
 *   }
 *
 * ── Customising register / login hooks ────────────────────────────────────
 *
 * Override static hooks to run logic around auth operations:
 *
 *   class User extends AuthUser {
 *     static async afterCreate(instance) {
 *       await emit('user.registered', { user: instance });
 *     }
 *   }
 */
class AuthUser extends Model {
  static table = 'users';

  static fields = {
    id:         fields.id(),
    name:       fields.string({ max: 100 }),
    email:      fields.string({ unique: true }),
    password:   fields.string(),
    role:       fields.enum(['admin', 'user'], { default: 'user' }),
    created_at: fields.timestamp(),
    updated_at: fields.timestamp(),
  };

  // ── Auth contract helpers ──────────────────────────────────────────────────

  /**
   * The fields to include in the JWT payload.
   * Override to add custom claims.
   *
   * @returns {object}
   */
  tokenPayload() {
    return {
      id:    this.id,
      sub:   this.id,
      email: this.email,
      role:  this.role || null,
    };
  }

  /**
   * Safe representation — strips sensitive fields.
   * Used by AuthController._safeUser().
   *
   * @returns {object}
   */
  toSafeObject() {
    const data = { ...this };
    delete data.password;
    delete data.remember_token;
    return data;
  }
}

module.exports = AuthUser;