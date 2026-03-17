'use strict';

const ServiceProvider = require('./ServiceProvider');
const EventEmitter    = require('../events/EventEmitter');
const { emit }        = require('../events/EventEmitter');

/**
 * EventServiceProvider
 *
 * Registers the EventEmitter singleton in the container
 * and connects it to the Queue for async listeners.
 *
 * Add to bootstrap/app.js:
 *   app.providers([..., EventServiceProvider, AppServiceProvider])
 *
 * Register event → listener mappings in AppServiceProvider.boot():
 *   EventEmitter.listen(UserRegistered, [SendWelcomeEmail, NotifyAdmin]);
 */
class EventServiceProvider extends ServiceProvider {
  register(container) {
    container.instance('EventEmitter', EventEmitter);
    container.alias('events', 'EventEmitter');
    container.instance('emit',         emit);
  }

  async boot(container) {
    // Connect queue to emitter for async listener support
    if (container.has('Queue')) {
      const Queue = container.make('Queue');
      EventEmitter.setQueue(Queue);
    }
  }
}

module.exports = EventServiceProvider;