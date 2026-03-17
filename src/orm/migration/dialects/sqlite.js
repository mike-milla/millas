'use strict';

/**
 * SQLite — drop all user tables.
 * Reads table names from sqlite_master.
 */
async function dropAllTables(db) {
  // Disable FK checks so drops don't fail on references
  await db.raw('PRAGMA foreign_keys = OFF');

  const tables = await db
    .select('name')
    .from('sqlite_master')
    .where('type', 'table')
    .whereNot('name', 'like', 'sqlite_%');

  for (const { name } of tables) {
    await db.schema.dropTableIfExists(name);
  }

  await db.raw('PRAGMA foreign_keys = ON');
}

module.exports = { dropAllTables };
