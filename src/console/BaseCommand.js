'use strict';

const chalk = require('chalk');
const Style = require('./Style');
const AppCommand = require('./AppCommand');
const v = require("../core/validation");

/**
 * @typedef {Object} CommandContext
 * @property {Object} program - Commander program instance
 * @property {Object} container - DI container
 * @property {Object} logger - Logger instance
 * @property {string} cwd - Current working directory
 */

/**
 * @callback StringValidatorCallback
 * @param {import('../validation/types').StringValidator} validator - String validator instance
 * @returns {import('../validation/types').StringValidator}
 */

/**
 * @callback NumberValidatorCallback
 * @param {import('../validation/types').NumberValidator} validator - Number validator instance
 * @returns {import('../validation/types').NumberValidator}
 */

/**
 * @callback EmailValidatorCallback
 * @param {import('../validation/types').EmailValidator} validator - Email validator instance
 * @returns {import('../validation/types').EmailValidator}
 */

/**
 * @callback BooleanValidatorCallback
 * @param {import('../validation/types').BooleanValidator} validator - Boolean validator instance
 * @returns {import('../validation/types').BooleanValidator}
 */

/**
 * @callback ValidatorCallback
 * @param {typeof import('../core/validation')} v - Validation module with factory functions
 * @returns {import('../validation/BaseValidator').BaseValidator}
 */

/**
 * Base class for all CLI commands
 */
class BaseCommand extends AppCommand {
  static namespace = ''; // Override to set a fixed command name

   /**
   * Short description shown in `millas --help` and `millas list`.
   *
   * @type {string}
   */
  static description = '';
  static aliases = [];
  static options = [];

  constructor(context) {
    super(context);
    this.style = new Style();
  }

  /**
   * Initialize commands - override in subclasses
   * @param {CommandRegistrar} register - Command registration helper
   * @returns {Promise<void>}
   */
  async onInit(register) {
    // Override in subclasses to register commands
  }

  /**
   * Derive command name from filename (set by CommandRegistry).
   * Override with `static namespace = 'name'` to use a fixed name.
   */
  static getCommandName() {
    if (this.namespace) return this.namespace;

    if (!this._filenameHint) throw new Error(`Cannot derive command name for ${this.name} — no filename hint set.`);

    return this._filenameHint
      .replace(/[-_]/g, ':')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1:$2')
      .replace(/([a-z\d])([A-Z])/g, '$1:$2')
      .toLowerCase();
  }

  getSubcommands() {
    const proto = Object.getPrototypeOf(this);
    return Object.getOwnPropertyNames(proto)
      .filter(name => {
        return typeof proto[name] === 'function' &&
               name !== 'constructor' &&
               !['register', 'handle', 'validate', 'before', 'after', 'onError', 'onInit', 'addArguments'].includes(name) &&
               !name.startsWith('_');
      });
  }

  /**
   * Register command with Commander
   * Calls onInit() for subcommands or registerSimpleCommand() for simple commands
   */
  async register() {
    // Expose filename to static getCommandName()
    if (this._filename) this.constructor._filenameHint = this._filename;
    const commandName = this.constructor.getCommandName();
    const subcommands = this.getSubcommands();

    if (typeof this.onInit === 'function') {
      const registrar = new CommandRegistrar(this, commandName);
      await this.onInit(registrar);
      
      // Find subcommand matching base name and make it the default
      for (const cmd of registrar.commands) {
        const subName = cmd.fullCommand.split(':')[1];
        if (subName === commandName) {
          // Register as base command (index/default)
          cmd.fullCommand = commandName;
          break;
        }
      }
      
      registrar.finalizeAll();
      return;
    }

    if (subcommands.length === 0 || subcommands.includes('handle')) {
      this.registerSimpleCommand(commandName);
    } else {
      throw new Error(
        `Command ${commandName} has subcommands but no onInit() method. ` +
        `Add: async onInit(register) { register.command(this.${subcommands[0]}); }`
      );
    }
  }

  registerSimpleCommand(commandName) {
    const cmd = this.program
      .command(commandName)
      .description(this.constructor.description || 'No description provided');

    if (this.constructor.aliases && this.constructor.aliases.length) {
      cmd.aliases(this.constructor.aliases);
    }

    if (this.constructor.options && this.constructor.options.length) {
      for (const opt of this.constructor.options) {
        if (opt.flags) {
          cmd.option(opt.flags, opt.description || '', opt.defaultValue);
        }
      }
    }

    if (typeof this.addArguments === 'function') {
      this.addArguments(cmd);
    }

    cmd.action(this.asyncHandler(this.handle.bind(this)));
  }

  /**
   * Override to add custom arguments/options
   * @param {Command} parser - Commander command instance
   */
  addArguments(parser) {}

  /**
   * Main command handler - must be implemented by subclasses
   */
  async handle(...args) {
    throw new Error(`Command ${this.constructor.name} must implement handle() method`);
  }

  asyncHandler(fn) {
    return async (...args) => {
      const startTime = Date.now();
      try {
        await this.before(...args);
        await this.validate(...args);
        const result = await fn.call(this, ...args);
        await this.after(...args);
        
        if (process.env.DEBUG) {
          this.info(`Completed in ${Date.now() - startTime}ms`);
        }
        return result;
      } catch (err) {
        await this.onError(err);
        this.handleError(err);
      }
    };
  }

  /**
   * Lifecycle hook: runs before validation and handler
   */
  async before(...args) {}
  
  /**
   * Lifecycle hook: runs after successful execution
   */
  async after(...args) {}
  
  /**
   * Lifecycle hook: runs when error occurs
   */
  async onError(err) {}
  
  /**
   * Validate command inputs before execution
   */
  async validate(...args) {}

  handleError(err) {
    if (err.code === 'ENOENT') {
      this.logger.error(this.style.danger(`\n  ✖ File not found: ${err.path}\n`));
    } else if (err.code === 'EEXIST') {
      this.logger.error(this.style.danger(`\n  ✖ File already exists: ${err.path}\n`));
    } else {
      this.logger.error(this.style.danger(`\n  ✖ Error: ${err.message}\n`));
      if (process.env.DEBUG) {
        this.logger.error(err.stack);
      }
    }
    
    if (this.program?.exitOverride || process.env.NODE_ENV === 'test') {
      throw err;
    }
    
    process.exitCode = 1;
  }
/**
   * Success message (green ✔).
   * @param {string} message
   */
  success(message) {
    this.logger.log(this.style.success(`\n  ✔ ${message}\n`));
  }
  /**
   * Informational message (cyan).
   * @param {string} message
   */
  info(message) {
    this.logger.log(this.style.info(`  ${message}`));
  }
/**
   * Warning message (yellow ⚠).
   * @param {string} message
   */
  warn(message) {
    this.logger.log(this.style.warning(`  ⚠ ${message}`));
  }
/**
   * Error message (red ✖). Does NOT exit — use fail() to exit.
   * @param {string} message
   */
  error(message) {
    this.logger.error(this.style.danger(`  ✖ ${message}`));
  }

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
   * Dimmed / comment message.
   * @param {string} msg
   */
  comment(msg) {
    this.line(chalk.dim(`// ${msg}`));
  }
    /**
   * Print an error and exit with code 1.
   * @param {string} msg
   */
  fail(msg) {
    this.error(msg);
    process.exit(1);
  }
}

/**
 * CommandRegistrar - Helper for explicit command registration
 */
class CommandRegistrar {
  constructor(baseCommand, baseName) {
    this.baseCommand = baseCommand;
    this.baseName = baseName;
    this.program = baseCommand.program;
    this.lastCommand = null;
    this.commands = [];
  }

  /**
   * Start registering a command
   * 
   * @param {Function} fn - The method to register (can be arrow function or method)
   * @returns {CommandRegistrar} - For chaining
   * 
   * @example
   * // Using a method
   * register.command(this.create)
   *   .arg('name', string().required(), 'User name')
   * 
   * // Using inline arrow function
   * register.command(async (name) => {
   *   this.success(`Created ${name}`);
   * })
   *   .arg('name', 'Item name')
   *   .name('create')
   */
  command(fn) {
    if (this.lastCommand) {
      this.#finalize();
    }

    // Derive method name from function name, or use 'anonymous' for arrow functions
    const methodName = fn.name || 'anonymous';
    const fullCommand = `${this.baseName}:${methodName}`;
    const defaultDescription = methodName !== 'anonymous' 
      ? `${methodName.charAt(0).toUpperCase()}${methodName.slice(1)} command`
      : 'Command';
    
    this.lastCommand = {
      fn,
      methodName,
      fullCommand,
      description: defaultDescription,
      args: [],
      aliases: [],
      hooks: {
        before: null,
        after: null,
        validate: null,
        onError: null
      }
    };

    
    this.commands.push(this.lastCommand);
    return this;
  }

  /**
   * Add an argument or flag
   * 
   * @param {string} name - Argument name (use '--' prefix for flags)
   * @param {import('../validation/BaseValidator').BaseValidator|ValidatorCallback|string} [validatorOrDescription] - Validator instance, callback, or description
   * @param {string} [description] - Optional description
   * @returns {CommandRegistrar} - For chaining
   * 
   * @example
   * .arg('name', v => v.string().required().min(2), 'User full name')
   * .arg('email', v => v.email().required())
   * .arg('--admin', v => v.boolean(), 'Create as admin')
   * .arg('--force', 'Force creation')  // boolean by default
   */
  arg(name, validatorOrDescription, description) {
    if (!this.lastCommand) {
      throw new Error('No command to add arg to. Call command() first.');
    }

    const isFlag = name.startsWith('--') || name.startsWith('-');
    const isOptional = /^\[.*\]$/.test(name);
    const cleanName = name
    .replace(/^--?/, '')
    .replace(/^\[|]$/g, '');let validator = null;
    let desc = description;


    
    if (typeof validatorOrDescription === 'string') {
      desc = validatorOrDescription;
    } else if (typeof validatorOrDescription === 'function') {
      // Callback receives validation module
      validator = validatorOrDescription(require("../core/validation"));
    } else if (validatorOrDescription && typeof validatorOrDescription === 'object') {
      // Direct validator object
      validator = validatorOrDescription;
      if (!desc) {
        desc = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
      }
    }
     if (isOptional && validator && typeof validator.optional === 'function') {
    validator = validator.optional();
  }
    
    this.lastCommand.args.push({
      name: cleanName,
      originalName: name,
      isFlag,
      validator,
      description: desc || cleanName
    });
    
    return this;
  }

  /**
   * Alias for arg() - adds an argument
   * @param {string} name - Argument name
   * @param {import('../validation/BaseValidator').BaseValidator|ValidatorCallback|string} [validatorOrDescription] - Validator instance, callback, or description
   * @param {string} [description] - Optional description
   * @returns {CommandRegistrar}
   */
  argument(name, validatorOrDescription, description) {
    return this.arg(name, validatorOrDescription, description);
  }

  /**
   * Alias for arg() with '--' prefix - adds an option/flag
   * @param {string} name - Option name (without --)
   * @param {import('../validation/BaseValidator').BaseValidator|ValidatorCallback|string} [validatorOrDescription] - Validator instance, callback, or description
   * @param {string} [description] - Optional description
   * @returns {CommandRegistrar}
   */
  option(name, validatorOrDescription, description) {
    if (!name.startsWith('--') && !name.startsWith('-')) {
      name = '--' + name;
    }
    return this.arg(name, validatorOrDescription, description);
  }


  /**
   * Add a string argument with optional validator
   * @param {string} name - Argument name
   * @param {StringValidatorCallback|string} [validatorOrDescription] - Validator callback or description
   * @param {string} [description] - Optional description
   * @returns {CommandRegistrar}
   * @example
   * .str('name', 'User name')
   * .str('email', v => v.min(5).max(100), 'Email address')
   */
  str(name, validatorOrDescription, description) {
    if (typeof validatorOrDescription === 'function') {
      return this.arg(name, v => {
        const base = v.string().required();
        return validatorOrDescription(base);
      }, description);
    }
    return this.arg(name, v => v.string().required(), validatorOrDescription || description);
  }

  /**
   * Add a number argument with optional validator
   * @param {string} name - Argument name
   * @param {NumberValidatorCallback|string} [validatorOrDescription] - Validator callback or description
   * @param {string} [description] - Optional description
   * @returns {CommandRegistrar}
   * @example
   * .num('age', 'User age')
   * .num('port', v => v.min(1000).max(9999), 'Port number')
   */
  num(name, validatorOrDescription, description) {
    if (typeof validatorOrDescription === 'function') {
      return this.arg(name, v => {
        const base = v.number().required();
        return validatorOrDescription(base);
      }, description);
    }
    return this.arg(name, v => v.number().required(), validatorOrDescription || description);
  }

  /**
   * Add a boolean flag
   * @param {string} name - Flag name (without --)
   * @param {BooleanValidatorCallback|string} [validatorOrDescription] - Validator callback or description
   * @param {string} [description] - Optional description
   * @returns {CommandRegistrar}
   * @example
   * .bool('force', 'Force operation')
   * .bool('verbose', 'Verbose output')
   */
  bool(name, validatorOrDescription, description) {
    if (!name.startsWith('--') && !name.startsWith('-')) {
      name = '--' + name;
    }
    if (typeof validatorOrDescription === 'function') {
      return this.arg(name, v => {
        const base = v.boolean();
        return validatorOrDescription(base);
      }, description);
    }
    return this.arg(name, v => v.boolean(), validatorOrDescription || description);
  }

  /**
   * Add an email argument
   * @param {string} name - Argument name
   * @param {EmailValidatorCallback|string} [validatorOrDescription] - Validator callback or description
   * @param {string} [description] - Optional description
   * @returns {CommandRegistrar}
   * @example
   * .email('email', 'User email address')
   * .email('email', v => v.domain('example.com'), 'Company email')
   */
  email(name, validatorOrDescription, description) {
    if (typeof validatorOrDescription === 'function') {
      return this.arg(name, v => {
        const base = v.email().required();
        return validatorOrDescription(base);
      }, description);
    }
    return this.arg(name, v => v.email().required(), validatorOrDescription || description);
  }

  /**
   * Add an enum argument
   * @param {string} name - Argument name
   * @param {Array<string>} values - Allowed values
   * @param {string} [description] - Optional description
   * @returns {CommandRegistrar}
   * @example
   * .enum('role', ['admin', 'user', 'guest'], 'User role')
   */
  enum(name, values, description) {
    return this.arg(name, v => v.enum(values).required(), description);
  }

  /**
   * Set description for the command
   */
  description(desc) {
    if (!this.lastCommand) {
      throw new Error('No command to set description for. Call command() first.');
    }
    
    this.lastCommand.description = desc;
    return this;
  }

  /**
   * Set aliases for the subcommand
   * 
   * @param {string[]} aliases - Array of alias names
   * @returns {CommandRegistrar} - For chaining
   * 
   * @example
   * register.command(this.create)
   *   .aliases(['c', 'new'])
   */
  aliases(aliasArray) {
    if (!this.lastCommand) {
      throw new Error('No command to set aliases for. Call command() first.');
    }
    
    this.lastCommand.aliases = aliasArray;
    return this;
  }

  /**
   * Override the command name
   * 
   * @param {string} customName - Custom command name (without base)
   * @returns {CommandRegistrar} - For chaining
   * 
   * @example
   * register.command(this.update)
   *   .name('modify')
   *   // Results in: user:modify instead of user:update
   */
  name(customName) {
    if (!this.lastCommand) {
      throw new Error('No command to set name for. Call command() first.');
    }
    
    this.lastCommand.fullCommand = `${this.baseName}:${customName}`;
    return this;
  }

  before(fn) {
    if (!this.lastCommand) {
      throw new Error('No command to set before hook for. Call command() first.');
    }
    
    this.lastCommand.hooks.before = fn;
    return this;
  }

  after(fn) {
    if (!this.lastCommand) {
      throw new Error('No command to set after hook for. Call command() first.');
    }
    
    this.lastCommand.hooks.after = fn;
    return this;
  }

  validate(fn) {
    if (!this.lastCommand) {
      throw new Error('No command to set validate hook for. Call command() first.');
    }
    
    this.lastCommand.hooks.validate = fn;
    return this;
  }

  onError(fn) {
    if (!this.lastCommand) {
      throw new Error('No command to set onError hook for. Call command() first.');
    }
    
    this.lastCommand.hooks.onError = fn;
    return this;
  }

  finalizeAll() {
    this.#finalizeAll();
  }

  #finalizeAll() {
    for (const cmd of this.commands) {
      if (!cmd._finalized) {
        this.lastCommand = cmd;
        this.#finalize();
      }
    }
  }

  #finalize() {

    if (!this.lastCommand || this.lastCommand._finalized) return;
    
    const { fn, fullCommand, description, args, hooks, aliases } = this.lastCommand;

    
    let commandStr = fullCommand;
    const positionalArgs = args.filter(a => !a.isFlag);

    const flagArgs = args.filter(a => a.isFlag);
    
    // Build command string with positional args - all optional, validators handle required checks
    for (const arg of positionalArgs) {
      commandStr += ` [${arg.name}]`;
    }
    
    const cmd = this.program
      .command(commandStr)
      .description(description);
    
    // Add subcommand aliases
    if (aliases && aliases.length > 0) {
      cmd.aliases(aliases);
    }
    
    for (const arg of flagArgs) {
      const flagName = `--${arg.name}`;
      const negatedFlagName = `--no-${arg.name}`;

      // Default validator for flags without one: boolean()
      if (!arg.validator) {
        arg.validator = v.boolean();
      }
      
      // Detect boolean validator
      const isBoolean = arg.validator._type === 'boolean';

      if (isBoolean) {
        cmd.option(flagName, arg.description);
        cmd.option(negatedFlagName, `Disable ${arg.name}`);
      } else {
        cmd.option(`${flagName} [value]`, arg.description);
      }
    }
    
    if (process.env.AP_DEBUG) {
      console.log(`Registered: ${commandStr}`);
      console.log(`  Args: ${args.map(a => a.originalName).join(', ')}`);
    }
    
    cmd.action(async (...cmdArgs) => {


      const cmdOptions = cmdArgs[cmdArgs.length - 1];
      const options = cmdOptions.opts ? cmdOptions.opts() : cmdOptions;
      const positionalValues = cmdArgs.slice(0, -1);
      
      const handlerArgs = [];
      const validationData = {};
      let positionalIndex = 0;
      
      for (const arg of args) {
        let value = undefined;
        
        if (arg.isFlag) {
          value = options[arg.name];
        } else {
          value = positionalValues[positionalIndex++];
        }

        
        handlerArgs.push(value);
        validationData[arg.name] = value;
      }
      
      const startTime = Date.now();
      
      try {
        if (hooks.before) {
          await hooks.before.call(this.baseCommand, ...handlerArgs);
        } else if (typeof this.baseCommand.before === 'function') {
          await this.baseCommand.before(...handlerArgs);
        }
        
        for (const arg of args) {
          // Default validator for positional args without one: string().required()
          if (!arg.validator && !arg.isFlag) {
            arg.validator = v.string().required();
          }
          
          let value = validationData[arg.name];
          
          // Apply default value if undefined and validator has default
          if (value === undefined && arg.validator && arg.validator._default !== undefined) {
            value = arg.validator._default;
            validationData[arg.name] = value;
            handlerArgs[args.indexOf(arg)] = value;
          }
          
          try {
            const res = await arg.validator.run(value, arg.name);
            if (res.error)
              throw new Error(res.error);
          } catch (err) {
            throw new Error(`Validation failed for '${arg.name}': ${err.message}`);
          }
        }
        
        if (hooks.validate) {
          await hooks.validate.call(this.baseCommand, ...handlerArgs);
        } else if (typeof this.baseCommand.validate === 'function') {
          await this.baseCommand.validate(...handlerArgs);
        }
        
        const result = await fn.call(this.baseCommand, ...handlerArgs);
        
        if (hooks.after) {
          await hooks.after.call(this.baseCommand, ...handlerArgs);
        } else if (typeof this.baseCommand.after === 'function') {
          await this.baseCommand.after(...handlerArgs);
        }
        
        if (process.env.DEBUG) {
          this.baseCommand.info(`Completed in ${Date.now() - startTime}ms`);
        }
        
        return result;
      } catch (err) {
        if (hooks.onError) {
          await hooks.onError.call(this.baseCommand, err);
        } else if (typeof this.baseCommand.onError === 'function') {
          await this.baseCommand.onError(err);
        }
        
        this.baseCommand.handleError(err);
      }
    });
    
    this.lastCommand._finalized = true;
  }
}

module.exports = BaseCommand;
