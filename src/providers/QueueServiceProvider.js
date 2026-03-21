'use strict';

const ServiceProvider = require('./ServiceProvider');
const Queue           = require('../queue/Queue');
const { dispatch }    = require('../queue/Queue');

/**
 * QueueServiceProvider
 *
 * Configures the Queue facade and registers it in the container.
 * Also connects the Mail facade to the queue for async sending.
 *
 * Add to bootstrap/app.js:
 *   app.providers([
 *     DatabaseServiceProvider,
 *     AuthServiceProvider,
 *     MailServiceProvider,
 *     QueueServiceProvider,
 *     AppServiceProvider,
 *   ])
 */
class QueueServiceProvider extends ServiceProvider {
  register(container) {
    container.instance('Queue', Queue);
    container.alias('queue', 'Queue');
    container.instance('dispatch', dispatch);
  }

  async boot(container) {
    let queueConfig;
    try {
      queueConfig = require((container.make('basePath') || process.cwd()) + '/config/queue');
    } catch {
      queueConfig = {
        default: process.env.QUEUE_DRIVER || 'sync',
        drivers: {
          sync:     {},
          database: { connection: null, table: 'millas_jobs' },
        },
      };
    }

    Queue.configure(queueConfig);

    // Connect Mail to Queue so Mail.queue() works
    if (container.has('Mail')) {
      const Mail = container.make('Mail');
      Mail.setQueue(Queue);
    }
  }
}

module.exports = QueueServiceProvider;