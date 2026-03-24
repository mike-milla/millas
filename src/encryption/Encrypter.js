'use strict';

const crypto = require('crypto');

// ── Supported ciphers ─────────────────────────────────────────────────────────

const CIPHER_CONFIG = {
  'AES-128-CBC': { keyBytes: 16, ivBytes: 16 },
  'AES-256-CBC': { keyBytes: 32, ivBytes: 16 },
  'AES-128-GCM': { keyBytes: 16, ivBytes: 12, gcm: true },
  'AES-256-GCM': { keyBytes: 32, ivBytes: 12, gcm: true },
};

// ── EncryptionError ───────────────────────────────────────────────────────────

class EncryptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EncryptionError';
  }
}

class DecryptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DecryptionError';
  }
}

// ── Encrypter ─────────────────────────────────────────────────────────────────

/**
 * Encrypter
 *
 * Laravel-style AES encryption service.
 * Registered in the container as 'encrypter'.
 * Access via the Encrypt facade — never instantiate directly.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * Every encrypted payload is a base64-encoded JSON object:
 *
 *   {
 *     iv:  "<base64 iv>",
 *     val: "<base64 ciphertext>",
 *     mac: "<hex HMAC-SHA256>",       // CBC only
 *     tag: "<base64 auth tag>",       // GCM only
 *     ser: true                       // if value was JSON-serialised
 *   }
 *
 * The MAC (CBC) or auth tag (GCM) prevents tampered payloads from decrypting.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const { Encrypt } = require('millas/facades/Encrypt');
 *
 *   // Encrypt any JS value (objects, arrays, strings, numbers)
 *   const token = Encrypt.encrypt({ userId: 1, role: 'admin' });
 *
 *   // Decrypt back
 *   const payload = Encrypt.decrypt(token);
 *   // → { userId: 1, role: 'admin' }
 *
 *   // Encrypt a raw string — skips JSON serialisation
 *   const raw = Encrypt.encryptString('hello');
 *   const str = Encrypt.decryptString(raw);  // → 'hello'
 *
 *   // Key introspection
 *   Encrypt.supported('my-key', 'AES-256-CBC');   // → true / false
 *   Encrypt.getKey();     // → Buffer
 *   Encrypt.getCipher();  // → 'AES-256-CBC'
 */
class Encrypter {
  /**
   * @param {string|Buffer} key    — raw key (use generateKey() to create one)
   * @param {string}        cipher — 'AES-128-CBC' | 'AES-256-CBC' | 'AES-128-GCM' | 'AES-256-GCM'
   */
  constructor(key, cipher = 'AES-256-CBC') {
    const cipherUpper = cipher.toUpperCase();
    const config      = CIPHER_CONFIG[cipherUpper];

    if (!config) {
      throw new EncryptionError(
        `[Encrypt] Unsupported cipher "${cipher}". ` +
        `Supported: ${Object.keys(CIPHER_CONFIG).join(', ')}.`
      );
    }

    const keyBuf = typeof key === 'string' ? Buffer.from(key, 'base64') : key;

    if (keyBuf.length !== config.keyBytes) {
      throw new EncryptionError(
        `[Encrypt] Invalid key length for ${cipherUpper}. ` +
        `Expected ${config.keyBytes} bytes, got ${keyBuf.length}. ` +
        `Use Encrypter.generateKey('${cipherUpper}') to create a valid key.`
      );
    }

    this._key    = keyBuf;
    this._cipher = cipherUpper;
    this._config = config;
  }

  // ── Core ───────────────────────────────────────────────────────────────────

  /**
   * Encrypt a value (any JSON-serialisable type).
   * Returns a base64-encoded payload string.
   *
   *   Encrypt.encrypt({ userId: 1 })
   *   Encrypt.encrypt([1, 2, 3])
   *   Encrypt.encrypt('hello')
   *   Encrypt.encrypt(42)
   */
  encrypt(value) {
    return this._encrypt(JSON.stringify(value), true);
  }

  /**
   * Encrypt a raw string without JSON serialisation.
   * Use when you need deterministic round-tripping of plain strings.
   *
   *   Encrypt.encryptString('secret-token')
   */
  encryptString(value) {
    return this._encrypt(String(value), false);
  }

  /**
   * Decrypt a payload produced by encrypt().
   * Deserialises the JSON value back to the original type.
   *
   *   const obj = Encrypt.decrypt(token);  // → original object / array / primitive
   */
  decrypt(payload) {
    const raw = this._decrypt(payload);
    try {
      return JSON.parse(raw);
    } catch {
      throw new DecryptionError('[Encrypt] Failed to deserialise decrypted value.');
    }
  }

  /**
   * Decrypt a payload produced by encryptString().
   * Returns a plain string.
   *
   *   const str = Encrypt.decryptString(token);
   */
  decryptString(payload) {
    return this._decrypt(payload);
  }

  // ── Key / cipher info ──────────────────────────────────────────────────────

  /**
   * Return the raw key as a Buffer.
   */
  getKey() {
    return Buffer.from(this._key);
  }

  /**
   * Return the cipher name (e.g. 'AES-256-CBC').
   */
  getCipher() {
    return this._cipher;
  }

  /**
   * Check whether a given key + cipher combination is supported and valid.
   *
   *   Encrypter.supported(myKey, 'AES-256-CBC')  → true / false
   *
   * @param {string|Buffer} key
   * @param {string}        cipher
   * @returns {boolean}
   */
  static supported(key, cipher) {
    try {
      const config = CIPHER_CONFIG[(cipher || '').toUpperCase()];
      if (!config) return false;
      const keyBuf = typeof key === 'string' ? Buffer.from(key, 'base64') : key;
      return keyBuf.length === config.keyBytes;
    } catch {
      return false;
    }
  }

  // ── Key generation ─────────────────────────────────────────────────────────

  /**
   * Generate a cryptographically random key for the given cipher.
   * Returns a base64-encoded string — store this in your APP_KEY env var.
   *
   *   const key = Encrypter.generateKey('AES-256-CBC');
   *   // → 'base64:...'
   *
   * @param {string} cipher
   * @returns {string}
   */
  static generateKey(cipher = 'AES-256-CBC') {
    const config = CIPHER_CONFIG[cipher.toUpperCase()];
    if (!config) {
      throw new EncryptionError(`[Encrypt] Unknown cipher "${cipher}".`);
    }
    return 'base64:' + crypto.randomBytes(config.keyBytes).toString('base64');
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _encrypt(plaintext, serialised) {
    const iv = crypto.randomBytes(this._config.ivBytes);

    if (this._config.gcm) {
      return this._encryptGcm(plaintext, iv, serialised);
    }
    return this._encryptCbc(plaintext, iv, serialised);
  }

  _encryptCbc(plaintext, iv, serialised) {
    const cipher     = crypto.createCipheriv(this._cipher, this._key, iv);
    const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const ivB64      = iv.toString('base64');
    const valB64     = encrypted.toString('base64');
    const mac        = this._computeMac(ivB64, valB64);

    const payload = JSON.stringify({ iv: ivB64, val: valB64, mac, ser: serialised });
    return Buffer.from(payload).toString('base64');
  }

  _encryptGcm(plaintext, iv, serialised) {
    const cipher    = crypto.createCipheriv(this._cipher, this._key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag       = cipher.getAuthTag();
    const ivB64     = iv.toString('base64');
    const valB64    = encrypted.toString('base64');
    const tagB64    = tag.toString('base64');

    const payload = JSON.stringify({ iv: ivB64, val: valB64, tag: tagB64, ser: serialised });
    return Buffer.from(payload).toString('base64');
  }

  _decrypt(token) {
    // Decode and parse the envelope
    let envelope;
    try {
      const json = Buffer.from(token, 'base64').toString('utf8');
      envelope   = JSON.parse(json);
    } catch {
      throw new DecryptionError('[Encrypt] The payload is invalid — could not decode.');
    }

    if (!envelope || typeof envelope !== 'object') {
      throw new DecryptionError('[Encrypt] The payload is invalid — unexpected structure.');
    }

    if (this._config.gcm) {
      return this._decryptGcm(envelope);
    }
    return this._decryptCbc(envelope);
  }

  _decryptCbc(envelope) {
    const { iv: ivB64, val: valB64, mac } = envelope;

    if (!ivB64 || !valB64 || !mac) {
      throw new DecryptionError('[Encrypt] The payload is missing required CBC fields (iv, val, mac).');
    }

    // Verify MAC before decrypting — prevents padding oracle attacks
    const expectedMac = this._computeMac(ivB64, valB64);
    if (!crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expectedMac, 'hex'))) {
      throw new DecryptionError('[Encrypt] The MAC is invalid. The payload may have been tampered with.');
    }

    try {
      const iv        = Buffer.from(ivB64, 'base64');
      const encrypted = Buffer.from(valB64, 'base64');
      const decipher  = crypto.createDecipheriv(this._cipher, this._key, iv);
      return decipher.update(encrypted) + decipher.final('utf8');
    } catch (err) {
      throw new DecryptionError(`[Encrypt] Decryption failed: ${err.message}`);
    }
  }

  _decryptGcm(envelope) {
    const { iv: ivB64, val: valB64, tag: tagB64 } = envelope;

    if (!ivB64 || !valB64 || !tagB64) {
      throw new DecryptionError('[Encrypt] The payload is missing required GCM fields (iv, val, tag).');
    }

    try {
      const iv        = Buffer.from(ivB64, 'base64');
      const encrypted = Buffer.from(valB64, 'base64');
      const tag       = Buffer.from(tagB64, 'base64');
      const decipher  = crypto.createDecipheriv(this._cipher, this._key, iv);
      decipher.setAuthTag(tag);
      return decipher.update(encrypted) + decipher.final('utf8');
    } catch (err) {
      throw new DecryptionError(`[Encrypt] Decryption failed — GCM auth tag mismatch or corrupted payload.`);
    }
  }

  _computeMac(iv, val) {
    return crypto
      .createHmac('sha256', this._key)
      .update(iv + val)
      .digest('hex');
  }
}

// ── EncrypterManager ──────────────────────────────────────────────────────────

/**
 * EncrypterManager
 *
 * Container-registered service (bound as 'encrypter').
 * Reads APP_KEY and MILLAS_CIPHER from the environment and
 * delegates everything to the underlying Encrypter.
 *
 * ── Service provider registration ─────────────────────────────────────────────
 *
 *   container.singleton('encrypter', () => new EncrypterManager());
 */
class EncrypterManager {
  constructor(config = {}) {
    this._config   = config;
    this._instance = null;
  }

  /**
   * Resolve (and cache) the underlying Encrypter.
   * Lazily created so APP_KEY can be set after the manager is instantiated.
   */
  _driver() {
    if (this._instance) return this._instance;

    let key    = this._config.key    || process.env.APP_KEY    || '';
    const cipher = this._config.cipher || process.env.MILLAS_CIPHER || 'AES-256-CBC';

    // Strip the 'base64:' prefix Laravel / Millas uses for generated keys
    if (key.startsWith('base64:')) {
      key = key.slice(7);
    }

    if (!key) {
      throw new EncryptionError(
        '[Encrypt] No application key set. ' +
        'Set APP_KEY in your .env file. ' +
        'Generate one with: Encrypter.generateKey(\'AES-256-CBC\')'
      );
    }

    this._instance = new Encrypter(key, cipher);
    return this._instance;
  }

  // ── Delegated API ──────────────────────────────────────────────────────────

  encrypt(value)             { return this._driver().encrypt(value); }
  encryptString(value)       { return this._driver().encryptString(value); }
  decrypt(payload)           { return this._driver().decrypt(payload); }
  decryptString(payload)     { return this._driver().decryptString(payload); }
  getKey()                   { return this._driver().getKey(); }
  getCipher()                { return this._driver().getCipher(); }

  // ── Static passthroughs ───────────────────────────────────────────────────

  static supported(key, cipher) { return Encrypter.supported(key, cipher); }
  static generateKey(cipher)    { return Encrypter.generateKey(cipher); }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports               = new EncrypterManager();
module.exports.Encrypter     = Encrypter;
module.exports.EncrypterManager = EncrypterManager;
module.exports.EncryptionError  = EncryptionError;
module.exports.DecryptionError  = DecryptionError;