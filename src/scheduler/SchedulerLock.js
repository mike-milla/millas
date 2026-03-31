'use strict';

/**
 * SchedulerLock
 *
 * Distributed locking mechanism to prevent duplicate task execution
 * across multiple app instances (PM2 cluster, Docker replicas, etc.)
 *
 * Uses database-based locks with automatic expiration.
 * The scheduler_locks table is created automatically by system migration 0004.
 */
class SchedulerLock {
  constructor(db) {
    this._db = db;
    this._tableName = 'scheduler_locks';
  }

  /**
   * Try to acquire a lock for a specific task
   * Returns true if lock acquired, false if another instance has it
   */
  async acquire(taskId, ttlSeconds = 300) {
    if (!this._db) return true; // No DB = no locking (single instance mode)

    const db = this._db.db || this._db;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    try {
      // Try to insert or update lock (upsert)
      const result = await db.raw(`
        INSERT INTO ${this._tableName} (task_id, locked_at, expires_at, instance_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (task_id) DO UPDATE
        SET locked_at = EXCLUDED.locked_at,
            expires_at = EXCLUDED.expires_at,
            instance_id = EXCLUDED.instance_id
        WHERE ${this._tableName}.expires_at < ?
        RETURNING instance_id
      `, [taskId, now, expiresAt, process.pid, now]);

      // Check if we got the lock (our PID is in the result)
      if (result.rows && result.rows.length > 0) {
        return result.rows[0].instance_id === process.pid;
      }

      // If no rows returned, lock is held by another instance
      return false;

    } catch (error) {
      console.error('[SchedulerLock] Failed to acquire lock:', error.message);
      return false;
    }
  }

  /**
   * Release a lock
   */
  async release(taskId) {
    if (!this._db) return;

    const db = this._db.db || this._db;

    try {
      await db.raw(`
        DELETE FROM ${this._tableName}
        WHERE task_id = ? AND instance_id = ?
      `, [taskId, process.pid]);
    } catch (error) {
      console.error('[SchedulerLock] Failed to release lock:', error.message);
    }
  }

  /**
   * Clean up expired locks
   */
  async cleanup() {
    if (!this._db) return;

    const db = this._db.db || this._db;

    try {
      await db.raw(`
        DELETE FROM ${this._tableName}
        WHERE expires_at < ?
      `, [new Date()]);
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

module.exports = SchedulerLock;