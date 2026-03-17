'use strict';

/**
 * src/logger/internal.js
 *
 * MillasLog — the Millas framework's own internal logger.
 *
 * This is separate from the user-facing `Log` singleton. It is used by:
 *   - ORM (queries, relation warnings, migration runner)
 *   - Admin panel
 *   - Queue worker
 *   - Any other framework-internal code
 *
 * It always works — no provider, no config, no try/catch needed at call sites.
 * It starts in a sensible default state (WARN+ to console) and is upgraded
 * by LogServiceProvider once the app boots and config/logging.js is read.
 *
 * ── Usage inside framework code ────────────────────────────────────────────
 *
 *   const MillasLog = require('../logger/internal');
 *
 *   MillasLog.d('ORM', 'Running query', { table: 'users' });
 *   MillasLog.w('ORM', 'Relation not defined', { model: 'Post', name: 'tags' });
 *   MillasLog.e('Migration', 'Failed to run migration', error);
 *
 * ── Configuring from config/logging.js ─────────────────────────────────────
 *
 *   module.exports = {
 *     // ... app channels ...
 *
 *     internal: {
 *       level: 'debug',      // show all ORM/framework logs (default: 'warn')
 *       format: 'pretty',    // pretty | simple | json
 *     },
 *   };
 *
 * ── Disabling internal logs entirely ───────────────────────────────────────
 *
 *   internal: false
 *
 * ── Writing to a separate file ─────────────────────────────────────────────
 *
 *   internal: {
 *     level:  'debug',
 *     channels: [
 *       { driver: 'console', format: 'pretty', level: 'warn' },
 *       { driver: 'file', format: 'simple', path: 'storage/logs', prefix: 'millas-internal', level: 'debug' },
 *     ],
 *   },
 */

const Logger          = require('./Logger');
const { LEVELS }      = require('./levels');
const ConsoleChannel  = require('./channels/ConsoleChannel');
const PrettyFormatter = require('./formatters/PrettyFormatter');
const { NullChannel } = require('./channels/index');

// ── Create the MillasLog singleton ───────────────────────────────────────────

const MillasLog = new Logger();

// Default: WARN and above, pretty-formatted to console.
// This means normal app runs are quiet — you only see warnings and errors
// from the framework itself unless you opt in to lower levels.
MillasLog.configure({
  defaultTag: 'Millas',
  minLevel:   LEVELS.VERBOSE,
  channel:    new ConsoleChannel({
    formatter: new PrettyFormatter({
      colour: process.stdout.isTTY !== false,
    }),
    minLevel: LEVELS.VERBOSE,
  }),
});

module.exports = MillasLog;
