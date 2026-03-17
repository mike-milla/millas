'use strict';

const {createFacade} = require('./Facade');


/**
 * Log facade.
 *
 * @class
 * @property {function(TAG:string,message:string,...*): void}           v
 * @property {function(TAG:string,message:string,...*): void}           d
 * @property {function(TAG:string,message:string,...*): void}           i
 * @property {function(TAG:string,message:string,...*): void}           w
 * @property {function(TAG:string,message:string,...*): void}           e
 * @property {function(TAG:string,message:string,...*): void}           wtf
 * @property {function(TAG:string,message:string,...*): void}           verbose
 * @property {function(TAG:string,message:string,...*): void}           debug
 * @property {function(TAG:string,message:string,...*): void}           info
 * @property {function(TAG:string,message:string,...*): void}           warn
 * @property {function(TAG:string,message:string,...*): void}           error
 * @property {function(string): TaggedLogger} tag
 * @property {function(string): function}     time
 * @property {function(string, function): Promise<*>} timed
 * @property {function(object): void}         swap
 * @property {function(): void}               restore
 *
 * @see src/logger/Logger.js
 */
class Log extends createFacade('log') {
}

module.exports = Log;