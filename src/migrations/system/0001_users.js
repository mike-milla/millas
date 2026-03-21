'use strict';

/**
 * System migration: 0001_users
 *
 * Previously created the users table directly.
 *
 * As of Millas 0.3+, the users table is owned by the APP — not the framework.
 * AuthUser is now fully abstract (no table). The app defines its own User model
 * that extends AuthUser and owns whatever table it wants (typically 'users').
 *
 * This migration is kept as a no-op so existing projects that depend on
 * ['system', '0001_users'] don't break. It creates nothing.
 *
 * Equivalent to Django's pattern: AbstractUser has no table; your custom
 * User model creates its own table via app migrations.
 */
module.exports = {
  dependencies: [],
  operations:   [],
};