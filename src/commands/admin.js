'use strict';

const path = require('path');
const fs = require('fs-extra');
const Hasher = require('../auth/Hasher');
const Command = require("../console/Command");
const DB = require("../facades/DB");

class AdminCommand extends Command {
  static description = 'Manage superusers and admin accounts';

  async onInit(register) {
    register
      .command(async (email, name, noinput) => {
        const { User } = await this.#resolveUserModel();

        this.info('Create Millas Superuser');
        this.newLine()

        // Email
        if (!email) email = await this.ask('Email address:', null, v => {
          const t = v.trim().toLowerCase();
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) || 'Enter a valid email address.';
        });
        email = email.trim().toLowerCase();

        const existing = await User.findBy('email', email);
        if (existing) {
          throw new Error(
            `A user with email "${email}" already exists.\n` +
            `  To grant staff access: update the record and set is_staff=true, is_superuser=true.\n` +
            `  To change their password: millas createsuperuser:changepassword --email ${email}`
          );
        }

        if (!name && !noinput)
          name = await this.ask('Display name (optional):', email.split('@')[0]);
        name = (name || '').trim() || email.split('@')[0];

        // Password
        let plainPassword;
        if (noinput) {
          plainPassword = process.env.ADMIN_PASSWORD;
          if (!plainPassword) {
            throw new Error('--noinput requires ADMIN_PASSWORD to be set in the environment.');
          }
        } else {
          plainPassword = await this.#promptPasswordWithBypass('Password:');
        }

        const hash = await Hasher.make(plainPassword);

        await User.create({
          email,
          name,
          password: hash,
          is_active: true,
          is_staff: true,
          is_superuser: true,
        });

        this.success(`Superuser "${email}" created successfully.`);
        this.info('Run: millas serve  then visit /admin');
      })
      .name('createsuperuser')
      .str('[email]', v => v.email().optional(), 'Email address (skip prompt)')
      .str('[name]', v => v.optional(), 'Display name (skip prompt)')
      .bool('noinput', 'Read password from ADMIN_PASSWORD env var, skip all prompts')
      .description('Create a superuser in the users table (interactive)');

    register
      .command(async (email) => {
        const { User } = await this.#resolveUserModel();

        if (!email) email = await this.ask('Email address:', null, v =>
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || 'Enter a valid email address.'
        );
        email = email.trim().toLowerCase();

        const user = await User.findBy('email', email);
        if (!user) throw new Error(`No user found with email "${email}".`);

        this.info(`Changing password for: ${user.email}`);
        this.newLine();

        const plain = await this.#promptPasswordWithBypass('New password:');

        const hash = await Hasher.make(plain);

        await User.where('id', user.id).update({
          password: hash,
          updated_at: new Date().toISOString(),
        });

        this.success(`Password updated for "${email}".`);
      })
      .name('changepassword')
      .str('[email]', v => v.email().optional(), 'Email address of the user')
      .description("Change a user's password in the users table")

    register
      .command(async () => {
        const { User } = await this.#resolveUserModel();

        const users = await User.where('is_staff', true).orderBy('id').get();

        if (!users.length) {
          this.warn('No staff users found.');
          this.info('Run: millas createsuperuser');
          return;
        }

        this.logger.log(this.style.info('\n  Staff / Superusers\n'));
        const colW = Math.max(...users.map(u => u.email.length)) + 2;
        this.logger.log(this.style.muted(`  ${'ID'.padEnd(5)}  ${'Email'.padEnd(colW)}  ${'Name'.padEnd(20)}  Active  Super`));
        this.logger.log(this.style.muted('  ' + '─'.repeat(colW + 42)));
        
        for (const u of users) {
          const active = u.is_active ? this.style.success('Yes   ') : this.style.danger('No    ');
          const sup = u.is_superuser ? this.style.success('Yes') : this.style.muted('No');
          this.logger.log(`  ${String(u.id).padEnd(5)}  ${this.style.info(u.email.padEnd(colW))}  ${(u.name || '—').padEnd(20)}  ${active}  ${sup}`);
        }
        this.logger.log('');
      })
      .name('listadmins')
      .description('List all staff/superusers from the users table');
  }

    async after(...args) {
        await DB.closeAll()
    }

    async #promptPasswordWithBypass(question) {
    while (true) {
      const pw = await this.secret(question, {
        confirm: { message: `${question.replace(':', '')} (again):`, error: 'Passwords do not match.', retry: true },
      });

      if (pw.length >= 8) return pw;

      this.warn('This password is too short. It must contain at least 8 characters.');
      const bypass = await this.confirm('Bypass password validation and create user anyway?', false);
      if (bypass) return pw;
    }
  }

  async #resolveUserModel() {  

      const db = DB.connection()

    let User;
    let authUserName = null;
    try {
      const appConfig = require(path.join(this.cwd, 'config/app'));
      authUserName = appConfig.auth_user || null;
    } catch { /* config/app.js missing or no auth_user key */ }

    if (authUserName) {
      try {
        const modelsIndex = require(path.join(this.cwd, 'app/models/index'));
        const resolved = modelsIndex[authUserName];
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
      try {
        User = require(path.join(this.cwd, 'app/models/User'));
      } catch {
        User = require('../auth/AuthUser');
      }
    }

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

}

module.exports = AdminCommand;
