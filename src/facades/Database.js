'use strict';

const { createFacade } = require('./Facade');

/**
 * Database facade — Laravel-style DB access.
 *
 * Usage:
 *   const { Database } = require('millas');
 *   // or
 *   const Database = require('millas/facades/Database');
 *
 *   // Raw SQL
 *   const users = await Database.select('SELECT * FROM users WHERE id = ?', [1]);
 *   await Database.insert('INSERT INTO users (name, email) VALUES (?, ?)', ['John', 'john@example.com']);
 *   await Database.update('UPDATE users SET name = ? WHERE id = ?', ['Jane', 1]);
 *   await Database.delete('DELETE FROM users WHERE id = ?', [1]);
 *
 *   // Query Builder (most common)
 *   const users = await Database.table('users').get();
 *   const user = await Database.table('users').where('id', 1).first();
 *   await Database.table('users').insert({ name: 'John', email: 'john@example.com' });
 *   await Database.table('users').where('id', 1).update({ name: 'Jane' });
 *   await Database.table('users').where('id', 1).delete();
 *
 *   // Transactions
 *   await Database.transaction(async (trx) => {
 *     await trx.table('accounts').update({ balance: 100 });
 *     await trx.table('transactions').insert({ amount: 100 });
 *   });
 *
 *   // Multiple connections
 *   await Database.connection('mysql').table('users').get();
 *
 *   // Raw expressions
 *   await Database.table('users').select(Database.raw('COUNT(*) as total')).first();
 *
 * @class
 * @property {function(string): *}                    table       - Query builder for a table
 * @property {function(string, array=): Promise<*>}   raw         - Execute raw SQL
 * @property {function(string, array=): Promise<*>}   select      - SELECT query
 * @property {function(string, array=): Promise<*>}   insert      - INSERT query
 * @property {function(string, array=): Promise<*>}   update      - UPDATE query
 * @property {function(string, array=): Promise<*>}   delete      - DELETE query
 * @property {function(function): Promise<*>}         transaction - Run queries in transaction
 * @property {function(string=): *}                   connection  - Get named connection
 *
 * @see src/orm/drivers/DatabaseManager.js
 */
class Database extends createFacade('db') {
}

module.exports = Database;
