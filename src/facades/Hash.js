'use strict';

const { createFacade }              = require('./Facade');
const { HashManager, BcryptDriver } = require('../hashing/Hash');

/**
 * Hash facade — Laravel-style hashing.
 *
 * Resolved from the DI container as 'hash'.
 * Falls back to the exported singleton if used before the container boots
 * (e.g. in migrations or standalone scripts).
 *
 * @class
 *
 * ── Core ─────────────────────────────────────────────────────────────────────
 * @property {function(string, object=): Promise<string>}   make
 *   Hash a plain-text value.
 *   Options: { rounds: 14 } — overrides the configured rounds for this call.
 *
 * @property {function(string, string): Promise<boolean>}   check
 *   Verify a plain-text value against a stored hash.
 *   Returns false (never throws) if either argument is falsy.
 *
 * @property {function(string): boolean}                    needsRehash
 *   Returns true if the hash was made with different rounds than currently
 *   configured. Use after login to silently upgrade stored hashes:
 *     if (Hash.needsRehash(user.password)) {
 *       user.password = await Hash.make(plaintext);
 *       await user.save();
 *     }
 *
 * ── Introspection ─────────────────────────────────────────────────────────────
 * @property {function(string): { alg: string, rounds: number }}  info
 *   Return metadata about a stored hash.
 *   Example: Hash.info(hash) → { alg: 'bcrypt', rounds: 12 }
 *
 * @property {function(string): boolean}                          isHashed
 *   Return true if the value looks like a bcrypt hash.
 *   Guards against accidentally double-hashing:
 *     if (!Hash.isHashed(value)) value = await Hash.make(value);
 *
 * ── Driver access ─────────────────────────────────────────────────────────────
 * @property {function(string=): BcryptDriver}   driver
 *   Get a specific driver instance:
 *     Hash.driver('bcrypt').make('secret', { rounds: 14 });
 *
 * ── Configuration ─────────────────────────────────────────────────────────────
 * @property {function(number): HashManager}   setRounds
 *   Change the bcrypt rounds at runtime. Busts the driver cache.
 *   Useful in tests:  Hash.setRounds(4);
 *
 * @property {function(): number}              getRounds
 *   Return the currently configured bcrypt rounds.
 *
 * ── Testing ───────────────────────────────────────────────────────────────────
 * @property {function(object): void}   swap
 *   Swap the underlying instance for a fake:
 *     Hash.swap({ make: async () => 'hashed', check: async () => true });
 *
 * @property {function(): void}         restore
 *   Restore the real implementation after a swap.
 *
 * @see src/hashing/Hash.js
 */
class Hash extends createFacade('hash') {}

module.exports = Hash