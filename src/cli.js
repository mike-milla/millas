'use strict';
// Set CLI mode globally for all commands
process.env.MILLAS_CLI_MODE = 'true';

// Load .env file early (before any commands are loaded)
const path = require('path');
const fs = require('fs');
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath, override: false });
}

const { Command } = require('commander');
const chalk = require('chalk');
const CommandContext = require('./console/CommandContext');
const CommandRegistry = require('./console/CommandRegistry');

// Initialize Commander program
const program = new Command();

program
  .enablePositionalOptions()
  .name('millas')
  .description(chalk.cyan('⚡ Millas — A modern batteries-included Node.js framework'))
  .version(require('../package.json').version)
  .option('--debug', 'Enable debug mode with verbose output');

// Configure help
program.configureHelp({
  sortSubcommands: true,
  sortOptions: true,
});

// Handle --debug flag globally
program.hook('preAction', (thisCommand) => {
  if (thisCommand.opts().debug) {
    process.env.DEBUG = 'true';
  }
});

// Create command context
const context = new CommandContext({
  program,
  cwd: process.cwd(),
  logger: console,
});

// Initialize command registry
const registry = new CommandRegistry(context);

// Bootstrap function (async)
async function bootstrap() {
  // Auto-discover and register built-in commands
  const commandsDir = path.join(__dirname, 'commands');
  await registry.discoverCommands(commandsDir);

  // Auto-discover user-defined commands (if inside a Millas project)
  if (context.isMillasProject()) {
    await registry.discoverUserCommands();
  }
}

// Unknown command handler with smart suggestions
program.on('command:*', ([cmd]) => {
  const Style = require('./console/Style');
  const style = new Style();
  
  // Check if this looks like a namespace (e.g., 'lang', 'user', 'migrate')
  const allCommands = program.commands.map(c => c.name());
  const namespaceCommands = allCommands.filter(c => c.startsWith(cmd + ':'));
  
  if (namespaceCommands.length > 0) {
    // User typed a namespace without subcommand
    console.error(style.danger(`\n  ✖ Command '${cmd}' requires a subcommand.\n`));
    console.log(style.info(`  Available ${cmd} commands:\n`));
    
    namespaceCommands.forEach(fullCmd => {
      const subCmd = fullCmd.substring(cmd.length + 1);
      const cmdObj = program.commands.find(c => c.name() === fullCmd);
      const desc = cmdObj ? cmdObj.description() : '';
      console.log(`    ${style.primary(fullCmd.padEnd(25))} ${style.secondary(desc)}`);
    });
    console.log('');
  } else {
    // Truly unknown command - suggest similar ones
    const similar = allCommands.filter(c => {
      const base = c.split(':')[0];
      return base.includes(cmd) || cmd.includes(base) || levenshtein(cmd, base) <= 2;
    });
    
    console.error(style.danger(`\n  ✖ Unknown command: ${style.bold(cmd)}\n`));
    
    if (similar.length > 0) {
      console.log(style.info('  Did you mean one of these?\n'));
      similar.slice(0, 5).forEach(s => {
        console.log(`    ${style.primary(s)}`);
      });
      console.log('');
    }
    
    console.log(`  Run ${style.primary('millas --help')} to see all available commands.\n`);
  }
  
  process.exitCode = 1;
});

// Simple Levenshtein distance for command suggestions
function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

module.exports = { program, context, registry, bootstrap };