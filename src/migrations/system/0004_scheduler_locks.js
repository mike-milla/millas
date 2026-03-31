'use strict';

/**
 * System Migration: Scheduler Locks
 *
 * Creates the scheduler_locks table for distributed locking.
 * Prevents duplicate task execution across multiple app instances.
 *
 * This is a system migration - it runs automatically when you run `millas migrate`.
 */

module.exports = {
  async up(db) {
    await db.schema.createTable('scheduler_locks', (table) => {
      table.string('task_id', 255).primary();
      table.timestamp('locked_at').notNullable();
      table.timestamp('expires_at').notNullable();
      table.integer('instance_id').notNullable();
      
      // Index for cleanup queries
      table.index('expires_at', 'idx_scheduler_locks_expires');
    });

    console.log('  ✓ Created scheduler_locks table');
  },

  async down(db) {
    await db.schema.dropTableIfExists('scheduler_locks');
    console.log('  ✓ Dropped scheduler_locks table');
  },
};