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
    const Command = require('./Command');

    if (typeof CommandClass !== 'function' || !(CommandClass.prototype instanceof Command)) return;

    const commandInstance = new CommandClass(this.context);
    commandInstance._filename = path.basename(commandPath, '.js');

    // Collect subcommand names the user intends to register
    // by running onInit against a dry registrar that only records names
    const namespace = commandInstance.constructor.namespace
      || commandInstance._filename.toLowerCase();

    const userSubcommandNames = await this.#collectSubcommandNames(commandInstance, namespace);

    // Remove any conflicting built-in subcommands from Commander
    for (const fullName of userSubcommandNames) {
      const existing = this.context.program.commands.findIndex(c => c.name() === fullName);
      if (existing !== -1) this.context.program.commands.splice(existing, 1);
    }

    await commandInstance.register();
    this.commands.set(namespace, commandInstance);
  }

  async #collectSubcommandNames(instance, namespace) {
    if (typeof instance.onInit !== 'function') return [namespace];

    const names = [];
    const dryRegistrar = {
      _last: null,
      command(fn) { this._last = { name: fn.name || 'anonymous' }; return this; },
      name(n)    { if (this._last) this._last.name = n; return this; },
      // absorb all chaining methods
      ...Object.fromEntries(
        ['arg','str','num','bool','email','enum','option','argument',
         'description','aliases','before','after','validate','onError']
          .map(m => [m, function() { return this; }])
      ),
      _flush(ns) {
        if (this._last) {
          names.push(this._last.name === ns ? ns : `${ns}:${this._last.name}`);
          this._last = null;
        }
      },
    };

    // Wrap command() to flush previous before starting next
    const origCommand = dryRegistrar.command.bind(dryRegistrar);
    dryRegistrar.command = function(fn) {
      this._flush(namespace);
      return origCommand(fn);
    };

    await instance.onInit(dryRegistrar);
    dryRegistrar._flush(namespace);

    return names;
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
