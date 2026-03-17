'use strict';

const ServiceProvider = require('./ServiceProvider');
const Admin           = require('../admin/Admin');

/**
 * AdminServiceProvider
 *
 * Registers the Admin singleton and exposes it in the container.
 *
 * Add to bootstrap/app.js:
 *   app.providers([..., AdminServiceProvider])
 *
 * Then register resources and mount:
 *   Admin.register(UserResource);
 *   Admin.mount(route, expressApp);
 */
class AdminServiceProvider extends ServiceProvider {
  register(container) {
    container.instance('Admin',         Admin);
    container.instance('AdminResource', require('../admin/resources/AdminResource').AdminResource);
    container.instance('AdminField',    require('../admin/resources/AdminResource').AdminField);
    container.instance('AdminFilter',   require('../admin/resources/AdminResource').AdminFilter);
  }

  async boot(container) {
    let adminConfig = {};
    try {
      adminConfig = require(process.cwd() + '/config/admin');
    } catch { /* config is optional */ }

    Admin.configure({
      prefix: adminConfig.prefix || '/admin',
      title:  adminConfig.title  || process.env.APP_NAME || 'Millas Admin',
      ...adminConfig,
    });
  }
}

module.exports = AdminServiceProvider;
