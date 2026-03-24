'use strict';

const express = require('express');
const Application = require('./Application');
const HttpServer = require('./HttpServer');

/**
 * AppInitialiser
 *
 * The internal engine that receives what bootstrap/app.js exports
 * (a MillasInstance), extracts its config, and wires up everything:
 *
 *   - ExpressAdapter
 *   - Application kernel (DI container, providers, routes, middleware)
 *   - Admin panel
 *   - HttpServer (port, signals, startup log, IPC ready signal)
 *
 * Developers never see or interact with this class.
 * It is used exclusively by runner.js (millas serve) and the no-reload path.
 *
 * ── Flow ─────────────────────────────────────────────────────────────────────
 *
 *   bootstrap/app.js  →  MillasInstance  →  AppInitialiser.boot()
 *                                              ├─ builds ExpressAdapter
 *                                              ├─ builds Application
 *                                              ├─ registers core providers
 *                                              │    Log → Database → Auth → Admin
 *                                              │    → Cache → Mail → Queue → Events
 *                                              ├─ registers app providers
 *                                              ├─ registers routes
 *                                              ├─ registers middleware aliases
 *                                              ├─ boots all providers
 *                                              ├─ mounts routes
 *                                              ├─ mounts admin panel
 *                                              ├─ mounts fallbacks
 *                                              └─ starts HttpServer
 */
class AppInitializer {
    /**
     * @param {Object} config — the sealed export of bootstrap/app.js
     */
    constructor(config) {
        this._config = config;
        this._kernel = null;
        this._adapter = null;
    }

    /**
     * Boot the full application and start the HTTP server.
     * Returns a Promise that resolves once the server is listening.
     */
    /**
     * Boot the full application and start the HTTP server.
     * Called by millas serve — no changes to the developer API.
     */
    async boot() {
        await this.bootKernel();
        await this._serve();
    }

    /**
     * Boot the application kernel only — DI container, providers, DB, auth,
     * cache, mail, queue. No HTTP server, no routes, no listen().
     *
     * Used internally by CLI commands (millas migrate, millas createsuperuser, etc.)
     * via MILLAS_CLI_BOOT=1 environment variable. Developers never call this directly.
     *
     * @returns {Application} the booted kernel
     */
    async bootKernel() {
        const cfg = this._config;

        const ExpressAdapter = require('../http/adapters/ExpressAdapter');
        const expressApp = express();
        this._adapter = new ExpressAdapter(expressApp);
        this._adapter.applyBodyParsers();

        // ── Security — applied before any routes or developer middleware ──────
        // Reads config/app.js for overrides. All protections are on by default:
        // security headers, CSRF, rate limiting, cookie defaults, allowed hosts.
        const SecurityBootstrap = require('../http/SecurityBootstrap');
        const basePath          = cfg.basePath || process.cwd();
        const appConfig         = SecurityBootstrap.loadConfig(basePath + '/config/app');
        SecurityBootstrap.apply(this._adapter.nativeApp || expressApp, appConfig);
        // ─────────────────────────────────────────────────────────────────────

        for (const mw of (cfg.adapterMiddleware || [])) {
            this._adapter.applyMiddleware(mw);
        }

        this._kernel = new Application(this._adapter);

        this._kernel._container.instance('basePath', basePath);

        const coreProviders = this._buildCoreProviders(cfg);
        this._kernel.providers([...coreProviders, ...cfg.providers]);

        for (const {alias, handler} of (cfg.middleware || [])) {
            this._kernel.middleware(alias, handler);
        }

        if (cfg.routes) {
            this._kernel.routes(cfg.routes);
        }

        await this._kernel.boot();

        return this._kernel;
    }

    /**
     * Mount routes and start the HTTP server.
     * Internal — called only by boot(). CLI commands stop after bootKernel().
     */
    async _serve() {
        const cfg = this._config;

        if (!process.env.MILLAS_ROUTE_LIST) {
            this._kernel.mountRoutes();

            if (cfg.admin !== null) {
                try {
                    const Admin = require('../admin/Admin');
                    if (cfg.admin && Object.keys(cfg.admin).length) {
                        Admin.configure(cfg.admin);
                    }
                    Admin.mount(this._adapter.nativeApp);
                } catch (err) {
                    process.stderr.write(`[millas] Admin mount failed: ${err.message}\n`);
                }
            }

            // ── Docs panel ────────────────────────────────────────────────
            if (cfg.docs !== null && cfg.docs !== undefined) {
                try {
                    const Docs = require('../docs/Docs');
                    // Wire live RouteRegistry now that routes are fully mounted
                    try {
                        Docs.setRouteRegistry(this._kernel.route.getRegistry());
                    } catch {}
                    if (cfg.docs && Object.keys(cfg.docs).length) {
                        Docs.configure(cfg.docs);
                    }
                    Docs.mount(this._adapter.nativeApp);
                } catch (err) {
                    process.stderr.write(`[millas] Docs mount failed: ${err.message}\n`);
                }
            }

            this._kernel.mountFallbacks();

            const server = new HttpServer(this._kernel, {
                onStart:    cfg.onStart    || undefined,
                onShutdown: cfg.onShutdown || undefined,
            });

            await server.start();
        }
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    _buildCoreProviders(cfg) {
        const providers = [];
        const load = (p) => {
            try { return require(p); } catch { return null; }
        };

        // ── 1. Logging ───────────────────────────────────────────────────────
        if (cfg.logging !== false) {
            const p = load('../providers/LogServiceProvider');
            if (p) providers.push(p);
        }

        // ── 2. Database ──────────────────────────────────────────────────────
        if (cfg.database !== false) {
            const p = load('../providers/DatabaseServiceProvider');
            if (p) providers.push(p);
        }

        // ── 3. Auth — always on unless explicitly disabled ───────────────────
        // Mirrors Django: django.contrib.auth is in INSTALLED_APPS by default.
        // Provides Auth.login/register, JWT middleware, the User model.
        // Requires Database to be booted first.
        if (cfg.auth !== false) {
            const p = load('../providers/AuthServiceProvider');
            if (p) providers.push(p);
        }

        // ── 4. Admin — on when .withAdmin() was called ───────────────────────
        // Mirrors Django: django.contrib.admin is in INSTALLED_APPS by default.
        // Requires Auth to be booted first (needs the resolved User model).
        if (cfg.admin !== null && cfg.admin !== undefined) {
            const p = load('../providers/AdminServiceProvider');
            if (p) providers.push(p);
        }

        // ── 4b. Docs — on when .withDocs() was called ────────────────────────
        if (cfg.docs !== null && cfg.docs !== undefined) {
            const p = load('../docs/DocsServiceProvider');
            if (p) providers.push(p);
        }

        // ── 5. Cache + Storage ───────────────────────────────────────────────
        if (cfg.cache !== false || cfg.storage !== false) {
            const p = load('../providers/CacheStorageServiceProvider');
            if (p) {
                if (cfg.cache !== false && p.CacheServiceProvider) providers.push(p.CacheServiceProvider);
                if (cfg.storage !== false && p.StorageServiceProvider) providers.push(p.StorageServiceProvider);
            }
        }

        // ── 6. Mail ──────────────────────────────────────────────────────────
        if (cfg.mail !== false) {
            const p = load('../providers/MailServiceProvider');
            if (p) providers.push(p);
        }

        // ── 7. Queue ─────────────────────────────────────────────────────────
        if (cfg.queue !== false) {
            const p = load('../providers/QueueServiceProvider');
            if (p) providers.push(p);
        }

        // ── 8. Events ────────────────────────────────────────────────────────
        if (cfg.events !== false) {
            const p = load('../providers/EventServiceProvider');
            if (p) providers.push(p);
        }

        // ── 9. i18n — opt-in via config/app.js use_i18n: true ───────────────
        // Mirrors Django's USE_I18N = True in settings.py.
        // Booted last so translations are available in all request handlers.
        // ── 9. Encryption — always on (APP_KEY drives it) ────────────────────
        // Mirrors Laravel: the encrypter is always bound so Crypt / Encrypt
        // facades work out of the box. If APP_KEY is absent a clear error is
        // thrown on first use, not at boot — apps without encryption still start.
        {
            const p = load('../providers/EncryptionServiceProvider');
            if (p) providers.push(p);
        }

        if (this._resolveI18nEnabled(cfg)) {
            const p = load('../i18n/I18nServiceProvider');
            if (p) providers.push(p);
        }

        return providers;
    }

    /**
     * Resolve whether i18n should be enabled.
     * Reads use_i18n from config/app.js — the single source of truth.
     *
     *   // config/app.js
     *   module.exports = {
     *     use_i18n: true,
     *     locale:   'sw',
     *     fallback: 'en',
     *   };
     */
    _resolveI18nEnabled(cfg) {
        try {
            const basePath  = cfg.basePath || process.cwd();
            const appConfig = require(basePath + '/config/app');
            return appConfig.use_i18n === true;
        } catch { return false; }
    }
}

module.exports = AppInitializer;