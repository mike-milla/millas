'use strict';

/**
 * Time
 *
 * Timezone utilities for Millas.
 * Provides helpers for timezone conversion and formatting.
 *
 * Note: JavaScript's Date object is already timezone-aware (stores UTC internally),
 * unlike Python's datetime which is naive by default. That's why Django needs
 * timezone.now() but JavaScript doesn't - new Date() already returns UTC.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const { Time } = require('millas/core/timezone');
 *
 *   // Convert UTC to local timezone for display
 *   const local = Time.localtime(new Date());
 *
 *   // Parse datetime string as UTC
 *   const dt = Time.parse('2026-03-31 20:00:00');
 *
 *   // Format for display
 *   const formatted = Time.format(new Date(), 'datetime');
 *
 * ── Configuration ─────────────────────────────────────────────────────────────
 *
 *   // config/app.js
 *   module.exports = {
 *     timezone: 'UTC',        // Default timezone for display/scheduler
 *     useTz: true,            // Store/read timestamps as UTC (recommended)
 *   };
 */
class Time {
  /**
   * Convert a UTC datetime to the local timezone configured in config/app.js.
   * Useful for displaying times to users in their expected timezone.
   *
   * @param {Date} dt - UTC datetime
   * @returns {Date} datetime in local timezone
   */
  static localtime(dt) {
    if (!(dt instanceof Date)) {
      throw new TypeError('localtime() requires a Date object');
    }

    const timezone = this.getTimezone();
    if (timezone === 'UTC') return dt;

    // For non-UTC timezones, we need to calculate the offset
    // This is a simplified implementation - for production use,
    // consider using a library like date-fns-tz or luxon
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      const parts = formatter.formatToParts(dt);
      const values = {};
      for (const part of parts) {
        if (part.type !== 'literal') values[part.type] = part.value;
      }

      return new Date(
        `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`
      );
    } catch (err) {
      // Fallback if timezone is invalid
      return dt;
    }
  }

  /**
   * Convert a naive datetime to timezone-aware datetime.
   * If useTz=true, assumes the naive datetime is in UTC.
   * If useTz=false, assumes the naive datetime is in local timezone.
   *
   * @param {Date} dt - naive datetime
   * @returns {Date} timezone-aware datetime
   */
  static makeAware(dt) {
    if (!(dt instanceof Date)) {
      throw new TypeError('makeAware() requires a Date object');
    }

    // If already has timezone info (ISO string with Z or offset), return as-is
    const isoStr = dt.toISOString();
    if (isoStr.includes('Z') || isoStr.match(/[+-]\d{2}:\d{2}$/)) {
      return dt;
    }

    // If useTz=true, treat as UTC
    if (this.isUseTzEnabled()) {
      // Parse as UTC by appending Z
      const str = dt.toISOString().replace('Z', '');
      return new Date(str + 'Z');
    }

    // If useTz=false, treat as local time
    return dt;
  }

  /**
   * Convert a timezone-aware datetime to naive datetime.
   * Strips timezone information, keeping the same wall-clock time.
   *
   * @param {Date} dt - timezone-aware datetime
   * @returns {Date} naive datetime
   */
  static makeNaive(dt) {
    if (!(dt instanceof Date)) {
      throw new TypeError('makeNaive() requires a Date object');
    }

    // Create a new Date with the same components but no timezone
    const year = dt.getUTCFullYear();
    const month = dt.getUTCMonth();
    const day = dt.getUTCDate();
    const hours = dt.getUTCHours();
    const minutes = dt.getUTCMinutes();
    const seconds = dt.getUTCSeconds();
    const ms = dt.getUTCMilliseconds();

    return new Date(year, month, day, hours, minutes, seconds, ms);
  }

  /**
   * Get the configured timezone from config/app.js.
   *
   * @returns {string} timezone (e.g., 'UTC', 'Africa/Nairobi')
   */
  static getTimezone() {
    try {
      const appConfig = require(process.cwd() + '/config/app.js');
      return appConfig.timezone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  /**
   * Check if USE_TZ is enabled (timezone awareness).
   *
   * @returns {boolean}
   */
  static isUseTzEnabled() {
    try {
      const appConfig = require(process.cwd() + '/config/app.js');
      return appConfig.useTz !== false; // Default to true
    } catch {
      return true;
    }
  }

  /**
   * Format a datetime for display in the configured timezone.
   *
   * @param {Date} dt - datetime to format
   * @param {string} format - format string (default: ISO)
   * @returns {string} formatted datetime
   */
  static format(dt, format = 'iso') {
    if (!(dt instanceof Date)) {
      throw new TypeError('format() requires a Date object');
    }

    const local = this.localtime(dt);

    switch (format) {
      case 'iso':
        return local.toISOString();
      case 'date':
        return local.toISOString().split('T')[0];
      case 'time':
        return local.toISOString().split('T')[1].split('.')[0];
      case 'datetime':
        return local.toISOString().replace('T', ' ').split('.')[0];
      default:
        return local.toISOString();
    }
  }

  /**
   * Parse a datetime string, treating it as UTC if useTz=true.
   *
   * @param {string} str - datetime string
   * @returns {Date} parsed datetime
   */
  static parse(str) {
    if (typeof str !== 'string') {
      throw new TypeError('parse() requires a string');
    }

    // If already has timezone info, parse normally
    if (str.includes('Z') || str.match(/[+-]\d{2}:\d{2}$/)) {
      return new Date(str);
    }

    // If useTz=true, treat as UTC
    if (this.isUseTzEnabled()) {
      return new Date(str + 'Z');
    }

    // If useTz=false, parse as local time
    return new Date(str);
  }
}

module.exports = Time;
