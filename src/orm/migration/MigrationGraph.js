'use strict';

const fs   = require('fs-extra');
const path = require('path');
const { deserialise } = require('./operations');
const { ProjectState } = require('./ProjectState');

/**
 * MigrationGraph
 *
 * Builds a directed acyclic graph (DAG) of migration files from one or more
 * source directories. Nodes are migrations; edges are declared dependencies.
 *
 * Responsibilities:
 *   - Load all migration files from all registered sources
 *   - Validate dependency declarations
 *   - Topologically sort into a deterministic execution order
 *   - Detect circular dependencies with a clear error message
 *   - Replay operations to produce a ProjectState at any point
 *
 * Migration file format:
 *
 *   module.exports = {
 *     dependencies: [
 *       ['system', '0001_users'],   // [source, migrationName]
 *     ],
 *     operations: [
 *       new CreateModel('posts', { ... }),
 *     ],
 *   };
 *
 * Source names:
 *   'system'  — framework built-in migrations (millas/src/migrations/system/)
 *   'app'     — project migrations (database/migrations/)
 *   or any named string for future multi-app support
 */
class MigrationGraph {
  constructor() {
    // Map<key, MigrationNode>  key = `${source}:${name}`
    this._nodes   = new Map();
    // Map<sourceName, absPath>
    this._sources = new Map();
  }

  // ─── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a source directory under a given name.
   * Call this before loadAll().
   */
  addSource(name, dirPath) {
    this._sources.set(name, dirPath);
    return this;
  }

  /**
   * Load all .js migration files from all registered sources.
   * Populates this._nodes.
   */
  loadAll() {
    this._nodes.clear();

    for (const [source, dirPath] of this._sources) {
      if (!fs.existsSync(dirPath)) continue;

      const files = fs.readdirSync(dirPath)
        .filter(f => f.endsWith('.js') && !f.startsWith('.'))
        .sort();

      for (const file of files) {
        const name     = file.replace(/\.js$/, '');
        const key      = `${source}:${name}`;
        const fullPath = path.join(dirPath, file);

        // Bust require cache so re-runs pick up edits
        try { delete require.cache[require.resolve(fullPath)]; } catch {}

        let mod;
        try {
          mod = require(fullPath);
        } catch (err) {
          throw new Error(`Failed to load migration "${key}": ${err.message}`);
        }

        // Normalise: support three formats:
        //   1. New class-based:  module.exports = class Migration { static operations = [...] }
        //   2. Old object-based: module.exports = { operations: [...], dependencies: [...] }
        //   3. Legacy:           module.exports = { up(db), down(db) }
        const cls   = typeof mod === 'function' ? mod : null;  // class export
        const plain = typeof mod === 'object'   ? mod : {};    // object export

        const rawDeps  = cls ? (cls.dependencies || []) : (plain.dependencies || []);
        const rawOps   = cls ? (cls.operations   || []) : (plain.operations   || []);
        const isInitial = cls ? !!cls.initial : !!plain.initial;
        const isLegacy  = !cls && typeof plain.up === 'function' && !Array.isArray(plain.operations);

        const node = {
          key,
          source,
          name,
          file,
          fullPath,
          initial:      isInitial,
          dependencies: rawDeps,
          operations:   isLegacy ? null : rawOps.map(op =>
            // Already-instantiated operation objects (from migrations proxy) pass through;
            // plain JSON descriptors go through deserialise()
            (op && typeof op.applyState === 'function') ? op : deserialise(op)
          ),
          legacy:       isLegacy,
          raw:          plain,
        };

        this._nodes.set(key, node);
      }
    }

    // Validate all declared dependencies exist
    for (const node of this._nodes.values()) {
      for (const [depSource, depName] of node.dependencies) {
        const depKey = `${depSource}:${depName}`;
        if (!this._nodes.has(depKey)) {
          throw new Error(
            `Migration "${node.key}" declares dependency "${depKey}" which does not exist.\n` +
            `  Available in "${depSource}": ${this._keysForSource(depSource).join(', ') || '(none)'}`
          );
        }
      }
    }

    return this;
  }

  // ─── Topological sort ──────────────────────────────────────────────────────

  /**
   * Return all nodes in dependency-safe execution order (topological sort).
   * Throws if a circular dependency is detected.
   */
  topoSort() {
    const visited  = new Set();
    const inStack  = new Set(); // cycle detection
    const result   = [];

    const visit = (key) => {
      if (visited.has(key)) return;
      if (inStack.has(key)) {
        throw new Error(`Circular dependency detected: ${[...inStack, key].join(' → ')}`);
      }

      inStack.add(key);
      const node = this._nodes.get(key);

      for (const [depSource, depName] of (node.dependencies || [])) {
        visit(`${depSource}:${depName}`);
      }

      inStack.delete(key);
      visited.add(key);
      result.push(node);
    };

    // Sort keys for determinism before visiting
    const sortedKeys = [...this._nodes.keys()].sort();
    for (const key of sortedKeys) {
      visit(key);
    }

    return result;
  }

  /**
   * Return all nodes for a specific source in topo order.
   */
  topoSortForSource(source) {
    return this.topoSort().filter(n => n.source === source);
  }

  // ─── ProjectState replay ──────────────────────────────────────────────────

  /**
   * Replay all migration operations in order to produce the final ProjectState.
   * This is the "reconstructed state" that makemigrations diffs against.
   *
   * @param {Set<string>} [upToKeys]  — if given, only replay these migrations
   * @returns {ProjectState}
   */
  buildState(upToKeys = null) {
    const state = new ProjectState();
    const nodes = this.topoSort();

    for (const node of nodes) {
      if (upToKeys && !upToKeys.has(node.key)) continue;
      if (node.legacy) continue; // legacy up/down migrations have no state

      for (const op of (node.operations || [])) {
        op.applyState(state);
      }
    }

    return state;
  }

  // ─── Accessors ────────────────────────────────────────────────────────────

  get(key) {
    return this._nodes.get(key);
  }

  all() {
    return [...this._nodes.values()];
  }

  keysForSource(source) {
    return this._keysForSource(source);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _keysForSource(source) {
    return [...this._nodes.keys()]
      .filter(k => k.startsWith(source + ':'))
      .map(k => k.slice(source.length + 1));
  }
}

module.exports = MigrationGraph;