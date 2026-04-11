'use strict';

const Millas = require('./container/MillasApp');
const DB = require('./facades/DB');

/**
 * @param {import('./types').MillasConfig} config
 * @returns {import('./types').MillasConfig}
 */
function defineConfig(config) {
  return config;
}

/**
 * @module millas
 */
module.exports = { Millas, DB, defineConfig };