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
 *                                              ├─ registers providers
 *                                              ├─ registers routes
 *                                              ├─ registers middleware aliases
 *                                              ├─ boots providers
 *                                              ├─ mounts routes
 *                                              ├─ mounts admin (if configured)
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
    async boot() {
        const cfg = this._config;

        // ── Build the HTTP adapter ───────────────────────────────────────────────
        const ExpressAdapter = require('../http/adapters/ExpressAdapter');
        const expressApp = express();
        this._adapter = new ExpressAdapter(expressApp);
        this._adapter.applyBodyParsers();

        // Raw adapter middleware (helmet, compression, etc.)
        for (const mw of (cfg.adapterMiddleware || [])) {
            this._adapter.applyMiddleware(mw);
        }

        // ── Build the Application kernel ─────────────────────────────────────────
        this._kernel = new Application(this._adapter);

        // Core providers (auto-enabled unless disabled in config)
        const coreProviders = this._buildCoreProviders(cfg);
        this._kernel.providers([...coreProviders, ...cfg.providers]);

        // Named middleware aliases
        for (const {alias, handler} of (cfg.middleware || [])) {
            this._kernel.middleware(alias, handler);
        }

        // Route definitions
        if (cfg.routes) {
            this._kernel.routes(cfg.routes);
        }

        // ── Boot providers ───────────────────────────────────────────────────────
        await this._kernel.boot();

        // ── Mount routes ─────────────────────────────────────────────────────────
        if (!process.env.MILLAS_ROUTE_LIST) {
            this._kernel.mountRoutes();

            // Admin panel — mounted between routes and fallbacks
            if (cfg.admin !== null) {
                try {
                    const Admin = require('../admin/Admin');
                    if (cfg.admin && Object.keys(cfg.admin).length) {
                        Admin.configure(cfg.admin);
                    }
                    Admin.mount(expressApp);
                } catch (err) {
                    process.stderr.write(`[millas] Admin mount failed: ${err.message}\n`);
                }
            }

            this._kernel.mountFallbacks();

            // ── Start the HTTP server ──────────────────────────────────────────────
            const server = new HttpServer(this._kernel, {
                onStart: cfg.onStart || undefined,
                onShutdown: cfg.onShutdown || undefined,
            });

            await server.start();
        }
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    _buildCoreProviders(cfg) {
        const providers = [];
        const load = (p) => {
            try {
                return require(p);
            } catch {
                return null;
            }
        };

        if (cfg.logging !== false) {
            const p = load('../providers/LogServiceProvider');
            if (p) providers.push(p);
        }
        if (cfg.database !== false) {
            const p = load('../providers/DatabaseServiceProvider');
            if (p) providers.push(p);
        }

        if (cfg.cache !== false || cfg.storage !== false) {
            const p = load('../providers/CacheStorageServiceProvider');
            if (p) {
                if (cfg.cache !== false && p.CacheServiceProvider) providers.push(p.CacheServiceProvider);
                if (cfg.storage !== false && p.StorageServiceProvider) providers.push(p.StorageServiceProvider);
            }
        }

        if (cfg.mail !== false) {
            const p = load('../providers/MailServiceProvider');
            if (p) providers.push(p);
        }
        if (cfg.queue !== false) {
            const p = load('../providers/QueueServiceProvider');
            if (p) providers.push(p);
        }
        if (cfg.events !== false) {
            const p = load('../providers/EventServiceProvider');
            if (p) providers.push(p);
        }

        return providers;
    }
}

module.exports = AppInitializer;