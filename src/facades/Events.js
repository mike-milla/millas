'use strict';

const { createFacade } = require('./Facade');

/**
 * Events facade.
 *
 * @class
 * @property {function(string|function, function[]|function): EventEmitter} listen
 * @property {function(string|function, function): EventEmitter}            on
 * @property {function(string|function, function): EventEmitter}            once
 * @property {function(string|function, function): EventEmitter}            off
 * @property {function(string, function): EventEmitter}                     onWildcard
 * @property {function(string|Event, object=): Promise<void>}               emit
 * @property {function(string|function): function[]}                        getListeners
 * @property {function(string|function): EventEmitter}                      removeAll
 * @property {function(): EventEmitter}                                      flush
 * @property {function(object): void}                                        swap
 * @property {function(): void}                                              restore
 *
 * @see src/events/EventEmitter.js
 */
class Events extends createFacade('events') {}

module.exports = Events;