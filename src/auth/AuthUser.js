'use strict';

const Model  = require('../orm/model/Model');
const fields = require('../orm/fields/index').fields;

/**
 * AuthUser
 *
 * Base model for authentication. Ships with Millas.
 * Covers the exact contract that Auth, AuthMiddleware, and AuthController expect.
 *
 * ── Fields ───────────────────────────────────────────────────────────────────
 *
 *   Core:
 *     email       — unique login identifier
 *     password    — bcrypt hash (set by Auth.register / Auth.hashPassword)
 *     name        — display name
 *     role        — API-level role enum, read by RoleMiddleware ('admin'|'user')
 *
 *   Django-style admin flags:
 *     is_active     — false blocks login entirely (like Django's is_active)
 *     is_staff      — true allows entry to the admin panel (like Django's is_staff)
 *     is_superuser  — true bypasses all admin permission checks (like Django's is_superuser)
 *     last_login    — updated by Auth.login() on each successful login
 *
 * ── Extending ────────────────────────────────────────────────────────────────
 *
 *   Because AuthUser is marked 'static abstract = true', its fields are
 *   automatically merged into any subclass — no spread needed.
 *
 *   class User extends AuthUser {
 *     static table = 'users';
 *     static fields = {
 *       // just declare what's new or overridden
 *       phone:      fields.string({ nullable: true }),
 *       avatar_url: fields.string({ nullable: true }),
 *       role:       fields.enum(['tenant', 'landlord'], { default: 'tenant' }),
 *     };
 *     // User.fields → id, name, email, password, is_active, is_staff,
 *     //               is_superuser, last_login, created_at, updated_at,
 *     //               phone, avatar_url, role  (merged automatically)
 *   }
 *
 * ── Customising the token payload ─────────────────────────────────────────
 *
 *   class User extends AuthUser {
 *     tokenPayload() {
 *       return { ...super.tokenPayload(), plan: this.plan };
 *     }
 *   }
 */
class AuthUser extends Model {
  // Abstract — no table. The app's User model owns the table.
  // Equivalent to Django's AbstractUser with class Meta: abstract = True.
  static abstract = true;

  static fields = {
    id:           fields.id(),
    name:         fields.string({ max: 100, nullable: true }),
    email:        fields.string({ unique: true }),
    password:     fields.string(),
    role:         fields.enum(['admin', 'user'], { default: 'user' }),

    // ── Django-style admin access flags ──────────────────────────────────
    is_active:    fields.boolean({ default: true }),
    is_staff:     fields.boolean({ default: false }),
    is_superuser: fields.boolean({ default: false }),

    last_login:   fields.timestamp(),
    created_at:   fields.timestamp(),
    updated_at:   fields.timestamp(),
  };

  // ── Auth contract helpers ──────────────────────────────────────────────────

  /**
   * Fields included in the JWT payload.
   * Override to add custom claims.
   */
  tokenPayload() {
    return {
      id:           this.id,
      sub:          this.id,
      email:        this.email,
      role:         this.role         || null,
      is_staff:     this.is_staff     ?? false,
      is_superuser: this.is_superuser ?? false,
    };
  }

  /**
   * Safe public representation — strips password and internal flags.
   * Used by AuthController._safeUser() and API responses.
   */
  toSafeObject() {
    const data = { ...this };
    delete data.password;
    delete data.remember_token;
    return data;
  }

  /**
   * Returns true if this user can access the admin panel.
   * Mirrors Django's User.has_module_perms / is_staff check.
   */
  get canAccessAdmin() {
    return !!(this.is_active && this.is_staff);
  }

  /**
   * Returns true if this user bypasses all permission checks.
   * Mirrors Django's User.is_superuser.
   */
  get isSuperuser() {
    return !!(this.is_active && this.is_superuser);
  }
}

module.exports = AuthUser;