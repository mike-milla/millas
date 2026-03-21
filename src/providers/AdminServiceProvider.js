'use strict';

const ServiceProvider = require('./ServiceProvider');
const Admin           = require('../admin/Admin');
const AdminAuth       = require('../admin/AdminAuth');

/**
 * AdminServiceProvider
 *
 * Boots the admin panel and wires it to the app's User model.
 *
 * ── Authentication flow ───────────────────────────────────────────────────
 *
 *  AdminAuth resolves the User model in this priority order:
 *    1. Explicit model in config/admin.js  auth.model
 *    2. The same model AuthServiceProvider resolved (app/models/User)
 *    3. Built-in AuthUser (framework fallback)
 *
 *  It then enforces:
 *    - user.is_active === true   (account not disabled)
 *    - user.is_staff  === true   (has admin panel access)
 *
 *  Run `millas createsuperuser` to create your first admin user.
 *  Run `millas migrate` first if you haven't — the users table must exist.
 *
 * ── Usage (bootstrap/app.js) ─────────────────────────────────────────────
 *
 *   module.exports = Millas.config()
 *     .providers([AppServiceProvider])
 *     .withAdmin()
 *     .create();
 *
 * ── Optional config/admin.js ─────────────────────────────────────────────
 *
 *   module.exports = {
 *     prefix: '/admin',
 *     title:  'My App Admin',
 *     auth: {
 *       cookieMaxAge:   60 * 60 * 8,
 *       rememberAge:    60 * 60 * 24 * 30,
 *       maxAttempts:    5,
 *       lockoutMinutes: 15,
 *       // model: require('../app/models/AdminUser'),  // explicit override
 *     },
 *     // auth: false   — disable auth entirely (not recommended)
 *   };
 */
class AdminServiceProvider extends ServiceProvider {
  register(container) {
    container.instance('Admin',         Admin);
    container.instance('AdminAuth',     AdminAuth);
    container.instance('AdminResource', require('../admin/resources/AdminResource').AdminResource);
    container.instance('AdminField',    require('../admin/resources/AdminResource').AdminField);
    container.instance('AdminFilter',   require('../admin/resources/AdminResource').AdminFilter);
  }

  async boot(container) {
    const basePath = container.make('basePath') || process.cwd();
    let adminConfig = {};
    try {
      adminConfig = require(basePath + '/config/admin');
    } catch { /* optional */ }

    // auth: {} means "use the User model with is_staff gate" — the Django default.
    // auth: false disables auth entirely.
    // Anything else is passed through as-is (model override, cookie settings, etc.)
    const authConfig = adminConfig.auth !== undefined ? adminConfig.auth : {};

    Admin.configure({
      prefix: adminConfig.prefix || '/admin',
      title:  adminConfig.title  || process.env.APP_NAME || 'Millas Admin',
      ...adminConfig,
      auth: authConfig,
    });

    // ── Wire basePath + User model into AdminAuth ──────────────────────────
    // Pass basePath so AdminAuth._resolveUserModel() can find app/models/User
    // without calling process.cwd() at request time.
    AdminAuth.setBasePath(basePath);

    // AuthServiceProvider runs before us (Database → Auth → Admin order).
    // It already resolved app/models/User → AuthUser fallback and gave it
    // to the Auth singleton. We grab the same model so AdminAuth and the
    // API auth system always use the same table.
    if (authConfig !== false) {
      try {
        const Auth = require('../auth/Auth');
        // Auth._UserModel is the resolved model — reuse it directly
        if (Auth._UserModel) {
          AdminAuth.setUserModel(Auth._UserModel);
        }
      } catch { /* Auth not booted yet — AdminAuth will lazy-resolve */ }
    }
  }
}

module.exports = AdminServiceProvider;