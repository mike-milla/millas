'use strict';

/**
 * Event
 *
 * Base class for all Millas events.
 *
 * Usage:
 *   class UserRegistered extends Event {
 *     constructor(user) {
 *       super();
 *       this.user      = user;
 *       this.timestamp = new Date();
 *     }
 *   }
 *
 *   // Fire the event
 *   await emit(new UserRegistered(user));
 */
class Event {
  constructor() {
    this._name      = this.constructor.name;
    this._timestamp = new Date().toISOString();
    this._stopped   = false;
  }

  /**
   * Stop event propagation — subsequent listeners won't be called.
   */
  stopPropagation() {
    this._stopped = true;
  }

  get name()      { return this._name; }
  get timestamp() { return this._timestamp; }
  get stopped()   { return this._stopped; }
}

module.exports = Event;
