'use strict';

/**
 * DatabaseManager
 *
 * Creates and caches knex connection instances per named connection.
 * Reads from config/database.js (or the config object passed in).
 *
 * Usage:
 *   const db = DatabaseManager.connection();           // default
 *   const db = DatabaseManager.connection('mysql');    // named
 *   await db.schema.createTable(...)
 *   await db('users').select('*')
 */
class DatabaseManager {
  constructor() {
    this._connections = new Map();
    this._config      = null;
    this._default     = null;
  }

  /**
   * Configure the manager with a database config object.
   * Called automatically by DatabaseServiceProvider.
   */
  configure(config) {
    this._config  = config;
    this._default = config.default || 'sqlite';
  }

  /**
   * Get (or create) a knex connection by name.
   * @param {string} name — connection name from config/database.js
   */
  connection(name) {
    const connName = name || this._default;

    if (this._connections.has(connName)) {
      return this._connections.get(connName);
    }

    const conn = this._makeConnection(connName);
    this._connections.set(connName, conn);
    return conn;
  }

  /**
   * Shorthand for the default connection.
   */
  get db() {
    return this.connection();
  }

  /**
   * Close all connections.
   */
  async closeAll() {
    for (const [, conn] of this._connections) {
      await conn.destroy();
    }
    this._connections.clear();
  }

  /**
   * Close a specific connection.
   */
  async close(name) {
    const conn = this._connections.get(name || this._default);
    if (conn) {
      await conn.destroy();
      this._connections.delete(name || this._default);
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _makeConnection(name) {
    if (!this._config) {
      throw new Error(
        'DatabaseManager not configured. ' +
        'Did you boot DatabaseServiceProvider?'
      );
    }

    const conf = this._config.connections?.[name];
    if (!conf) {
      throw new Error(`Database connection "${name}" is not defined in config/database.js`);
    }

    const knex = require('knex');

    switch (conf.driver) {
      case 'sqlite':
        return knex({
          client:            'sqlite3',
          connection:        { filename: conf.database },
          useNullAsDefault:  true,
          asyncStackTraces:  process.env.NODE_ENV !== 'production',
        });

      case 'mysql':
        return knex({
          client:     'mysql2',
          connection: {
            host:     conf.host,
            port:     conf.port,
            database: conf.database,
            user:     conf.username,
            password: conf.password,
          },
          pool: { min: 2, max: 10 },
        });

      case 'postgres':
        return knex({
          client:     'pg',
          connection: {
            host:     conf.host,
            port:     conf.port,
            database: conf.database,
            user:     conf.username,
            password: conf.password,
          },
          pool: { min: 2, max: 10 },
        });

      default:
        throw new Error(`Unsupported database driver: "${conf.driver}"`);
    }
  }
}

// Singleton — shared across the whole application
const manager = new DatabaseManager();
module.exports = manager;
