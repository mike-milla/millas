'use strict';

const {createFacade} = require('./Facade');

/**
 * Cache facade.
 *
 * @class
 * @property {function(string, *, number=): Promise<void>}    set
 * @property {function(string, *=): Promise<*>}               get
 * @property {function(string): Promise<void>}                delete
 * @property {function(string): Promise<void>}                deletePattern
 * @property {function(): Promise<void>}                      flush
 * @property {function(string, number, function): Promise<*>} remember
 * @property {function(string, number=): Promise<number>}     increment
 * @property {function(string, number=): Promise<number>}     decrement
 * @property {function(string[]): Promise<object>}            getMany
 * @property {function(object, number=): Promise<void>}       setMany
 * @property {function(...string): TaggedCache}               tags
 * @property {function(object): void}                         swap
 * @property {function(): void}                               restore
 *
 * @see src/cache/Cache.js
 */
class Cache extends createFacade('cache') {
}

module.exports = Cache;