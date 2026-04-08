'use strict';

const path = require('path');
const fs = require('fs-extra');
const Command = require('../console/Command');
const DB = require('../facades/DB');

class MigrateCommand extends Command {
  static description = 'Database migration commands';
  static namespace = 'db';

  async onInit(register) {
    // makemigrations
    register
      .command(async (dryRun, noinput) => {
        const ctx = this.getProjectContext();
        const Mk = require('../orm/migration/Makemigrations');
        const mk = new Mk(ctx.modelsPath, ctx.appMigPath, ctx.systemMigPath, {
          nonInteractive: noinput || false,
        });
        const result = await mk.run({ dryRun });

        if (result.files.length === 0) {
          this.warn('No changes detected.');
        } else {
          if (dryRun) {
            this.info('\nWould generate:');
          } else {
            this.success('Migrations generated:');
          }
          result.files.forEach(f => this.info(`  + ${f}`));
          result.ops.forEach(op => this.printOperation(op));
          if (!dryRun) {
            this.info('\nRun: millas migrate   to apply.\n');
          }
        }
      })
      .name('makemigrations')
      .bool('dry-run', 'Show what would be generated without writing files')
      .bool('noinput', 'Non-interactive mode — fails if dangerous fields need resolution')
      .description('Detect model changes and generate migration files (never touches DB)');

    // migrate
    register
      .command(async (fakeAll, fake) => {
        const runner = await this.getRunner();

        if (fakeAll === true) {
          const pending = await runner.plan();
          if (pending.length === 0) {
            this.warn('No pending migrations to fake.');
            return;
          }
          
          for (const mig of pending) {
            await runner.fake(mig.source, mig.name);
            this.success(`Marked "${mig.key}" as applied (fake).`);
          }
          return;
        }

        if (fake) {
          const [source, name] = fake.includes(':') ? fake.split(':') : ['app', fake];
          const result = await runner.fake(source, name);
          this.success(`Marked "${result.key}" as applied (fake).`);
          return;
        }

        const result = await runner.migrate();
        this.printResult(result.ran, 'Applying');
      })
      .name('migrate')
      .bool('fake-all', 'Mark all pending migrations as applied without running them')
      .str('--fake', v => v.optional(), 'Mark a migration as applied without running it')
      .description('Apply pending migrations in dependency order (never generates migrations)')
      .after(async () => await DB.closeAll());

    // migrate:plan
    register
      .command(async () => {
        const runner = await this.getRunner();
        const pending = await runner.plan();

        if (pending.length === 0) {
          this.warn('Nothing to migrate.');
          return;
        }

        this.info('\nMigration plan:\n');
        pending.forEach(p => {
          const prefix = p.source === 'system' ? '  [system]' : '  ';
          this.info(`${prefix} ${p.key}`);
        });
      })
      .name('plan')
      .description('Preview which migrations would run without applying them')
      .after(async () => await DB.closeAll());

    // migrate:status
    register
      .command(async () => {
        const runner = await this.getRunner();
        const rows = await runner.status();

        if (rows.length === 0) {
          this.warn('No migrations found.');
          return;
        }

        const colW = Math.max(...rows.map(r => r.key.length)) + 2;
        this.info(`\n${'Migration'.padEnd(colW)}  ${'Status'.padEnd(10)}  Batch`);
        this.info('─'.repeat(colW + 20));

        let lastSource = null;
        for (const row of rows) {
          if (row.source !== lastSource) {
            if (lastSource !== null) this.info('');
            lastSource = row.source;
          }
          const status = row.status.padEnd(10);
          const batch = row.batch ? String(row.batch) : '—';
          const prefix = row.source === 'system' ? '[system]' : '';
          this.info(`${row.key.padEnd(colW)}  ${status}  ${batch} ${prefix}`);
        }
      })
      .name('status')
      .description('Show the status of all migrations')
      .after(async () => await DB.closeAll());

    // migrate:rollback
    register
      .command(async (steps) => {
        const runner = await this.getRunner();
        const result = await runner.rollback(Number(steps));
        this.printResult(result.rolledBack, 'Reverting');
      })
      .name('rollback')
      .num('--steps', v => v.optional().default(1), 'Number of batches to rollback')
      .description('Rollback the last batch of migrations')
      .after(async () => await DB.closeAll());

    // migrate:fresh
    register
      .command(async () => {
        this.warn('⚠  Dropping all tables…');
        const runner = await this.getRunner();
        const result = await runner.fresh();
        this.printResult(result.ran, 'Applying');
      })
      .name('fresh')
      .description('Drop all tables and re-run every migration from scratch')
      .after(async () => await DB.closeAll());

    // migrate:reset
    register
      .command(async () => {
        const runner = await this.getRunner();
        const result = await runner.reset();
        this.printResult(result.rolledBack, 'Reverting');
      })
      .name('reset')
      .description('Rollback ALL migrations')
      .after(async () => await DB.closeAll());

    // migrate:refresh
    register
      .command(async () => {
        const runner = await this.getRunner();
        const result = await runner.refresh();
        this.printResult(result.ran, 'Applying');
      })
      .name('refresh')
      .description('Rollback all then re-run all migrations')
      .after(async () => await DB.closeAll());

    // db:seed
    register
      .command(async () => {
        const ctx = this.getProjectContext();
        const seedersDir = ctx.seedersPath;

        if (!fs.existsSync(seedersDir)) {
          this.warn('No seeders directory found.');
          return;
        }

        const files = fs.readdirSync(seedersDir)
          .filter(f => f.endsWith('.js') && !f.startsWith('.'))
          .sort();

        if (files.length === 0) {
          this.warn('No seeder files found.');
          return;
        }

        const db = DB.connection();
        for (const file of files) {
          const seeder = require(path.join(seedersDir, file));
          await seeder.run(db);
          this.success(`Seeded: ${file}`);
        }
      })
      .name('seed')
      .description('Run all database seeders')
      .after(async () => await DB.closeAll());
  }

  getProjectContext() {
    return {
      appMigPath: path.join(this.cwd, 'database/migrations'),
      systemMigPath: path.join(__dirname, '../migrations/system'),
      seedersPath: path.join(this.cwd, 'database/seeders'),
      modelsPath: path.join(this.cwd, 'app/models'),
    };
  }

  async getRunner() {
    const MigrationRunner = require('../orm/migration/MigrationRunner');
    const ctx = this.getProjectContext();
    const db = DB.connection();
    return new MigrationRunner(db, ctx.appMigPath, ctx.systemMigPath);
  }

  printOperation(op) {
    let prefix, label;
    switch (op.type) {
      case 'CreateModel': {
        this.info(`    + Create model ${op.table}`);
        for (const idx of (op.indexes || [])) {
          const l = idx.name ? `${idx.name} on ${op.table}` : `on field(s) ${idx.fields.join(', ')} of model ${op.table}`;
          this.info(`      + Create index ${l}`);
        }
        for (const ut of (op.uniqueTogether || [])) {
          this.info(`      + Create constraint on ${op.table} (${ut.join(', ')})`);
        }
        return;
      }
      case 'DeleteModel': prefix = '-'; label = `Delete model ${op.table}`; break;
      case 'AddField': prefix = '+'; label = `Add field ${op.column} to ${op.table}`; break;
      case 'RemoveField': prefix = '-'; label = `Remove field ${op.column} from ${op.table}`; break;
      case 'AlterField': prefix = '~'; label = `Alter field ${op.column} on ${op.table}`; break;
      case 'RenameField': prefix = '~'; label = `Rename field ${op.oldColumn} on ${op.table} to ${op.newColumn}`; break;
      case 'RenameModel': prefix = '~'; label = `Rename model ${op.oldTable} to ${op.newTable}`; break;
      case 'AddIndex': {
        const idx = op.index;
        const idxLabel = idx.name ? `${idx.name} on ${op.table}` : `on field(s) ${idx.fields.join(', ')} of model ${op.table}`;
        prefix = '+'; label = `Create index ${idxLabel}`; break;
      }
      case 'RemoveIndex': {
        const idx = op.index;
        const idxLabel = idx.name ? `${idx.name} from ${op.table}` : `on field(s) ${idx.fields.join(', ')} of model ${op.table}`;
        prefix = '-'; label = `Remove index ${idxLabel}`; break;
      }
      case 'RenameIndex': prefix = '~'; label = `Rename index ${op.oldName} on ${op.table} to ${op.newName}`; break;
      case 'AlterUniqueTogether': prefix = '~'; label = `Alter unique_together on ${op.table}`; break;
      default: prefix = ' '; label = op.type;
    }
    this.info(`    ${prefix} ${label}`);
  }

  printResult(list, verb) {
    if (!list || list.length === 0) {
      this.warn('Nothing to do.');
      return;
    }
    this.success('Running migrations:');
    for (const entry of list) {
      const label = typeof entry === 'object' ? entry.label || entry.key : entry;
      const source = typeof entry === 'object' ? entry.source : null;
      const prefix = source === 'system' ? '[system]' : '';
      this.info(`  ${verb} ${label}... OK ${prefix}`);
    }
  }
}

module.exports = MigrateCommand;
