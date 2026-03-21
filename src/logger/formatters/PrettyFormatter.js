'use strict';

const { LEVEL_TAGS, LEVEL_COLOURS, RESET, BOLD } = require('../levels');

const SEP = '  ';
const TAG_WIDTH = 18;

// Matches /absolute/path/to/file.js or /absolute/path/to/file.js:12:34
const FILE_PATH_RE = /(\/[^\s)'"]+\.(js|ts|json|mjs|cjs)(?::\d+(?::\d+)?)?)/g;
// Matches http(s):// URLs
const URL_RE = /(https?:\/\/[^\s)'"]+)/g;

function linkify(text, dim, useColour) {
  if (!useColour) return text;

  text = text.replace(FILE_PATH_RE, (match) => {
    const filePath = match.replace(/(:\d+)+$/, '');
    const uri = `file://${filePath}`;
    return `${RESET}\x1b]8;;${uri}\x1b\\${match}\x1b]8;;\x1b\\`;
  });

  text = text.replace(URL_RE, (match) => {
    return `${RESET}\x1b]8;;${match}\x1b\\${match}\x1b]8;;\x1b\\`;
  });

  return text;
}

class PrettyFormatter {
  constructor(options = {}) {
    this.showTimestamp = options.timestamp !== false;
    this.showTag       = options.tag       !== false;
    this.colour        = options.colour    !== false;
    this.tsFormat      = options.timestampFormat || 'short';
    this.tagWidth      = options.tagWidth || TAG_WIDTH;
  }

  format(entry) {
    const { level, tag, message, context, error } = entry;

    const c   = this.colour ? (LEVEL_COLOURS[level] || '') : '';
    const r   = this.colour ? RESET     : '';
    const b   = this.colour ? BOLD      : '';
    const d   = this.colour ? '\x1b[2m' : '';
    const lvl = LEVEL_TAGS[level] || '?';

    // ── 1. Measure plain prefix once ─────────────────────────────────────────
    const ts = this._timestamp();
    const plainCols = [];
    if (this.showTimestamp)    plainCols.push(`[${ts}]`);
    plainCols.push(lvl);
    if (this.showTag && tag)   plainCols.push(tag.padEnd(this.tagWidth));

    const indentWidth = plainCols.join(SEP).length + SEP.length;
    const indent      = ' '.repeat(indentWidth);

    // ── 2. Coloured prefix ───────────────────────────────────────────────────
    const colCols = [];
    if (this.showTimestamp)    colCols.push(`${d}[${ts}]${r}`);
    colCols.push(`${c}${b}${lvl}${r}`);
    if (this.showTag && tag)   colCols.push(`${b}${tag.padEnd(this.tagWidth)}${r}`);

    const prefix = colCols.join(SEP) + SEP;

    // ── 3. Terminal width ────────────────────────────────────────────────────
    const termWidth = (process.stdout.columns || 120);
    const msgWidth  = termWidth - indentWidth;

    // ── 4. Collect all logical lines ─────────────────────────────────────────
    const logicalLines = [];

    for (const l of String(message).split('\n')) logicalLines.push({ text: l, dim: false });

    if (context != null) {
      const ctx = typeof context === 'object' ? JSON.stringify(context) : String(context);
      logicalLines.push({ text: ctx, dim: true });
    }

    if (error instanceof Error) {
      for (const l of (error.stack || error.message).split('\n'))
        logicalLines.push({ text: l, dim: true });
    }

    // ── 5. Hard-wrap (skip stack frames so paths stay intact) ────────────────
    const wrappedLines = [];

    for (const { text, dim } of logicalLines) {
      const isStackFrame = dim && /^\s*at /.test(text);

      if (isStackFrame || text.length <= msgWidth) {
        wrappedLines.push({ text, dim });
        continue;
      }

      const words = text.split(' ');
      let chunk = '';
      for (const word of words) {
        if (chunk.length === 0) {
          if (word.length > msgWidth) {
            for (let i = 0; i < word.length; i += msgWidth)
              wrappedLines.push({ text: word.slice(i, i + msgWidth), dim });
          } else {
            chunk = word;
          }
        } else if (chunk.length + 1 + word.length <= msgWidth) {
          chunk += ' ' + word;
        } else {
          wrappedLines.push({ text: chunk, dim });
          chunk = word;
        }
      }
      if (chunk.length) wrappedLines.push({ text: chunk, dim });
    }

    // ── 6. Render + linkify ───────────────────────────────────────────────────
    const rendered = wrappedLines.map((line, i) => {
      const col  = line.dim ? d : c;
      const text = linkify(line.text, line.dim, this.colour);
      if (i === 0) return `${prefix}${col}${text}${r}`;
      return `${indent}${col}${text}${r}`;
    }).join('\n');

    // ── 7. WTF banner ─────────────────────────────────────────────────────────
    if (level === 5) {
      const bar = this.colour
        ? `\x1b[35m\x1b[1m${'━'.repeat(60)}\x1b[0m`
        : '━'.repeat(60);
      return `${bar}\n${rendered}\n${bar}`;
    }

    return rendered;
  }

  _timestamp() {
    const now = new Date();
    if (this.tsFormat === 'iso') return now.toISOString();
    return now.toISOString().replace('T', ' ').slice(0, 19);
  }
}

module.exports = PrettyFormatter;