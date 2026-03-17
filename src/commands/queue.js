'use strict';

const chalk = require('chalk');
const path  = require('path');
const fs    = require('fs-extra');

module.exports = function (program) {

  program
    .command('queue:work')
    .description('Start the queue worker process')
    .option('-q, --queue <queues>', 'Comma-separated queue names to process', 'default')
    .option('-s, --sleep <seconds>', 'Seconds to sleep between polls', '3')
    .option('--once', 'Process only one job then exit')
    .action(async (options) => {
      const bootstrapPath = path.resolve(process.cwd(), 'bootstrap/app.js');
      if (!fs.existsSync(bootstrapPath)) {
        console.error(chalk.red('\n  ✖ Not inside a Millas project.\n'));
        process.exit(1);
      }

      const Queue       = require('../queue/Queue');
      const QueueWorker = require('../queue/workers/QueueWorker');

      // Boot the app to get config + job registry
      process.env.MILLAS_ROUTE_LIST = 'true'; // suppress server listen
      let app;
      try {
        const bootstrap = require(bootstrapPath);
        app = bootstrap.app;
      } catch (e) {
        console.error(chalk.red(`\n  ✖ Failed to load app: ${e.message}\n`));
        process.exit(1);
      }

      const queues  = options.queue.split(',').map(q => q.trim());
      const sleep   = Number(options.sleep) || 3;
      const maxJobs = options.once ? 1 : Infinity;

      const worker = new QueueWorker(
        Queue.getDriver(),
        Queue.getRegistry(),
        { queues, sleep, maxJobs }
      );

      await worker.start();
    });

  program
    .command('queue:status')
    .description('Show queue statistics')
    .action(async () => {
      const Queue = require('../queue/Queue');

      let queueConfig;
      try { queueConfig = require(path.resolve(process.cwd(), 'config/queue')); }
      catch { queueConfig = { default: process.env.QUEUE_DRIVER || 'sync' }; }

      Queue.configure(queueConfig);

      console.log();
      if (queueConfig.default === 'sync') {
        console.log(chalk.yellow('  Queue driver: sync (jobs run immediately, no persistence)'));
      } else {
        const stats = await Queue.stats();
        if (!stats || !stats.length) {
          console.log(chalk.gray('  No jobs in queue.'));
        } else {
          console.log(chalk.bold('  Queue Statistics\n'));
          for (const row of stats) {
            const statusColor = row.status === 'completed' ? chalk.green
              : row.status === 'failed' ? chalk.red
              : chalk.yellow;
            console.log(`  ${chalk.cyan(row.queue.padEnd(20))} ${statusColor(row.status.padEnd(12))} ${row.count}`);
          }
        }
      }
      console.log();
      process.exit(0);
    });

  program
    .command('queue:clear')
    .description('Clear all pending jobs from a queue')
    .option('-q, --queue <name>', 'Queue name to clear', 'default')
    .action(async (options) => {
      const Queue = require('../queue/Queue');
      const n = await Queue.clear(options.queue);
      console.log(chalk.green(`\n  ✔ Cleared ${n} job(s) from "${options.queue}" queue.\n`));
      process.exit(0);
    });
};
