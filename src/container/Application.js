'use strict';

const Container = require('./Container');
const ProviderRegistry = require('../providers/ProviderRegistry');
const {Route, Router, MiddlewareRegistry} = require('../router');
const CorsMiddleware = require('../middleware/CorsMiddleware');
const ThrottleMiddleware = require('../middleware/ThrottleMiddleware');
const LogMiddleware = require('../middleware/LogMiddleware');
const AuthMiddleware = require('../auth/AuthMiddleware');
const Facade = require("../facades/Facade");
const UrlGenerator = require("../http/UrlGenerator");

/**
 * Application
 *
 * The central Millas kernel. Owns:
 *   - The DI container
 *   - The provider registry
 *   - The HttpAdapter  (NOT Express directly — any adapter works)
 *   - The route instance
 *   - The middleware registry
 *
 * The kernel is fully decoupled from Express. It talks to the HTTP layer
 * exclusively through the HttpAdapter interface.
 *
 * Usage in bootstrap/app.js:
 *
 *   const { Application }    = require('millas/src/container');
 *   const { ExpressAdapter } = require('millas/src/http/adapters');
 *   const express = require('express');
 *
 *   const adapter = new ExpressAdapter(express());
 *   const app     = new Application(adapter);
 *   app.providers([AppServiceProvider]);
 *   await app.boot();
 *   app.routes(Route => require('../routes/api')(Route));
 *   app.mount();
 *   app.listen();
 */
class Application {
    /**
     * @param {import('../http/adapters/HttpAdapter')} adapter
     */
    constructor(adapter) {
        this._adapter = adapter;
        this._container = new Container();
        this._providers = new ProviderRegistry(this._container, adapter.nativeApp || adapter);
        this._mwRegistry = new MiddlewareRegistry();
        this._route = new Route();
        this._booted = false;

        this._registerCoreBindings();
    }

    // ── Configuration ──────────────────────────────────────────────────────────

    providers(providers = []) {
        this._providers.addMany(providers);
        return this;
    }

    /**
     * Register a middleware alias.
     *
     *   app.middleware('auth', AuthMiddleware)
     *   app.middleware('throttle', new ThrottleMiddleware({ max: 60 }))
     */
    middleware(alias, handler) {
        this._mwRegistry.register(alias, handler);
        return this;
    }

    /**
     * Define all routes via a callback.
     *
     *   app.routes(Route => {
     *     require('../routes/api')(Route);
     *   });
     */
    routes(callback) {
        callback(this._route);
        return this;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    /**
     * Run the full provider lifecycle:
     *   Phase 0 — beforeBoot  (sync, global setup)
     *   Phase 1 — register    (sync, container bindings)
     *   Phase 2 — boot        (async, all bindings available)
     */
    async boot() {
        if (this._booted) return this;

        this._emitSync('platform.booting', {providers: this._providers.list()});

        await this._providers.boot();
        this._booted = true;

        // Wire cache, db, and storage into AI manager now that providers are booted
        try {
          const ai = this._container.make('ai');
          if (ai) {
            try { const cache = this._container.make('cache'); if (cache) ai.setCache(cache); } catch {}
            try { const db    = this._container.make('db');    if (db)    ai.setDb(db);       } catch {}
            try { const store = this._container.make('storage'); if (store) ai.setStorage(store); } catch {}
            // Attach files and stores API as properties
            try {
              const { AIFilesAPI, AIStoresAPI } = require('../ai/files');
              if (!ai.files)  Object.defineProperty(ai, 'files',  { get: () => new AIFilesAPI(ai),  configurable: true });
              if (!ai.stores) Object.defineProperty(ai, 'stores', { get: () => new AIStoresAPI(ai), configurable: true });
            } catch {}
          }
        } catch { /* ai not registered — skip */ }

        this._emitSync('platform.booted', {providers: this._providers.list()});

        return this;
    }

    /**
     * Mount all registered routes onto the adapter.
     * Does NOT add fallbacks — call mountFallbacks() separately after
     * any extra middleware (e.g. Admin panel) is mounted.
     */
    mountRoutes() {
        this._router = new Router(
            this._adapter,
            this._route.getRegistry(),
            this._mwRegistry,
            this._container
        );
        this._router.mountRoutes();
        return this;
    }

    /**
     * Mount 404 + error handler. Must be called LAST.
     */
    mountFallbacks() {
        if (!this._router) {
            this._router = new Router(
                this._adapter,
                this._route.getRegistry(),
                this._mwRegistry,
                this._container
            );
        }
        this._router.mountFallbacks();
        return this;
    }

    /**
     * Mount routes + fallbacks in one call.
     */
    mount() {
        const router = new Router(
            this._adapter,
            this._route.getRegistry(),
            this._mwRegistry,
            this._container
        );
        router.mount();
        return this;
    }

    /**
     * Start the HTTP server via the adapter.
     * Emits: platform.listening
     */
    async listen(port, host, callback) {
        const _port = port
            || parseInt(process.env.MILLAS_INTERNAL_PORT, 10)
            || parseInt(process.env.APP_PORT, 10)
            || 3000;
        const _host = host || process.env.MILLAS_HOST || 'localhost';

        await this._adapter.listen(_port, _host);

        if (process.env.APP_ENV === "development" && process.env.MILLAS_START_UP && !process.env.MILLERS_NODE_ENV) {
            this._printStartupLog(_host, _port);
        }

        this._emitSync('platform.listening', {port: _port, host: _host});

        if (typeof callback === 'function') callback(_port, _host);

        return this;
    }

    _printStartupLog(host, port) {
        const chalk = _tryChalk();
        const routeCount = this._route.list().length;
        const url = `http://${host}:${port}`;

        // console.error(chalk.dim('›') + '  ' +
        //     chalk.dim('Listening on ') + chalk.bold.white(url)
        // );
        console.log(chalk.dim('›') + '  ' +
            chalk.white(routeCount + ' route' + (routeCount !== 1 ? 's' : '') + ' registered')
        );
        console.error(chalk.dim('›') + '  ' +
            chalk.dim('Press ') + chalk.bold('Ctrl+C') + chalk.dim(' to stop')
        );
    }

    /**
     * Graceful shutdown.
     */
    async shutdown(code = 0) {
        this._emitSync('platform.shutting_down', {});
        await this._adapter.close();
        process.exit(code);
    }

    // ── Platform event bus ─────────────────────────────────────────────────────

    on(event, fn) {
        if (!this._platformListeners) this._platformListeners = new Map();
        if (!this._platformListeners.has(event)) this._platformListeners.set(event, []);
        this._platformListeners.get(event).push(fn);
        return this;
    }

    _emitSync(event, data) {
        if (!this._platformListeners) return;
        const listeners = this._platformListeners.get(event) || [];
        for (const fn of listeners) {
            try {
                fn(data);
            } catch {
            }
        }
    }

    // ── Container proxy ────────────────────────────────────────────────────────

    bind(abstract, concrete) {
        this._container.bind(abstract, concrete);
        return this;
    }

    singleton(abstract, c) {
        this._container.singleton(abstract, c);
        return this;
    }

    instance(abstract, value) {
        this._container.instance(abstract, value);
        return this;
    }

    make(abstract, overrides) {
        return this._container.make(abstract, overrides);
    }

    // ── Accessors ──────────────────────────────────────────────────────────────

    get container() {
        return this._container;
    }

    get route() {
        return this._route;
    }

    get adapter() {
        return this._adapter;
    }

    get mwRegistry() {
        return this._mwRegistry;
    }

    /**
     * express — backward-compatible escape hatch.
     * Returns the native app from the adapter if available.
     * Prefer adapter.nativeApp for new code.
     */
    get express() {
        return this._adapter.nativeApp || this._adapter;
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    _registerCoreBindings() {
        this._container.instance('app', this);
        this._container.instance('container', this._container);

        const Facade = require('../facades/Facade');
        Facade.setContainer(this._container);
        // Http client — always available, no provider needed
        const {HttpClient} = require('../http/HttpClient');
        this._container.instance('HttpClient', HttpClient);
        this._container.alias('http', "HttpClient");

        const UrlGenerator = require('../http/UrlGenerator');
        const urlGenerator = new UrlGenerator({
            baseUrl: process.env.APP_URL || '',
            appKey: process.env.APP_KEY || '',
            routeRegistry: this._route?.getRegistry?.() || null,
        });
        this._container.instance('url', urlGenerator);

        const { HashManager } = require('../hashing/Hash');
        let _hashRounds = 12;
        try { const _appCfg = require(basePath + '/config/app'); if (_appCfg.hashing?.rounds) _hashRounds = _appCfg.hashing.rounds; } catch {}
        const hashManager = new HashManager({ default: 'bcrypt', bcrypt: { rounds: _hashRounds } });
        this._container.instance('hash', hashManager);

        const ProcessManager = require('../process/Process').ProcessManager;
        this._container.instance('process', new ProcessManager());

        const { AIManager } = require('../ai/AIManager');
        const basePath = (() => { try { return this._container.make('basePath'); } catch { return process.cwd(); } })();
        let aiConfig = { default: process.env.AI_PROVIDER || 'anthropic', providers: {} };
        try { aiConfig = require(basePath + '/config/ai'); } catch { /* no config — use env vars */ }
        const aiManager = new AIManager(aiConfig);
        this._container.instance('ai', aiManager);


        this._mwRegistry.register('cors', new CorsMiddleware());
        this._mwRegistry.register('throttle', ThrottleMiddleware);
        this._mwRegistry.register('log', new LogMiddleware());
        this._mwRegistry.register('auth', AuthMiddleware);
    }
}

module.exports = Application;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _tryChalk() {
    try {
        return require('chalk');
    } catch {
        const id = s => s;
        const p = new Proxy({}, {get: () => p, apply: (_, __, [s]) => String(s || '')});
        p.dim = id;
        p.bold = p;
        p.white = id;
        return p;
    }
}