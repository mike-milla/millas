'use strict';

const chalk = require('chalk');

/**
 * Command
 *
 * Base class for all custom Millas console commands.
 * Mirrors Laravel's Artisan command / Django's BaseCommand.
 *
 * ── Defining a command ────────────────────────────────────────────────────────
 *
 *   // app/commands/SendDigestCommand.js
 *   const { Command } = require('millas/console');
 *
 *   class SendDigestCommand extends Command {
 *     static signature    = 'email:digest';
 *     static description  = 'Send the weekly digest email to all subscribers';
 *
 *     // Optional: define arguments and options
 *     static args = [
 *       { name: 'type', description: 'Digest type (weekly|daily)', default: 'weekly' },
 *     ];
 *
 *     static options = [
 *       { flag: '--dry-run', description: 'Preview without sending' },
 *       { flag: '--limit <n>', description: 'Max recipients', default: '100' },
 *     ];
 *
 *     async handle() {
 *       const type  = this.argument('type');
 *       const limit = this.option('limit');
 *       const dry   = this.option('dryRun');
 *
 *       this.info(`Sending ${type} digest to up to ${limit} users…`);
 *
 *       if (dry) {
 *         this.warn('Dry run — no emails sent.');
 *         return;
 *       }
 *
 *       // … your logic …
 *       this.success('Done!');
 *     }
 *   }
 *
 *   module.exports = SendDigestCommand;
 *
 * ── Running ───────────────────────────────────────────────────────────────────
 *
 *   millas call email:digest
 *   millas call email:digest weekly --limit 50 --dry-run
 *
 * ── Output helpers ────────────────────────────────────────────────────────────
 *
 *   this.line(msg)      — plain output
 *   this.info(msg)      — cyan
 *   this.success(msg)   — green  ✔
 *   this.warn(msg)      — yellow ⚠
 *   this.error(msg)     — red    ✖
 *   this.comment(msg)   — dim / gray
 *   this.newLine()      — blank line
 *   this.table(headers, rows)   — formatted table
 *
 * ── Input helpers ─────────────────────────────────────────────────────────────
 *
 *   this.argument(name)   — positional arg value
 *   this.option(name)     — option value (camelCase: --dry-run → dryRun)
 *   this.ask(question)    — interactive prompt, returns Promise<string>
 *   this.secret(question) — hidden input (passwords), returns Promise<string>
 *   this.confirm(question, default?) — yes/no prompt, returns Promise<boolean>
 *
 * ── Exit ──────────────────────────────────────────────────────────────────────
 *
 *   return;              — success (exit 0)
 *   this.fail(msg)       — print error + exit 1
 */
class Command {
  /**
   * The CLI signature — used as the command name.
   * Use colons for namespacing: 'email:digest', 'cache:clear', 'db:seed'
   *
   * @type {string}
   */
  static signature = '';

  /**
   * Short description shown in `millas --help` and `millas list`.
   *
   * @type {string}
   */
  static description = '';

  /**
   * Positional arguments.
   * Each entry: { name: string, description?: string, default?: * }
   *
   * @type {Array<{ name: string, description?: string, default?: * }>}
   */
  static args = [];

  /**
   * Named options / flags.
   * Each entry: { flag: string, description?: string, default?: * }
   * flag examples: '--dry-run', '--limit <n>', '-f, --force'
   *
   * @type {Array<{ flag: string, description?: string, default?: * }>}
   */
  static options = [];

  // ── Internal ───────────────────────────────────────────────────────────────

  constructor() {
    this._args    = {};
    this._opts    = {};
  }

  /**
   * Populate the command with parsed CLI values.
   * Called by CommandLoader before handle().
   *
   * @param {object} args    — { argName: value, … }
   * @param {object} options — { optName: value, … }
   * @internal
   */
  _hydrate(args, options) {
    this._args = args    || {};
    this._opts = options || {};
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  /**
   * Get a positional argument value by name.
   *
   *   const name = this.argument('name');
   *
   * @param {string} name
   * @returns {*}
   */
  argument(name) {
    return this._args[name];
  }

  /**
   * Get an option value by name (camelCase).
   * Flags like --dry-run become dryRun.
   *
   *   const limit = this.option('limit');
   *   const dry   = this.option('dryRun');
   *
   * @param {string} name
   * @returns {*}
   */
  option(name) {
    return this._opts[name];
  }

  /**
   * Prompt the user for input.
   *
   *   const name = await this.ask('What is your name?');
   *
   * @param {string} question
   * @returns {Promise<string>}
   */
  ask(question) {
    return _prompt(question + ' ');
  }

  /**
   * Prompt the user for a secret (input hidden — for passwords).
   *
   *   const pass = await this.secret('Password:');
   *
   * @param {string} question
   * @returns {Promise<string>}
   */
  secret(question) {
    return _promptSecret(question + ' ');
  }

  /**
   * Prompt for a yes/no confirmation.
   *
   *   const ok = await this.confirm('Are you sure?');
   *   const ok = await this.confirm('Delete all records?', false);
   *
   * @param {string}  question
   * @param {boolean} [defaultValue=true]
   * @returns {Promise<boolean>}
   */
  async confirm(question, defaultValue = true) {
    const hint   = defaultValue ? '(Y/n)' : '(y/N)';
    const answer = await _prompt(`${question} ${hint} `);
    const trimmed = (answer || '').trim().toLowerCase();
    if (!trimmed) return defaultValue;
    return trimmed === 'y' || trimmed === 'yes';
  }

  // ── Output ─────────────────────────────────────────────────────────────────

  /**
   * Write a plain line to stdout.
   * @param {string} [msg='']
   */
  line(msg = '') {
    process.stdout.write(msg + '\n');
  }

  /**
   * Write a blank line.
   */
  newLine() {
    process.stdout.write('\n');
  }

  /**
   * Informational message (cyan).
   * @param {string} msg
   */
  info(msg) {
    this.line(chalk.cyan(`  ${msg}`));
  }

  /**
   * Success message (green ✔).
   * @param {string} msg
   */
  success(msg) {
    this.line(chalk.green(`  ✔  ${msg}`));
  }

  /**
   * Warning message (yellow ⚠).
   * @param {string} msg
   */
  warn(msg) {
    this.line(chalk.yellow(`  ⚠  ${msg}`));
  }

  /**
   * Error message (red ✖). Does NOT exit — use fail() to exit.
   * @param {string} msg
   */
  error(msg) {
    this.line(chalk.red(`  ✖  ${msg}`));
  }

  /**
   * Dimmed / comment message.
   * @param {string} msg
   */
  comment(msg) {
    this.line(chalk.dim(`  // ${msg}`));
  }

  /**
   * Print an error and exit with code 1.
   * @param {string} msg
   */
  fail(msg) {
    this.error(msg);
    process.exit(1);
  }

  /**
   * Render a simple table.
   *
   *   this.table(
   *     ['ID', 'Name',  'Email'],
   *     [[1,   'Alice', 'alice@example.com'],
   *      [2,   'Bob',   'bob@example.com']],
   *   );
   *
   * @param {string[]}   headers
   * @param {Array[]}    rows
   */
  table(headers, rows) {
    if (!headers.length) return;

    // Compute column widths
    const widths = headers.map((h, i) => {
      const colValues = [String(h), ...rows.map(r => String(r[i] ?? ''))];
      return Math.max(...colValues.map(v => v.length));
    });

    const hr  = '  ' + widths.map(w => '─'.repeat(w + 2)).join('┼') ;
    const fmt = (cells, color) => '  ' + cells
      .map((c, i) => color(String(c ?? '').padEnd(widths[i])))
      .join(chalk.dim(' │ '));

    this.newLine();
    this.line(fmt(headers, chalk.bold));
    this.line(chalk.dim(hr));
    for (const row of rows) {
      this.line(fmt(row, v => v));
    }
    this.newLine();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * The command's entry point. Override this in your command.
   *
   * @returns {Promise<void>}
   */
  async handle() {
    throw new Error(`[Command] "${this.constructor.signature}" must implement handle().`);
  }
}

// ── Prompt helpers ────────────────────────────────────────────────────────────

function _prompt(question) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
}

function _promptSecret(question) {
  if (!process.stdin.isTTY) return _prompt(question);
  return new Promise(resolve => {
    process.stdout.write(question);
    const rl = require('readline').createInterface({
      input:    process.stdin,
      output:   new (require('stream').Writable)({ write(c, e, cb) { cb(); } }),
      terminal: true,
    });
    rl.question('', answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

module.exports = Command;
