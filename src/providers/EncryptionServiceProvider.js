'use strict';

const ServiceProvider        = require('./ServiceProvider');
const { EncrypterManager }   = require('../encryption/Encrypter');

/**
 * EncryptionServiceProvider
 *
 * Registers the Encrypter as a singleton in the DI container.
 * Reads APP_KEY and (optionally) MILLAS_CIPHER from config or environment.
 *
 * ── Registration ──────────────────────────────────────────────────────────────
 *
 * Add to bootstrap/app.js:
 *
 *   const { EncryptionServiceProvider } = require('millas/providers/EncryptionServiceProvider');
 *
 *   app.providers([
 *     EncryptionServiceProvider,
 *     // ... other providers
 *   ]);
 *
 * ── Configuration ─────────────────────────────────────────────────────────────
 *
 * The provider resolves keys in this order:
 *
 *   1. config/app.js  →  { key: '...', cipher: 'AES-256-CBC' }
 *   2. Environment variables  →  APP_KEY, MILLAS_CIPHER
 *   3. Defaults  →  cipher: 'AES-256-CBC'
 *
 * Example config/app.js:
 *
 *   module.exports = {
 *     key:    process.env.APP_KEY,
 *     cipher: 'AES-256-CBC',   // optional — default
 *   };
 *
 * ── Key generation ─────────────────────────────────────────────────────────────
 *
 * Generate a key for your .env file:
 *
 *   const { Encrypter } = require('millas/encryption/Encrypter');
 *   console.log(Encrypter.generateKey('AES-256-CBC'));
 *   // → 'base64:...'  ← paste this as APP_KEY=
 */
class EncryptionServiceProvider extends ServiceProvider {
  register(container) {
    container.singleton('encrypter', () => {
      const basePath = (() => { try { return container.make('basePath'); } catch { return process.cwd(); } })();

      let appConfig = {};
      try { appConfig = require(basePath + '/config/app'); } catch { /* no config/app.js */ }

      return new EncrypterManager({
        key:    appConfig.key    || process.env.APP_KEY    || '',
        cipher: appConfig.cipher || process.env.MILLAS_CIPHER || 'AES-256-CBC',
      });
    });

    // Aliases — 'encrypter', 'Encrypter', and 'crypt' all resolve to the same binding
    container.alias('Encrypter', 'encrypter');
    container.alias('crypt',     'encrypter');
  }
}

module.exports = EncryptionServiceProvider;
