'use strict';

const ServiceProvider = require('./ServiceProvider');
const DatabaseManager = require('../orm/drivers/DatabaseManager');
const SchemaBuilder   = require('../orm/migration/SchemaBuilder');

/**
 * DatabaseServiceProvider
 *
 * Configures the DatabaseManager with the app's database config
 * and registers DB-related bindings into the container.
 *
 * Add to bootstrap/app.js:
 *   app.providers([DatabaseServiceProvider, AppServiceProvider])
 */
class DatabaseServiceProvider extends ServiceProvider {
  register(container) {
    // Make DatabaseManager available as a singleton in the container
    container.instance('db',              DatabaseManager);
    container.instance('DatabaseManager', DatabaseManager);
  }

  async boot(container) {
    const basePath = container.make('basePath') || process.cwd();
    // Load the database config
    let dbConfig;
    try {
      dbConfig = require(basePath + '/config/database');
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
      dbConfig = {
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', database: ':memory:' },
        },
      };
    }

    DatabaseManager.configure(dbConfig);

    // Register SchemaBuilder against the default connection
    container.instance('schema', new SchemaBuilder(DatabaseManager.connection()));
  }
}

module.exports = DatabaseServiceProvider;