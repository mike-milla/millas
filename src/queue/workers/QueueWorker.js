'use strict';

/**
 * QueueWorker
 *
 * Polls the queue driver and executes pending jobs.
 * Started by: millas queue:work
 *
 * Usage:
 *   const worker = new QueueWorker(driver, registry, options);
 *   await worker.start();
 */
class QueueWorker {
  constructor(driver, jobRegistry, options = {}) {
    this._driver        = driver;
    this._registry      = jobRegistry;
    this._queues        = options.queues       || ['default'];
    this._sleep         = options.sleep        || 3;
    this._maxJobs       = options.maxJobs      || Infinity;
    this._handleSignals = options.handleSignals !== false && options.maxJobs === undefined;
    this._silent        = options.silent       || options.maxJobs !== undefined;
    this._running       = false;
    this._processed     = 0;
    this._failed        = 0;
  }

  /**
   * Start the worker loop.
   */
  async start() {
    this._running = true;

    if (!this._silent) {
      console.log(`\n  ⚡ Queue worker started`);
      console.log(`  Queues: ${this._queues.join(', ')}`);
      console.log(`  Sleep:  ${this._sleep}s between polls\n`);
    }

    // Only register signal handlers when running as main process
    if (this._handleSignals) {
      process.on('SIGINT',  () => this.stop('SIGINT'));
      process.on('SIGTERM', () => this.stop('SIGTERM'));
    }

    while (this._running && this._processed < this._maxJobs) {
      let worked = false;

      for (const queue of this._queues) {
        const record = await this._driver.pop(queue);
        if (record) {
          await this._process(record);
          worked = true;
          break;
        }
      }

      if (!worked) {
        // If maxJobs is finite and queue is empty, stop
        if (this._maxJobs < Infinity) break;
        await this._sleep_ms(this._sleep * 1000);
      }
    }

    if (!this._silent) {
      console.log(`\n  Worker stopped. Processed: ${this._processed}, Failed: ${this._failed}\n`);
    }
  }

  stop(signal = 'manual') {
    if (!this._silent) console.log(`\n  [${signal}] Stopping worker gracefully...`);
    this._running = false;
  }

  stats() {
    return { processed: this._processed, failed: this._failed };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  async _process(record) {
    let payload;
    try {
      payload = JSON.parse(record.payload);
    } catch {
      console.error(`  ✖ Failed to parse job payload (id: ${record.id})`);
      await this._driver.fail(record.id, new Error('Invalid payload'), {});
      this._failed++;
      return;
    }

    const JobClass = this._registry.get(payload.class);
    if (!JobClass) {
      console.error(`  ✖ Unknown job class: ${payload.class}`);
      await this._driver.fail(record.id, new Error(`Unknown job: ${payload.class}`), payload);
      this._failed++;
      return;
    }

    const job = JobClass.deserialize
      ? JobClass.deserialize({ ...record, payload: payload.payload || {} }, JobClass)
      : Object.assign(new JobClass(), payload.payload || {});

    const start = Date.now();
    process.stdout.write(`  ⟳  ${payload.class} (id: ${record.id})... `);

    try {
      await Promise.race([
        job.handle(),
        this._timeout(payload.timeout || 60),
      ]);

      const ms = Date.now() - start;
      console.log(`\x1b[32m✔\x1b[0m ${ms}ms`);
      await this._driver.complete(record.id);
      this._processed++;
    } catch (error) {
      const ms = Date.now() - start;
      console.log(`\x1b[31m✖\x1b[0m ${ms}ms — ${error.message}`);
      await this._driver.fail(record.id, error, payload);

      if (typeof job.failed === 'function') {
        await job.failed(error).catch(() => {});
      }

      this._failed++;
    }
  }

  _timeout(seconds) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Job timed out after ${seconds}s`)), seconds * 1000)
    );
  }

  _sleep_ms(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = QueueWorker;
