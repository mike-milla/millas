'use strict';

const ServiceProvider = require('./ServiceProvider');
const Auth            = require('../auth/Auth');
const AuthMiddleware  = require('../auth/AuthMiddleware');
const RoleMiddleware  = require('../auth/RoleMiddleware');

/**
 * AuthServiceProvider
 *
 * Configures the Auth facade and registers auth-related
 * bindings and middleware aliases.
 *
 * Add to bootstrap/app.js:
 *   app.providers([DatabaseServiceProvider, AuthServiceProvider, AppServiceProvider])
 */
class AuthServiceProvider extends ServiceProvider {
  register(container) {
    container.instance('Auth', Auth);
    container.alias('auth', 'Auth');
    container.instance('AuthMiddleware',  AuthMiddleware);
  }

  async boot(container, app) {
    const basePath = container.make('basePath') || process.cwd();
    // Load auth config
    let authConfig;
    try {
      authConfig = require(basePath + '/config/auth');
    } catch {
      authConfig = {
        default: 'jwt',
        guards:  { jwt: { driver: 'jwt', secret: process.env.APP_KEY || 'dev-secret', expiresIn: '7d' } },
      };
    }

    // ── Resolve the User model ──────────────────────────────────────────────
    //
    // Priority order (mirrors Django's AUTH_USER_MODEL pattern):
    //
    //   1. config/app.js → auth_user: 'User'
    //      The model name is looked up in app/models/index.js exports.
    //      This is the recommended approach — explicit and refactor-safe.
    //
    //   2. app/models/User.js (default export or named User export)
    //      Conventional fallback — works if auth_user is not set and
    //      the file exists at the default path.
    //
    //   3. Built-in AuthUser
    //      Abstract base class — no table. Used only as a last resort
    //      so Auth always has a model to work with during early dev.
    //
    let UserModel;
    try {
      // Step 1: read auth_user from config/app.js
      let authUserName = null;
      try {
        const appConfig = require(basePath + '/config/app');
        authUserName = appConfig.auth_user || null;
      } catch { /* config/app.js missing or has no auth_user key */ }

      if (authUserName) {
        // Resolve by name from app/models/index.js
        const modelsIndex = require(basePath + '/app/models/index');
        const resolved    = modelsIndex[authUserName];
        if (!resolved) {
          throw new Error(
            `[AuthServiceProvider] auth_user: '${authUserName}' not found in app/models/index.js.\n` +
            `  Available exports: ${Object.keys(modelsIndex).join(', ')}`
          );
        }
        UserModel = resolved;
      }
    } catch (err) {
      if (err.message.includes('[AuthServiceProvider]')) throw err; // re-throw config errors
      // Step 3: fall back to built-in AuthUser (abstract — no table)
      UserModel = require('../auth/AuthUser');
    }

    // Configure the Auth singleton
    Auth.configure(authConfig, UserModel);

    // Register 'auth' middleware alias with the real JWT implementation
    if (app && app.mwRegistry) {
      app.mwRegistry.register('auth',  AuthMiddleware);
      app.mwRegistry.register('role',  new RoleMiddleware([]));
      app.mwRegistry.register('admin', new RoleMiddleware(['admin']));
    }
  }
}

module.exports = AuthServiceProvider;