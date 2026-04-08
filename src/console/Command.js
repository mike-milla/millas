'use strict';

const chalk = require('chalk');
const BaseCommand = require("./BaseCommand");

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

/**
 * @typedef {Object} SecreteOptions
 * @property {{mesage?:string,error?:string,retry?:boolean}} [confirm] - Needs secrete Confirmation
 */
class Command extends BaseCommand{

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

  /**
   * Prompt the user for input.
   *
   *   const name = await this.ask('What is your name?');
   *   const name = await this.ask('What is your name?', 'Anonymous');
   *   const age  = await this.ask('Your age?', null, v => Number.isInteger(+v) || 'Must be a number');
   *
   * @param {string}                          question
   * @param {string|null}                     [defaultValue=null]
   * @param {(v:string)=>true|string}         [validate]   — return true to accept, or an error string
   * @returns {Promise<string>}
   */
  async ask(question, defaultValue = null, validate = null) {
    const hint   = defaultValue != null ? chalk.dim(` [${defaultValue}]`) : '';
    const prompt = `${question}${hint} `;

    while (true) {
      const raw    = await _prompt(prompt);
      const answer = raw.trim() || (defaultValue ?? '');

      if (validate) {
        const result = validate(answer);
        if (result !== true) {
          this.error(typeof result === 'string' ? result : 'Invalid input.');
          continue;
        }
      }

      return answer;
    }
  }

  /**
   * Prompt the user for a secret (input hidden — for passwords).
   *
   *   const pass = await this.secret('Password:');
   *   const pass = await this.secret('Password:', { confirm: { message: 'Confirm:' } });
   *   const pass = await this.secret('Password:', { validate: v => v.length >= 8 || 'Min 8 chars' });
   *
   * @param {string} question
   * @param {{ confirm?: { message?: string, error?: string, retry?: boolean }, validate?: (v: string) => true|string }} [options]
   * @returns {Promise<string>}
   */
  async secret(question, options = {}) {
    while (true) {
      const first = await _promptSecret(question + ' ');

      if (options.validate) {
        const result = options.validate(first);
        if (result !== true) {
          this.error(typeof result === 'string' ? result : 'Invalid input.');
          continue;
        }
      }

      if (options.confirm) {
        const second = await _promptSecret(options.confirm.message ?? 'Confirm: ');
        if (first !== second) {
          this.error(options.confirm.error ?? "Inputs don't match!");
          if (options.confirm.retry) continue;
          return null;
        }
      }

      return first;
    }
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
