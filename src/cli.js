'use strict';

// Load .env before anything else so all commands have access to env vars
require('dotenv').config();

const { Command } = require('commander');
const chalk = require('chalk');
const program = new Command();

program
  .enablePositionalOptions()
  .name('millas')
  .description(chalk.cyan('⚡ Millas — A modern batteries-included Node.js framework'))
  .version('0.2.12-beta-1');

// Load all command modules
require('./commands/new')(program);
require('./commands/serve')(program);
require('./commands/make')(program);
require('./commands/migrate')(program);
require('./commands/route')(program);
require('./commands/queue')(program);
require('./commands/createsuperuser')(program);
require('./commands/lang')(program);
require('./commands/key')(program);
require('./commands/call')(program);

// Unknown command handler
program.on('command:*', ([cmd]) => {
  console.error(chalk.red(`\n  Unknown command: ${chalk.bold(cmd)}\n`));
  console.log(`  Run ${chalk.cyan('millas --help')} to see available commands.\n`);
  process.exit(1);
});

module.exports = { program };