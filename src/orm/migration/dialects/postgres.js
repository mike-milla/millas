'use strict';

/**
 * PostgreSQL — drop all user tables in the public schema.
 */
async function dropAllTables(db) {
  const rows = await db
    .select('tablename')
    .from('pg_tables')
    .where('schemaname', 'public');

  if (rows.length === 0) return;

  const names = rows.map(r => `"${r.tablename}"`).join(', ');
  await db.raw(`DROP TABLE IF EXISTS ${names} CASCADE`);
}

module.exports = { dropAllTables };
