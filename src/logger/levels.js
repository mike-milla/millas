'use strict';

/**
 * Log levels — ordered by severity (lowest to highest).
 *
 * Inspired by Android's Timber / Log class:
 *   VERBOSE  — extremely detailed; usually filtered out in production
 *   DEBUG    — development diagnostics
 *   INFO     — normal operational messages (default minimum in production)
 *   WARN     — something unexpected but recoverable
 *   ERROR    — something failed; needs attention
 *   WTF      — "What a Terrible Failure" — should never happen; always logged
 */
const LEVELS = {
  VERBOSE: 0,
  DEBUG:   1,
  INFO:    2,
  WARN:    3,
  ERROR:   4,
  WTF:     5,
};

/** Reverse map: number → name */
const LEVEL_NAMES = Object.fromEntries(
  Object.entries(LEVELS).map(([k, v]) => [v, k])
);

/** Single-letter tags (like Android logcat) */
const LEVEL_TAGS = {
  0: 'V',
  1: 'D',
  2: 'I',
  3: 'W',
  4: 'E',
  5: 'F', // Fatal / WTF
};

/** ANSI colour codes for each level */
const LEVEL_COLOURS = {
  0: '\x1b[90m',   // VERBOSE  — dark grey
  1: '\x1b[36m',   // DEBUG    — cyan
  2: '\x1b[32m',   // INFO     — green
  3: '\x1b[33m',   // WARN     — yellow
  4: '\x1b[31m',   // ERROR    — red
  5: '\x1b[35m',   // WTF      — magenta
};

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';

module.exports = { LEVELS, LEVEL_NAMES, LEVEL_TAGS, LEVEL_COLOURS, RESET, BOLD, DIM };
