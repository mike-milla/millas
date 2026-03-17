'use strict';

/**
 * Listener
 *
 * Base class for all event listeners.
 *
 * Usage:
 *   class SendWelcomeEmail extends Listener {
 *     static queue = true;  // run this listener via the queue (Phase 9)
 *
 *     async handle(event) {
 *       await Mail.send({
 *         to:       event.user.email,
 *         subject:  'Welcome!',
 *         template: 'welcome',
 *         data:     { name: event.user.name },
 *       });
 *     }
 *   }
 *
 * Register:
 *   EventEmitter.listen(UserRegistered, [SendWelcomeEmail, NotifyAdmin]);
 */
class Listener {
  /**
   * Whether to run this listener via the queue.
   * Set to true for slow operations (email, notifications, etc.)
   */
  static queue = false;

  /**
   * Handle the event.
   * @param {Event} event
   */
  async handle(event) {
    throw new Error(`${this.constructor.name} must implement handle(event)`);
  }

  /**
   * Called when the listener fails.
   */
  async failed(event, error) {}
}

module.exports = Listener;
