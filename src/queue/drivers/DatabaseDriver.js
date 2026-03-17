'use strict';

/**
 * DatabaseDriver
 *
 * Stores jobs in the `millas_jobs` database table.
 * Requires a database connection configured in config/database.js.
 *
 * Run migration to create the table:
 *   millas migrate
 *
 * Start the worker:
 *   millas queue:work
 *   millas queue:work --queue emails,notifications
 *   millas queue:work --sleep 3
 */
class DatabaseDriver {
  constructor(config = {}) {
    this._config     = config;
    this._connection = config.connection || null;
    this._db         = null;
    this._table      = config.table || 'millas_jobs';
    this._failedTable = config.failedTable || 'millas_failed_jobs';
  }

  // ─── Push ─────────────────────────────────────────────────────────────────

  /**
   * Push a serialized job onto the queue.
   */
  async push(job) {
    const db      = this._getDb();
    const record  = job.serialize();
    const runAt   = record.delay
      ? new Date(Date.now() + record.delay * 1000).toISOString()
      : new Date().toISOString();

    const [id] = await db(this._table).insert({
      queue:      record.queue,
      payload:    JSON.stringify(record),
      attempts:   0,
      max_tries:  record.tries,
      status:     'pending',
      run_at:     runAt,
      created_at: new Date().toISOString(),
    });

    return { id, status: 'queued', queue: record.queue };
  }

  // ─── Pop (used by worker) ─────────────────────────────────────────────────

  /**
   * Fetch the next available job from the queue.
   * Marks it as 'processing' atomically.
   */
  async pop(queue = 'default') {
    const db  = this._getDb();
    const now = new Date().toISOString();

    const row = await db(this._table)
      .where('queue',   queue)
      .where('status',  'pending')
      .where('run_at',  '<=', now)
      .orderBy('run_at', 'asc')
      .first();

    if (!row) return null;

    await db(this._table).where('id', row.id).update({
      status:       'processing',
      started_at:   now,
      attempts:     row.attempts + 1,
    });

    return { ...row, attempts: row.attempts + 1 };
  }

  // ─── Complete / Fail ──────────────────────────────────────────────────────

  async complete(id) {
    await this._getDb()(this._table).where('id', id).update({
      status:      'completed',
      finished_at: new Date().toISOString(),
    });
  }

  async fail(id, error, record) {
    const db       = this._getDb();
    const row      = await db(this._table).where('id', id).first();
    const maxTries = row?.max_tries || 3;
    const attempts = row?.attempts  || 1;

    if (attempts < maxTries) {
      // Schedule retry with backoff
      const backoff = this._backoff(record?.backoff || 'exponential', attempts);
      const runAt   = new Date(Date.now() + backoff * 1000).toISOString();

      await db(this._table).where('id', id).update({
        status:  'pending',
        run_at:  runAt,
        last_error: error.message,
      });
    } else {
      // Move to failed jobs table
      await db(this._failedTable).insert({
        queue:      row?.queue,
        payload:    row?.payload,
        error:      error.message,
        failed_at:  new Date().toISOString(),
      });
      await db(this._table).where('id', id).delete();
    }
  }

  async release(id) {
    await this._getDb()(this._table).where('id', id).update({ status: 'pending' });
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async size(queue = 'default') {
    const result = await this._getDb()(this._table)
      .where('queue', queue).where('status', 'pending').count('* as count').first();
    return Number(result?.count || 0);
  }

  async clear(queue = 'default') {
    return this._getDb()(this._table)
      .where('queue', queue).where('status', 'pending').delete();
  }

  async stats() {
    const db = this._getDb();
    const rows = await db(this._table)
      .select('queue', 'status')
      .count('* as count')
      .groupBy('queue', 'status');
    return rows;
  }

  // ─── Schema ───────────────────────────────────────────────────────────────

  /**
   * Create the jobs tables. Called by migrate.
   */
  async createTables() {
    const db = this._getDb();

    const jobsExists = await db.schema.hasTable(this._table);
    if (!jobsExists) {
      await db.schema.createTable(this._table, (t) => {
        t.increments('id');
        t.string('queue', 100).notNullable().defaultTo('default').index();
        t.text('payload').notNullable();
        t.integer('attempts').defaultTo(0);
        t.integer('max_tries').defaultTo(3);
        t.string('status', 20).defaultTo('pending').index();
        t.string('last_error').nullable();
        t.timestamp('run_at').nullable().index();
        t.timestamp('started_at').nullable();
        t.timestamp('finished_at').nullable();
        t.timestamp('created_at').nullable();
      });
    }

    const failedExists = await db.schema.hasTable(this._failedTable);
    if (!failedExists) {
      await db.schema.createTable(this._failedTable, (t) => {
        t.increments('id');
        t.string('queue', 100).nullable();
        t.text('payload').nullable();
        t.text('error').nullable();
        t.timestamp('failed_at').nullable();
      });
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _getDb() {
    if (this._db) return this._db;
    const DatabaseManager = require('../orm/drivers/DatabaseManager');
    this._db = DatabaseManager.connection(this._connection);
    return this._db;
  }

  _backoff(strategy, attempt) {
    if (strategy === 'exponential') return Math.min(Math.pow(2, attempt), 3600);
    return 60; // fixed: 60 seconds
  }
}

module.exports = DatabaseDriver;
