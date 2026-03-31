'use strict';

const Facade = require('./Facade');

/**
 * Schedule Facade
 *
 * Provides easy access to the task scheduler for defining scheduled tasks.
 *
 * Usage:
 *   const { Schedule } = require('millas/facades');
 *   
 *   Schedule.job(SendEmailJob).daily().at('09:00');
 *   Schedule.job(CleanupJob).hourly();
 */
class Schedule extends Facade {
  static getAccessor() {
    return 'scheduler';
  }
}

module.exports = Schedule;