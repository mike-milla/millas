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
    // Load auth config
    let authConfig;
    try {
      authConfig = require(process.cwd() + '/config/auth');
    } catch {
      authConfig = {
        default: 'jwt',
        guards:  { jwt: { driver: 'jwt', secret: process.env.APP_KEY || 'dev-secret', expiresIn: '7d' } },
      };
    }

    // Load the app's User model if it exists.
    // Falls back to the built-in AuthUser so Auth always has a model to work with.
    let UserModel;
    try {
      UserModel = require(process.cwd() + '/app/models/User');
    } catch {
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