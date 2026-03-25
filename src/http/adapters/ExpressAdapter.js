'use strict';

const HttpAdapter = require('./HttpAdapter');
const MillasRequest = require('../MillasRequest');
const MillasResponse = require('../MillasResponse');
const RequestContext = require('../RequestContext');
const ErrorRenderer = require('../../errors/ErrorRenderer');
const WelcomePage = require('../WelcomePage');
const http = require("http");

/**
 * ExpressAdapter
 *
 * The Express implementation of HttpAdapter.
 * This is the ONLY file in the entire Millas codebase that imports Express
 * or calls Express APIs (req, res, next, app[verb], app.use, etc.).
 *
 * Swapping to a different HTTP engine means writing a new adapter class —
 * zero changes to the kernel, Router, MiddlewareRegistry, or any user code.
 */
class ExpressAdapter extends HttpAdapter {

    /**
     * @param {import('express').Application} expressApp
     */
    constructor(expressApp) {
        super();
        this._app = expressApp;
        this._server = null;
    }

    // ── Setup ──────────────────────────────────────────────────────────────────

    applyBodyParsers() {
        const express = require('express');
        this._app.use(express.json());
        this._app.use(express.urlencoded({extended: true}));
    }

    applyMiddleware(fn) {
        this._app.use(fn);
    }

    // ── Route mounting ─────────────────────────────────────────────────────────

    mountRoute(verb, path, handlers) {
        this._app[verb.toLowerCase()](path, ...handlers);
    }

    mountWelcome(handler) {
        this._app.get('/', handler);
    }

    mountNotFound() {
        this._app.use(ErrorRenderer.notFound());
    }

    mountErrorHandler() {
        this._app.use(ErrorRenderer.handler());
    }

    // ── Request / Response bridge ──────────────────────────────────────────────

    /**
     * Wrap a Millas kernel handler into an Express (req, res, next) function.
     *
     * This is the ONLY place in the codebase where Express req/res/next
     * appear outside of adapter code. The kernel handler never sees them.
     */
    wrapKernelHandler(kernelFn, displayName, container) {
        const fnName = displayName || kernelFn.name || 'anonymous';

        return (expressReq, expressRes, expressNext) => {
            const millaReq = new MillasRequest(expressReq);
            const ctx = new RequestContext(millaReq, container);

            let nextCalled = false;
            const trackedNext = (...args) => {
                nextCalled = true;
                expressNext(...args);
            };

            new Promise((resolve, reject) => {
                try {
                    resolve(kernelFn(ctx, trackedNext));
                } catch (err) {
                    reject(err);
                }
            })
                .then(value => {
                    if (nextCalled) return;
                    if (expressRes.headersSent) return;

                    if (value === undefined || value === null) {
                        return expressNext(Object.assign(
                            new Error(
                                `Route handler "${fnName}" did not return a response.\n` +
                                `Return a MillasResponse or a plain value:\n\n` +
                                `  return jsonify({ ok: true })\n` +
                                `  return { ok: true }           // auto-wrapped\n` +
                                `  return 'Hello world'          // auto-wrapped\n` +
                                `  return redirect('/login')\n` +
                                `  return view('home', { data })`
                            ),
                            {status: 500, statusCode: 500}
                        ));
                    }

                    if (value instanceof Error) return expressNext(value);

                    try {
                        const response = MillasResponse.isResponse(value)
                            ? value
                            : this._autoWrap(value);
                        this.dispatch(response, expressRes);
                    } catch (dispatchErr) {
                        expressNext(dispatchErr);
                    }
                })
                .catch(expressNext);
        };
    }

    /**
     * Wrap a Millas middleware instance into an Express (req, res, next) function.
     */
    wrapMiddleware(instance, container) {
        return (expressReq, expressRes, expressNext) => {
            const millaReq = new MillasRequest(expressReq);
            const ctx = new RequestContext(millaReq, container);

            const next = () => {
                expressNext();
                return undefined;
            };

            new Promise((resolve, reject) => {
                try {
                    resolve(instance.handle(ctx, next));
                } catch (err) {
                    reject(err);
                }
            })
                .then(value => {
                    if (value !== undefined && value !== null && !expressRes.headersSent) {
                        const response = MillasResponse.isResponse(value)
                            ? value
                            : this._autoWrap(value);
                        this.dispatch(response, expressRes);
                    }
                })
                .catch(expressNext);
        };
    }

    /**
     * Dispatch a MillasResponse to the Express res object.
     * This is the ONLY place in the codebase where Express res methods are called.
     */
    dispatch(response, expressRes) {
        if (!response || !MillasResponse.isResponse(response)) {
            throw new Error(
                '[ExpressAdapter] Expected a MillasResponse. Got: ' + typeof response
            );
        }

        // Status
        expressRes.status(response.statusCode);

        // Headers stashed by middleware during the request pipeline
        // (e.g. CorsMiddleware → _corsHeaders, ThrottleMiddleware → _rateLimitHeaders)
        const corsHeaders      = expressRes.req?._corsHeaders;
        const rateLimitHeaders = expressRes.req?._rateLimitHeaders;
        for (const map of [corsHeaders, rateLimitHeaders]) {
            if (map) {
                for (const [name, value] of Object.entries(map)) {
                    expressRes.setHeader(name, value);
                }
            }
        }

        // Response headers
        for (const [name, value] of Object.entries(response.headers)) {
            expressRes.setHeader(name, value);
        }

        // Cookies
        for (const [name, {value, options}] of Object.entries(response.cookies)) {
            if (options.maxAge === 0 || options.expires?.getTime() === 0) {
                expressRes.clearCookie(name, options);
            } else {
                expressRes.cookie(name, value, options);
            }
        }

        // Body
        const {type, body} = response;

        switch (type) {
            case 'json':
                return expressRes.json(body);

            case 'html':
            case 'text':
                return expressRes.send(body);

            case 'redirect':
                return expressRes.redirect(response.statusCode, body);

            case 'empty':
                return expressRes.end();

            case 'file': {
                const {path: filePath, download, name: fileName} = body;
                if (download) {
                    return expressRes.download(
                        filePath,
                        fileName || require('path').basename(filePath)
                    );
                }
                return expressRes.sendFile(require('path').resolve(filePath));
            }

            case 'view': {
                const {template, data} = body;
                return expressRes.render(template, data);
            }

            case 'stream': {
                if (body && typeof body.pipe === 'function') {
                    body.pipe(expressRes);
                } else {
                    expressRes.end();
                }
                return;
            }

            default:
                return expressRes.send(body);
        }
    }

    // ── Server lifecycle ───────────────────────────────────────────────────────

    listen(port, host) {
        return new Promise((resolve, reject) => {
            this.initListener(port, host, resolve, reject);
        });
    }

    initListener(port, host, onListening, onError) {
        const server = http.createServer(this._app);
        server.listen(port, host);
        server.on('error', onError);
        server.on('listening', onListening);
    }

    close() {
        return new Promise((resolve) => {
            if (!this._server) return resolve();
            this._server.close(() => resolve());
        });
    }

    // ── WelcomePage factory ───────────────────────────────────────────────────

    /**
     * Build the welcome page native handler.
     * Returned value is passed directly to mountWelcome().
     */
    makeWelcomeHandler(version) {
        return WelcomePage.handler(version);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /**
     * Auto-wrap a plain JS value into a MillasResponse.
     * Kept inside the adapter — not on the kernel — because it ultimately
     * decides what to send over the wire, which is adapter territory.
     */
    _autoWrap(value) {
        if (MillasResponse.isResponse(value)) return value;
        if (value instanceof Error) throw value;

        if (typeof value === 'string') {
            return value.trimStart().startsWith('<')
                ? MillasResponse.html(value)
                : MillasResponse.text(value);
        }

        if (
            typeof value === 'object' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            return MillasResponse.json(value);
        }

        return MillasResponse.text(String(value));
    }

    /**
     * Expose the raw Express app for escape hatches.
     * Prefer not using this — it couples code to Express.
     */
    get nativeApp() {
        return this._app;
    }

    /**
     * Expose the raw net.Server once listen() has been called.
     */
    get server() {
        return this._server;
    }
}

module.exports = ExpressAdapter;