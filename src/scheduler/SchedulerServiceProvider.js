'use strict';

const ServiceProvider = require('../providers/ServiceProvider');
const TaskScheduler = require('./TaskScheduler');

/**
 * SchedulerServiceProvider
 *
 * Registers the task scheduler in the DI container and starts it automatically.
 * Integrates with the existing queue system and provides graceful shutdown.
 */
class SchedulerServiceProvider extends ServiceProvider {
  register(container) {
    container.singleton('scheduler', () => {
      const queue = container.has('queue') ? container.make('queue') : null;
      return new TaskScheduler(container, queue);
    });
  }

  async boot(container, app) {
    const scheduler = container.make('scheduler');
    
    // Load configuration
    const config = this._loadConfig(container);
    scheduler.configure(config);

    // Load scheduled tasks from routes/schedule.js
    const basePath = container.make('basePath');
    const schedulePath = require('path').join(basePath, 'routes', 'schedule.js');
    scheduler.loadSchedules(schedulePath);

    // Start the scheduler
    scheduler.start();

    // Register shutdown handler
    if (app && typeof app.onShutdown === 'function') {
      app.onShutdown(async () => {
        await scheduler.stop();
      });
    }
  }

  _loadConfig(container) {
    const basePath = container.make('basePath');
    
    try {
      const appConfig = require(require('path').join(basePath, 'config', 'app'));
      return appConfig.scheduler || {};
    } catch {
      return {};
    }
  }
}

module.exports = SchedulerServiceProvider;