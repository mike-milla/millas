'use strict';

/**
 * BaseOperation
 *
 * Abstract base class for all migration operations.
 *
 * Every operation must implement:
 *   applyState(projectState)  — mutate the in-memory ProjectState (no DB touch)
 *   up(db)                    — apply the change to the live database
 *   down(db)                  — revert the change from the live database
 *   toJSON()                  — return a plain serialisable descriptor
 *
 * The `type` property is set by each subclass and must match the key used
 * in the deserialise() registry in registry.js.
 */
class BaseOperation {
  /**
   * Mutate the in-memory ProjectState.
   * Called during migration graph replay (makemigrations) — never touches DB.
   * @param {import('../ProjectState').ProjectState} _state
   */
  // eslint-disable-next-line no-unused-vars
  applyState(_state) {
    throw new Error(`${this.constructor.name}.applyState() not implemented`);
  }

  /**
   * Apply this operation to the live database (forward migration).
   * @param {import('knex').Knex} _db
   */
  // eslint-disable-next-line no-unused-vars
  async up(_db) {
    throw new Error(`${this.constructor.name}.up() not implemented`);
  }

  /**
   * Revert this operation from the live database (rollback).
   * @param {import('knex').Knex} _db
   */
  // eslint-disable-next-line no-unused-vars
  async down(_db) {
    throw new Error(`${this.constructor.name}.down() not implemented`);
  }

  /**
   * Return a plain, JSON-serialisable descriptor for this operation.
   * Used by MigrationWriter to write migration files and by MigrationGraph
   * to reload them via deserialise().
   * @returns {object}
   */
  toJSON() {
    throw new Error(`${this.constructor.name}.toJSON() not implemented`);
  }
}

module.exports = { BaseOperation };