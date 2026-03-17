'use strict';

const ServiceProvider = require('./ServiceProvider');
const {
  Log,
  Logger,
  LEVELS,
  PrettyFormatter,
  JsonFormatter,
  SimpleFormatter,
  ConsoleChannel,
  FileChannel,
  NullChannel,
  StackChannel,
} = require('../logger/index');
const MillasLog      = require('../logger/internal');
const patchConsole   = require('../logger/patchConsole');

/**
 * LogServiceProvider
 *
 * On boot:
 *   1. Configures Log (app logger) from config/logging.js
 *   2. Configures MillasLog (internal framework logger) from config.internal
 *   3. Patches console.* to route through Log  (unless interceptConsole: false)
 *
 * config/logging.js reference:
 *
 *   module.exports = {
 *     level:    'debug',
 *     channels: [{ driver: 'console', format: 'pretty' }],
 *
 *     // Opt out of console patching:
 *     interceptConsole: false,
 *
 *     // Framework-internal logs (ORM, migrations, admin):
 *     internal: { level: 'warn' },
 *   };
 */
class LogServiceProvider extends ServiceProvider {
  register(container) {
    container.instance('Log', Log);
    container.instance('Logger', Logger);
    container.alias('log', 'Log');
    container.instance('MillasLog', MillasLog);
  }

  /**
   * beforeBoot — runs before any provider's register() call.
   *
   * We configure logging and patch console here so that:
   *   - Every register() call in every provider already produces
   *     formatted log output
   *   - No provider boots without a working logger
   *
   * This is synchronous — no async allowed in beforeBoot.
   * We load config synchronously and apply defaults eagerly.
   */
  beforeBoot(container) {
    let config = {};
    try {
      config = require(process.cwd() + '/config/logging');
    } catch {
      // No config file — defaults already applied in logger/index.js
    }

    // Store config on the instance so boot() can use it without re-reading
    this._loggingConfig = config;

    // ── Configure Log from config ─────────────────────────────────────────
    const channels = this._buildChannels(config);
    Log.configure({
      minLevel:   this._resolveLevel(config.level ?? config.minLevel),
      defaultTag: config.defaultTag || 'SystemOut',
      channel:    channels.length === 1 ? channels[0] : new StackChannel(channels),
    });

    // ── Configure MillasLog (internal framework logger) ───────────────────
    this._configureMillasLog(config.internal);

    // ── Patch console.* → Log.* ───────────────────────────────────────────
      this._restoreConsole = patchConsole(Log, config.defaultTag || 'SystemOut');

  }

  async boot(container, app) {
    const config  = this._loggingConfig || {};
    const intercept = config.interceptConsole !== false;

    // Store restore fn so tests can call container.make('console.restore')
    if (this._restoreConsole) {
      container.instance('console.restore', this._restoreConsole);
    }

    // Log.tag('Millas').i(
    //   `Logger ready` +
    //   ` — level: ${this._levelName(Log._minLevel)}` +
    //   `, internal: ${this._levelName(MillasLog._minLevel)}` +
    //   `, console: ${intercept ? 'intercepted' : 'native'}`
    // );
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _configureMillasLog(internalConfig) {
    if (internalConfig === false) {
      MillasLog.configure({ channel: new NullChannel() });
    } else if (internalConfig && typeof internalConfig === 'object') {
      if (internalConfig.channels) {
        const internalChannels = this._buildChannels(internalConfig);
        MillasLog.configure({
          minLevel:   this._resolveLevel(internalConfig.level ?? internalConfig.minLevel),
          defaultTag: 'Millas',
          channel:    internalChannels.length === 1
            ? internalChannels[0]
            : new StackChannel(internalChannels),
        });
      } else {
        const fmt   = this._buildFormatter(internalConfig.format || 'pretty', internalConfig);
        const level = this._resolveLevel(internalConfig.level ?? internalConfig.minLevel);
        MillasLog.configure({
          minLevel:   level,
          defaultTag: 'Millas',
          channel:    new ConsoleChannel({ formatter: fmt, minLevel: level }),
        });
      }
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _buildChannels(config) {
    const channelDefs = config.channels || ['console'];
    const built       = [];

    for (const def of channelDefs) {
      // String shorthand: 'console' | 'file' | 'null'
      if (def === 'console' || def?.driver === 'console') {
        built.push(this._buildConsole(def));
      } else if (def === 'file' || def?.driver === 'file') {
        built.push(this._buildFile(def));
      } else if (def === 'null' || def?.driver === 'null') {
        built.push(new NullChannel());
      } else if (def && typeof def.write === 'function') {
        // Already an instantiated channel — use directly
        built.push(def);
      }
    }

    // Always have at least a console channel
    if (!built.length) built.push(this._buildConsole({}));

    return built;
  }

  _buildConsole(opts = {}) {
    const fmt = this._buildFormatter(opts.formatter || opts.format || 'pretty', opts);
    return new ConsoleChannel({
      formatter: fmt,
      minLevel:  this._resolveLevel(opts.level ?? opts.minLevel),
    });
  }

  _buildFile(opts = {}) {
    const fmt = this._buildFormatter(opts.formatter || opts.format || 'simple', opts);
    return new FileChannel({
      path:      opts.path     || 'storage/logs',
      prefix:    opts.prefix   || 'millas',
      formatter: fmt,
      minLevel:  this._resolveLevel(opts.level ?? opts.minLevel),
      maxFiles:  opts.maxFiles ?? 30,
    });
  }

  _buildFormatter(name, opts = {}) {
    if (name && typeof name === 'object' && typeof name.format === 'function') {
      return name; // already an instance
    }
    switch (String(name).toLowerCase()) {
      case 'json':
        return new JsonFormatter({ extra: opts.extra });
      case 'simple':
        return new SimpleFormatter();
      case 'pretty':
      default:
        return new PrettyFormatter({
          colour:           opts.colour !== false && process.stdout.isTTY !== false,
          timestamp:        opts.timestamp !== false,
          tag:              opts.tag !== false,
          timestampFormat:  opts.timestampFormat || 'short',
        });
    }
  }

  _resolveLevel(level) {
    if (level === undefined || level === null) {
      return process.env.NODE_ENV === 'production' ? LEVELS.INFO : LEVELS.DEBUG;
    }
    if (typeof level === 'number') return level;
    return LEVELS[String(level).toUpperCase()] ?? LEVELS.DEBUG;
  }

  _levelName(n) {
    const names = ['VERBOSE','DEBUG','INFO','WARN','ERROR','WTF'];
    return names[n] || String(n);
  }
}

module.exports = LogServiceProvider;
