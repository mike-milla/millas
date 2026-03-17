'use strict';

/**
 * MySQL / MariaDB — drop all user tables in the active database.
 */
async function dropAllTables(db) {
  const dbName = db.client.config.connection.database;

  const rows = await db
    .select('TABLE_NAME as name')
    .from('information_schema.TABLES')
    .where('TABLE_SCHEMA', dbName)
    .where('TABLE_TYPE', 'BASE TABLE');

  if (rows.length === 0) return;

  await db.raw('SET FOREIGN_KEY_CHECKS = 0');

  for (const { name } of rows) {
    await db.schema.dropTableIfExists(name);
  }

  await db.raw('SET FOREIGN_KEY_CHECKS = 1');
}

module.exports = { dropAllTables };
