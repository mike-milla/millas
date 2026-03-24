'use strict';

const AdminAuth = require('../AdminAuth');

/**
 * AuthHandler
 *
 * Handles the three admin authentication routes:
 *   GET  /admin/login
 *   POST /admin/login
 *   GET  /admin/logout
 */
class AuthHandler {
  constructor(admin) {
    this._admin = admin;
  }

  async loginPage(req, res) {
    const admin = this._admin;

    // Already logged in → redirect to dashboard
    if (AdminAuth.enabled && AdminAuth._getSession(req)) {
      return res.redirect(
        (req.query.next && decodeURIComponent(req.query.next)) ||
        admin._config.prefix + '/'
      );
    }

    const flash = AdminAuth.getFlash(req, res);
    return admin._render(req, res, 'pages/login.njk', {
      adminTitle:  admin._config.title,
      adminPrefix: admin._config.prefix,
      flash,
      next:  req.query.next || '',
      error: null,
    });
  }

  async loginSubmit(req, res) {
    const admin  = this._admin;
    const { email, password, remember, next } = req.body;
    const prefix = admin._config.prefix;

    if (!AdminAuth.enabled) {
      return res.redirect(next || prefix + '/');
    }

    try {
      await AdminAuth.login(req, res, {
        email,
        password,
        remember: remember === 'on' || remember === '1' || remember === 'true',
      });

      res.redirect(next || prefix + '/');
    } catch (err) {
      return admin._render(req, res, 'pages/login.njk', {
        adminTitle:  admin._config.title,
        adminPrefix: prefix,
        flash:       {},
        next:        next || '',
        error:       err.message,
        email,
      });
    }
  }

  logout(req, res) {
    const admin = this._admin;
    AdminAuth.logout(res);
    AdminAuth.setFlash(res, 'success', 'You have been logged out.');
    res.redirect(`${admin._config.prefix}/login`);
  }
}

module.exports = AuthHandler;
