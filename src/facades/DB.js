'use strict';

const path = require('path');
const fs = require('fs');

/**
 * DB Facade - Django-style database access
 * 
 * Auto-configures on first use by loading config/database.js
 * 
 * Usage:
 *   const DB = require('millas/src/facades/DB');
 *   
 *   // Query builder
 *   const users = await DB.table('users').where('active', true).get();
 *   
 *   // Raw queries
 *   const result = await DB.select('SELECT * FROM users WHERE id = ?', [1]);
 *   
 *   // Transactions
 *   await DB.transaction(async (trx) => {
 *     await trx('users').insert({ name: 'John' });
 *     await trx('posts').insert({ title: 'Hello' });
 *   });
 *   
 *   // Direct connection
 *   const db = DB.connection();
 *   await db('users').select('*');
 */
class DBFacade {
  constructor() {
    this._manager = null;
    this._configured = false;
  }

  /**
   * Get the DatabaseManager instance (auto-configures if needed)
   */
  _getManager() {
    if (!this._configured) {
      this._configure();
    }
    return this._manager;
  }

  /**
   * Auto-configure by loading config/database.js
   */
  _configure() {
    if (this._configured) return;

    // Try to find config/database.js from current working directory
    const configPath = path.resolve(process.cwd(), 'config/database.js');
    
    if (!fs.existsSync(configPath)) {
      throw new Error(
        'config/database.js not found. Make sure you are in a Millas project directory.'
      );
    }

    const config = require(configPath);
    this._manager = require('../orm/drivers/DatabaseManager');
    this._manager.configure(config);
    this._configured = true;
  }

  /**
   * Get a database connection
   * @param {string} name - Connection name (optional, uses default if not provided)
   */
  connection(name) {
    return this._getManager().connection(name);
  }

  /**
   * Get the default connection
   */
  get db() {
    return this._getManager().db;
  }

  /**
   * Query builder for a table (Laravel: DB::table('users'))
   * @param {string} tableName
   */
  table(tableName) {
    return this._getManager().table(tableName);
  }

  /**
   * Execute raw SQL SELECT
   * @param {string} sql
   * @param {Array} bindings
   */
  async select(sql, bindings = []) {
    return this._getManager().select(sql, bindings);
  }

  /**
   * Execute INSERT
   * @param {string} sql
   * @param {Array} bindings
   */
  async insert(sql, bindings = []) {
    return this._getManager().insert(sql, bindings);
  }

  /**
   * Execute UPDATE
   * @param {string} sql
   * @param {Array} bindings
   */
  async update(sql, bindings = []) {
    return this._getManager().update(sql, bindings);
  }

  /**
   * Execute DELETE
   * @param {string} sql
   * @param {Array} bindings
   */
  async delete(sql, bindings = []) {
    return this._getManager().delete(sql, bindings);
  }

  /**
   * Execute raw SQL
   * @param {string} sql
   * @param {Array} bindings
   */
  async raw(sql, bindings = []) {
    return this._getManager().raw(sql, bindings);
  }

  /**
   * Run queries in a transaction
   * @param {Function} callback
   */
  async transaction(callback) {
    return this._getManager().transaction(callback);
  }

  /**
   * Begin a transaction manually
   */
  async beginTransaction() {
    return this._getManager().beginTransaction();
  }

  /**
   * Execute a statement
   * @param {string} sql
   * @param {Array} bindings
   */
  async statement(sql, bindings = []) {
    return this._getManager().statement(sql, bindings);
  }

  /**
   * Execute unprepared statement
   * @param {string} sql
   */
  async unprepared(sql) {
    return this._getManager().unprepared(sql);
  }

  /**
   * Get schema builder
   */
  get schema() {
    return this._getManager().schema;
  }

  /**
   * Close all database connections
   */
  async closeAll() {
    if (this._manager) {
      await this._manager.closeAll();
    }
  }

  /**
   * Close a specific connection
   * @param {string} name
   */
  async close(name) {
    if (this._manager) {
      await this._manager.close(name);
    }
  }
}

// Export singleton instance
module.exports = new DBFacade();
