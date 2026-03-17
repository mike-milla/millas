'use strict';

const fs   = require('fs-extra');
const path = require('path');

/**
 * MigrationRunner
 *
 * Handles the full migration lifecycle:
 *   - run pending migrations          (migrate)
 *   - rollback last batch             (migrate:rollback)
 *   - show status table               (migrate:status)
 *   - drop all + re-run               (migrate:fresh)
 *   - rollback all                    (migrate:reset)
 *   - rollback all + re-run           (migrate:refresh)
 *
 * Migration history is tracked in the `millas_migrations` table.
 * Each migration file must export { up(db), down(db) }.
 */
class MigrationRunner {
  /**
   * @param {object} knexConn      — live knex connection
   * @param {string} migrationsPath — absolute path to migrations dir
   */
  constructor(knexConn, migrationsPath) {
    this._db   = knexConn;
    this._path = migrationsPath;
  }

  // ─── Public commands ──────────────────────────────────────────────────────

  /** Run all pending migrations. */
  async migrate() {
    await this._ensureTable();
    const pending = await this._pending();

    if (pending.length === 0) {
      return { ran: [], message: 'Nothing to migrate.' };
    }

    const batch = await this._nextBatch();
    const ran   = [];

    for (const file of pending) {
      const migration = this._load(file);
      await migration.up(this._db);
      await this._record(file, batch);
      ran.push(file);
    }

    return { ran, batch, message: `Ran ${ran.length} migration(s).` };
  }

  /** Rollback the last batch of migrations. */
  async rollback(steps = 1) {
    await this._ensureTable();
    const batches = await this._lastBatches(steps);

    if (batches.length === 0) {
      return { rolledBack: [], message: 'Nothing to rollback.' };
    }

    const rolledBack = [];

    for (const row of [...batches].reverse()) {
      const migration = this._load(row.name);
      await migration.down(this._db);
      await this._db('millas_migrations').where('name', row.name).delete();
      rolledBack.push(row.name);
    }

    return { rolledBack, message: `Rolled back ${rolledBack.length} migration(s).` };
  }

  /** Drop all tables and re-run every migration. */
  async fresh() {
    await this._dropAllTables();
    await this._ensureTable();
    return this.migrate();
  }

  /** Rollback ALL migrations. */
  async reset() {
    await this._ensureTable();
    const all = await this._db('millas_migrations').orderBy('id', 'desc');

    if (all.length === 0) {
      return { rolledBack: [], message: 'Nothing to reset.' };
    }

    const rolledBack = [];
    for (const row of all) {
      const migration = this._load(row.name);
      await migration.down(this._db);
      await this._db('millas_migrations').where('name', row.name).delete();
      rolledBack.push(row.name);
    }

    return { rolledBack, message: `Reset ${rolledBack.length} migration(s).` };
  }

  /** Rollback all then re-run all. */
  async refresh() {
    await this.reset();
    return this.migrate();
  }

  /** Return status of all migration files. */
  async status() {
    await this._ensureTable();
    const files = this._files();
    const ran   = await this._ranNames();

    return files.map(file => ({
      name:   file,
      status: ran.has(file) ? 'Ran' : 'Pending',
      batch:  ran.get(file) || null,
    }));
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  async _ensureTable() {
    const exists = await this._db.schema.hasTable('millas_migrations');
    if (exists) return;

    await this._db.schema.createTable('millas_migrations', (t) => {
      t.increments('id');
      t.string('name').notNullable().unique();
      t.integer('batch').notNullable();
      t.timestamp('ran_at').defaultTo(this._db.fn.now());
    });
  }

  async _pending() {
    const ran   = await this._ranNames();
    const files = this._files();
    return files.filter(f => !ran.has(f));
  }

  async _ranNames() {
    const rows = await this._db('millas_migrations').select('name', 'batch');
    return new Map(rows.map(r => [r.name, r.batch]));
  }

  async _nextBatch() {
    const result = await this._db('millas_migrations').max('batch as max').first();
    return (result?.max || 0) + 1;
  }

  async _lastBatches(steps = 1) {
    const maxBatch = await this._db('millas_migrations').max('batch as max').first();
    if (!maxBatch?.max) return [];

    const fromBatch = maxBatch.max - steps + 1;
    const all = await this._db('millas_migrations').orderBy('id', 'desc');
    return all.filter(r => r.batch >= fromBatch);
  }

  /**
   * Drop all user tables — dialect-aware.
   * Resolves the knex client name and delegates to the right helper.
   */
  async _dropAllTables() {
    const clientName = this._db.client.config.client || 'sqlite3';

    let dialect;
    if (clientName.includes('pg') || clientName.includes('postgres')) {
      dialect = require('./dialects/postgres');
    } else if (clientName.includes('mysql') || clientName.includes('maria')) {
      dialect = require('./dialects/mysql');
    } else {
      // Default: sqlite / sqlite3
      dialect = require('./dialects/sqlite');
    }

    await dialect.dropAllTables(this._db);
  }

  _files() {
    if (!fs.existsSync(this._path)) return [];
    return fs.readdirSync(this._path)
      .filter(f => f.endsWith('.js') && !f.startsWith('.'))
      .sort();
  }

  _load(name) {
    const filePath = path.join(this._path, name);
    delete require.cache[require.resolve(filePath)];
    const migration = require(filePath);
    if (typeof migration.up !== 'function' || typeof migration.down !== 'function') {
      throw new Error(`Migration "${name}" must export { up(db), down(db) }`);
    }
    return migration;
  }

  async _record(name, batch) {
    await this._db('millas_migrations').insert({
      name,
      batch,
      ran_at: new Date().toISOString(),
    });
  }
}

module.exports = MigrationRunner;
