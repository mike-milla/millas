'use strict';

const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');

module.exports = function (program) {

  program
    .command('schedule:list')
    .description('Show all scheduled tasks and their next run times')
    .action(async () => {
      const bootstrapPath = path.resolve(process.cwd(), 'bootstrap/app.js');
      if (!fs.existsSync(bootstrapPath)) {
        console.error(chalk.red('\n  ✖ Not inside a Millas project.\n'));
        process.exit(1);
      }

      // Boot the app to get scheduler
      let app;
      try {
        app = await require(bootstrapPath);
      } catch (e) {
        console.error(chalk.red(`\n  ✖ Failed to load app: ${e.message}\n`));
        process.exit(1);
      }

      const scheduler = app.make('scheduler');
      const tasks = scheduler.getTasks();

      console.log();
      if (tasks.length === 0) {
        console.log(chalk.gray('  No scheduled tasks found.'));
        console.log(chalk.gray('  Create routes/schedule.js to define scheduled tasks.'));
      } else {
        console.log(chalk.bold('  Scheduled Tasks\n'));
        
        for (const task of tasks) {
          const status = task.isRunning() ? chalk.yellow('RUNNING') : chalk.green('READY');
          const nextRun = task.lastRun 
            ? `Last: ${task.lastRun.toLocaleString()}`
            : chalk.gray('Never run');
          
          console.log(`  ${chalk.cyan(task.jobClass.name.padEnd(30))} ${status.padEnd(15)} ${nextRun}`);
          
          if (task.cronExpression) {
            console.log(`    ${chalk.gray('Cron:')} ${task.cronExpression}`);
          }
          
          if (Object.keys(task.parameters).length > 0) {
            console.log(`    ${chalk.gray('Params:')} ${JSON.stringify(task.parameters)}`);
          }
          
          if (task.failures.length > 0) {
            const lastFailure = task.failures[task.failures.length - 1];
            console.log(`    ${chalk.red('Last failure:')} ${lastFailure.error} (${lastFailure.timestamp.toLocaleString()})`);
          }
          
          console.log();
        }
      }
      
      process.exit(0);
    });

  program
    .command('schedule:test <taskName>')
    .description('Run a specific scheduled task immediately for testing')
    .action(async (taskName) => {
      const bootstrapPath = path.resolve(process.cwd(), 'bootstrap/app.js');
      if (!fs.existsSync(bootstrapPath)) {
        console.error(chalk.red('\n  ✖ Not inside a Millas project.\n'));
        process.exit(1);
      }

      // Boot the app
      let app;
      try {
        app = await require(bootstrapPath);
      } catch (e) {
        console.error(chalk.red(`\n  ✖ Failed to load app: ${e.message}\n`));
        process.exit(1);
      }

      const scheduler = app.make('scheduler');
      const tasks = scheduler.getTasks();
      const task = tasks.find(t => t.jobClass.name === taskName);

      if (!task) {
        console.error(chalk.red(`\n  ✖ Task "${taskName}" not found.\n`));
        console.log(chalk.gray('  Available tasks:'));
        tasks.forEach(t => console.log(chalk.gray(`    - ${t.jobClass.name}`)));
        console.log();
        process.exit(1);
      }

      console.log(chalk.blue(`\n  ▶ Running ${taskName}...\n`));

      try {
        await scheduler._executeTask(task, new Date());
        console.log(chalk.green(`  ✔ ${taskName} completed successfully.\n`));
      } catch (error) {
        console.error(chalk.red(`  ✖ ${taskName} failed: ${error.message}\n`));
        process.exit(1);
      }

      process.exit(0);
    });

  program
    .command('make:task <name>')
    .description('Generate a new scheduled task class')
    .action(async (name) => {
      const taskName = name.endsWith('Task') ? name : `${name}Task`;
      const taskPath = path.resolve(process.cwd(), 'app', 'tasks', `${taskName}.js`);

      // Ensure directory exists
      await fs.ensureDir(path.dirname(taskPath));

      // Check if file already exists
      if (await fs.pathExists(taskPath)) {
        console.error(chalk.red(`\n  ✖ Task ${taskName} already exists.\n`));
        process.exit(1);
      }

      // Generate task class
      const template = `'use strict';

const { Job } = require('millas/core/queue');

/**
 * ${taskName}
 *
 * Scheduled task that runs automatically based on the schedule defined in routes/schedule.js
 *
 * Usage in routes/schedule.js:
 *   Schedule.job(${taskName}).daily().at('09:00');
 */
class ${taskName} extends Job {
  /**
   * Constructor - DI container will inject dependencies automatically
   */
  constructor(/* inject dependencies here */) {
    super();
    // Store injected dependencies
  }

  /**
   * Execute the scheduled task
   */
  async handle() {
    // Implement your scheduled task logic here
    console.log('${taskName} is running...');
  }

  /**
   * Handle task failure (optional)
   */
  async failed(error) {
    console.error('${taskName} failed:', error.message);
  }
}

module.exports = ${taskName};
`;

      await fs.writeFile(taskPath, template);

      console.log(chalk.green(`\n  ✔ Task created: ${taskPath}`));
      console.log(chalk.gray('\n  Next steps:'));
      console.log(chalk.gray(`    1. Implement the handle() method in ${taskName}`));
      console.log(chalk.gray(`    2. Add the task to routes/schedule.js:`));
      console.log(chalk.gray(`       Schedule.job(${taskName}).daily().at('09:00');`));
      console.log();
    });
};