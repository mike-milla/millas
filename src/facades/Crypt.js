'use strict';

const { createFacade }                              = require('./Facade');
const { Encrypter, EncrypterManager,
        EncryptionError, DecryptionError }          = require('../encryption/Encrypter');

/**
 * Crypt facade — Laravel-style AES encryption.
 *
 * Resolved from the DI container as 'encrypter'.
 * Identical in behaviour to the Encrypt facade — exists so that developers
 * familiar with Laravel can use the name they already know.
 *
 * @class
 *
 * ── Core ──────────────────────────────────────────────────────────────────────
 * @property {function(*): string}           encrypt
 *   Encrypt any JSON-serialisable value (object, array, string, number, boolean).
 *   Returns a base64-encoded ciphertext payload.
 *
 *     const token = Crypt.encrypt({ userId: 1, role: 'admin' });
 *     const token = Crypt.encrypt('hello');
 *     const token = Crypt.encrypt(42);
 *
 * @property {function(string): string}      encryptString
 *   Encrypt a raw string without JSON serialisation.
 *   Use for tokens, IDs, or any value you know is a string.
 *
 *     const token = Crypt.encryptString('reset-token-abc');
 *
 * @property {function(string): *}           decrypt
 *   Decrypt a payload produced by encrypt().
 *   Automatically deserialises JSON back to the original type.
 *   Throws DecryptionError if the payload is invalid or tampered.
 *
 *     const payload = Crypt.decrypt(token);  // → original object / value
 *
 * @property {function(string): string}      decryptString
 *   Decrypt a payload produced by encryptString().
 *   Returns a plain string.
 *   Throws DecryptionError if the payload is invalid or tampered.
 *
 *     const str = Crypt.decryptString(token);
 *
 * ── Key / cipher introspection ────────────────────────────────────────────────
 * @property {function(): Buffer}            getKey
 *   Return the raw key Buffer currently in use.
 *
 *     const key = Crypt.getKey();  // → Buffer
 *
 * @property {function(): string}            getCipher
 *   Return the cipher name in use (e.g. 'AES-256-CBC').
 *
 *     const cipher = Crypt.getCipher();  // → 'AES-256-CBC'
 *
 * ── Static helpers (do not go through the container) ─────────────────────────
 * @property {function(string|Buffer, string): boolean}  supported
 *   Check whether a key + cipher pair is valid before constructing an Encrypter.
 *
 *     Crypt.supported(myKey, 'AES-256-CBC');  // → true / false
 *
 * @property {function(string=): string}                 generateKey
 *   Generate a cryptographically random base64 key for a given cipher.
 *   The returned string includes the 'base64:' prefix — paste it into .env as APP_KEY.
 *
 *     const key = Crypt.generateKey();              // → 'base64:...' (AES-256-CBC)
 *     const key = Crypt.generateKey('AES-128-CBC'); // → 'base64:...'
 *
 * ── How encryption works ──────────────────────────────────────────────────────
 *
 * Every payload is a base64-encoded JSON envelope:
 *
 *   {
 *     iv:  "<base64 IV>",
 *     val: "<base64 ciphertext>",
 *     mac: "<hex HMAC-SHA256>",   // CBC only — prevents tampering
 *     tag: "<base64 auth tag>",   // GCM only — built-in authentication
 *     ser: true                   // present when value was JSON-serialised
 *   }
 *
 * CBC mode uses a separate HMAC-SHA256 MAC over (iv + ciphertext) and verifies
 * it with crypto.timingSafeEqual() before decrypting — guards against padding
 * oracle attacks.
 *
 * GCM mode uses the built-in auth tag; decryption throws if the tag is invalid.
 *
 * ── Configuration ─────────────────────────────────────────────────────────────
 *
 * APP_KEY and (optionally) MILLAS_CIPHER are read from the environment:
 *
 *   APP_KEY=base64:A3k9...        # required
 *   MILLAS_CIPHER=AES-256-CBC     # optional, default AES-256-CBC
 *
 * Supported ciphers: AES-128-CBC, AES-256-CBC, AES-128-GCM, AES-256-GCM
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const { Crypt } = require('millas/facades/Crypt');
 *
 *   // Encrypt / decrypt any value
 *   const token   = Crypt.encrypt({ userId: 1, plan: 'pro' });
 *   const payload = Crypt.decrypt(token);   // → { userId: 1, plan: 'pro' }
 *
 *   // Encrypt / decrypt raw strings
 *   const raw = Crypt.encryptString('api-secret-xyz');
 *   const str = Crypt.decryptString(raw);   // → 'api-secret-xyz'
 *
 *   // Generate a key (e.g. in a setup script)
 *   console.log(Crypt.generateKey());       // → 'base64:...'
 *
 *   // Check a key is valid before use
 *   if (!Crypt.supported(myKey, 'AES-256-CBC')) {
 *     throw new Error('Invalid key');
 *   }
 *
 * ── Testing ───────────────────────────────────────────────────────────────────
 * @property {function(object): void}   swap
 *   Swap the underlying instance for a fake in tests:
 *     Crypt.swap({ encrypt: (v) => 'fake', decrypt: (v) => original });
 *
 * @property {function(): void}         restore
 *   Restore the real implementation after a swap.
 *
 * @see src/encryption/Encrypter.js
 * @see src/facades/Encrypt.js
 */
class Crypt extends createFacade('encrypter') {
  static AES_128_CBC = 'AES-128-CBC';
  static AES_256_CBC = 'AES-256-CBC';
  static AES_128_GCM = 'AES-128-GCM';
  static AES_256_GCM = 'AES-256-GCM';

  /**
   * Check whether a key + cipher pair is valid.
   * Static helper — does not go through the container.
   *
   * @param {string|Buffer} key
   * @param {string}        cipher
   * @returns {boolean}
   */
  static supported(key, cipher) {
    return Encrypter.supported(key, cipher);
  }

  /**
   * Generate a cryptographically random base64 key for the given cipher.
   * Static helper — does not go through the container.
   *
   * The returned string includes the 'base64:' prefix so it can be pasted
   * directly into your .env file as APP_KEY.
   *
   *   const key = Crypt.generateKey();              // AES-256-CBC (default)
   *   const key = Crypt.generateKey('AES-128-CBC');
   *   const key = Crypt.generateKey('AES-256-GCM');
   *
   * @param {string} [cipher='AES-256-CBC']
   * @returns {string}  e.g. 'base64:A3k9...'
   */
  static generateKey(cipher = 'AES-256-CBC') {
    return Encrypter.generateKey(cipher);
  }


}

module.exports = Crypt;
