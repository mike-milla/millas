'use strict';

const fs   = require('fs-extra');
const path = require('path');

/**
 * utils.js — shared utilities for the migration system
 *
 * Every function here was previously duplicated across two or more files.
 * Single source of truth — import from here, never re-implement.
 *
 * Exports:
 *   walkJs(dir)                    — recursively collect .js files
 *   extractClasses(exported)       — pull class candidates from a module export
 *   isMillasModel(cls)             — true if cls looks like a Millas Model
 *   resolveTable(cls)              — table name for a Model class (convention or explicit)
 *   modelNameToTable(name)         — PascalCase model name → snake_case plural table
 *   tableFromClass(cls)            — walk prototype chain to find nearest static table
 *   isSnakeCase(str)               — true if string is already snake_case
 *   fieldsEqual(a, b)              — schema-key equality, ignores internal FK flags
 */

// ─── File system ──────────────────────────────────────────────────────────────

/**
 * Recursively collect all .js files under a directory.
 * Skips dotfiles and index.js at any depth.
 *
 * @param {string} dir
 * @returns {string[]} absolute paths
 */
function walkJs(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJs(fullPath));
    } else if (entry.name.endsWith('.js') && entry.name !== 'index.js') {
      results.push(fullPath);
    }
  }

  return results;
}

// ─── Model class detection ────────────────────────────────────────────────────

/**
 * Given a module export (class, object, or anything), return every
 * function/class value that could be a Model subclass.
 *
 * Handles:
 *   module.exports = MyModel              → [MyModel]
 *   module.exports = { User, Post }       → [User, Post]
 *
 * @param {*} exported
 * @returns {Function[]}
 */
function extractClasses(exported) {
  if (!exported) return [];
  if (typeof exported === 'function') return [exported];
  if (typeof exported === 'object') {
    return Object.values(exported).filter(v => typeof v === 'function');
  }
  return [];
}

/**
 * A class qualifies as a Millas Model if:
 *   - It is a function (class)
 *   - It has a static `fields` property that is a non-null object with at least one key
 *
 * Intentionally avoids instanceof checks so this works regardless of which
 * resolution path Model was loaded from (e.g. during tests or monorepo setups).
 *
 * @param {*} cls
 * @returns {boolean}
 */
function isMillasModel(cls) {
  if (typeof cls !== 'function') return false;
  if (!cls.fields || typeof cls.fields !== 'object') return false;
  return Object.keys(cls.fields).length > 0;
}

// ─── Table name resolution ────────────────────────────────────────────────────

/**
 * Resolve the table name for a Model class.
 *
 * Rules (in priority order):
 *   1. Abstract class (hasOwnProperty 'abstract' === true) → null (no table)
 *   2. Explicitly declared via static set table(v) → stored in _table
 *   3. Explicitly declared as static string property
 *   4. Convention — auto-generated from class name via Model._defaultTable()
 *      (same as Laravel/Eloquent and Rails/ActiveRecord)
 *
 * @param {Function} cls — Model subclass
 * @returns {string|null}
 */
function resolveTable(cls) {
  if (Object.prototype.hasOwnProperty.call(cls, 'abstract') && cls.abstract) return null;
  if (Object.prototype.hasOwnProperty.call(cls, '_table') && cls._table) return cls._table;
  if (Object.prototype.hasOwnProperty.call(cls, 'table') && typeof cls.table === 'string' && cls.table) return cls.table;
  const generated = typeof cls.table === 'string' ? cls.table : null;
  return generated || null;
}

/**
 * Walk a Model class's prototype chain to find the nearest ancestor that
 * explicitly declares a static table property via hasOwnProperty.
 *
 * Correctly resolves:
 *   Concrete model:          User.table = 'users'      → 'users'
 *   Same-table child:        AdminUser extends User    → 'users'  (no own table)
 *   Multi-table child:       Employee.table='employees'→ 'employees'
 *   Abstract base:           AuthUser (abstract=true)  → null
 *
 * @param {Function} cls
 * @returns {string|null}
 */
function tableFromClass(cls) {
  let current = cls;
  while (current && current !== Function.prototype) {
    if (Object.prototype.hasOwnProperty.call(current, 'table') && current.table) {
      return current.table;
    }
    current = Object.getPrototypeOf(current);
  }
  return null;
}

/**
 * Convert a PascalCase model name to a snake_case plural table name.
 *
 * Used as a last resort when _fkModel is a string and no class reference
 * is available. Handles irregular pluralisation:
 *
 *   'User'          → 'users'
 *   'Category'      → 'categories'
 *   'TaggedPost'    → 'tagged_posts'
 *   'UnitCategory'  → 'unit_categories'
 *
 * @param {string} name — PascalCase model name
 * @returns {string} snake_case plural table name
 */
function modelNameToTable(name) {
  const snake = name
    .replace(/([A-Z])/g, (m, c, i) => (i ? '_' : '') + c.toLowerCase())
    .replace(/^_/, '');
  if (snake.endsWith('y') && !/[aeiou]y$/.test(snake)) return snake.slice(0, -1) + 'ies';
  if (/(?:s|sh|ch|x|z)$/.test(snake)) return snake + 'es';
  return snake + 's';
}

/**
 * Return true if the string is already a snake_case table name.
 * Detected by: all lowercase (no uppercase letters).
 *
 *   'users'           → true  (table name — return as-is)
 *   'unit_categories' → true  (table name — return as-is)
 *   'User'            → false (PascalCase — needs conversion)
 *   'UnitCategory'    → false (PascalCase — needs conversion)
 *
 * @param {string} str
 * @returns {boolean}
 */
function isSnakeCase(str) {
  return str === str.toLowerCase();
}

// ─── Field comparison ─────────────────────────────────────────────────────────

/**
 * Compare two normalised field definitions for schema equality.
 *
 * Only compares the 10 schema-relevant keys — ignores internal FK metadata
 * flags (_isForeignKey, _isOneToOne, _fkOnDelete, _fkRelatedName) which are
 * present on live-scanned fields but absent on replayed migration state.
 * Comparing those would cause phantom AlterField diffs on every makemigrations run.
 *
 * @param {object} a — normalised field def
 * @param {object} b — normalised field def
 * @returns {boolean}
 */
function fieldsEqual(a, b) {
  const SCHEMA_KEYS = [
    'type', 'nullable', 'unique', 'default', 'max',
    'unsigned', 'enumValues', 'references', 'precision', 'scale',
  ];
  for (const k of SCHEMA_KEYS) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

module.exports = {
  walkJs,
  extractClasses,
  isMillasModel,
  resolveTable,
  tableFromClass,
  modelNameToTable,
  isSnakeCase,
  fieldsEqual,
};