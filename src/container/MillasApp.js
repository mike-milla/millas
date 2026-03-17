'use strict';

const MillasConfig = require('./MillasConfig');

/**
 * Millas

 * ── bootstrap/app.js ────────────────────────────────────────────────────────
 *
 *   const { Millas } = require('millas');
 *
 *   module.exports = Millas.config()
 *     .providers([AppServiceProvider])
 *     .routes(Route => {
 *       require('../routes/web')(Route);
 *       require('../routes/api')(Route);
 *     })
 *     .withAdmin()
 *     .create();
 *
 * That is everything a developer writes. The rest is handled internally.
 *
 * Millas.config()   → MillasConfig  (chainable, collects config only)
 * .create()         → MillasInstance (sealed carrier, no callable methods)
 *
 * The framework's AppInitialiser receives the MillasInstance, reads its
 * config, and boots the full application — adapter, kernel, providers,
 * routes, admin, HTTP server — without the developer being involved.
 */
const Millas = {
  /**
   * Start building an application config.
   * Returns a MillasConfig chain ending in .create().
   *
   * @returns {MillasConfig}
   */
  config() {
    return new MillasConfig();
  },
};

module.exports = Millas;