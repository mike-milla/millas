'use strict';

const SyncDriver = require('./drivers/SyncDriver');

/**
 * Queue
 *
 * The primary queue facade.
 *
 * Usage:
 *   const { Queue, dispatch } = require('millas/src');
 *
 *   // Dispatch a job
 *   await dispatch(new SendEmailJob(user));
 *
 *   // Dispatch with options
 *   await dispatch(new SendEmailJob(user).delay(60).onQueue('emails'));
 *
 *   // Direct facade methods
 *   await Queue.push(new SendEmailJob(user));
 *   await Queue.size('default');
 *   await Queue.clear('default');
 */
class Queue {
  constructor() {
    this._driver   = null;
    this._config   = null;
    this._registry = new Map();  // className → JobClass
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  configure(config) {
    this._config = config;
    this._driver = null;  // reset so driver is rebuilt with new config
  }

  /**
   * Register a Job class so the worker can deserialize it.
   */
  register(JobClass) {
    this._registry.set(JobClass.name, JobClass);
    return this;
  }

  registerMany(classes = []) {
    classes.forEach(c => this.register(c));
    return this;
  }

  // ─── Core API ──────────────────────────────────────────────────────────────

  /**
   * Push a job onto the queue.
   * Returns { id, status, queue }
   */
  async push(job) {
    return this._getDriver().push(job);
  }

  /**
   * Get the number of pending jobs on a queue.
   */
  async size(queue = 'default') {
    return this._getDriver().size(queue);
  }

  /**
   * Clear all pending jobs from a queue.
   */
  async clear(queue = 'default') {
    return this._getDriver().clear(queue);
  }

  /**
   * Get queue statistics (DatabaseDriver only).
   */
  async stats() {
    const driver = this._getDriver();
    if (typeof driver.stats === 'function') return driver.stats();
    return {};
  }

  /**
   * Get processed jobs (SyncDriver only — for testing).
   */
  processed() {
    const driver = this._getDriver();
    if (typeof driver.processed === 'function') return driver.processed();
    return [];
  }

  /**
   * Get the job registry Map (used by QueueWorker).
   */
  getRegistry() {
    return this._registry;
  }

  getDriver() {
    return this._getDriver();
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _getDriver() {
    if (this._driver) return this._driver;

    const driverName = this._config?.default
      || process.env.QUEUE_DRIVER
      || 'sync';

    const driverConf = this._config?.drivers?.[driverName] || {};

    switch (driverName) {
      case 'database': {
        const DatabaseDriver = require('./drivers/DatabaseDriver');
        this._driver = new DatabaseDriver(driverConf);
        break;
      }
      case 'sync':
      default: {
        this._driver = new SyncDriver();
        break;
      }
    }

    return this._driver;
  }
}

// Singleton
const queue = new Queue();
module.exports = queue;
module.exports.Queue = Queue;

/**
 * dispatch()
 *
 * Global helper — push a job onto the queue.
 *
 *   const { dispatch } = require('millas/src');
 *   await dispatch(new SendEmailJob(user));
 */
module.exports.dispatch = async function dispatch(job) {
  return queue.push(job);
};
