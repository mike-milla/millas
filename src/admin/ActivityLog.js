'use strict';

/**
 * AdminActivityLog
 *
 * Lightweight in-process activity log for the admin panel.
 * Stores the last N actions in a ring buffer — no database required.
 *
 * Each entry:
 *   { id, action, resource, recordId, label, user, at, meta }
 *
 * Usage (automatic — Admin.js calls this internally):
 *   ActivityLog.record('create', 'users', 5, 'Alice Smith');
 *   ActivityLog.record('update', 'posts', 12, 'Hello World');
 *   ActivityLog.record('delete', 'comments', 7, '#7');
 *
 * Read:
 *   ActivityLog.recent(20)   // last 20 entries, newest first
 *   ActivityLog.forResource('users', 10)
 */
class AdminActivityLog {
  constructor(maxSize = 200) {
    this._log     = [];
    this._maxSize = maxSize;
    this._seq     = 0;
  }

  /**
   * Record an admin action.
   * @param {'create'|'update'|'delete'} action
   * @param {string} resource   — resource slug
   * @param {*}      recordId
   * @param {string} label      — human-readable name of the record
   * @param {string} [user]     — who performed the action (optional)
   */
  record(action, resource, recordId, label, user = null) {
    this._seq++;
    const entry = {
      id:         this._seq,
      action,
      resource,
      recordId,
      label:      label || `#${recordId}`,
      user:       user || 'Admin',
      at:         new Date().toISOString(),
      _ts:        Date.now(),
    };

    this._log.unshift(entry);

    // Trim to max size
    if (this._log.length > this._maxSize) {
      this._log.length = this._maxSize;
    }
  }

  /**
   * Return the most recent N entries, newest first.
   */
  recent(n = 20) {
    return this._log.slice(0, n);
  }

  /**
   * Return recent entries for a specific resource slug.
   */
  forResource(slug, n = 10) {
    return this._log.filter(e => e.resource === slug).slice(0, n);
  }

  /**
   * Return totals by action type.
   * { create: N, update: N, delete: N }
   */
  totals() {
    const t = { create: 0, update: 0, delete: 0 };
    for (const e of this._log) {
      if (t[e.action] !== undefined) t[e.action]++;
    }
    return t;
  }

  /**
   * Clear all log entries.
   */
  clear() {
    this._log = [];
    this._seq = 0;
  }
}

// Singleton
const activityLog = new AdminActivityLog();
module.exports = activityLog;
module.exports.AdminActivityLog = AdminActivityLog;
