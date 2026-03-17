'use strict';

const { createFacade } = require('./Facade');

/**
 * Queue facade.
 *
 * @class
 * @property {function(Job): Promise<void>}          push
 * @property {function(string=): Promise<number>}    size
 * @property {function(string=): Promise<void>}      clear
 * @property {function(function): void}              register
 * @property {function(object): void}                swap
 * @property {function(): void}                      restore
 *
 * @see src/queue/Queue.js
 */
class Queue extends createFacade('queue') {}

/**
 * Shorthand for Queue.push(job).
 *
 * @param {Job} job
 * @returns {Promise<void>}
 */
async function dispatch(job) {
  return Queue.push(job);
}

module.exports = Queue;