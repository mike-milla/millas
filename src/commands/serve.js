'use strict';

const path = require('path');
const fs = require('fs-extra');
const { fork } = require('child_process');
const chokidar = require('chokidar');
const BaseCommand = require('../console/BaseCommand');
const patchConsole = require('../logger/patchConsole');
const Logger = require('../logger/internal');

const WATCH_DIRS = ['app', 'routes', 'config', 'bootstrap', 'providers', 'middleware'];
const WATCH_EXTS = new Set(['.js', '.mjs', '.cjs', '.json', '.njk', '.env']);
const DEBOUNCE_MS = 250;

class HotReloader {
  constructor(bootstrapPath) {
    this._bootstrap = bootstrapPath;
    this._initialised = false;
    this._child = null;
    this._starting = false;
    this._restarts = 0;
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
    if (this._starting) return;
    
    this._starting = true;
    const extra = {};
    
    if (!this._initialised) {
      extra['MILLAS_START_UP'] = true;
      this._initialised = true;
    }

    this._child = fork(this._bootstrap, [], {
      env: {
        ...process.env,
        ...extra,
        MILLAS_CHILD: '1',
      },
      stdio: 'inherit',
    });

    this._child.on('message', msg => {
      if (msg && msg.type === 'ready') {
        this._starting = false;
      }
    });

    this._child.on('exit', (code, signal) => {
      this._starting = false;

      if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
        console.error(
          this.style?.danger('✖  App crashed') ||
          `✖  App crashed (exit ${code ?? signal}) — fix the error, file watcher will reload…`
        );
      }
    });

    this._child.on('error', err => {
      this._starting = false;
      console.error(`✖  ${err.message}`);
    });
  }

  _killChild(cb) {
    if (!this._child || this._child.exitCode !== null) return cb();
    this._child.once('exit', cb);
    this._child.kill('SIGTERM');
  }

  _restart(changedFile) {
    console.warn(`↺  Reloading${changedFile ? '  ' + changedFile : ''}`);
    this._restarts++;
    this._killChild(() => this._spawnChild());
  }

  _watch() {
    console.log('✔  Watching for changes…');
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
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
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
      } catch {}
    }
    this._watchers = [];
  }

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

class ServeCommand extends BaseCommand {
  static description = 'Start the development server with hot reload';

  async onInit(register) {
    register
      .command(async (port, host, reload) => {
        const restoreAfterPatch = patchConsole(Logger, 'SystemOut');
        const appBootstrap = path.resolve(this.cwd, 'bootstrap/app.js');

        if (!fs.existsSync(appBootstrap)) {
          throw new Error('No Millas project found here. Make sure bootstrap/app.js exists.');
        }

        const publicPort = parseInt(port || process.env.APP_PORT || 3000, 10);
        const publicHost = host || process.env.APP_HOST || 'localhost';

        const env = Object.fromEntries(
          Object.entries({
            NODE_ENV: process.env.APP_ENV,
            MILLERS_NODE_ENV: true,
            MILLAS_HOST: publicHost,
            MILLAS_PORT: String(publicPort),
          }).filter(([, v]) => v !== undefined)
        );

        Object.assign(process.env, env);

        const enableReload = reload !== false;

        if (enableReload) {
          new HotReloader(appBootstrap).start();
        } else {
          try {
            await require(appBootstrap);
          } catch (e) {
            throw new Error(`Error starting server: ${e.message}`);
          }
        }
      })
      .name('serve')
      .num('port', v => v.optional().min(1).max(65535), 'Port to listen on')
      .str('host', v => v.optional(), 'Host to bind to')
      .bool('reload', v => v.default(true), 'Enable hot reload')
      .description('Start the development server with hot reload');
  }
}

module.exports = ServeCommand;
