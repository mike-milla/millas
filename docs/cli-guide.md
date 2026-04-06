# CLI Commands - Developer Guide

## Quick Start

### Simple Command

```js
// app/commands/InspectCommand.js
const { BaseCommand } = require('millas/console');

class InspectCommand extends BaseCommand {
  static description = 'Inspect project structure';

  async handle() {
    this.info('Inspecting project...');
    this.success('Done!');
  }
}

module.exports = InspectCommand;
```

**Usage:** `millas inspect`

---

## Command Groups (Subcommands)

### Basic Pattern

```js
// app/commands/UserCommand.js
const { BaseCommand } = require('millas/console');

class UserCommand extends BaseCommand {
  async onInit(register) {
    register
      .command(this.create, 'name', 'email', '--admin')
      .description('Create a new user');
    
    register
      .command(this.update, 'id', '--name', '--email')
      .description('Update user details');
    
    register
      .command(this.delete, 'id', '--confirm')
      .description('Delete a user');
  }

  async create(name, email, admin) {
    this.info(`Creating user: ${name}`);
    if (admin) this.warn('Creating as admin');
    this.success('User created!');
  }

  async update(id, name, email) {
    this.info(`Updating user ${id}`);
    this.success('User updated!');
  }

  async delete(id, confirm) {
    if (!confirm) {
      throw new Error('Use --confirm flag');
    }
    this.success('User deleted!');
  }
}

module.exports = UserCommand;
```

**Usage:**
```bash
millas user:create John john@example.com --admin
millas user:update 123 --name Jane --email jane@example.com
millas user:delete 123 --confirm
```

---

## Registration API

### `register.command(method, ...params)`

Register a subcommand with arguments and flags.

**Arguments:**
- Positional args: `'name'`, `'id'`, `'file'`
- Flags: `'--admin'`, `'--force'`, `'--confirm'`
- Order matters for args, not for flags

**Examples:**

```js
// Only positional args
register.command(this.create, 'name', 'email');
// Usage: millas user:create John john@example.com

// Args + flags
register.command(this.update, 'id', '--name', '--email', '--force');
// Usage: millas user:update 123 --name Jane --force

// Only flags
register.command(this.list, '--role', '--active', '--limit');
// Usage: millas user:list --role admin --active --limit 10

// Mixed order (args first recommended)
register.command(this.send, 'to', 'subject', '--cc', '--priority');
// Usage: millas email:send john@example.com "Hello" --cc jane@example.com
```

### `.description(text)`

Add description to the last registered command.

```js
register
  .command(this.create, 'name', 'email')
  .description('Create a new user account');
```

---

## Handler Signatures

**Handler parameters match registration order exactly:**

```js
async onInit(register) {
  register.command(this.update, 'id', '--name', '--email', '--force');
}

// Handler receives: id, name, email, force (in that order)
async update(id, name, email, force) {
  // id = positional arg value
  // name = value from --name flag
  // email = value from --email flag
  // force = boolean from --force flag
}
```

---

## Logging Helpers

```js
this.success('Operation completed');  // Green ✔
this.info('Processing...');           // Cyan
this.warn('Be careful!');             // Yellow ⚠
this.error('Failed!');                // Red ✖
this.logger.log('Custom message');    // Direct access
```

---

## Lifecycle Hooks

```js
class MyCommand extends BaseCommand {
  async before() {
    // Runs before validation and handler
    this.startTime = Date.now();
  }

  async validate(arg1, arg2) {
    // Validate inputs
    if (!arg1) throw new Error('arg1 required');
  }

  async handle(arg1, arg2) {
    // Main logic
  }

  async after() {
    // Runs after successful execution
    const duration = Date.now() - this.startTime;
    this.info(`Took ${duration}ms`);
  }

  async onError(err) {
    // Runs when error occurs (before handleError)
    // Cleanup logic here
  }
}
```

---

## Private Helpers

Use underscore prefix for private methods:

```js
class UserCommand extends BaseCommand {
  async onInit(register) {
    register.command(this.create, 'name', 'email');
    register.command(this.update, 'id', '--name');
  }

  // Private helper (not a command)
  async _getUser(id) {
    return this.container.resolve('Database')
      .table('users').find(id);
  }

  async create(name, email) {
    // Use helper
    const exists = await this._checkExists(email);
  }

  async update(id, name) {
    const user = await this._getUser(id);
    // update logic
  }
}
```

---

## DI Container Access

```js
async handle() {
  // Resolve services from container
  const db = this.container.resolve('Database');
  const cache = this.container.resolve('Cache');
  const mailer = this.container.resolve('Mail');
  
  // Use services
  const users = await db.table('users').get();
  await cache.set('users', users);
  await mailer.send('admin@example.com', 'Report', { users });
}
```

---

## Command Naming

### Auto-derived from class name:

| Class Name | Command Name |
|------------|--------------|
| `UserCommand` | `user:*` |
| `SendEmailCommand` | `send:email:*` |
| `User_ManagementCommand` | `user:management:*` |
| `UserManagementCommand` | `user:management:*` |
| `HTTP2RequestCommand` | `http2:request:*` |

### Filename-based (Django-style):

| Filename | Command Name |
|----------|--------------|
| `user-management.js` | `user:management:*` |
| `user_management.js` | `user:management:*` |
| `send-email.js` | `send:email:*` |

**Recommendation:** Use hyphens in filenames: `user-management.js`

---

## Simple Command Options

For commands without subcommands:

```js
class DeployCommand extends BaseCommand {
  static description = 'Deploy application';
  static aliases = ['d'];
  static options = [
    { flags: '--env <name>', description: 'Environment', defaultValue: 'staging' },
    { flags: '--force', description: 'Force deploy' }
  ];

  async handle(options) {
    this.info(`Deploying to ${options.env}`);
    if (options.force) {
      this.warn('Force mode enabled');
    }
    this.success('Deployed!');
  }
}
```

**Usage:**
```bash
millas deploy --env production --force
millas d --env staging
```

---

## Custom Arguments (Advanced)

Override `addArguments()` for full control:

```js
class ImportCommand extends BaseCommand {
  static description = 'Import data';

  addArguments(parser) {
    parser
      .argument('<file>', 'Input file')
      .argument('[output]', 'Output file', 'output.txt')
      .option('--format <type>', 'Format', 'json')
      .option('--force', 'Overwrite');
  }

  async handle(file, output, options) {
    this.info(`Importing ${file} to ${output}`);
    this.info(`Format: ${options.format}`);
  }
}
```

---

## Testing Commands

```js
const { program } = require('millas/console');

// Prevent process.exit in tests
program.exitOverride();

// Run command
await program.parseAsync(['node', 'millas', 'user:create', 'John', 'john@example.com']);
```

---

## Debug Mode

```bash
# Enable debug output
millas --debug user:create John john@example.com

# Shows:
# - Registered commands
# - Execution timing
# - Stack traces on errors
```

---

## Complete Example

```js
const { BaseCommand } = require('millas/console');

class EmailCommand extends BaseCommand {
  async onInit(register) {
    register
      .command(this.send, 'to', 'subject', '--cc', '--priority', '--dry-run')
      .description('Send an email');
    
    register
      .command(this.queue, '--to', '--subject', '--delay')
      .description('Queue an email for later');
  }

  async _validateEmail(email) {
    if (!email.includes('@')) {
      throw new Error('Invalid email');
    }
  }

  async send(to, subject, cc, priority, dryRun) {
    await this._validateEmail(to);
    
    if (dryRun) {
      this.warn('Dry run mode - no email sent');
      this.info(`Would send to: ${to}`);
      this.info(`Subject: ${subject}`);
      if (cc) this.info(`CC: ${cc}`);
      return;
    }

    const mailer = this.container.resolve('Mail');
    
    this.info(`Sending email to ${to}...`);
    await mailer.send(to, subject, { cc, priority });
    
    this.success('Email sent!');
  }

  async queue(to, subject, delay) {
    await this._validateEmail(to);
    
    const queue = this.container.resolve('Queue');
    
    await queue.push('SendEmailJob', { to, subject }, { delay });
    
    this.success(`Email queued for ${to}`);
  }
}

module.exports = EmailCommand;
```

**Usage:**
```bash
millas email:send john@example.com "Hello" --cc jane@example.com --priority
millas email:send john@example.com "Test" --dry-run
millas email:queue --to john@example.com --subject "Hello" --delay 3600
```
