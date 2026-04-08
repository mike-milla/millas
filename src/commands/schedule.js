'use strict';

const Command = require('../console/Command');

class ScheduleCommand extends Command {
  static description = 'Manage scheduled tasks';

  async onInit(register) {
    register
      .command(async () => {
        const app = this.getApp();
        const scheduler = app.make('scheduler');
        const tasks = scheduler.getTasks();

        if (tasks.length === 0) {
          this.info('No scheduled tasks found.');
          this.info('Create routes/schedule.js to define scheduled tasks.');
          return;
        }

        this.logger.log(this.style.bold('\n  Scheduled Tasks\n'));
        
        for (const task of tasks) {
          const status = task.isRunning() 
            ? this.style.warning('RUNNING') 
            : this.style.success('READY');
          const nextRun = task.lastRun 
            ? `Last: ${task.lastRun.toLocaleString()}`
            : this.style.muted('Never run');
          
          this.logger.log(`  ${this.style.info(task.jobClass.name.padEnd(30))} ${status.padEnd(15)} ${nextRun}`);
          
          if (task.cronExpression) {
            this.logger.log(`    ${this.style.muted('Cron:')} ${task.cronExpression}`);
          }
          
          if (Object.keys(task.parameters).length > 0) {
            this.logger.log(`    ${this.style.muted('Params:')} ${JSON.stringify(task.parameters)}`);
          }
          
          if (task.failures.length > 0) {
            const lastFailure = task.failures[task.failures.length - 1];
            this.logger.log(`    ${this.style.danger('Last failure:')} ${lastFailure.error} (${lastFailure.timestamp.toLocaleString()})`);
          }
          
          this.logger.log('');
        }
      })
      .name('list')
      .description('Show all scheduled tasks and their next run times');

    register
      .command(async (taskName) => {
        await this.appBoot();
        const app = this.getApp();
        const scheduler = app.make('scheduler');
        const tasks = scheduler.getTasks();
        const task = tasks.find(t => t.jobClass.name === taskName);

        if (!task) {
          this.error(`Task "${taskName}" not found.`);
          this.info('Available tasks:');
          tasks.forEach(t => this.logger.log(this.style.muted(`    - ${t.jobClass.name}`)));
          throw new Error(`Task "${taskName}" not found`);
        }

        this.logger.log(this.style.primary(`\n  ▶ Running ${taskName}...\n`));

        await scheduler._executeTask(task, new Date());
        this.success(`${taskName} completed successfully.`);
      })
      .name('test')
      .str('taskName', 'Task name to run')
      .description('Run a specific scheduled task immediately for testing');
  }
}

module.exports = ScheduleCommand;
