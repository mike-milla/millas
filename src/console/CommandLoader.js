'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * CommandLoader
 *
 * Discovers all custom commands in app/commands/ and registers
 * them as Commander sub-commands under `millas call <signature>`.
 *
 * Each file must export a class that extends Command:
 *
 *   module.exports = SendDigestCommand;
 *
 * CommandLoader reads the static `signature`, `description`, `args`,
 * and `options` properties to wire up Commander automatically —
 * no manual registration needed.
 */
class CommandLoader {
  /**
   * @param {string} commandsDir — absolute path to app/commands/
   */
  constructor(commandsDir) {
    this._dir      = commandsDir;
    this._commands = new Map(); // signature → CommandClass
  }

  /**
   * Scan commandsDir and load all valid Command subclasses.
   * Non-command files (missing signature / handle) are silently skipped.
   *
   * @returns {Map<string, typeof Command>}
   */
  load() {
    if (!fs.existsSync(this._dir)) return this._commands;

    const files = fs.readdirSync(this._dir)
      .filter(f => f.endsWith('.js') && !f.startsWith('.') && !f.startsWith('_'));

    for (const file of files) {
      try {
        const CommandClass = require(path.join(this._dir, file));
        if (!CommandClass || typeof CommandClass !== 'function') continue;
        if (!CommandClass.signature || typeof CommandClass.prototype.handle !== 'function') continue;
        this._commands.set(CommandClass.signature, CommandClass);
      } catch {
        // malformed file — skip silently; errors will surface when the command is run
      }
    }

    return this._commands;
  }

  /**
   * Register all loaded commands onto a Commander `program` instance.
   * Called by the `millas call` command to dynamically attach sub-commands.
   *
   * @param {import('commander').Command} program
   */
  register(program) {
    this.load();

    for (const [, CommandClass] of this._commands) {
      this._registerOne(program, CommandClass);
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _registerOne(program, CommandClass) {
    const sig  = CommandClass.signature;
    const desc = CommandClass.description || '';
    const args = CommandClass.args    || [];
    const opts = CommandClass.options || [];

    // Build Commander argument string: <required> or [optional]
    const argStr = args
      .map(a => a.default !== undefined ? `[${a.name}]` : `<${a.name}>`)
      .join(' ');

    const fullSig = argStr ? `${sig} ${argStr}` : sig;

    let cmd = program.command(fullSig).description(desc);

    // Register each option
    for (const opt of opts) {
      if (opt.default !== undefined) {
        cmd = cmd.option(opt.flag, opt.description || '', opt.default);
      } else {
        cmd = cmd.option(opt.flag, opt.description || '');
      }
    }

    // Action handler
    cmd.action(async (...cliArgs) => {
      // Commander passes positional args first, then the options object last
      const options  = cliArgs[cliArgs.length - 1];
      const posArgs  = cliArgs.slice(0, cliArgs.length - 1);

      // Build named arg map
      const argMap = {};
      for (let i = 0; i < args.length; i++) {
        argMap[args[i].name] = posArgs[i] !== undefined
          ? posArgs[i]
          : args[i].default;
      }

      const instance = new CommandClass();
      instance._hydrate(argMap, options);

      try {
        await instance.handle();
      } catch (err) {
        const chalk = require('chalk');
        process.stderr.write(chalk.red(`\n  ✖  ${sig} failed: ${err.message}\n`));
        if (process.env.DEBUG) process.stderr.write(err.stack + '\n');
        process.exit(1);
      }
    });
  }

  /**
   * Return all loaded command signatures.
   * @returns {string[]}
   */
  signatures() {
    this.load();
    return [...this._commands.keys()];
  }
}

module.exports = CommandLoader;
