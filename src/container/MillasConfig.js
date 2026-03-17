'use strict';

const AppInitializer = require("./AppInitializer");

/**
 * MillasConfig
 *
 * A pure config collector — no side effects, no HTTP, no booting.
 * Every method returns `this` for chaining.
 * The chain ends with .create() which seals the config into a MillasInstance.
 *
 * ── Usage (bootstrap/app.js) ─────────────────────────────────────────────────
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
 */
class MillasConfig {
    constructor() {
        this._config = {
            // Service providers
            providers: [],

            // Route registration callback: (Route) => void
            routes: null,

            // Named middleware aliases: [{ alias, handler }]
            middleware: [],

            // Core service toggles
            database: true,
            cache: true,
            storage: true,
            mail: true,
            queue: true,
            events: true,
            logging: true,

            // Admin panel — null means disabled, {} or options object means enabled
            admin: null,

            // Raw adapter-level middleware (e.g. helmet, compression)
            adapterMiddleware: [],

            // Lifecycle callbacks
            onStart: null,
            onShutdown: null,
        };
    }

    // ── Chainable config methods ───────────────────────────────────────────────

    /**
     * Register application service providers.
     *
     *   .providers([AppServiceProvider, PaymentServiceProvider])
     */
    providers(list = []) {
        this._config.providers.push(...list);
        return this;
    }

    /**
     * Register application routes.
     *
     *   .routes(Route => {
     *     require('../routes/web')(Route);
     *     require('../routes/api')(Route);
     *   })
     */
    routes(callback) {
        this._config.routes = callback;
        return this;
    }

    /**
     * Register a named middleware alias.
     *
     *   .middleware('verified', EmailVerifiedMiddleware)
     */
    middleware(alias, handler) {
        this._config.middleware.push({alias, handler});
        return this;
    }

    /**
     * Enable the admin panel.
     *
     *   .withAdmin()
     *   .withAdmin({ prefix: '/cms', title: 'My CMS' })
     */
    withAdmin(options = {}) {
        this._config.admin = options;
        return this;
    }

    /**
     * Disable individual core services.
     *
     *   .disable('mail', 'queue')
     */
    disable(...services) {
        for (const svc of services) {
            if (svc in this._config) this._config[svc] = false;
        }
        return this;
    }

    /**
     * Apply raw adapter-level middleware (e.g. helmet, compression).
     * These are applied before any Millas routes.
     *
     *   .use(helmet())
     *   .use(compression())
     */
    use(...fns) {
        this._config.adapterMiddleware.push(...fns);
        return this;
    }

    /**
     * Called once the server is listening.
     *
     *   .onStart((port, host) => console.log(`up on ${host}:${port}`))
     */
    onStart(fn) {
        this._config.onStart = fn;
        return this;
    }

    /**
     * Called before graceful shutdown.
     *
     *   .onShutdown(async () => db.close())
     */
    onShutdown(fn) {
        this._config.onShutdown = fn;
        return this;
    }

    // ── Terminal method ────────────────────────────────────────────────────────

    /**
     *
     *
     *   module.exports = Millas.config()
     *     .providers([AppServiceProvider])
     *     .routes(...)
     *     .create();
     */
    async create() {
        return (new AppInitializer(Object.freeze({...this._config}))).boot();
    }
}

module.exports = MillasConfig;