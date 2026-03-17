'use strict';

/**
 * Logging Configuration
 *
 * Controls what gets logged, where, and in what format.
 *
 * Channels:
 *   'console'   — coloured output to stdout/stderr
 *   'file'      — daily rotating files in storage/logs/
 *   'null'      — discard everything (useful in tests)
 *
 * Levels (lowest → highest):
 *   'verbose' | 'debug' | 'info' | 'warn' | 'error' | 'wtf'
 *
 * Formats:
 *   'pretty'   — coloured, human-readable (default for console)
 *   'simple'   — plain text  (default for file)
 *   'json'     — structured JSON (for log aggregators / production)
 */
module.exports = {
  /*
  |--------------------------------------------------------------------------
  | Default Log Level
  |--------------------------------------------------------------------------
  | The minimum severity to emit. Entries below this level are silently
  | discarded. Typically 'debug' in development, 'info' in production.
  */
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),

  /*
  |--------------------------------------------------------------------------
  | Default Tag
  |--------------------------------------------------------------------------
  | Shown when no tag is supplied to a log call.
  */
  defaultTag: process.env.APP_NAME || 'App',

  /*
  |--------------------------------------------------------------------------
  | Channels
  |--------------------------------------------------------------------------
  | Where log entries are sent. You can define multiple channels and they
  | all receive every entry (fan-out / stack pattern).
  |
  | Each channel can set its own minimum level, so you could log DEBUG to
  | the console during development but only WARN+ to files.
  */
  channels: [
    {
      driver: 'console',
      format: 'pretty',             // 'pretty' | 'simple' | 'json'
      colour: true,                 // set false if piping stdout to a file
      // level: 'debug',            // override per-channel minimum level
    },

    {
      driver:   'file',
      format:   'simple',           // plain text is easiest to grep
      path:     'storage/logs',     // directory (relative to project root)
      prefix:   'millas',           // filenames: millas-2026-03-15.log
      level:    'warn',             // only write warnings and above to disk
      maxFiles: 30,                 // keep 30 days; delete older files
    },

    // Production example — JSON for a log aggregator:
    // {
    //   driver: 'console',
    //   format: 'json',
    //   extra:  { service: 'api', version: '1.0.0' },
    // },
  ],
};
