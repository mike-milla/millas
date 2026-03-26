'use strict';

const chalk = require('chalk');
const path  = require('path');
const fs    = require('fs-extra');

module.exports = function (program) {

  // ── makemigrations ──────────────────────────────────────────────────────────
  program
    .command('makemigrations')
    .description('Detect model changes and generate migration files (never touches DB)')
    .option('--dry-run',  'Show what would be generated without writing files')
    .option('--noinput',  'Non-interactive mode — fails if dangerous fields need resolution')
    .action(async (options) => {
      try {
        const ctx  = getProjectContext();
        const Mk   = require('../orm/migration/Makemigrations');
        const mk   = new Mk(ctx.modelsPath, ctx.appMigPath, ctx.systemMigPath, {
          nonInteractive: options.noinput || false,
        });
        const result = await mk.run({ dryRun: options.dryRun });

        if (result.files.length === 0) {
          console.log(chalk.yellow(`\n  No changes detected.\n`));
        } else {
          if (options.dryRun) {
            console.log(chalk.cyan('\n  Would generate:'));
          } else {
            console.log(chalk.green('\n  Migrations generated:'));
          }
          result.files.forEach(f => console.log(chalk.cyan(`    + ${f}`)));
          result.ops.forEach(op => {
            // Match Django's +/-/~ prefix style exactly
            let prefix, label;
            switch (op.type) {
              case 'CreateModel': {
                const idxLines = [];
                for (const idx of (op.indexes || [])) {
                  const l = idx.name
                    ? `${idx.name} on ${op.table}`
                    : `on field(s) ${idx.fields.join(', ')} of model ${op.table}`;
                  idxLines.push(`      ${chalk.green('+')} Create index ${l}`);
                }
                for (const ut of (op.uniqueTogether || [])) {
                  idxLines.push(`      ${chalk.green('+')} Create constraint on ${op.table} (${ut.join(', ')})`);
                }
                prefix = chalk.green('+'); label = `Create model ${op.table}`;
                console.log(chalk.gray(`      ${prefix} ${label}`));
                idxLines.forEach(l => console.log(chalk.gray(l)));
                return; // return from forEach callback
              }
              case 'DeleteModel':
                prefix = chalk.red('-');   label = `Delete model ${op.table}`; break;
              case 'AddField':
                prefix = chalk.green('+'); label = `Add field ${op.column} to ${op.table}`; break;
              case 'RemoveField':
                prefix = chalk.red('-');   label = `Remove field ${op.column} from ${op.table}`; break;
              case 'AlterField':
                prefix = chalk.yellow('~'); label = `Alter field ${op.column} on ${op.table}`; break;
              case 'RenameField':
                prefix = chalk.yellow('~'); label = `Rename field ${op.oldColumn} on ${op.table} to ${op.newColumn}`; break;
              case 'RenameModel':
                prefix = chalk.yellow('~'); label = `Rename model ${op.oldTable} to ${op.newTable}`; break;
              case 'AddIndex': {
                const idx = op.index;
                const idxLabel = idx.name
                  ? `${idx.name} on ${op.table}`
                  : `on field(s) ${idx.fields.join(', ')} of model ${op.table}`;
                prefix = chalk.green('+'); label = `Create index ${idxLabel}`; break;
              }
              case 'RemoveIndex': {
                const idx = op.index;
                const idxLabel = idx.name
                  ? `${idx.name} from ${op.table}`
                  : `on field(s) ${idx.fields.join(', ')} of model ${op.table}`;
                prefix = chalk.red('-');   label = `Remove index ${idxLabel}`; break;
              }
              case 'RenameIndex':
                prefix = chalk.yellow('~'); label = `Rename index ${op.oldName} on ${op.table} to ${op.newName}`; break;
              case 'AlterUniqueTogether':
                prefix = chalk.yellow('~'); label = `Alter unique_together on ${op.table}`; break;
              default:
                prefix = chalk.gray(' ');   label = op.type;
            }
            console.log(chalk.gray(`      ${prefix} ${label}`));
          });
          if (!options.dryRun) {
            console.log(chalk.gray('\n  Run: millas migrate   to apply.\n'));
          } else {
            console.log();
          }
        }
      } catch (err) {
        bail('makemigrations', err);
      }
    });

  // ── migrate ─────────────────────────────────────────────────────────────────
  program
    .command('migrate')
    .description('Apply pending migrations in dependency order (never generates migrations)')
    .option('--fake <name>', 'Mark a migration as applied without running it')
    .action(async (options) => {
      try {
        const runner = await getRunner();

        if (options.fake) {
          const [source, name] = options.fake.includes(':')
            ? options.fake.split(':')
            : ['app', options.fake];
          const result = await runner.fake(source, name);
          console.log(chalk.green(`\n  Marked "${result.key}" as applied (fake).\n`));
          return;
        }

        const result = await runner.migrate();
        printResult(result.ran, 'Applying');
      } catch (err) {
        bail('migrate', err);
      } finally {
        await closeDb();
      }
    });

  // ── migrate:plan ─────────────────────────────────────────────────────────────
  program
    .command('migrate:plan')
    .description('Preview which migrations would run without applying them')
    .action(async () => {
      try {
        const runner  = await getRunner();
        const pending = await runner.plan();

        if (pending.length === 0) {
          console.log(chalk.yellow('\n  Nothing to migrate.\n'));
          return;
        }

        console.log(chalk.cyan('\n  Migration plan:\n'));
        pending.forEach(p => {
          const color = p.source === 'system' ? chalk.gray : chalk.cyan;
          console.log(color(`    ${p.key}`));
        });
        console.log();
      } catch (err) {
        bail('migrate:plan', err);
      } finally {
        await closeDb();
      }
    });

  // ── migrate:status ───────────────────────────────────────────────────────────
  program
    .command('migrate:status')
    .description('Show the status of all migrations')
    .action(async () => {
      try {
        const runner = await getRunner();
        const rows   = await runner.status();

        if (rows.length === 0) {
          console.log(chalk.yellow('\n  No migrations found.\n'));
          return;
        }

        const colW = Math.max(...rows.map(r => r.key.length)) + 2;
        console.log(`\n  ${'Migration'.padEnd(colW)}  ${'Status'.padEnd(10)}  Batch`);
        console.log(chalk.gray('  ' + '─'.repeat(colW + 20)));

        let lastSource = null;
        for (const row of rows) {
          if (row.source !== lastSource) {
            if (lastSource !== null) console.log();
            lastSource = row.source;
          }
          const status = row.status === 'Applied'
            ? chalk.green(row.status.padEnd(10))
            : chalk.yellow(row.status.padEnd(10));
          const batch = row.batch ? chalk.gray(String(row.batch)) : chalk.gray('—');
          const label = row.source === 'system'
            ? chalk.gray(row.key.padEnd(colW))
            : chalk.cyan(row.key.padEnd(colW));
          console.log(`  ${label}  ${status}  ${batch}`);
        }
        console.log();
      } catch (err) {
        bail('migrate:status', err);
      } finally {
        await closeDb();
      }
    });

  // ── migrate:rollback ─────────────────────────────────────────────────────────
  program
    .command('migrate:rollback')
    .description('Rollback the last batch of migrations')
    .option('--steps <n>', 'Number of batches to rollback', '1')
    .action(async (options) => {
      try {
        const runner = await getRunner();
        const result = await runner.rollback(Number(options.steps));
        printResult(result.rolledBack, 'Reverting');
      } catch (err) {
        bail('migrate:rollback', err);
      } finally {
        await closeDb();
      }
    });

  // ── migrate:fresh ────────────────────────────────────────────────────────────
  program
    .command('migrate:fresh')
    .description('Drop all tables and re-run every migration from scratch')
    .action(async () => {
      try {
        console.log(chalk.yellow('\n  ⚠  Dropping all tables…\n'));
        const runner = await getRunner();
        const result = await runner.fresh();
        printResult(result.ran, 'Applying');
      } catch (err) {
        bail('migrate:fresh', err);
      } finally {
        await closeDb();
      }
    });

  // ── migrate:reset ────────────────────────────────────────────────────────────
  program
    .command('migrate:reset')
    .description('Rollback ALL migrations')
    .action(async () => {
      try {
        const runner = await getRunner();
        const result = await runner.reset();
        printResult(result.rolledBack, 'Reverting');
      } catch (err) {
        bail('migrate:reset', err);
      } finally {
        await closeDb();
      }
    });

  // ── migrate:refresh ──────────────────────────────────────────────────────────
  program
    .command('migrate:refresh')
    .description('Rollback all then re-run all migrations')
    .action(async () => {
      try {
        const runner = await getRunner();
        const result = await runner.refresh();
        printResult(result.ran, 'Applying');
      } catch (err) {
        bail('migrate:refresh', err);
      } finally {
        await closeDb();
      }
    });

  // ── db:seed ──────────────────────────────────────────────────────────────────
  program
    .command('db:seed')
    .description('Run all database seeders')
    .action(async () => {
      try {
        const ctx        = getProjectContext();
        const seedersDir = ctx.seedersPath;

        if (!fs.existsSync(seedersDir)) {
          console.log(chalk.yellow('\n  No seeders directory found.\n'));
          return;
        }

        const files = fs.readdirSync(seedersDir)
          .filter(f => f.endsWith('.js') && !f.startsWith('.'))
          .sort();

        if (files.length === 0) {
          console.log(chalk.yellow('\n  No seeder files found.\n'));
          return;
        }

        const db = await getDbConnection();
        console.log();
        for (const file of files) {
          const seeder = require(path.join(seedersDir, file));
          await seeder.run(db);
          console.log(chalk.green(`  ✔  Seeded: ${file}`));
        }
        console.log();
      } catch (err) {
        bail('db:seed', err);
      } finally {
        await closeDb();
      }
    });
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getProjectContext() {
  const cwd = process.cwd();
  return {
    appMigPath:    path.join(cwd, 'database/migrations'),
    systemMigPath: path.join(__dirname, '../migrations/system'),
    seedersPath:   path.join(cwd, 'database/seeders'),
    modelsPath:    path.join(cwd, 'app/models'),
  };
}

async function getDbConnection() {
  const configPath = path.join(process.cwd(), 'config/database');
  if (!fs.existsSync(configPath + '.js')) {
    throw new Error('config/database.js not found. Are you inside a Millas project?');
  }
  const config         = require(configPath);
  const DatabaseManager = require('../orm/drivers/DatabaseManager');
  DatabaseManager.configure(config);
  return DatabaseManager.connection();
}

async function getRunner() {
  const MigrationRunner = require('../orm/migration/MigrationRunner');
  const ctx = getProjectContext();
  const db  = await getDbConnection();
  return new MigrationRunner(db, ctx.appMigPath, ctx.systemMigPath);
}

async function closeDb() {
  try {
    const DatabaseManager = require('../orm/drivers/DatabaseManager');
    await DatabaseManager.closeAll();
  } catch {}
}

function printResult(list, verb) {
  if (!list || list.length === 0) {
    console.log(chalk.yellow('\n  Nothing to do.\n'));
    return;
  }
  console.log(chalk.green(`\n  Running migrations:`));
  for (const entry of list) {
    const label = typeof entry === 'object' ? entry.label || entry.key : entry;
    const source = typeof entry === 'object' ? entry.source : null;
    const color = source === 'system' ? chalk.gray : chalk.cyan;
    console.log(color(`    ${verb} ${label}... OK`));
  }
  console.log();
}

function bail(cmd, err) {
  console.error(chalk.red(`\n  ✖  ${cmd} failed: ${err.message}\n`));
  if (process.env.DEBUG) console.error(err.stack);
  closeDb().finally(() => process.exit(1));
}