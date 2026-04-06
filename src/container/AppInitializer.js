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
        if (!process.env.MILLAS_CLI_MODE) {
            await this._serve();
        }

        return this._kernel;
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
        // Load .env if not running via CLI (CLI loads it in src/cli.js)
        if (!process.env.MILLAS_CLI_MODE) {
            const path = require('path');
            const fs = require('fs');
            const envPath = path.resolve(process.cwd(), '.env');
            if (fs.existsSync(envPath)) {
                require('dotenv').config({ path: envPath, override: false });
            }
        }

        const cfg = this._config;
        const basePath = cfg.basePath || process.cwd();

        const ExpressAdapter = require('../http/adapters/ExpressAdapter');
        const expressApp = express();
        this._adapter = new ExpressAdapter(expressApp);
        this._adapter.applyBodyParsers();

        // ── Security — applied before any routes or developer middleware ──────
        // Reads config/app.js for overrides. All protections are on by default:
        // security headers, CSRF, rate limiting, cookie defaults, allowed hosts.
        const SecurityBootstrap = require('../http/SecurityBootstrap');
        const appConfig         = SecurityBootstrap.loadConfig(basePath + '/config/app');
        SecurityBootstrap.apply(this._adapter.nativeApp || expressApp, appConfig);

        // ── CORS — applied immediately after security, before routes ──────────
        // Only active when .withCors() was called in bootstrap/app.js.
        // Config is read from the cors: {} block in config/app.js (already loaded
        // above as appConfig). No cors key = CorsMiddleware class defaults apply.
        if (cfg.cors !== null && cfg.cors !== undefined) {
            const CorsMiddleware = require('../middleware/CorsMiddleware');
            const corsMiddleware = new CorsMiddleware(appConfig.cors || {});
            (this._adapter.nativeApp || expressApp).use(
                this._adapter.wrapMiddleware(corsMiddleware, null)
            );
        }
        // ─────────────────────────────────────────────────────────────────────

        for (const mw of (cfg.adapterMiddleware || [])) {
            this._adapter.applyMiddleware(mw);
        }

        this._kernel = new Application(this._adapter);

        this._kernel._container.instance('basePath', basePath);

        // ── View engine ─────────────────────────────────────────────────────────────────
        // Auto-configure Nunjucks as the default template engine.
        // Looks for views/ in the project root. Zero config required.
        // Disable via config/app.js: { views: false }
        this._setupViewEngine(expressApp, basePath, appConfig);

        // ── Static file serving ───────────────────────────────────────────────
        // Auto-serve each storage disk that has a baseUrl configured.
        // Mirrors Laravel's public disk serving — zero config required.
        // e.g. LocalDriver root=storage/uploads baseUrl=/storage
        //      → GET /storage/avatars/photo.jpg serves the file directly.
        this._serveStorageDisks(expressApp, basePath);

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

    _setupViewEngine(expressApp, basePath, appConfig) {
        const path = require('path');
        const fs   = require('fs');

        // Opt-out: views: false in config/app.js
        if (appConfig.views === false) return;

        const viewsConfig = appConfig.views || {};
        const viewsDir    = path.isAbsolute(viewsConfig.path || '')
            ? viewsConfig.path
            : path.join(basePath, viewsConfig.path || 'resources/views');

        // Don't configure if views directory doesn't exist
        if (!fs.existsSync(viewsDir)) return;

        // Serve public/ directory for CSS, JS, images used in views
        const publicDir = path.join(basePath, viewsConfig.public || 'public');
        if (fs.existsSync(publicDir)) {
            expressApp.use(express.static(publicDir));
        }

        const engine = viewsConfig.engine || 'nunjucks';

        if (engine === 'nunjucks') {
            // nunjucks is a core Millas dependency — always available
            const nunjucks = require('nunjucks');

            // Check if nunjucks is already configured for this express app
            const existingEnv = expressApp.get('nunjucksEnvironment');
            let env;
            
            if (existingEnv) {
                // Admin panel will reconfigure with multiple search paths
                env = existingEnv;
            } else {
                env = nunjucks.configure(viewsDir, {
                    autoescape:    viewsConfig.autoescape    ?? true,
                    watch:         viewsConfig.watch         ?? (process.env.NODE_ENV !== 'production'),
                    noCache:       viewsConfig.noCache       ?? (process.env.NODE_ENV !== 'production'),
                    throwOnUndefined: viewsConfig.throwOnUndefined ?? false,
                    express:       expressApp,
                });
                // Store reference for later use
                expressApp.set('nunjucksEnvironment', env);
            }

            // Support both .html and .njk extensions
            expressApp.set('view engine', 'html');
            expressApp.engine('html', env.render.bind(env));
            expressApp.engine('njk',  env.render.bind(env));
            expressApp.set('views', viewsDir);

        } else {
            // Custom engine — user must configure it themselves via .use()
            expressApp.set('views', viewsDir);
            expressApp.set('view engine', engine);
        }
    }

    _serveStorageDisks(expressApp, basePath) {
        const express = require('express');
        const path    = require('path');
        const fs      = require('fs');

        let storageConfig;
        try {
            storageConfig = require(basePath + '/config/storage');
        } catch {
            // Fall back to the same defaults StorageServiceProvider uses
            storageConfig = {
                default: 'local',
                disks: {
                    local:  { driver: 'local', root: 'storage/uploads', baseUrl: '/storage' },
                    public: { driver: 'local', root: 'public/storage',  baseUrl: '/storage' },
                },
            };
        }

        const seen = new Set(); // avoid mounting the same baseUrl twice
        for (const [, disk] of Object.entries(storageConfig.disks || {})) {
            if (!disk.baseUrl || !disk.root) continue;
            if (seen.has(disk.baseUrl)) continue;
            seen.add(disk.baseUrl);

            const absRoot = path.isAbsolute(disk.root)
                ? disk.root
                : path.join(basePath, disk.root);

            // Ensure the directory exists so express.static doesn't warn
            fs.mkdirSync(absRoot, { recursive: true });

            expressApp.use(disk.baseUrl, express.static(absRoot));
        }
    }

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

        // ── 9. Scheduler — always on unless explicitly disabled ──────────────
        // Built-in task scheduler that runs alongside the HTTP server.
        // Automatically loads and executes scheduled tasks from routes/schedule.js.
        if (cfg.scheduler !== false) {
            const p = load('../scheduler/SchedulerServiceProvider');
            if (p) providers.push(p);
        }

        // ── 10. i18n — opt-in via config/app.js use_i18n: true ──────────────
        // Mirrors Django's USE_I18N = True in settings.py.
        // Booted last so translations are available in all request handlers.
        // ── 10. Encryption — always on (APP_KEY drives it) ────────────────────
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