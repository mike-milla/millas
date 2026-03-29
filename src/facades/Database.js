'use strict';

const Facade = require('./Facade');

/**
 * Database facade — direct access to the knex connection.
 *
 * Usage:
 *   const Database = require('millas/facades/Database');
 *
 *   // Raw SQL
 *   const result = await Database.raw('SELECT NOW()');
 *
 *   // Knex query builder
 *   const rows = await Database.table('posts').where('published', true).select('*');
 *
 *   // Named connection
 *   const rows = await Database.connection('replica').raw('SELECT 1');
 */
class Database {
  static _resolveInstance() {
    const DatabaseManager = require('../orm/drivers/DatabaseManager');
    return DatabaseManager.connection();
  }
}

// Proxy every static call to the knex connection
module.exports = new Proxy(Database, {
  get(target, prop) {
    // Let real static members through
    if (prop in target || prop === 'then' || prop === 'catch') {
      return target[prop];
    }
    if (typeof prop === 'symbol') return target[prop];

    // Special case: raw() — normalize result across dialects
    if (prop === 'raw') {
      return async (sql, bindings) => {
        const db = Database._resolveInstance();
        const result = await db.raw(sql, bindings);
        // Postgres returns { rows: [...], command, rowCount, ... }
        // SQLite/MySQL return [rows, fields] or just rows
        if (result && result.rows) return result.rows;
        if (Array.isArray(result)) return result[0] ?? result;
        return result;
      };
    }

    // Special case: connection(name) returns a named knex instance
    if (prop === 'connection') {
      return (name) => {
        const DatabaseManager = require('../orm/drivers/DatabaseManager');
        return DatabaseManager.connection(name || null);
      };
    }

    // Proxy everything else to the default knex connection
    return (...args) => {
      const db = Database._resolveInstance();
      if (typeof db[prop] !== 'function') return db[prop];
      return db[prop](...args);
    };
  },
});
