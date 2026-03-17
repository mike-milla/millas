'use strict';

/**
 * SyncDriver
 *
 * Executes jobs immediately and synchronously in the current process.
 * Default driver — no Redis or DB required.
 *
 * Perfect for:
 *   - Local development
 *   - Testing
 *   - Simple apps that don't need background processing
 *
 * Set QUEUE_DRIVER=sync in .env
 */
class SyncDriver {
  constructor() {
    this._processed = [];
    this._failed    = [];
  }

  /**
   * Push and immediately execute a job.
   */
  async push(job) {
    const record = {
      id:         this._id(),
      job:        job.constructor.name,
      queue:      job._queue || job.constructor.queue || 'default',
      payload:    job._getPayload(),
      attempts:   0,
      status:     'processing',
      createdAt:  new Date().toISOString(),
    };

    try {
      await job.handle();
      record.status     = 'completed';
      record.finishedAt = new Date().toISOString();
      this._processed.push(record);
      return { id: record.id, status: 'completed' };
    } catch (error) {
      record.status    = 'failed';
      record.error     = error.message;
      record.failedAt  = new Date().toISOString();
      this._failed.push(record);

      if (typeof job.failed === 'function') {
        await job.failed(error).catch(() => {});
      }

      throw error;
    }
  }

  /**
   * SyncDriver has no persistent queue — nothing to work.
   */
  async work() {
    return { processed: 0, message: 'SyncDriver: jobs run immediately on dispatch.' };
  }

  async size(queue = 'default') { return 0; }
  async clear(queue = 'default') { return 0; }

  processed() { return [...this._processed]; }
  failed()    { return [...this._failed]; }

  _id() { return `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
}

module.exports = SyncDriver;
