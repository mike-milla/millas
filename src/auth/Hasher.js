'use strict';

/**
 * Hasher
 *
 * Thin re-export of the canonical Hash singleton from hashing/Hash.js.
 *
 * All password hashing in the framework — Auth.register(), Auth.login(),
 * Auth.attempt(), AdminAuth.login(), createsuperuser CLI — flows through
 * this single file, which delegates to HashManager (hashing/Hash.js).
 *
 * This means one algorithm, one rounds config, one place to change either.
 *
 * Developers who need hashing directly should prefer the Hash facade:
 *   const { Hash } = require('millas/facades/Hash');
 *
 * Internal framework code uses this file so it works before the container
 * is booted (CLI commands, early bootstrap).
 */
const Hash = require('../hashing/Hash');

module.exports = Hash;
module.exports.Hasher = Hash.constructor;