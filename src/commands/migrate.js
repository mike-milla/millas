'use strict';

const chalk = require('chalk');
const path  = require('path');
const fs    = require('fs-extra');

module.exports = function (program) {

  // ── makemigrations ──────────────────────────────────────────────────────────
  program
    .command('makemigrations')
    .description('Scan model files, detect schema changes, generate migration files')
    .action(async () => {
      try {
        const ctx            = getProjectContext();
        const ModelInspector = require('../orm/migration/ModelInspector');
        const inspector      = new ModelInspector(
          ctx.modelsPath,
          ctx.migrationsPath,
          ctx.snapshotPath,
        );
        const result = await inspector.makeMigrations();

        if (result.files.length === 0) {
          console.log(chalk.yellow(`\n  ${result.message}\n`));
        } else {
          console.log(chalk.green(`\n  ✔  ${result.message}`));
          result.files.forEach(f => console.log(chalk.cyan(`     + ${f}`)));
          console.log(chalk.gray('\n  Run: millas migrate   to apply these migrations.\n'));
        }
      } catch (err) {
        bail('makemigrations', err);
      }
      // makemigrations doesn't open a DB connection so no closeDb() needed
    });

  // ── migrate ─────────────────────────────────────────────────────────────────
  program
    .command('migrate')
    .description('Run all pending migrations')
    .action(async () => {
      try {
        const runner = await getRunner();
        const result = await runner.migrate();
        printMigrationResult(result, 'Ran');
      } catch (err) {
        bail('migrate', err);
      } finally {
        await closeDb();
      }
    });

  // ── migrate:fresh ────────────────────────────────────────────────────────────
  program
    .command('migrate:fresh')
    .description('Drop ALL tables then re-run every migration from scratch')
    .action(async () => {
      try {
        console.log(chalk.yellow('\n  ⚠  Dropping all tables…\n'));
        const runner = await getRunner();
        const result = await runner.fresh();
        printMigrationResult(result, 'Ran');
      } catch (err) {
        bail('migrate:fresh', err);
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
        printMigrationResult(result, 'Rolled back');
      } catch (err) {
        bail('migrate:rollback', err);
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
        printMigrationResult(result, 'Rolled back');
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
        printMigrationResult(result, 'Ran');
      } catch (err) {
        bail('migrate:refresh', err);
      } finally {
        await closeDb();
      }
    });

  // ── migrate:status ───────────────────────────────────────────────────────────
  program
    .command('migrate:status')
    .description('Show the status of all migration files')
    .action(async () => {
      try {
        const runner = await getRunner();
        const rows   = await runner.status();

        if (rows.length === 0) {
          console.log(chalk.yellow('\n  No migration files found.\n'));
          return;
        }

        const colW = Math.max(...rows.map(r => r.name.length)) + 2;
        console.log(`\n  ${'Migration'.padEnd(colW)}  ${'Status'.padEnd(10)}  Batch`);
        console.log(chalk.gray('  ' + '─'.repeat(colW + 20)));

        for (const row of rows) {
          const status = row.status === 'Ran'
            ? chalk.green(row.status.padEnd(10))
            : chalk.yellow(row.status.padEnd(10));
          const batch = row.batch ? chalk.gray(String(row.batch)) : chalk.gray('—');
          console.log(`  ${chalk.cyan(row.name.padEnd(colW))}  ${status}  ${batch}`);
        }
        console.log();
      } catch (err) {
        bail('migrate:status', err);
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
    migrationsPath: path.join(cwd, 'database/migrations'),
    seedersPath:    path.join(cwd, 'database/seeders'),
    modelsPath:     path.join(cwd, 'app/models'),
    snapshotPath:   path.join(cwd, '.millas/schema.json'),
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
  return new MigrationRunner(db, ctx.migrationsPath);
}

/**
 * Destroy all open knex connection pools so the CLI process exits cleanly.
 * Without this, knex keeps the event loop alive indefinitely after the
 * command finishes, causing the terminal to appear to hang.
 */
async function closeDb() {
  try {
    const DatabaseManager = require('../orm/drivers/DatabaseManager');
    await DatabaseManager.closeAll();
  } catch { /* already closed or never opened — safe to ignore */ }
}

function printMigrationResult(result, verb) {
  const list = result.ran || result.rolledBack || [];
  if (list.length === 0) {
    console.log(chalk.yellow(`\n  ${result.message}\n`));
    return;
  }
  console.log(chalk.green(`\n  ✔  ${result.message}`));
  list.forEach(f =>
    console.log(chalk.cyan(`     ${verb === 'Ran' ? '+' : '-'} ${f}`))
  );
  console.log();
}

function bail(cmd, err) {
  console.error(chalk.red(`\n  ✖  ${cmd} failed: ${err.message}\n`));
  if (process.env.DEBUG) console.error(err.stack);
  closeDb().finally(() => process.exit(1));
}
