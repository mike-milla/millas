'use strict';

const { createFacade } = require('./Facade');

/**
 * Storage facade.
 *
 * @class
 * @property {function(string, Buffer|string, object=): Promise<void>}    put
 * @property {function(string): Promise<Buffer|string>}                   get
 * @property {function(string): Promise<boolean>}                         exists
 * @property {function(string): Promise<void>}                            delete
 * @property {function(string): Promise<object>}                          metadata
 * @property {function(string): string}                                   url
 * @property {function(string): string}                                   path
 * @property {function(string, object, object=): void}                    stream
 * @property {function(string): Storage}                                  disk
 * @property {function(object): void}                                     swap
 * @property {function(): void}                                           restore
 *
 * @see src/storage/Storage.js
 */
class Storage extends createFacade('storage') {}

module.exports = Storage;