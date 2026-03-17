'use strict';

const { LEVEL_NAMES } = require('../levels');

/**
 * JsonFormatter
 *
 * Emits one JSON object per log entry — ideal for production environments
 * where logs are shipped to Datadog, Elasticsearch, CloudWatch, etc.
 *
 * Output (one line per entry):
 *   {"ts":"2026-03-15T12:00:00.000Z","level":"INFO","tag":"Auth","msg":"Login","ctx":{...}}
 */
class JsonFormatter {
  /**
   * @param {object} options
   * @param {boolean} [options.pretty=false]   — pretty-print JSON (for debugging)
   * @param {object}  [options.extra]          — static fields merged into every entry (e.g. service name)
   */
  constructor(options = {}) {
    this.pretty = options.pretty || false;
    this.extra  = options.extra  || {};
  }

  format(entry) {
    const { level, tag, message, context, error, timestamp } = entry;

    const record = {
      ts:    timestamp || new Date().toISOString(),
      level: LEVEL_NAMES[level] || String(level),
      ...this.extra,
    };

    if (tag)     record.tag = tag;
    record.msg = message;
    if (context !== undefined && context !== null) record.ctx = context;

    if (error instanceof Error) {
      record.error = {
        message: error.message,
        name:    error.name,
        stack:   error.stack,
      };
    }

    return this.pretty
      ? JSON.stringify(record, null, 2)
      : JSON.stringify(record);
  }
}

module.exports = JsonFormatter;
