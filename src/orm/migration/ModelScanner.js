'use strict';

const fs   = require('fs-extra');
const path = require('path');
const { ProjectState, normaliseField } = require('./ProjectState');
const { walkJs, extractClasses, isMillasModel, resolveTable } = require('./utils');

/**
 * ModelScanner
 *
 * Scans model files from disk and builds a ProjectState representing
 * the CURRENT state of the schema as defined in source code.
 *
 * This is the "current state" that makemigrations diffs against the
 * "reconstructed state" from migration files.
 *
 * ── Model loading convention ──────────────────────────────────────────────────
 *
 * Models are loaded from a single entry point — app/models/index.js —
 * which must export all models as named exports:
 *
 *   // app/models/index.js
 *   module.exports = { User, Post, Comment, Order };
 *
 * This mirrors Django's pattern where each app's models/__init__.py
 * explicitly imports and exposes every model class. The developer
 * decides what is registered — ModelScanner never auto-discovers files.
 *
 * Sub-folders are supported as long as index.js re-exports everything:
 *
 *   // app/models/index.js
 *   const { User }    = require('./auth/User');
 *   const { Post }    = require('./content/Post');
 *   module.exports    = { User, Post };
 *
 * ── Inheritance handling ──────────────────────────────────────────────────────
 *
 *   Abstract Base Class (static abstract = true):
 *     - No table created
 *     - Fields merged into every concrete subclass
 *
 *   Multi-table Inheritance (different static table from parent):
 *     - Parent gets its own table (already in migration history)
 *     - Child gets its own table
 *     - A OneToOne FK from child → parent is auto-injected
 *
 *   Same-table inheritance (child overrides fields, same static table):
 *     - Treated as one model — most-derived fields win
 *
 *   Proxy model (static proxy = true):
 *     - No table created, no migration generated
 */
class ModelScanner {
  constructor(modelsPath) {
    this._modelsPath = modelsPath;
  }

  /**
   * Scan all model files and return a ProjectState.
   * Never touches the database.
   */
  scan() {
    const state   = new ProjectState();
    const classes = this._loadAllClasses();

    // Two passes: first register concrete tables, then detect relationships
    const tableToClass = new Map(); // table → most-derived class

    for (const cls of classes) {
      // Skip abstract and proxy models — no table
      // Only skip if the class itself declares abstract/proxy (not inherited)
      if (cls.hasOwnProperty('abstract') && cls.abstract) continue;
      if (cls.hasOwnProperty('proxy') && cls.proxy) continue;

      const table = resolveTable(cls);
      if (!table) continue;

      // Keep the most-derived class for each table
      const existing = tableToClass.get(table);
      if (!existing || this._fieldCount(cls) >= this._fieldCount(existing)) {
        tableToClass.set(table, cls);
      }
    }

    // Build state from the canonical (most-derived) class per table
    for (const [table, cls] of tableToClass) {
      const fields = this._resolveFields(cls, classes, tableToClass);
      state.createModel(table, fields);
    }

    return state;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Load all model classes from app/models/index.js.
   *
   * The index must export all models as named (or default) exports.
   * ModelScanner never auto-discovers individual files — the developer
   * controls what is registered, exactly like Django's models/__init__.py.
   *
   * Falls back to scanning individual .js files in the models directory
   * only if index.js does not exist, so existing projects without an
   * index.js keep working. A warning is printed to encourage migration.
   */
  _loadAllClasses() {
    if (!fs.existsSync(this._modelsPath)) return [];

    const indexPath = path.join(this._modelsPath, 'index.js');

    // ── Primary path: load from index.js ────────────────────────────────
    if (fs.existsSync(indexPath)) {
      try { delete require.cache[require.resolve(indexPath)]; } catch {}
      let exported;
      try {
        exported = require(indexPath);
      } catch (err) {
        process.stderr.write(
          `  ✖  [makemigrations] Failed to load app/models/index.js: ${err.message}\n`
        );
        return [];
      }
      const classes = [];
      const candidates = extractClasses(exported);
      for (const cls of candidates) {
        if (isMillasModel(cls)) classes.push(cls);
      }
      return classes;
    }

    // ── Fallback: walk individual files (legacy — no index.js yet) ───────
    process.stderr.write(
      `  ⚠  [makemigrations] No app/models/index.js found. ` +
      `Create one that exports all your models to follow the recommended pattern.\n` +
      `  Falling back to file scanning (slower, may miss models in subfolders).\n`
    );

    const classes = [];
    const files   = walkJs(this._modelsPath);

    for (const fullPath of files) {
      try { delete require.cache[require.resolve(fullPath)]; } catch {}
      let exported;
      try {
        exported = require(fullPath);
      } catch (err) {
        process.stderr.write(
          `  ⚠  [makemigrations] Could not load ${path.relative(this._modelsPath, fullPath)}: ${err.message}\n`
        );
        continue;
      }
      const candidates = extractClasses(exported);
      for (const cls of candidates) {
        if (isMillasModel(cls)) classes.push(cls);
      }
    }

    return classes;
  }



  _resolveFields(cls, allClasses, tableToClass) {
    const fields = {};

    // Walk the prototype chain collecting fields, child overrides parent
    const chain = this._inheritanceChain(cls);

    for (const ancestor of chain.reverse()) {
      // Skip ancestors that have their own table (multi-table inheritance)
      // unless they are the starting class itself
      if (ancestor !== cls) {
        const ancestorTable = resolveTable(ancestor);
        if (ancestorTable && ancestorTable !== resolveTable(cls)) {
          // Multi-table: inject OneToOne FK instead of merging fields
          // The FK column name is `${ancestorTable.replace(/s$/, '')}_ptr`
          const ptrCol = `${ancestorTable.replace(/s$/, '')}_ptr`;
          fields[ptrCol] = normaliseField({
            type:      'integer',
            unsigned:  true,
            nullable:  false,
            unique:    true,
            references: { table: ancestorTable, column: 'id', onDelete: 'CASCADE' },
          });
          continue;
        }
      }

      // Merge fields from this ancestor (skip abstract flag, just take fields)
      if (ancestor.fields && typeof ancestor.fields === 'object') {
        for (const [name, def] of Object.entries(ancestor.fields)) {
          if (def && typeof def === 'object' && def.type === 'm2m') continue; // skip M2M
          // null = explicit removal, like Django's title = None — remove from merged set
          if (def === null) { delete fields[name]; continue; }
          // Django convention: ForeignKey declared as 'landlord' creates column 'landlord_id'.
          // If already ends with _id, use as-is to avoid double-appending.
          const colName = (def && def._isForeignKey && !name.endsWith('_id'))
            ? name + '_id'
            : name;
          fields[colName] = normaliseField(def);
        }
      }
    }

    return fields;
  }

  _inheritanceChain(cls) {
    const chain = [];
    let current = cls;
    while (current && current.fields !== undefined) {
      chain.push(current);
      current = Object.getPrototypeOf(current);
    }
    return chain; // child first, ancestors last
  }

  _fieldCount(cls) {
    return cls.fields ? Object.keys(cls.fields).length : 0;
  }

}

module.exports = ModelScanner;