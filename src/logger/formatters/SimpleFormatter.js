'use strict';

const { LEVEL_NAMES } = require('../levels');

/**
 * SimpleFormatter
 *
 * Plain, no-colour text. Suitable for file output or any sink
 * where ANSI codes would be noise.
 *
 * Output:
 *   [2026-03-15 12:00:00] [INFO]  Auth: User logged in
 *   [2026-03-15 12:00:01] [ERROR] DB: Query failed {"table":"users"}
 */
class SimpleFormatter {
  format(entry) {
    const { level, tag, message, context, error, timestamp } = entry;

    const ts      = (timestamp || new Date().toISOString()).replace('T', ' ').slice(0, 23);
    const lvlName = (LEVEL_NAMES[level] || String(level)).padEnd(7);
    const tagPart = tag ? `${tag}: ` : '';

    let line = `[${ts}] [${lvlName}] ${tagPart}${message}`;

    if (context !== undefined && context !== null) {
      line += ' ' + (typeof context === 'object' ? JSON.stringify(context) : String(context));
    }

    if (error instanceof Error) {
      line += '\n  ' + (error.stack || error.message).replace(/\n/g, '\n  ');
    }

    return line;
  }
}

module.exports = SimpleFormatter;
