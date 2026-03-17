'use strict';

/**
 * ConsoleChannel
 *
 * Writes log entries to process.stdout (levels < ERROR) or
 * process.stderr (ERROR and WTF).
 *
 * Usage in config/logging.js:
 *   new ConsoleChannel({ formatter: new PrettyFormatter() })
 */
class ConsoleChannel {
  /**
   * @param {object} options
   * @param {object} options.formatter  — formatter instance (PrettyFormatter, JsonFormatter, …)
   * @param {number} [options.minLevel] — minimum level to output (default: 0 = all)
   */
  constructor(options = {}) {
    this.formatter = options.formatter;
    this.minLevel  = options.minLevel ?? 0;
  }

  write(entry) {
    if (entry.level < this.minLevel) return;

    const output = this.formatter
      ? this.formatter.format(entry)
      : `[${entry.level}] ${entry.message}`;

    // Route errors to stderr
    if (entry.level >= 4) {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  }
}

module.exports = ConsoleChannel;
