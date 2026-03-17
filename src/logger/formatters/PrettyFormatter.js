'use strict';

const { LEVEL_NAMES, LEVEL_TAGS, LEVEL_COLOURS, RESET, BOLD, DIM } = require('../levels');

/**
 * PrettyFormatter
 *
 * Colourful, human-readable output. Designed for development.
 * Inspired by Timber (Android) and Laravel's log formatting.
 *
 * Output:
 *   [2026-03-15 12:00:00] I  UserController  User #5 logged in
 *   [2026-03-15 12:00:01] E  Database        Connection refused  { host: 'localhost' }
 *   [2026-03-15 12:00:02] W  Auth            Token expiring soon
 *
 * WTF level also prints the full stack trace.
 */
class PrettyFormatter {
  /**
   * @param {object} options
   * @param {boolean} [options.timestamp=true]    — show timestamp
   * @param {boolean} [options.tag=true]          — show tag/component name
   * @param {boolean} [options.colour=true]       — ANSI colour (disable for pipes/files)
   * @param {string}  [options.timestampFormat]   — 'iso' | 'short' (default: 'short')
   */
  constructor(options = {}) {
    this.showTimestamp = options.timestamp !== false;
    this.showTag       = options.tag       !== false;
    this.colour        = options.colour    !== false;
    this.tsFormat      = options.timestampFormat || 'short';
  }

  format(entry) {
    const { level, tag, message, context, error } = entry;

    const c    = this.colour ? LEVEL_COLOURS[level] : '';
    const r    = this.colour ? RESET                : '';
    const b    = this.colour ? BOLD                 : '';
    const d    = this.colour ? '\x1b[2m'            : '';
    const lvl  = LEVEL_TAGS[level] || '?';

    const parts = [];

    // Timestamp
    if (this.showTimestamp) {
      const ts = this._timestamp();
      parts.push(`${d}[${ts}]${r}`);
    }

    // Level tag (single letter, coloured)
    parts.push(`${c}${b}${lvl}${r}`);

    // Component/tag
    if (this.showTag && tag) {
      const tagStr = tag.padEnd(18);
      parts.push(`${b}${tagStr}${r}`);
    }

    // Message (handle multi-line)
    const lines = message.split('\n');
    parts.push(`${c}${lines[0]}${r}`);

    let output = parts.join('  ');

    // Continuation lines (aligned with first line)
    if (lines.length > 1) {
      const prefix = parts.slice(0, -1).map(p => p.replace(/\x1b\[[0-9;]*m/g, '')).join('  ');
      const indent = ' '.repeat(prefix.length + 2);
      for (let i = 1; i < lines.length; i++) {
        output += `\n${indent}${c}${lines[i]}${r}`;
      }
    }

    // Context object
    if (context !== undefined && context !== null) {
      const ctx = typeof context === 'object'
        ? JSON.stringify(context, null, 0)
        : String(context);
      output += `  ${d}${ctx}${r}`;
    }

    // Error stack
    if (error instanceof Error) {
      output += `\n${d}${error.stack || error.message}${r}`;
    }

    // WTF: print big warning banner
    if (level === 5) {
      const banner = this.colour
        ? `\x1b[35m\x1b[1m${'━'.repeat(60)}\x1b[0m`
        : '━'.repeat(60);
      output = `${banner}\n${output}\n${banner}`;
    }

    return output;
  }

  _timestamp() {
    const now = new Date();
    if (this.tsFormat === 'iso') return now.toISOString();
    return now.toISOString().replace('T', ' ').slice(0, 19);
  }
}

module.exports = PrettyFormatter;
