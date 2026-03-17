'use strict';

/**
 * Job
 *
 * Base class for all Millas background jobs.
 *
 * Usage:
 *   class SendEmailJob extends Job {
 *     static queue    = 'emails';   // which queue to push to
 *     static tries    = 3;          // max attempts before failing
 *     static delay    = 0;          // seconds before first attempt
 *     static timeout  = 60;         // seconds before job times out
 *     static backoff  = 'exponential'; // 'fixed' | 'exponential'
 *
 *     constructor(user, subject) {
 *       super();
 *       this.user    = user;
 *       this.subject = subject;
 *     }
 *
 *     async handle() {
 *       await Mail.send({ to: this.user.email, subject: this.subject });
 *     }
 *
 *     async failed(error) {
 *       console.error('SendEmailJob failed:', error.message);
 *     }
 *   }
 *
 * Dispatch:
 *   dispatch(new SendEmailJob(user, 'Welcome!'));
 *   dispatch(new SendEmailJob(user)).delay(60);   // delay 60 seconds
 *   dispatch(new SendEmailJob(user)).onQueue('priority');
 */
class Job {
  // ─── Static config (override per job class) ───────────────────────────────

  /** Queue name this job belongs to */
  static queue   = 'default';

  /** Max attempts before marking as failed */
  static tries   = 3;

  /** Seconds to wait before first execution */
  static delay   = 0;

  /** Seconds before the job is considered timed out */
  static timeout = 60;

  /** Backoff strategy: 'fixed' | 'exponential' */
  static backoff = 'exponential';

  // ─── Instance ─────────────────────────────────────────────────────────────

  constructor() {
    this._queue    = null;   // runtime override
    this._delay    = null;   // runtime override
    this._attempts = 0;
  }

  /**
   * Execute the job. Must be implemented by subclasses.
   */
  async handle() {
    throw new Error(`${this.constructor.name} must implement handle()`);
  }

  /**
   * Called when the job fails after all retries.
   * Override to notify, log, or clean up.
   */
  async failed(error) {}

  // ─── Fluent dispatch modifiers ────────────────────────────────────────────

  /**
   * Override the queue name at dispatch time.
   */
  onQueue(name) {
    this._queue = name;
    return this;
  }

  /**
   * Delay execution by N seconds.
   */
  delay(seconds) {
    this._delay = seconds;
    return this;
  }

  // ─── Serialisation ────────────────────────────────────────────────────────

  /**
   * Serialize this job for storage in the queue driver.
   */
  serialize() {
    return {
      class:     this.constructor.name,
      queue:     this._queue     || this.constructor.queue  || 'default',
      tries:     this.constructor.tries   || 3,
      timeout:   this.constructor.timeout || 60,
      backoff:   this.constructor.backoff || 'exponential',
      delay:     this._delay !== null
                   ? this._delay
                   : (this.constructor.delay || 0),
      payload:   this._getPayload(),
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Get the serializable payload (all own non-private properties).
   */
  _getPayload() {
    const payload = {};
    for (const key of Object.keys(this)) {
      if (!key.startsWith('_')) payload[key] = this[key];
    }
    return payload;
  }

  /**
   * Restore a job instance from a serialized record.
   */
  static deserialize(record, JobClass) {
    const instance = new JobClass();
    Object.assign(instance, record.payload || {});
    instance._attempts = record.attempts || 0;
    return instance;
  }
}

module.exports = Job;
