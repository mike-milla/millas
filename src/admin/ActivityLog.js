'use strict';

/**
 * ActivityLog
 *
 * Persistent admin activity log — equivalent to Django's django_admin_log.
 *
 * ── Storage strategy ─────────────────────────────────────────────────────────
 *
 * Writes go to the `millas_admin_log` DB table (created by system migration
 * 0002_admin_log). If the DB is unavailable (table not yet created, connection
 * not configured, etc.) it falls back silently to an in-memory ring buffer
 * so the admin panel never crashes because of a log write.
 *
 * Reads come from the DB when available, memory otherwise.
 *
 * All DB writes are fire-and-forget — they never block or throw into
 * the calling request handler.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   // Admin.js calls this automatically — you don't call it directly.
 *   ActivityLog.record('create', 'posts', 5, 'Hello World', req.adminUser);
 *   ActivityLog.record('update', 'users', 12, 'alice@example.com', req.adminUser);
 *   ActivityLog.record('delete', 'comments', 7, '#7', req.adminUser);
 *
 *   // Dashboard reads
 *   const entries = await ActivityLog.recent(25);
 *   const totals  = await ActivityLog.totals();
 *
 * ── Entry shape ───────────────────────────────────────────────────────────────
 *
 *   {
 *     id:         number,
 *     user_id:    number|null,
 *     user_email: string,
 *     resource:   string,    // resource slug
 *     record_id:  string,    // PK of affected record (null for bulk)
 *     action:     'create'|'update'|'delete',
 *     label:      string,    // human-readable record name
 *     change_msg: string,    // optional extra detail
 *     created_at: string,    // ISO timestamp
 *   }
 */
class AdminActivityLog {
  constructor(maxMemory = 200) {
    this._mem     = [];   // in-memory fallback ring buffer
    this._maxMem  = maxMemory;
    this._seq     = 0;
    this._dbReady = null; // null=unknown, true=available, false=unavailable
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Record an admin action.
   *
   * @param {'create'|'update'|'delete'} action
   * @param {string}      resource  — resource slug
   * @param {*}           recordId  — PK of the affected record (null for bulk)
   * @param {string}      label     — human-readable description
   * @param {object|null} user      — req.adminUser (live User model instance)
   * @param {string}      [changeMsg] — optional detail (changed fields, etc.)
   */
  record(action, resource, recordId, label, user = null, changeMsg = null) {
    const userId    = user?.id    || null;
    const userEmail = user?.email || 'System';
    const entry = {
      user_id:    userId,
      user_email: userEmail,
      resource,
      record_id:  recordId !== null && recordId !== undefined ? String(recordId) : null,
      action,
      label:      label || (recordId ? `#${recordId}` : resource),
      change_msg: changeMsg,
      created_at: new Date().toISOString(),
    };

    // ── Write to DB fire-and-forget ──────────────────────────────────────
    this._writeDb(entry).catch(() => {});

    // ── Always write to in-memory buffer too ─────────────────────────────
    // This ensures recent() works immediately even before the DB round-trip
    // completes, and provides a fallback if DB is unavailable.
    this._seq++;
    this._mem.unshift({ id: this._seq, ...entry });
    if (this._mem.length > this._maxMem) this._mem.length = this._maxMem;
  }

  /**
   * Return the most recent N log entries, newest first.
   * Reads from DB if available, memory otherwise.
   */
  async recent(n = 25) {
    try {
      const db = this._getDb();
      if (db) {
        const rows = await db('millas_admin_log')
          .orderBy('id', 'desc')
          .limit(n);
        return rows;
      }
    } catch { /* DB unavailable */ }
    return this._mem.slice(0, n);
  }

  /**
   * Return action totals for the current calendar day.
   * { create: N, update: N, delete: N }
   * Reads from DB if available, memory otherwise.
   */
  async totals() {
    try {
      const db = this._getDb();
      if (db) {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const rows  = await db('millas_admin_log')
          .whereRaw(`date(created_at) = ?`, [today])
          .select('action')
          .count('* as count')
          .groupBy('action');

        const t = { create: 0, update: 0, delete: 0 };
        for (const r of rows) {
          if (t[r.action] !== undefined) t[r.action] = Number(r.count);
        }
        return t;
      }
    } catch { /* DB unavailable */ }

    // In-memory fallback — count today's entries
    const today = new Date().toISOString().slice(0, 10);
    const t = { create: 0, update: 0, delete: 0 };
    for (const e of this._mem) {
      if (e.created_at?.slice(0, 10) === today && t[e.action] !== undefined) {
        t[e.action]++;
      }
    }
    return t;
  }

  /**
   * Return recent entries for a specific resource slug.
   */
  async forResource(slug, n = 10) {
    try {
      const db = this._getDb();
      if (db) {
        return db('millas_admin_log')
          .where('resource', slug)
          .orderBy('id', 'desc')
          .limit(n);
      }
    } catch {}
    return this._mem.filter(e => e.resource === slug).slice(0, n);
  }

  /**
   * Clear all log entries (DB + memory).
   * Primarily for testing.
   */
  async clear() {
    this._mem  = [];
    this._seq  = 0;
    try {
      const db = this._getDb();
      if (db) await db('millas_admin_log').delete();
    } catch {}
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  async _writeDb(entry) {
    const db = this._getDb();
    if (!db) return;
    await db('millas_admin_log').insert(entry);
    this._dbReady = true;
  }

  _getDb() {
    // Don't retry after a confirmed failure in this process lifetime
    if (this._dbReady === false) return null;
    try {
      const DatabaseManager = require('../orm/drivers/DatabaseManager');
      if (!DatabaseManager._config) return null;
      return DatabaseManager.connection();
    } catch {
      return null;
    }
  }
}

// Singleton
const activityLog = new AdminActivityLog();
module.exports = activityLog;
module.exports.AdminActivityLog = AdminActivityLog;