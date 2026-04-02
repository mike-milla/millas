'use strict';

const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const fsnative = require('fs');
const {fork} = require('child_process');
const chokidar = require('chokidar');
const patchConsole = require("../logger/patchConsole");
const Logger = require("../logger/internal");
// ── ASCII banner ───────────────────────────────────────────────────────────────

const BANNER_LINES = [
    '  ███╗   ███╗██╗██╗     ██╗      █████╗ ███████╗',
    '  ████╗ ████║██║██║     ██║     ██╔══██╗██╔════╝',
    '  ██╔████╔██║██║██║     ██║     ███████║███████╗',
    '  ██║╚██╔╝██║██║██║     ██║     ██╔══██║╚════██║',
    '  ██║ ╚═╝ ██║██║███████╗███████╗██║  ██║███████║',
    '  ╚═╝     ╚═╝╚═╝╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝',
];

function printBanner(host, port) {
    const env = process.env.NODE_ENV || 'development';
    const ver = 'v' + (require('../../package.json').version || '0.1.0');
    const url = `http://${host}:${port}`;
    const hr = chalk.dim('  ' + '─'.repeat(54));
    const envColour = env === 'production' ? chalk.red
        : env === 'staging' ? chalk.yellow
            : chalk.green;

    process.stdout.write('\n');
    for (const line of BANNER_LINES) {
        process.stdout.write(chalk.bold.cyan(line) + '\n');
    }
    process.stdout.write('\n' + hr + '\n');
    process.stdout.write(
        '  ' + chalk.dim(ver.padEnd(8)) +
        chalk.dim('│') + '  ' + envColour('⬤  ' + env) + '  ' +
        chalk.dim('│') + '  ' + chalk.bold.white(url) + '\n'
    );
    process.stdout.write(hr + '\n\n');
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WATCH_DIRS = ['app', 'routes', 'config', 'bootstrap', 'providers', 'middleware'];
const WATCH_EXTS = new Set(['.js', '.mjs', '.cjs', '.json', '.njk', '.env']);
const DEBOUNCE_MS = 250;


// ── HotReloader ───────────────────────────────────────────────────────────────

class HotReloader {
    constructor(bootstrapPath, publicPort, publicHost) {
        this._bootstrap = bootstrapPath;
        this._initialised = false

        this._child = null;
        this._starting = false;
        this._restarts = 0;

        // Queued { req, res, timer } entries while child is restarting
        this._queue = [];
        this._watchers = [];
        this._timer = null;
    }

    start() {
        this._spawnChild();
        this._watch();
        this._handleSignals();
    }

    _spawnChild() {
        if (this._starting) {
            return;
        }
        this._starting = true;
        const extra = {}
        if (!this._initialised) {
            extra["MILLAS_START_UP"] = true
            this._initialised = true
        }

        this._child = fork(this._bootstrap, [], {
            env: {
                ...extra,
                MILLAS_CHILD: '1',
                DEBUG: process.env.APP_DEBUG,
                MILLAS_HOST: process.env.MILLAS_HOST,
                MILLAS_PORT: process.env.MILLAS_PORT,
            },
            stdio: 'inherit',
        });

        // Application.listen() sends { type:'ready' } via IPC once bound
        this._child.on('message', msg => {
            if (msg && msg.type === 'ready') {
                this._starting = false;
            }
        });
        //
        this._child.on('exit', (code, signal) => {
            this._starting = false;

            if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
                console.error(chalk.red('✖  App crashed') +
                    chalk.dim(` (exit ${code ?? signal})`) +
                    chalk.dim(' — fix the error, file watcher will reload…')
                );
            }
        });
        //
        this._child.on('error', err => {
            this._starting = false;
            console.error(chalk.red(`✖  ${err.message}`));
        });
    }

    _killChild(cb) {
        if (!this._child || this._child.exitCode !== null) return cb();
        this._child.once('exit', cb);
        this._child.kill('SIGTERM');
    }

    _restart(changedFile) {

        console.warn(
            chalk.yellow('↺') + '  ' +
            chalk.white('Reloading') +
            (changedFile ? chalk.blueBright('  ' + changedFile) : '')
        );

        this._restarts++;
        this._killChild(() => this._spawnChild());
    }

    // ── Watcher ───────────────────────────────────────────────────────────────

    _watch() {
        console.log(chalk.green('✔') + '  ' +
            chalk.dim('Watching for changes…')
        );
        const cwd = process.cwd();
        const watchPaths = [
            ...WATCH_DIRS.map(d => path.join(cwd, d)),
            path.join(cwd, '.env'),
            path.join(cwd, '.env.local'),
        ];

        const watcher = chokidar.watch(watchPaths, {
            persistent: true,
            ignoreInitial: true,
            ignored: /(^|[\/\\])\..(?!env)/,
            // Wait for the file write to settle before reloading.
            // Prevents double-restarts on editors that truncate then rewrite.
            awaitWriteFinish: {stabilityThreshold: 80, pollInterval: 20},
        });

        watcher.on('all', (event, filePath) => {
            if (WATCH_EXTS.has(path.extname(filePath))) {
                this._scheduleRestart(filePath);
            }
        });

        this._watchers.push(watcher);
    }

    _scheduleRestart(changedFile) {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._restart(changedFile), DEBOUNCE_MS);
    }

    _stopWatching() {
        for (const w of this._watchers) {
            try {
                w.close();
            } catch {
            }
        }
        this._watchers = [];
    }

    // ── Signals ───────────────────────────────────────────────────────────────

    _handleSignals() {
        const cleanup = () => {
            clearTimeout(this._timer);
            this._stopWatching();
            if (this._child) this._child.kill('SIGTERM');
            process.exit(0);
        };
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
    }
}

// ── Command ────────────────────────────────────────────────────────────────────

module.exports = function (program) {
    program
        .command('serve')
        .description('Start the development server with hot reload')
        .option('-p, --port <port>', 'Port to listen on')
        .option('-h, --host <host>', 'Host to bind to', 'localhost')
        .option('--no-reload', 'Disable hot reload (run once, like production)')
        .action((options) => {

            require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

            const restoreAfterPatch = patchConsole(Logger,"SystemOut")
            let appBootstrap = path.resolve(process.cwd(), 'bootstrap/app.js');

            if (!fs.existsSync(appBootstrap)) {
                process.stderr.write(chalk.red('\n  ✖  No Millas project found here.\n'));
                process.stderr.write(chalk.dim('     Make sure bootstrap/app.js exists.\n\n'));
                process.exit(1);
            }

            const publicPort = parseInt(options.port ||process.env.APP_PORT, 10) || 3000;
            const publicHost = options.host || 'localhost';

            const env = {
                NODE_ENV: process.env.APP_ENV || 'development',
                MILLERS_NODE_ENV: true,
                MILLAS_HOST: publicHost,
                MILLAS_PORT: String(publicPort),
            };

            Object.assign(process.env, env);
            printBanner(publicHost, publicPort);

            if (options.reload !== false) {
                new HotReloader(appBootstrap, publicPort, publicHost).start();
            } else {
                try {
                    require(appBootstrap);
                } catch (e) {
                    console.log("Error starting server: ", +e)
                }
            }
        });

};

module.exports.requireProject = function (command) {
    const bootstrapPath = path.resolve(process.cwd(), 'bootstrap/app.js');
    if (!fsnative.existsSync(bootstrapPath)) {
        process.stderr.write(chalk.red(`\n  ✖  Not inside a Millas project (${command}).\n\n`));
        process.exit(1);
    }
};