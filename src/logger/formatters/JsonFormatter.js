'use strict';

const { LEVEL_NAMES }     = require('../levels');
const { LogRedactor }     = require('../LogRedactor');

/**
 * JsonFormatter
 *
 * Emits one JSON object per log entry — ideal for production environments
 * where logs are shipped to Datadog, Elasticsearch, CloudWatch, etc.
 * Sensitive context fields are automatically redacted before serialisation.
 *
 * Output (one line per entry):
 *   {"ts":"2026-03-15T12:00:00.000Z","level":"INFO","tag":"Auth","msg":"Login","ctx":{...}}
 */
class JsonFormatter {
  /**
   * @param {object} options
   * @param {boolean} [options.pretty=false]   — pretty-print JSON (for debugging)
   * @param {object}  [options.extra]          — static fields merged into every entry
   * @param {boolean} [options.redact=true]    — redact sensitive context fields
   */
  constructor(options = {}) {
    this.pretty = options.pretty || false;
    this.extra  = options.extra  || {};
    this.redact = options.redact !== false;   // default: true
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

    if (context !== undefined && context !== null) {
      record.ctx = this.redact ? LogRedactor.redact(context) : context;
    }

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