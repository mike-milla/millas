'use strict';

const Logger          = require('./Logger');
const { LEVELS, LEVEL_NAMES } = require('./levels');
const PrettyFormatter = require('./formatters/PrettyFormatter');
const JsonFormatter   = require('./formatters/JsonFormatter');
const SimpleFormatter = require('./formatters/SimpleFormatter');
const ConsoleChannel  = require('./channels/ConsoleChannel');
const FileChannel     = require('./channels/FileChannel');
const { NullChannel, StackChannel } = require('./channels/index');

/**
 * Log
 *
 * The global logger singleton — the one you import everywhere.
 *
 *   const { Log } = require('millas');
 *
 *   Log.i('App booted');
 *   Log.tag('UserService').d('Fetching user', { id: 5 });
 *   Log.e('Payment', 'Stripe failed', error);
 *   Log.wtf('Impossible state reached');
 *
 * Configured automatically by LogServiceProvider when you add it
 * to your providers list. For manual setup:
 *
 *   Log.configure({
 *     minLevel: LEVELS.INFO,
 *     channel: new StackChannel([
 *       new ConsoleChannel({ formatter: new PrettyFormatter() }),
 *       new FileChannel({ formatter: new SimpleFormatter(), minLevel: LEVELS.WARN }),
 *     ]),
 *   });
 */
const Log = new Logger();

// Apply sensible defaults so Log works out-of-the-box before
// LogServiceProvider runs (during framework boot, tests, etc.)
Log.configure({
  minLevel: process.env.NODE_ENV === 'production' ? LEVELS.INFO : LEVELS.DEBUG,
  channel: new ConsoleChannel({
    formatter: new PrettyFormatter({
      colour: process.stdout.isTTY !== false,
    }),
  }),
});

module.exports = {
  // The singleton you use everywhere
  Log,

  // The class (for constructing named loggers)
  Logger,

  // Level constants
  LEVELS,
  LEVEL_NAMES,

  // Formatters
  PrettyFormatter,
  JsonFormatter,
  SimpleFormatter,

  // Channels
  ConsoleChannel,
  FileChannel,
  NullChannel,
  StackChannel,
};
