'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

/**
 * Command Registry
 * Auto-discovers and registers all commands
 */
class CommandRegistry {
  constructor(context) {
    this.context = context;
    this.commands = new Map();
  }

  /**
   * Discover and load all commands from a directory
   */
  async discoverCommands(commandsDir) {
    if (!require('fs').existsSync(commandsDir)) {
      return;
    }

    const fs = require('fs').promises;
    const files = (await fs.readdir(commandsDir))
      .filter(file => file.endsWith('.js') && file !== 'index.js');

    for (const file of files) {
      const commandPath = path.join(commandsDir, file);
      try {
        await this.loadCommand(commandPath);
      } catch (err) {
        console.log(err)
        console.error(chalk.yellow(`  ⚠ Failed to load command: ${file}`));
        if (process.env.APP_DEBUG) {
          console.error(err);
        }
      }
    }
  }

  /**
   * Load a single command file
   */
  async loadCommand(commandPath) {
    const CommandClass = require(commandPath);
    const BaseCommand = require('./BaseCommand');
    
    // Support both class-based and function-based commands
    if (typeof CommandClass === 'function') {
      // Check if it's a class extending BaseCommand
      if (CommandClass.prototype instanceof BaseCommand) {
        const commandInstance = new CommandClass(this.context);
        await commandInstance.register(); // Now async
        this.commands.set(commandPath, commandInstance);
      }
      // Legacy function-based command (backward compatibility)
      // else if (CommandClass.length === 1) { // expects (program) argument
      //   CommandClass(this.context.program);
      //   this.commands.set(commandPath, CommandClass);
      // }
      // Invalid command export
      // else {
      //   throw new Error(`Invalid command export in ${commandPath}. Must extend BaseCommand or export function(program).`);
      // }
    }
  }

  /**
   * Register commands from app/commands/ (user-defined commands)
   */
  async discoverUserCommands() {
    const userCommandsDir = path.join(this.context.cwd, 'app', 'commands');
    if (require('fs').existsSync(userCommandsDir)) {
      await this.discoverCommands(userCommandsDir);
    }
  }

  /**
   * Get all registered commands
   */
  getCommands() {
    return Array.from(this.commands.values());
  }
}

module.exports = CommandRegistry;
