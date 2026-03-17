'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * FileChannel
 *
 * Writes log entries to daily rotating files.
 *   storage/logs/millas-2026-03-15.log
 *   storage/logs/millas-2026-03-16.log
 *   …
 *
 * Uses Node's built-in fs — no external log-rotation library needed.
 * Files are appended synchronously to avoid losing entries on crash.
 *
 * Usage in config/logging.js:
 *   new FileChannel({
 *     path:      'storage/logs',
 *     prefix:    'millas',
 *     formatter: new SimpleFormatter(),
 *     minLevel:  LEVELS.INFO,
 *     maxFiles:  30,   // keep 30 days of logs
 *   })
 */
class FileChannel {
  /**
   * @param {object} options
   * @param {string}  [options.path]       — directory path (default: storage/logs)
   * @param {string}  [options.prefix]     — filename prefix (default: 'millas')
   * @param {object}  [options.formatter]  — formatter instance
   * @param {number}  [options.minLevel]   — minimum level (default: 0)
   * @param {number}  [options.maxFiles]   — max daily files to retain (default: 30)
   */
  constructor(options = {}) {
    this._dir       = path.resolve(process.cwd(), options.path || 'storage/logs');
    this._prefix    = options.prefix    || 'millas';
    this.formatter  = options.formatter;
    this.minLevel   = options.minLevel  ?? 0;
    this._maxFiles  = options.maxFiles  ?? 30;
    this._lastDate  = null;
    this._stream    = null;
    this._ensuredDir = false;
  }

  write(entry) {
    if (entry.level < this.minLevel) return;

    try {
      this._ensureDir();

      const today = new Date().toISOString().slice(0, 10);
      if (today !== this._lastDate) {
        this._rotateStream(today);
        this._pruneOldFiles();
      }

      const line = this.formatter
        ? this.formatter.format(entry)
        : `[${entry.timestamp}] [${entry.level}] ${entry.message}`;

      fs.appendFileSync(this._currentPath, line + '\n', 'utf8');
    } catch (err) {
      // Never crash the app because of a logging failure
      process.stderr.write(`[millas logger] FileChannel write error: ${err.message}\n`);
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  _ensureDir() {
    if (this._ensuredDir) return;
    fs.mkdirSync(this._dir, { recursive: true });
    this._ensuredDir = true;
  }

  _rotateStream(date) {
    this._lastDate    = date;
    this._currentPath = path.join(this._dir, `${this._prefix}-${date}.log`);
  }

  _pruneOldFiles() {
    try {
      const files = fs.readdirSync(this._dir)
        .filter(f => f.startsWith(this._prefix + '-') && f.endsWith('.log'))
        .sort(); // ISO date prefix sorts chronologically

      const toDelete = files.slice(0, Math.max(0, files.length - this._maxFiles));
      for (const f of toDelete) {
        try { fs.unlinkSync(path.join(this._dir, f)); } catch {}
      }
    } catch {}
  }

  /** Current log file path (useful for tooling). */
  get currentFile() {
    return this._currentPath || null;
  }
}

module.exports = FileChannel;
