'use strict';

const path = require('path');
const MigrationGraph = require('./MigrationGraph');

/**
 * MigrationRunner
 *
 * Implements `millas migrate` and related commands.
 *
 * Critical separation:
 *   - NEVER generates migrations
 *   - NEVER reads model files
 *   - Only applies existing migration files to the database
 *
 * Tracking table: millas_migrations
 *   - app_name      (source: 'system' | 'app')
 *   - name          (migration name without .js)
 *   - applied_at    (timestamp)
 *   - batch         (integer, for rollback grouping)
 *
 * Execution order: topological sort of the DAG — dependencies always run first.
 */
class MigrationRunner {
  /**
   * @param {object} db             — live knex connection
   * @param {string} appMigPath     — abs path to database/migrations/
   * @param {string} systemMigPath  — abs path to millas/src/migrations/system/
   */
  constructor(db, appMigPath, systemMigPath) {
    this._db            = db;
    this._appMigPath    = appMigPath;
    this._systemMigPath = systemMigPath || path.join(__dirname, '../../../migrations/system');
  }

  // ─── Public commands ───────────────────────────────────────────────────────

  async migrate() {
    await this._ensureTable();
    const graph   = this._buildGraph();
    const applied = await this._appliedSet();
    const pending = graph.topoSort().filter(n => !applied.has(n.key));

    if (pending.length === 0) return { ran: [], message: 'Nothing to migrate.' };

    const batch = await this._nextBatch();
    const ran   = [];

    for (const node of pending) {
      await this._applyNode(node);
      await this._record(node, batch);
      ran.push({ label: node.key, source: node.source, name: node.name });
    }

    return { ran, batch, message: `Ran ${ran.length} migration(s).` };
  }

  async rollback(steps = 1) {
    await this._ensureTable();
    const rows = await this._lastBatchRows(steps);
    if (rows.length === 0) return { rolledBack: [], message: 'Nothing to rollback.' };

    const graph       = this._buildGraph();
    const rolledBack  = [];

    // Reverse the topo order for rollback
    const topoKeys = graph.topoSort().map(n => n.key);
    rows.sort((a, b) => topoKeys.indexOf(`${b.app_name}:${b.name}`) - topoKeys.indexOf(`${a.app_name}:${a.name}`));

    for (const row of rows) {
      const key  = `${row.app_name}:${row.name}`;
      const node = graph.get(key);
      if (!node) {
        process.stderr.write(`  ⚠  Migration "${key}" not found — skipping rollback\n`);
        continue;
      }
      await this._revertNode(node);
      await this._db('millas_migrations')
        .where('app_name', row.app_name)
        .where('name', row.name)
        .delete();
      rolledBack.push({ label: key, source: node.source, name: node.name });
    }

    return { rolledBack, message: `Rolled back ${rolledBack.length} migration(s).` };
  }

  async fresh() {
    await this._dropAllTables();
    await this._ensureTable();
    return this.migrate();
  }

  async reset() {
    await this._ensureTable();
    const all = await this._db('millas_migrations').select('*').orderBy('id', 'desc');
    if (all.length === 0) return { rolledBack: [], message: 'Nothing to reset.' };

    const graph = this._buildGraph();
    const rolledBack = [];

    for (const row of all) {
      const key  = `${row.app_name}:${row.name}`;
      const node = graph.get(key);
      if (node) {
        try { await this._revertNode(node); } catch { /* already gone */ }
      }
      await this._db('millas_migrations')
        .where('app_name', row.app_name).where('name', row.name).delete();
      rolledBack.push({ label: key });
    }

    return { rolledBack, message: `Reset ${rolledBack.length} migration(s).` };
  }

  async refresh() {
    await this.reset();
    return this.migrate();
  }

  async status() {
    await this._ensureTable();

    const graph   = this._buildGraph();
    const applied = await this._appliedMap();
    const rows    = [];

    for (const node of graph.topoSort()) {
      const rec = applied.get(node.key);
      rows.push({
        key:    node.key,
        source: node.source,
        name:   node.name,
        status: rec ? 'Applied' : 'Pending',
        batch:  rec?.batch ?? null,
        appliedAt: rec?.applied_at ?? null,
      });
    }

    return rows;
  }

  /**
   * Mark a migration as applied without running it (--fake).
   */
  async fake(source, name) {
    await this._ensureTable();
    const key = `${source}:${name}`;
    const already = await this._db('millas_migrations')
      .where('app_name', source).where('name', name).first();
    if (already) throw new Error(`Migration "${key}" is already applied.`);
    const batch = await this._nextBatch();
    await this._record({ source, name }, batch);
    return { key };
  }

  /**
   * Show which migrations WOULD run (plan preview, no DB changes).
   */
  async plan() {
    await this._ensureTable();
    const graph   = this._buildGraph();
    const applied = await this._appliedSet();
    return graph.topoSort()
      .filter(n => !applied.has(n.key))
      .map(n => ({ key: n.key, source: n.source, name: n.name }));
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _buildGraph() {
    const graph = new MigrationGraph()
      .addSource('system', this._systemMigPath)
      .addSource('app',    this._appMigPath);
    graph.loadAll();
    return graph;
  }

  async _applyNode(node) {
    if (node.legacy) {
      // Legacy up/down migration — no operations array, just call up()
      await node.raw.up(this._db);
      return;
    }

    const ops = node.operations || [];

    // ── FK-safe two-phase execution ───────────────────────────────────────────
    //
    // When a migration contains multiple CreateModel ops, running them one by
    // one with inline FK constraints fails whenever a table references another
    // table that appears later in the op list (or in a circular relationship).
    //
    // Strategy:
    //   Phase 1 — run all CreateModel ops without FK constraints
    //             (plain integer columns only)
    //   Phase 2 — attach all FK constraints in a single alterTable per table,
    //             now that every referenced table is guaranteed to exist
    //   Phase 3 — run all remaining ops (AddField, AlterField, etc.) normally
    //
    // This costs exactly the same number of DB round-trips as the naive approach
    // for the common case (one CreateModel per migration = one CREATE TABLE +
    // one ALTER TABLE if it has FKs, vs one CREATE TABLE inline). For migrations
    // with multiple CreateModel ops it is strictly cheaper than per-op ALTER TABLE
    // calls because FK constraints are batched per table in phase 2.

    const createOps = ops.filter(op => op.type === 'CreateModel');
    const otherOps  = ops.filter(op => op.type !== 'CreateModel');

    // Phase 1: create all tables, FK columns as plain integers
    for (const op of createOps) {
      await op.upWithoutFKs(this._db);
    }

    // Phase 2: attach all FK constraints — one alterTable per table
    for (const op of createOps) {
      await op.applyFKConstraints(this._db);
    }

    // Phase 3: remaining ops (AddField, RemoveField, AlterField, RunSQL, etc.)
    for (const op of otherOps) {
      await op.up(this._db);
    }
  }

  async _revertNode(node) {
    if (node.legacy) {
      await node.raw.down(this._db);
    } else {
      const ops = [...(node.operations || [])].reverse();
      for (const op of ops) {
        await op.down(this._db);
      }
    }
  }

  async _ensureTable() {
    const exists = await this._db.schema.hasTable('millas_migrations');
    if (exists) return;

    await this._db.schema.createTable('millas_migrations', (t) => {
      t.increments('id');
      t.string('app_name', 50).notNullable();
      t.string('name', 200).notNullable();
      t.integer('batch').notNullable();
      t.timestamp('applied_at').defaultTo(this._db.fn.now());
      t.unique(['app_name', 'name']);
    });
  }

  async _appliedSet() {
    const rows = await this._db('millas_migrations').select('app_name', 'name');
    return new Set(rows.map(r => `${r.app_name}:${r.name}`));
  }

  async _appliedMap() {
    const rows = await this._db('millas_migrations').select('*');
    const map  = new Map();
    for (const r of rows) map.set(`${r.app_name}:${r.name}`, r);
    return map;
  }

  async _nextBatch() {
    const result = await this._db('millas_migrations').max('batch as max').first();
    return (result?.max || 0) + 1;
  }

  async _lastBatchRows(steps) {
    const result = await this._db('millas_migrations').max('batch as max').first();
    if (!result?.max) return [];
    const fromBatch = result.max - steps + 1;
    return this._db('millas_migrations')
      .where('batch', '>=', fromBatch)
      .orderBy('id', 'desc');
  }

  async _record(node, batch) {
    await this._db('millas_migrations').insert({
      app_name:   node.source,
      name:       node.name,
      batch,
      applied_at: new Date().toISOString(),
    });
  }

  async _dropAllTables() {
    const clientName = this._db.client.config.client || 'sqlite3';
    let dialect;
    if (clientName.includes('pg') || clientName.includes('postgres')) {
      dialect = require('./dialects/postgres');
    } else if (clientName.includes('mysql') || clientName.includes('maria')) {
      dialect = require('./dialects/mysql');
    } else {
      dialect = require('./dialects/sqlite');
    }
    await dialect.dropAllTables(this._db);
  }
}

module.exports = MigrationRunner;