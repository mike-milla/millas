'use strict';

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const SchedulerLock = require('./SchedulerLock');

/**
 * TaskScheduler
 *
 * Built-in task scheduler that runs alongside the HTTP server.
 * Uses node-cron for reliable cron expression handling.
 * Uses distributed locks to prevent duplicate execution across multiple instances.
 *
 * Features:
 *   - Zero configuration required
 *   - DI container integration
 *   - Queue system integration
 *   - Distributed locking (multi-instance safe)
 *   - Graceful shutdown handling
 */
class TaskScheduler {
  constructor(container = null, queue = null) {
    this._container = container;
    this._queue = queue;
    this._tasks = new Map();
    this._running = false;
    this._lock = null;
    this._config = {
      enabled: true,
      timezone: process.env.TZ || 'UTC',
      useQueue: true,
      useLocking: true, // Enable distributed locking by default
      lockTTL: 300, // Lock expires after 5 minutes
    };
  }

  configure(config = {}) {
    this._config = { ...this._config, ...config };
    return this;
  }

  /**
   * Load scheduled tasks from a file (routes/schedule.js)
   */
  loadSchedules(schedulePath) {
    if (!fs.existsSync(schedulePath)) return this;

    try {
      const scheduleDefinition = require(schedulePath);
      const scheduleBuilder = new ScheduleBuilder(this);
      scheduleDefinition(scheduleBuilder);
    } catch (error) {
      console.error(`[TaskScheduler] Failed to load schedules from ${schedulePath}:`, error.message);
    }

    return this;
  }

  /**
   * Register a scheduled task
   */
  addTask(task) {
    this._tasks.set(task.id, task);
    return this;
  }

  /**
   * Start the scheduler
   */
  start() {
    if (!this._config.enabled || this._running || process.env.MILLAS_CLI_MODE) return;

    this._running = true;
    
    // Initialize distributed locking
    if (this._config.useLocking) {
      const db = this._container ? this._container.make('db') : null;
      this._lock = new SchedulerLock(db);
      
      // Clean up expired locks every minute
      setInterval(() => {
        this._lock.cleanup().catch(() => {});
      }, 60000);
    }
    
    console.log(`[TaskScheduler] Starting with ${this._tasks.size} scheduled tasks`);
    if (this._config.useLocking) {
      console.log('[TaskScheduler] Distributed locking enabled (multi-instance safe)');
    }

    // Start all cron jobs
    for (const task of this._tasks.values()) {
      task.start();
    }

    return this;
  }

  /**
   * Stop the scheduler
   */
  async stop() {
    if (!this._running) return;

    this._running = false;
    
    // Stop all cron jobs
    for (const task of this._tasks.values()) {
      task.stop();
    }

    console.log('[TaskScheduler] Stopped');
  }

  /**
   * Get all scheduled tasks
   */
  getTasks() {
    return Array.from(this._tasks.values());
  }

  /**
   * Execute a scheduled task (used by cron jobs and manual testing)
   */
  async _executeTask(task, now = new Date()) {
    // Try to acquire distributed lock
    if (this._config.useLocking && this._lock) {
      const lockAcquired = await this._lock.acquire(task.id, this._config.lockTTL);
      
      if (!lockAcquired) {
        console.log(`[TaskScheduler] Skipping ${task.jobClass.name} - another instance is running it`);
        return;
      }
    }

    try {
      // Prevent overlapping executions within same instance
      if (task.isRunning()) {
        console.warn(`[TaskScheduler] Skipping ${task.jobClass.name} - already running in this instance`);
        return;
      }

      task.markAsRunning();
      console.log(`[TaskScheduler] Executing ${task.jobClass.name}`);

      // Create job instance with DI
      const jobInstance = this._createJobInstance(task);

      if (this._config.useQueue && this._queue) {
        // Dispatch to queue system
        await this._queue.push(jobInstance);
      } else {
        // Execute immediately
        await jobInstance.handle();
      }

      task.updateLastRun(now);
      task.markAsCompleted();

    } catch (error) {
      console.error(`[TaskScheduler] Failed to execute ${task.jobClass.name}:`, error.message);
      task.markAsFailed(error);
    } finally {
      // Always release the lock
      if (this._config.useLocking && this._lock) {
        await this._lock.release(task.id);
      }
    }
  }

  /**
   * Create job instance using DI container
   */
  _createJobInstance(task) {
    const JobClass = task.jobClass;
    
    if (this._container) {
      // Use DI container to resolve dependencies
      return this._container.make(JobClass, task.parameters);
    } else {
      // Fallback to manual instantiation
      return new JobClass(...Object.values(task.parameters || {}));
    }
  }
}

/**
 * ScheduleBuilder
 *
 * Fluent API for defining scheduled tasks
 */
class ScheduleBuilder {
  constructor(scheduler) {
    this._scheduler = scheduler;
  }

  /**
   * Schedule a job class
   */
  job(JobClass) {
    return new ScheduledTask(this._scheduler, JobClass);
  }
}

/**
 * ScheduledTask
 *
 * Represents a single scheduled task with its timing and parameters
 */
class ScheduledTask {
  constructor(scheduler, jobClass) {
    this._scheduler = scheduler;
    this.jobClass = jobClass;
    this.id = `${jobClass.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.cronExpression = null;
    this.cronJob = null;
    this.parameters = {};
    this.conditions = [];
    this.timezone = scheduler._config.timezone;
    this.lastRun = null;
    this.running = false;
    this.failures = [];
  }

  // ── Timing methods ────────────────────────────────────────────────────────

  cron(expression) {
    this.cronExpression = expression;
    this._register();
    return this;
  }

  daily() {
    return this.cron('0 0 * * *');
  }

  hourly() {
    return this.cron('0 * * * *');
  }

  weekly() {
    return this.cron('0 0 * * 0');
  }

  monthly() {
    return this.cron('0 0 1 * *');
  }

  weekdays() {
    return this.cron('0 0 * * 1-5');
  }

  everyMinute() {
    return this.cron('* * * * *');
  }

  everyFiveMinutes() {
    return this.cron('*/5 * * * *');
  }

  everyTenMinutes() {
    return this.cron('*/10 * * * *');
  }

  everyFifteenMinutes() {
    return this.cron('*/15 * * * *');
  }

  everyThirtyMinutes() {
    return this.cron('*/30 * * * *');
  }

  at(time) {
    if (!this.cronExpression) {
      throw new Error('Must call a frequency method (daily, hourly, etc.) before at()');
    }
    
    const [hour, minute = 0] = time.split(':').map(Number);
    const parts = this.cronExpression.split(' ');
    parts[0] = minute.toString();
    parts[1] = hour.toString();
    
    this.cronExpression = parts.join(' ');
    return this;
  }

  // ── Configuration methods ─────────────────────────────────────────────────

  with(params) {
    this.parameters = { ...this.parameters, ...params };
    return this;
  }

  when(condition) {
    this.conditions.push(condition);
    return this;
  }

  timezone(tz) {
    this.timezone = tz;
    return this;
  }

  // ── Execution control ─────────────────────────────────────────────────────

  start() {
    if (!this.cronExpression || this.cronJob) return;

    this.cronJob = cron.schedule(
      this.cronExpression,
      async () => {
        if (this._checkConditions()) {
          await this._scheduler._executeTask(this, new Date());
        }
      },
      {
        scheduled: true,
        timezone: this.timezone,
      }
    );
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  // ── Execution state ───────────────────────────────────────────────────────

  isRunning() {
    return this.running;
  }

  markAsRunning() {
    this.running = true;
  }

  markAsCompleted() {
    this.running = false;
  }

  markAsFailed(error) {
    this.running = false;
    this.failures.push({
      error: error.message,
      timestamp: new Date(),
    });
  }

  updateLastRun(timestamp) {
    this.lastRun = timestamp;
  }

  getNextRun() {
    // node-cron doesn't expose next run time easily
    // Return a placeholder for now
    return 'Scheduled';
  }

  // ── Internal methods ──────────────────────────────────────────────────────

  _register() {
    this._scheduler.addTask(this);
  }

  _checkConditions() {
    return this.conditions.every(condition => {
      try {
        return condition();
      } catch {
        return false;
      }
    });
  }
}

module.exports = TaskScheduler;
module.exports.ScheduleBuilder = ScheduleBuilder;
module.exports.ScheduledTask = ScheduledTask;