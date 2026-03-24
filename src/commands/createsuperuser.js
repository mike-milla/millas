'use strict';

const chalk    = require('chalk');
const path     = require('path');
const fs       = require('fs-extra');
const readline = require('readline');
const Hasher   = require('../auth/Hasher');

const Log = require("../logger/internal")

const TAG = 'Create SuperUser';

module.exports = function (program) {

  // ── createsuperuser ────────────────────────────────────────────────────────
  program
    .command('createsuperuser')
    .description('Create a superuser in the users table (interactive)')
    .option('--email <email>', 'Email address (skip prompt)')
    .option('--name <n>',      'Display name (skip prompt)')
    .option('--noinput',       'Read password from ADMIN_PASSWORD env var, skip all prompts')
    .action(async (options) => {
      try {
        const { User, Auth } = await resolveUserModel();

        Log.i(TAG,chalk.cyan('Create Millas Superuser'));

        // ── Email ────────────────────────────────────────────────
        let email = options.email;
        if (!email) email = await prompt('  Email address: ');
        email = (email || '').trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new Error('Enter a valid email address.');
        }

        const existing = await User.findBy('email', email);
        if (existing) {
          throw new Error(
            `A user with email "${email}" already exists.\n` +
            `  To grant staff access: update the record and set is_staff=true, is_superuser=true.\n` +
            `  To change their password: millas changepassword --email ${email}`
          );
        }

        // ── Name ─────────────────────────────────────────────────
        let name = options.name;
        if (!name && !options.noinput) {
          name = await prompt('  Display name (optional, press Enter to skip): ');
        }
        name = (name || '').trim() || email.split('@')[0];

        // ── Password ─────────────────────────────────────────────
        let plainPassword;
        if (options.noinput) {
          plainPassword = process.env.ADMIN_PASSWORD;
          if (!plainPassword) {
            throw new Error('--noinput requires ADMIN_PASSWORD to be set in the environment.');
          }
        } else {
          plainPassword = await promptPassword('  Password: ');
          const confirm = await promptPassword('  Password (again): ');
          if (plainPassword !== confirm) throw new Error('Passwords do not match.');
        }

        validatePassword(plainPassword);

        // ── Create via Auth.register path but with staff flags ───
        // Hash manually so we can pass the flags in the same create() call.
        const hash = await Hasher.make(plainPassword);

        await User.create({
          email,
          name,
          password:     hash,
          is_active:    true,
          is_staff:     true,
          is_superuser: true,
        });

        Log.i(TAG,chalk.green(`✔ Superuser "${email}" created successfully.`));
        Log.i(TAG,chalk.gray(` Run: millas serve  then visit /admin`));
      } catch (err) {
        Log.e(TAG,chalk.red(`✖ ${err.message}`));
        Log.e(TAG,err.stack);
        process.exit(1);
      }
    });

  // ── changepassword ─────────────────────────────────────────────────────────
  program
    .command('changepassword')
    .description("Change a user's password in the users table")
    .option('--email <email>', 'Email address of the user')
    .action(async (options) => {
      try {
        const { User } = await resolveUserModel();

        let email = options.email;
        if (!email) email = await prompt('\n  Email address: ');
        email = (email || '').trim().toLowerCase();

        const user = await User.findBy('email', email);
        if (!user) throw new Error(`No user found with email "${email}".`);

        Log.i(TAG,chalk.cyan(`Changing password for: ${user.email}`));

        const plain   = await promptPassword('  New password: ');
        const confirm = await promptPassword('  New password (again): ');
        if (plain !== confirm) throw new Error('Passwords do not match.');
        validatePassword(plain);

        const hash = await Hasher.make(plain);

        await User.where('id', user.id).update({
          password:   hash,
          updated_at: new Date().toISOString(),
        });

        Log.i(TAG, chalk.green(`✔ Password updated for "${email}".`));
      } catch (err) {
        Log.e(TAG, chalk.red(`✖ ${err.message}`));
        process.exit(1);
      }
    });

  // ── listadmins ─────────────────────────────────────────────────────────────
  program
    .command('listadmins')
    .description('List all staff/superusers from the users table')
    .action(async () => {
      try {
        const { User } = await resolveUserModel();

        // Query for all staff users — is_staff=true
        const users = await User.where('is_staff', true).orderBy('id').get();

        if (!users.length) {
          Log.i(TAG, chalk.yellow('No staff users found.\n  Run: millas createsuperuser'));
          return;
        }

        Log.i(TAG, chalk.cyan('Staff / Superusers'));
        const colW = Math.max(...users.map(u => u.email.length)) + 2;
        Log.i(TAG, chalk.gray(`  ${'ID'.padEnd(5)}  ${'Email'.padEnd(colW)}  ${'Name'.padEnd(20)}  Active  Super`));
        Log.i(TAG, chalk.gray('  ' + '─'.repeat(colW + 42)));
        for (const u of users) {
          const active = u.is_active    ? chalk.green('Yes   ') : chalk.red('No    ');
          const sup    = u.is_superuser ? chalk.green('Yes')    : chalk.gray('No');
          Log.i(TAG, `  ${String(u.id).padEnd(5)}  ${chalk.cyan(u.email.padEnd(colW))}  ${(u.name || '—').padEnd(20)}  ${active}  ${sup}`);
        }
      } catch (err) {
        Log.e(TAG, chalk.red(`✖ ${err.message}`));
        process.exit(1);
      }
    });
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the User model using the same three-step priority as AuthServiceProvider:
 *
 *   1. config/app.js -> auth_user: 'ModelName'
 *      Looked up by name in app/models/index.js exports.
 *
 *   2. app/models/User.js  (conventional default path)
 *
 *   3. Built-in AuthUser   (abstract fallback)
 *
 * Also boots the DB connection and verifies the resolved model's table exists,
 * giving a clear error if migrations haven't been run yet.
 */

async function resolveUserModel() {
  const cwd        = process.cwd();
  const configPath = path.join(cwd, 'config/database.js');
  if (!fs.existsSync(configPath)) {
    throw new Error('config/database.js not found. Are you inside a Millas project?');
  }

  // Always require DatabaseManager from the project-local node_modules.
  // This ensures the same singleton is shared with the project's models,
  // avoiding the "not configured" error when millas is installed globally.
  const dbConfig = require(configPath);
  let DatabaseManager;
  try {
    DatabaseManager = require(path.join(cwd, 'node_modules/millas/src/orm/drivers/DatabaseManager'));
  } catch {
    DatabaseManager = require('../orm/drivers/DatabaseManager');
  }
  DatabaseManager.configure(dbConfig);
  const db = DatabaseManager.connection();

  // -- Step 1: auth_user from config/app.js --
  let User;
  let authUserName = null;
  try {
    const appConfig = require(path.join(cwd, 'config/app'));
    authUserName = appConfig.auth_user || null;
  } catch { /* config/app.js missing or no auth_user key */ }

  if (authUserName) {
    try {
      const modelsIndex = require(path.join(cwd, 'app/models/index'));
      const resolved    = modelsIndex[authUserName];
      if (!resolved) {
        throw new Error(
          `auth_user: '${authUserName}' not found in app/models/index.js.\n` +
          `  Available exports: ${Object.keys(modelsIndex).join(', ')}`
        );
      }
      User = resolved;
    } catch (err) {
      if (err.message.includes('auth_user:')) throw err;
      throw new Error(`Could not load app/models/index.js: ${err.message}`);
    }
  } else {
    // -- Step 2: try app/models/User.js --
    try {
      User = require(path.join(cwd, 'app/models/User'));
    } catch {
      // -- Step 3: abstract AuthUser fallback --
      User = require('../auth/AuthUser');
    }
  }

  // -- Verify the model's table exists (uses the model's own table name) --
  const table = User.table;
  if (table) {
    const tableExists = await db.schema.hasTable(table);
    if (!tableExists) {
      throw new Error(
        `Table "${table}" does not exist.\n\n` +
        `  Did you run migrations?\n` +
        `  Run: millas migrate\n`
      );
    }
  }

  return { User, db };
}

function validatePassword(pw) {
  if (!pw || pw.length < 8) {
    throw new Error('This password is too short. It must contain at least 8 characters.');
  }
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

function promptPassword(question) {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) return prompt(question).then(resolve);

    process.stdout.write(question);
    const rl = readline.createInterface({
      input:  process.stdin,
      output: new (require('stream').Writable)({ write(c, e, cb) { cb(); } }),
      terminal: true,
    });
    rl.question('', ans => { rl.close(); process.stdout.write('\n'); resolve(ans); });
  });
}