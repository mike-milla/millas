'use strict';

/**
 * HttpServer
 *
 * Owns everything that belongs to the process/server layer — the things
 * Express puts in bin/www that have nothing to do with your app logic:
 *
 *   - Port normalisation and validation
 *   - EADDRINUSE / EACCES error handling with clear messages
 *   - Startup log (route count, URL, Ctrl+C hint)
 *   - IPC ready signal to the hot-reload proxy (millas serve)
 *   - Graceful shutdown on SIGTERM / SIGINT
 *
 * The Application kernel knows nothing about any of this.
 *
 * ── Usage in bootstrap/server.js ────────────────────────────────────────────
 *
 *   const app    = require('./app');          // configured Millas app, no listen()
 *   const server = new HttpServer(app);
 *   server.start();
 *
 * ── Advanced ─────────────────────────────────────────────────────────────────
 *
 *   new HttpServer(app, {
 *     port:     4000,
 *     host:     '0.0.0.0',
 *     onStart:  (port, host) => console.log(`up on ${host}:${port}`),
 *     onShutdown: () => db.close(),
 *   }).start();
 */
class HttpServer {
    /**
     * @param {import('./Application')} app     — booted Millas Application instance
     * @param {object}                  options
     * @param {number}  [options.port]
     * @param {string}  [options.host]
     * @param {Function}[options.onStart]     — (port, host) => void, called after listen
     * @param {Function}[options.onShutdown]  — async () => void, called before process.exit
     */
    constructor(app, options = {}) {
        this._app = app;
        this._options = options;
    }

    /**
     * Resolve port, boot the server, wire signals.
     * Returns a Promise that resolves once the server is listening.
     */
    async start() {
        const port = this._resolvePort();
        const host = this._options.host
            || process.env.MILLAS_HOST
            || process.env.APP_HOST
            || 'localhost';

        // Boot providers if not already done
        if (!this._app._booted) {
            await this._app.boot();
        }

        // Mount routes + fallbacks if not already mounted
        if (!this._app._router) {
            this._app.mount();
        }

        // Start listening — may throw on EADDRINUSE / EACCES
        try {
            await this._app.listen(port, host);
        } catch (err) {
            this._handleListenError(err, port);
            return; // _handleListenError always exits
        }

        // Notify the millas serve hot-reload proxy that we're ready
        if (typeof process.send === 'function') {
            process.send({type: 'ready', port});
        }

        // User callback
        if (typeof this._options.onStart === 'function') {
            this._options.onStart(port, host);
        }
        this._handleSignals();

    }

    // ── Private ────────────────────────────────────────────────────────────────

    _resolvePort() {
        const raw =
            this._options.port ||
            parseInt(process.env.MILLAS_INTERNAL_PORT, 10) ||
            parseInt(process.env.APP_PORT, 10) ||
            3000;

        return this._normalizePort(raw);
    }

    _normalizePort(val) {
        const n = parseInt(val, 10);
        if (isNaN(n)) return val;   // named pipe — pass through
        if (n >= 0) return n;
        return 3000;
    }

    _handleListenError(err, port) {
        const bind = typeof port === 'string' ? `pipe ${port}` : `port ${port}`;

        switch (err.code) {
            case 'EACCES':
                console.error(
                    `✖  ${bind} requires elevated privileges.\n` +
                    `     Try a port above 1024 or run with sudo.`
                );
                break;

            case 'EADDRINUSE':
                console.error(
                    `✖  ${bind} is already in use.\n` +
                    `     Another process is listening on that port.\n` +
                    `     Try: APP_PORT=3001 millas serve`
                );
                break;

            default:
                console.error(`✖  Listen error: ${err.message}`);
                if (process.env.APP_DEBUG) console.error(err.stack + '\n');
        }

        process.exit(1);
    }


    _handleSignals() {
        const shutdown = async (signal) => {
            process.stdout.write(`\n  Shutting down (${signal})…\n`);
            
            if (typeof this._options.onShutdown === 'function') {
                try {
                    await this._options.onShutdown();
                } catch (err) {
                    console.error('Shutdown error:', err.message);
                }
            }
            
            // Stop scheduler if it exists
            try {
                const scheduler = this._app._container.make('scheduler');
                await scheduler.stop();
            } catch {
                // Scheduler not registered or already stopped
            }
            
            process.exit(0);
        };

        process.once('SIGTERM', () => shutdown("SIGTERM"));
        process.once('SIGINT', () => shutdown('SIGINT'));
    }
}

module.exports = HttpServer;