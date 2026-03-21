'use strict';

const fs   = require('fs-extra');
const path = require('path');

const MigrationGraph       = require('./MigrationGraph');
const ModelScanner         = require('./ModelScanner');
const MigrationWriter      = require('./MigrationWriter');
const InteractiveResolver  = require('./InteractiveResolver');
const RenameDetector       = require('./RenameDetector');

/**
 * Makemigrations
 *
 * Implements `millas makemigrations`.
 *
 * Algorithm:
 *   1. Build MigrationGraph from all sources (system + app)
 *   2. Replay all migration operations → historyState (ProjectState)
 *   3. Scan model files → currentState (ProjectState)
 *   4. Diff historyState vs currentState → list of operations
 *   5. If ops exist, write a new migration file
 *   6. If no ops, report "No changes detected"
 *
 * Critical separation:
 *   - NEVER touches the database
 *   - NEVER reads the database schema
 *   - NEVER writes to the database
 *   - Only reads model files and existing migration files
 */
class Makemigrations {
  /**
   * @param {string} modelsPath     — abs path to app/models/
   * @param {string} appMigPath     — abs path to database/migrations/
   * @param {string} systemMigPath  — abs path to millas/src/migrations/system/
   */
  constructor(modelsPath, appMigPath, systemMigPath, options = {}) {
    this._modelsPath      = modelsPath;
    this._appMigPath      = appMigPath;
    this._systemMigPath   = systemMigPath;
    this._nonInteractive  = options.nonInteractive || false;
  }

  /**
   * Run makemigrations.
   * Returns { files: string[], message: string, ops: object[] }
   */
  async run(options = {}) {
    // ── Step 1: Build graph from all migration sources ────────────────────────
    const graph = new MigrationGraph()
      .addSource('system', this._systemMigPath)
      .addSource('app',    this._appMigPath);

    graph.loadAll();

    // ── Step 2: Replay migrations → history state ─────────────────────────────
    const historyState = graph.buildState();

    // ── Step 3: Scan models → current state ───────────────────────────────────
    const scanner      = new ModelScanner(this._modelsPath);
    const currentState = scanner.scan();

    // ── Step 4: Diff ──────────────────────────────────────────────────────────
    const writer = new MigrationWriter();
    const ops    = writer.diff(historyState, currentState);

    if (ops.length === 0) {
      return { files: [], ops: [], message: 'No changes detected.' };
    }

    // ── Step 5: Detect field renames ─────────────────────────────────────────
    // Must happen BEFORE non-nullable resolution — a renamed field that is
    // non-nullable needs only one prompt, not two.
    // Django prompt: "Was student.age4 renamed to student.age7 (a IntegerField)? [y/N]"
    {
      const detector = new RenameDetector({
        nonInteractive: this._nonInteractive || options.nonInteractive,
      });
      const afterRename = await detector.detect(ops);
      ops.splice(0, ops.length, ...afterRename);
    }

    // ── Step 6: Resolve dangerous ops (non-nullable fields without defaults) ──
    // This MUST happen before writing — never during migrate.
    const dangerousOps = ops.filter(op => op._needsDefault);
    if (dangerousOps.length > 0) {
      const resolver = new InteractiveResolver({
        nonInteractive: this._nonInteractive || options.nonInteractive,
      });
      // resolveAll mutates ops in place (returns new array with resolved ops)
      const resolved = await resolver.resolveAll(ops);
      ops.splice(0, ops.length, ...resolved);
    }

    // Strip internal flags before writing
    ops.forEach(op => { delete op._needsDefault; delete op._madeNullable; });

    // ── Step 7: Compute file name and content ────────────────────────────────
    // Detect initial FIRST — isInitial must be known before naming the file
    const dependencies = this._buildDependencies(graph, ops);
    const appMigs      = graph.topoSortForSource('app');
    const isInitial    = appMigs.length === 0;

    const opName       = isInitial ? 'initial' : this._opsToName(ops);
    const nextNumber   = this._nextMigrationNumber();
    const fileName     = `${nextNumber}_${opName}.js`;
    const filePath     = path.join(this._appMigPath, fileName);

    const meta = {
      initial: isInitial,
      number:  nextNumber,
      date:    new Date().toISOString().replace('T', ' ').slice(0, 16),
    };

    const content = writer.render(ops, dependencies, opName, meta);

    // ── Dry run: return without writing ───────────────────────────────────────
    if (options.dryRun) {
      return { files: [fileName], ops, dryRun: true, message: `Would generate: ${fileName}` };
    }

    // ── Write ─────────────────────────────────────────────────────────────────
    await fs.ensureDir(this._appMigPath);
    await fs.writeFile(filePath, content, 'utf8');

    return {
      files:   [fileName],
      ops,
      message: `Generated ${ops.length} operation(s) in ${fileName}`,
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Determine the dependency list for the new migration file.
   *
   * Django's rule (which we mirror):
   *   1. Initial migration: depends on the leaf(s) of every source (system + app).
   *   2. Subsequent migrations: depends on the last app migration PLUS any system
   *      migration whose tables are directly referenced by the new ops but are NOT
   *      already transitively covered through the existing app migration chain.
   *      (e.g. extending a system model adds that system source as a dep — like Django's auth)
   *
   * @param {MigrationGraph} graph
   * @param {Array<object>}  ops — the new operations about to be written
   */
  _buildDependencies(graph, ops = []) {
    const appNodes  = graph.topoSortForSource('app');
    const isInitial = appNodes.length === 0;

    if (isInitial) {
      // First ever app migration.
      // Only include system deps if the new ops actually reference a system table —
      // same rule Django uses: empty dependencies = [] when models are self-contained.
      const deps = [];

      // Collect tables referenced by FK in the new ops
      const referencedTables = new Set();
      for (const op of ops) {
        const fieldEntries = op.fields ? Object.values(op.fields) : [];
        if (op.field) fieldEntries.push(op.field);
        for (const f of fieldEntries) {
          if (f && f.references && f.references.table) referencedTables.add(f.references.table);
        }
      }

      if (referencedTables.size === 0) return deps; // fully self-contained — no deps

      // Add system leaves whose tables are referenced
      const systemNodes = graph.topoSortForSource('system');
      const sysDepKeys  = new Set(
        systemNodes.flatMap(n => n.dependencies.map(([s, nm]) => `${s}:${nm}`))
      );
      const systemLeaves = systemNodes.filter(n => !sysDepKeys.has(n.key));

      for (const leaf of systemLeaves) {
        const tablesFromLeaf = new Set();
        for (const op of (leaf.operations || [])) {
          if (op.type === 'CreateModel' && op.table) tablesFromLeaf.add(op.table);
        }
        if ([...tablesFromLeaf].some(t => referencedTables.has(t))) {
          deps.push([leaf.source, leaf.name]);
        }
      }

      return deps;
    }

    // ── Non-initial ───────────────────────────────────────────────────────────

    // Start with the last app migration (leaf of app source)
    const appDepKeys = new Set(
      appNodes.flatMap(n => n.dependencies.map(([s, nm]) => `${s}:${nm}`))
    );
    const appLeaves = appNodes.filter(n => !appDepKeys.has(n.key));
    const deps = appLeaves.map(n => [n.source, n.name]);

    // Collect all tables already created by any migration in the full graph
    // (all are transitively reachable through the app chain)
    const coveredTables = new Set();
    for (const node of graph.topoSort()) {
      for (const op of (node.operations || [])) {
        if (op.type === 'CreateModel' && op.table) coveredTables.add(op.table);
      }
    }

    // Collect tables directly referenced via FK in the new ops
    const referencedTables = new Set();
    for (const op of ops) {
      const fieldEntries = op.fields ? Object.values(op.fields) : [];
      if (op.field) fieldEntries.push(op.field);
      for (const f of fieldEntries) {
        if (f && f.references && f.references.table) {
          referencedTables.add(f.references.table);
        }
      }
    }

    // For each system leaf: add it as a dep if it creates a table that is
    // referenced by the new ops but NOT already covered by existing migrations
    const alreadyDeclared = new Set(deps.map(([s, n]) => `${s}:${n}`));
    const systemNodes  = graph.topoSortForSource('system');
    const sysDepKeys   = new Set(
      systemNodes.flatMap(n => n.dependencies.map(([s, nm]) => `${s}:${nm}`))
    );
    const systemLeaves = systemNodes.filter(n => !sysDepKeys.has(n.key));

    for (const leaf of systemLeaves) {
      if (alreadyDeclared.has(leaf.key)) continue;
      const tablesFromLeaf = new Set();
      for (const op of (leaf.operations || [])) {
        if (op.type === 'CreateModel' && op.table) tablesFromLeaf.add(op.table);
      }
      const needsLeaf = [...tablesFromLeaf].some(
        t => referencedTables.has(t) && !coveredTables.has(t)
      );
      if (needsLeaf) deps.push([leaf.source, leaf.name]);
    }

    return deps;
  }


  _opsToName(ops) {
    if (ops.length === 0) return 'auto';

    // For initial migrations → 'initial'
    // For single op → descriptive name
    // For multiple ops → Django style: table_field1_field2 (up to 3 segments)

    if (ops.length === 1) {
      const op = ops[0];
      switch (op.type) {
        // 0001_students        (initial already handled above)
        case 'CreateModel':  return op.table;
        // 0009_delete_course
        case 'DeleteModel':  return `delete_${op.table}`;
        // 0004_student_age4
        case 'AddField':     return `${op.table}_${op.column}`;
        // 0008_remove_student_age8
        case 'RemoveField':  return `remove_${op.table}_${op.column}`;
        // 0007_alter_student_age8
        case 'AlterField':   return `alter_${op.table}_${op.column}`;
        // 0006_rename_age7_student_age8
        case 'RenameField':  return `rename_${op.oldColumn}_${op.table}_${op.newColumn}`;
        case 'RenameModel':  return `rename_${op.oldTable}`;
      }
    }

    // Multiple ops — build Django-style compound name from each op's contribution
    // 0005_remove_student_age4_student_age7  (Remove + Add)
    const segments = ops.slice(0, 3).map(op => {
      switch (op.type) {
        case 'CreateModel':  return op.table;
        case 'DeleteModel':  return `delete_${op.table}`;
        case 'AddField':     return `${op.table}_${op.column}`;
        case 'RemoveField':  return `${op.table}_${op.column}`;
        case 'AlterField':   return `alter_${op.table}_${op.column}`;
        case 'RenameField':  return `rename_${op.oldColumn}_${op.table}_${op.newColumn}`;
        default: {
          const table  = op.table || op.oldTable || 'change';
          const detail = op.column || op.oldColumn || '';
          return detail ? `${table}_${detail}` : table;
        }
      }
    });
    // Prefix with 'remove_' only when first op is a RemoveField (matches Django)
    const prefix = ops[0]?.type === 'RemoveField' ? 'remove_' : '';
    const joined = prefix + segments.join('_');
    return joined || 'auto';
  }

  /**
   * Return the next sequential 4-digit migration number as a string.
   * Scans existing files in appMigPath for the highest NNNN_ prefix.
   * First migration → '0001', second → '0002', etc. (Django style)
   */
  _nextMigrationNumber() {
    let max = 0;
    try {
      const files = require('fs').readdirSync(this._appMigPath);
      for (const f of files) {
        const m = f.match(/^(\d{4})_/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    } catch { /* directory doesn't exist yet */ }
    return String(max + 1).padStart(4, '0');
  }
}

module.exports = Makemigrations;