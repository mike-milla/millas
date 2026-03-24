'use strict';

const chalk = require('chalk');
const path  = require('path');
const fs    = require('fs');

/**
 * `millas call <signature> [args] [options]`
 *
 * Discovers all commands in app/commands/, then either:
 *   - Runs the matched command directly, OR
 *   - Lists all available commands when no signature is given
 *
 * Each command in app/commands/ must extend Command and have a static `signature`.
 *
 * ── Examples ─────────────────────────────────────────────────────────────────
 *
 *   millas call                        — list all custom commands
 *   millas call email:digest           — run with defaults
 *   millas call email:digest weekly    — positional arg
 *   millas call email:digest --dry-run — flag
 */
module.exports = function (program) {
  const commandsDir = path.resolve(process.cwd(), 'app/commands');
  const CommandLoader = require('../console/CommandLoader');

  // ── millas list ────────────────────────────────────────────────────────────
  program
    .command('list')
    .description('List all available custom commands')
    .action(() => {
      if (!fs.existsSync(commandsDir)) {
        console.log(chalk.yellow('\n  No app/commands/ directory found.\n'));
        console.log(chalk.dim('  Run: millas make:command <Name>  to create your first command.\n'));
        return;
      }

      const loader = new CommandLoader(commandsDir);
      loader.load();
      const sigs = loader.signatures();

      if (sigs.length === 0) {
        console.log(chalk.yellow('\n  No custom commands found in app/commands/.\n'));
        console.log(chalk.dim('  Run: millas make:command <Name>  to create one.\n'));
        return;
      }

      const maxLen = Math.max(...sigs.map(s => s.length));

      console.log(chalk.bold('\n  Available commands:\n'));
      for (const [sig, CommandClass] of loader._commands) {
        const desc = CommandClass.description || '';
        console.log(
          '  ' + chalk.cyan(sig.padEnd(maxLen + 2)) +
          chalk.dim(desc)
        );
      }
      console.log();
    });

  // ── millas call <signature> ────────────────────────────────────────────────
  // Uses Commander's allowUnknownOption + passThroughOptions so we can
  // forward all args/options to the matched command.
  const callCmd = program
    .command('call <signature> [args...]')
    .description('Run a custom command from app/commands/')
    .allowUnknownOption(true)
    .passThroughOptions(true)
    .action((signature, extraArgs, options, cmd) => {
      if (!fs.existsSync(commandsDir)) {
        console.error(chalk.red('\n  ✖  No app/commands/ directory found.\n'));
        console.error(chalk.dim('  Run: millas make:command <Name>  to create your first command.\n'));
        process.exit(1);
      }

      const loader = new CommandLoader(commandsDir);
      loader.load();

      const CommandClass = loader._commands.get(signature);

      if (!CommandClass) {
        const sigs = loader.signatures();
        console.error(chalk.red(`\n  ✖  Unknown command: ${chalk.bold(signature)}\n`));
        if (sigs.length) {
          console.log(chalk.dim('  Available commands:'));
          for (const s of sigs) console.log(chalk.dim(`    ${s}`));
        } else {
          console.log(chalk.dim('  No custom commands found. Run: millas make:command <Name>'));
        }
        console.log();
        process.exit(1);
      }

      // Re-parse args + options against the command's own definition
      const { Command: CommanderCmd } = require('commander');
      const sub = new CommanderCmd(signature);

      const argsDef = CommandClass.args    || [];
      const optsDef = CommandClass.options || [];

      for (const a of argsDef) {
        sub.argument(
          a.default !== undefined ? `[${a.name}]` : `<${a.name}>`,
          a.description || '',
          a.default
        );
      }
      for (const o of optsDef) {
        if (o.default !== undefined) {
          sub.option(o.flag, o.description || '', o.default);
        } else {
          sub.option(o.flag, o.description || '');
        }
      }

      // Combine extraArgs back with the raw unknown options Commander captured
      const rawArgs = [...(extraArgs || []), ...(cmd.args || [])];

      // Re-deduplicate (Commander may put some into cmd.args already)
      const allRaw = [...new Set([...extraArgs, ...rawArgs])];

      sub.parse([process.execPath, signature, ...allRaw]);

      const parsedOpts    = sub.opts();
      const parsedPosArgs = sub.args;

      const argMap = {};
      for (let i = 0; i < argsDef.length; i++) {
        argMap[argsDef[i].name] = parsedPosArgs[i] !== undefined
          ? parsedPosArgs[i]
          : argsDef[i].default;
      }

      const instance = new CommandClass();
      instance._hydrate(argMap, parsedOpts);

      Promise.resolve()
        .then(() => instance.handle())
        .catch(err => {
          console.error(chalk.red(`\n  ✖  ${signature} failed: ${err.message}\n`));
          if (process.env.DEBUG) console.error(err.stack);
          process.exit(1);
        });
    });
};
