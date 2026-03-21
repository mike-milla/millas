'use strict';

const path = require('path');
const fs   = require('fs');

/**
 * Translator
 *
 * The Millas i18n engine. Provides Django-style translation with:
 *   - _()    gettext — translate a string
 *   - _n()   ngettext — singular/plural
 *   - _p()   pgettext — contextual translation (same word, different meaning)
 *   - _f()   format  — translate + interpolate variables
 *
 * ── Translation file format ────────────────────────────────────────────────
 *
 * Translation files live in lang/ at the project root (configurable).
 * Each locale has its own JS or JSON file:
 *
 *   lang/
 *     en.js          ← source language (can be empty / identity)
 *     sw.js          ← Swahili
 *     fr.js          ← French
 *     ar.js          ← Arabic (RTL)
 *     es.js          ← Spanish
 *
 * File format (JS export or JSON):
 *
 *   // lang/sw.js
 *   module.exports = {
 *     // Simple string
 *     'Hello': 'Habari',
 *
 *     // Plural forms — array [singular, plural, ...] for complex pluralisation
 *     'You have %d message':  ['Una ujumbe %d', 'Una ujumbe %d'],
 *
 *     // Contextual — prefixed with context|
 *     'menu|File':  'Faili',
 *     'menu|Edit':  'Hariri',
 *
 *     // Interpolation uses %s (string), %d (number), {name} (named)
 *     'Welcome, %s!':        'Karibu, %s!',
 *     'Welcome, {name}!':    'Karibu, {name}!',
 *   };
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   const { __, _n, _p, _f } = require('millas/src/i18n');
 *
 *   // Basic
 *   __('Hello')                          // 'Habari'  (if locale=sw)
 *
 *   // Plural
 *   _n('You have %d message', 'You have %d messages', count)
 *
 *   // Contextual
 *   _p('menu', 'File')                   // 'Faili'
 *
 *   // Interpolation with named vars
 *   _f('Welcome, {name}!', { name: 'Alice' })
 *
 *   // Interpolation with positional
 *   _f('Hello, %s! You have %d items.', 'Alice', 3)
 *
 * ── Locale detection ───────────────────────────────────────────────────────
 *
 *   Locale is resolved in this order:
 *     1. Per-request override  — Trans.setLocale('sw') in middleware
 *     2. Accept-Language header — parsed from req automatically
 *     3. config/app.js locale  — static default ('en')
 *
 * ── Lazy loading ───────────────────────────────────────────────────────────
 *
 *   Translation files are loaded on first use and cached in memory.
 *   Reloading is possible in development with Trans.reload().
 *
 * ── Fallback chain ─────────────────────────────────────────────────────────
 *
 *   sw-KE → sw → en → original string (never throws, always returns something)
 */
class Translator {
  constructor() {
    /** Active locale — used when no per-call override is given */
    this._locale      = 'en';

    /** Default/fallback locale */
    this._fallback    = 'en';

    /** Directory where lang files live */
    this._langPath    = null;

    /** In-memory catalogue cache: Map<locale, catalogue> */
    this._catalogues  = new Map();

    /** Whether to warn when a translation key is missing */
    this._warnMissing = false;

    /** Set of missing keys collected during this session */
    this._missing     = new Set();
  }

  // ─── Configuration ────────────────────────────────────────────────────────

  /**
   * Configure the translator.
   *
   * @param {object} options
   * @param {string}  [options.locale='en']        — active locale
   * @param {string}  [options.fallback='en']       — fallback locale
   * @param {string}  [options.langPath]            — abs path to lang/ dir
   * @param {boolean} [options.warnMissing=false]   — log missing keys
   */
  configure({ locale, fallback, langPath, warnMissing } = {}) {
    if (locale      !== undefined) this._locale      = locale;
    if (fallback    !== undefined) this._fallback    = fallback;
    if (langPath    !== undefined) this._langPath    = langPath;
    if (warnMissing !== undefined) this._warnMissing = warnMissing;
    return this;
  }

  /**
   * Set the active locale.
   * In a web context, call this per-request in middleware.
   */
  setLocale(locale) {
    this._locale = this._normaliseLocale(locale);
    return this;
  }

  /**
   * Get the active locale.
   */
  getLocale() {
    return this._locale;
  }

  /**
   * Get a list of all available locales (files found in lang/).
   */
  availableLocales() {
    if (!this._langPath || !fs.existsSync(this._langPath)) return ['en'];
    return fs.readdirSync(this._langPath, { withFileTypes: true })
      .filter(e => (e.isFile() && /\.(js|json)$/.test(e.name)) || e.isDirectory())
      .map(e => e.name.replace(/\.(js|json)$/, ''));
  }

  /**
   * Reload all cached catalogues (useful in development).
   */
  reload() {
    this._catalogues.clear();
    return this;
  }

  // ─── Core translation functions ───────────────────────────────────────────

  /**
   * Translate a string (gettext).
   *
   *   __('Hello')
   *   __('Hello', 'sw')     // override locale for this call
   *
   * @param {string} key
   * @param {string} [locale]
   * @returns {string}
   */
  translate(key, locale) {
    const loc = this._normaliseLocale(locale || this._locale);

    // ── Namespace parsing: 'auth::Invalid 2FA code' ───────────────────────
    // Splits into { namespace: 'auth', bare: 'Invalid 2FA code' }
    // Bare keys (no ::) use namespace 'messages' (the default file).
    const { namespace, bare } = this._parseKey(key);
    const catalogue     = this._getCatalogue(loc, namespace);

    // Direct lookup using the bare key (without namespace prefix)
    // null means 'needs translation' — treat as missing, fall through
    if (catalogue[bare] !== undefined && catalogue[bare] !== null) {
      const val = catalogue[bare];
      if (Array.isArray(val) && val[0] === null) { /* plural not translated yet — fall through */ }
      else return Array.isArray(val) ? val[0] : String(val);
    }

    // Fallback locale
    if (loc !== this._fallback) {
      const fallCatalogue = this._getCatalogue(this._fallback, namespace);
      if (fallCatalogue[bare] !== undefined) {
        const val = fallCatalogue[bare];
        return Array.isArray(val) ? val[0] : String(val);
      }
    }

    this._recordMissing(key, loc);
    return bare; // return the bare key, not the full 'namespace::key'
  }

  /**
   * Translate with plural forms (ngettext).
   *
   *   _n('You have %d message', 'You have %d messages', count)
   *   _n('One item', '%d items', count, 'sw')
   *
   * The plural form index is chosen by getPluralForm() which handles
   * language-specific rules (Arabic has 6 forms, Russian has 3, etc.).
   *
   * @param {string} singular
   * @param {string} plural
   * @param {number} count
   * @param {string} [locale]
   * @returns {string}
   */
  ngettext(singular, plural, count, locale) {
    const loc = this._normaliseLocale(locale || this._locale);

    // Parse namespace from the singular key: 'auth::Invalid 2FA code'
    const { namespace, bare } = this._parseKey(singular);
    const catalogue = this._getCatalogue(loc, namespace);

    let forms;
    if (catalogue[bare] !== undefined && catalogue[bare] !== null) {
      const val = catalogue[bare];
      const arr = Array.isArray(val) ? val : [String(val), String(val)];
      if (!arr.some(v => v === null)) forms = arr; // only use if fully translated
    }
    if (!forms && loc !== this._fallback) {
      const fallCatalogue = this._getCatalogue(this._fallback, namespace);
      if (fallCatalogue[bare] !== undefined && fallCatalogue[bare] !== null) {
        const val = fallCatalogue[bare];
        forms = Array.isArray(val) ? val : [String(val), String(val)];
      }
    }

    if (!forms) {
      this._recordMissing(singular, loc);
      forms = [bare, plural ? this._parseKey(plural).bare : bare];
    }

    const idx = this._pluralIndex(count, loc);
    return forms[Math.min(idx, forms.length - 1)];
  }

  /**
   * Contextual translation (pgettext).
   * Use when the same word has different meanings in different contexts.
   *
   *   _p('menu', 'File')       // 'Faili' — the File menu
   *   _p('action', 'File')     // 'Faili' — the verb "to file"
   *
   * In the catalogue, context keys are stored as 'context|key'.
   *
   * @param {string} context
   * @param {string} key
   * @param {string} [locale]
   * @returns {string}
   */
  pgettext(context, key, locale) {
    return this.translate(`${context}|${key}`, locale) || key;
  }

  /**
   * Translate and interpolate variables (format).
   *
   * Supports two interpolation styles:
   *
   *   Named:      _f('Welcome, {name}!', { name: 'Alice' })
   *   Positional: _f('Hello, %s! You have %d items.', 'Alice', 3)
   *
   * @param {string} key
   * @param {...*}   args — either a single plain object (named) or positional values
   * @returns {string}
   */
  format(key, ...args) {
    const translated = this.translate(key);
    return this._interpolate(translated, args);
  }

  /**
   * Translate plural + interpolate.
   *
   *   _fn('You have %d message', 'You have %d messages', count)
   *   // → 'Una ujumbe 3'  (if locale=sw, count=3)
   *
   * @param {string} singular
   * @param {string} plural
   * @param {number} count
   * @param {...*}   args — interpolation values (count is always the first positional)
   * @returns {string}
   */
  nformat(singular, plural, count, ...args) {
    const translated = this.ngettext(singular, plural, count);
    // Prepend count so %d in the translated string gets the count value
    return this._interpolate(translated, [count, ...args]);
  }

  // ─── Middleware ───────────────────────────────────────────────────────────

  /**
   * Express middleware that detects the locale from:
   *   1. ?lang= query param
   *   2. X-Language header
   *   3. Accept-Language header
   *   4. Cookie (millas_lang)
   *   5. config default
   *
   * Sets req.locale and Trans.setLocale() for the duration of the request.
   *
   *   app.use(Trans.middleware())
   *
   * @param {object} [options]
   * @param {boolean} [options.cookie=true]   — read/write millas_lang cookie
   * @param {boolean} [options.query=true]    — read ?lang= query param
   * @param {string}  [options.cookieName='millas_lang']
   */
  middleware({ cookie = true, query = true, cookieName = 'millas_lang' } = {}) {
    const self = this;
    return function millaI18nMiddleware(req, res, next) {
      let locale = null;

      // 1. Query param: ?lang=sw
      if (query && req.query && req.query.lang) {
        locale = req.query.lang;
        // Persist to cookie so subsequent requests remember
        if (cookie) {
          // Locale is a non-sensitive preference value, not a security credential.
          // httpOnly: false is intentional here so client-side JS can read/switch
          // the locale without a round-trip. All other secure defaults still apply.
          res.cookie(cookieName, locale, {
            maxAge:   60 * 60 * 24 * 365,
            httpOnly: false,
            sameSite: 'Lax',
            secure:   process.env.NODE_ENV === 'production',
          });
        }
      }

      // 2. X-Language header (API clients)
      if (!locale && req.headers['x-language']) {
        locale = req.headers['x-language'];
      }

      // 3. Cookie
      if (!locale && cookie && req.cookies && req.cookies[cookieName]) {
        locale = req.cookies[cookieName];
      }

      // 4. Accept-Language header — take the first preferred language
      if (!locale && req.headers['accept-language']) {
        locale = self._parseAcceptLanguage(req.headers['accept-language']);
      }

      // 5. Fall back to configured default
      if (!locale) locale = self._locale;

      const normalised = self._normaliseLocale(locale);
      req.locale = normalised;

      // Make helper functions available on req so controllers can use them
      req.__ = (key, ...a)               => a.length ? self.format(key, ...a) : self.translate(key, normalised);
      req._n = (s, p, c, ...a)           => self.nformat(s, p, c, ...a);
      req._p = (ctx, key)                => self.pgettext(ctx, key, normalised);

      // Temporarily override locale for this request
      // (uses AsyncLocalStorage in a future version — for now simple override)
      const prev = self._locale;
      self.setLocale(normalised);
      res.on('finish', () => self.setLocale(prev));

      next();
    };
  }

  // ─── Missing key reporting ────────────────────────────────────────────────

  /**
   * Return all keys that had no translation during this session.
   * Useful for finding gaps in translation catalogues.
   */
  getMissingKeys() {
    return [...this._missing];
  }

  /**
   * Clear the missing keys log.
   */
  clearMissingKeys() {
    this._missing.clear();
    return this;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Load and cache a translation catalogue for a locale.
   * Returns an empty object for unknown locales (graceful degradation).
   */
  /**
   * Load and cache a translation catalogue for a locale + namespace.
   *
   * Supports two directory layouts — auto-detected:
   *
   *   Flat (single file per locale):
   *     lang/sw.js          ← all keys in one file, no namespacing
   *
   *   Namespaced (subdirectory per locale):
   *     lang/sw/auth.js     ← __('auth::...')
   *     lang/sw/messages.js ← __('...') bare keys
   *     lang/sw/admin.js    ← __('admin::...')
   *
   * When a subdirectory exists it takes priority over the flat file.
   * Within the subdirectory, the namespace maps directly to the filename:
   *   'auth'     → lang/sw/auth.js
   *   'messages' → lang/sw/messages.js  (also the default for bare keys)
   *
   * Falls back through: sw-KE → sw → fallback locale → empty object.
   * Never throws — always returns something.
   */
  _getCatalogue(locale, namespace = 'messages') {
    const cacheKey = `${locale}::${namespace}`;
    if (this._catalogues.has(cacheKey)) return this._catalogues.get(cacheKey);

    if (!this._langPath) {
      this._catalogues.set(cacheKey, {});
      return {};
    }

    // Resolve locale variants: sw-KE → try sw-KE first, then sw
    const variants = [locale];
    if (locale.includes('-')) variants.push(locale.split('-')[0]);

    for (const variant of variants) {
      // ── Try subdirectory layout first: lang/sw/auth.js ─────────────────
      const subDir = path.join(this._langPath, variant);
      if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
        // Try exact namespace name, then singular/plural variants so that
        // 'message.js' and 'messages.js' both work for the 'messages' namespace.
        const nsVariants = [namespace];
        if (namespace.endsWith('s')) nsVariants.push(namespace.slice(0, -1)); // messages → message
        else nsVariants.push(namespace + 's');                                 // message  → messages

        let nsFile = null;
        for (const nsv of nsVariants) {
          nsFile = this._loadFile(path.join(subDir, `${nsv}.js`))
                ?? this._loadFile(path.join(subDir, `${nsv}.json`));
          if (nsFile !== null) break;
        }

        if (nsFile !== null) {
          this._catalogues.set(cacheKey, nsFile);
          return nsFile;
        }
        // Namespace file not found in subdir — return empty (don't fall to flat)
        this._catalogues.set(cacheKey, {});
        return {};
      }

      // ── Flat layout: lang/sw.js — all keys in one file ─────────────────
      // For flat files, ignore namespace — everything lives in one catalogue.
      // Cache under all namespace variants so repeated lookups are fast.
      const flatFile = this._loadFile(path.join(this._langPath, `${variant}.js`))
                    ?? this._loadFile(path.join(this._langPath, `${variant}.json`));
      if (flatFile !== null) {
        // Cache this catalogue for every possible namespace key
        this._catalogues.set(`${locale}::${namespace}`, flatFile);
        this._catalogues.set(`${variant}::${namespace}`, flatFile);
        return flatFile;
      }
    }

    this._catalogues.set(cacheKey, {});
    return {};
  }

  /**
   * Load a single file safely. Returns null if not found or parse error.
   */
  _loadFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
      delete require.cache[require.resolve(filePath)];
      return require(filePath) || {};
    } catch (err) {
      process.stderr.write(`[i18n] Failed to load ${filePath}: ${err.message}\n`);
      return null;
    }
  }

  /**
   * Parse a key that may contain a namespace prefix.
   *
   *   'auth::Invalid 2FA code'  → { namespace: 'auth',     bare: 'Invalid 2FA code' }
   *   'Invalid 2FA code'        → { namespace: 'messages', bare: 'Invalid 2FA code' }
   *   'menu|File'               → { namespace: 'messages', bare: 'menu|File' }
   *
   * The '::' separator is chosen to avoid collision with '|' (pgettext context)
   * and '.' (common in English sentences).
   */
  _parseKey(key) {
    const sep = key.indexOf('::');
    if (sep === -1) return { namespace: 'messages', bare: key };
    return {
      namespace: key.slice(0, sep).trim() || 'messages',
      bare:      key.slice(sep + 2),
    };
  }

  /**
   * Normalise a locale string: 'en_US' → 'en-US', lowercase base.
   */
  _normaliseLocale(locale) {
    if (!locale) return this._fallback;
    return String(locale).replace(/_/g, '-').trim();
  }

  /**
   * Parse the first preferred language from an Accept-Language header.
   * 'sw-KE,sw;q=0.9,en;q=0.8' → 'sw-KE'
   */
  _parseAcceptLanguage(header) {
    if (!header) return null;
    const parts = header.split(',').map(p => {
      const [lang, q] = p.trim().split(';q=');
      return { lang: lang.trim(), q: q ? parseFloat(q) : 1 };
    });
    parts.sort((a, b) => b.q - a.q);
    return parts[0]?.lang || null;
  }

  /**
   * Choose the correct plural form index for a count in a given locale.
   *
   * Covers the most common plural rules. For full CLDR coverage, an
   * external library (intl-pluralrules) can be plugged in via configure().
   */
  _pluralIndex(count, locale) {
    const base = locale.split('-')[0].toLowerCase();

    switch (base) {
      // 1 form — no plurals (Chinese, Japanese, Korean, Thai, Vietnamese, Indonesian)
      case 'zh': case 'ja': case 'ko': case 'th': case 'vi': case 'id':
      case 'ms': case 'tr': case 'ka': case 'az':
        return 0;

      // 2 forms — standard (n != 1): English, German, French, Spanish, Portuguese, etc.
      case 'en': case 'de': case 'nl': case 'sv': case 'no': case 'da':
      case 'fi': case 'hu': case 'el': case 'he': case 'it': case 'es':
      case 'pt': case 'af': case 'bg': case 'ca': case 'et': case 'eu':
      case 'hi': case 'sw': case 'ur': case 'bn':
        return count !== 1 ? 1 : 0;

      // French: 0 and 1 are singular
      case 'fr':
        return count > 1 ? 1 : 0;

      // Russian, Ukrainian, Serbian, Croatian — 3 plural forms
      case 'ru': case 'uk': case 'sr': case 'hr': case 'bs': {
        const mod10 = count % 10, mod100 = count % 100;
        if (mod10 === 1 && mod100 !== 11) return 0;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 1;
        return 2;
      }

      // Polish — 3 plural forms
      case 'pl': {
        const mod10 = count % 10, mod100 = count % 100;
        if (count === 1) return 0;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 1;
        return 2;
      }

      // Czech, Slovak
      case 'cs': case 'sk':
        if (count === 1) return 0;
        if (count >= 2 && count <= 4) return 1;
        return 2;

      // Arabic — 6 plural forms
      case 'ar': {
        if (count === 0) return 0;
        if (count === 1) return 1;
        if (count === 2) return 2;
        const mod100 = count % 100;
        if (mod100 >= 3 && mod100 <= 10) return 3;
        if (mod100 >= 11 && mod100 <= 99) return 4;
        return 5;
      }

      // Latvian
      case 'lv':
        if (count === 0) return 0;
        if (count % 10 === 1 && count % 100 !== 11) return 1;
        return 2;

      default:
        return count !== 1 ? 1 : 0; // safe English default
    }
  }

  /**
   * Interpolate variables into a translated string.
   *
   * Supports:
   *   {name}  named placeholder — args[0] must be a plain object
   *   %s      positional string
   *   %d      positional number
   *   %f      positional float
   *   %i      positional integer
   */
  _interpolate(str, args) {
    if (!args || args.length === 0) return str;

    // Named placeholders: _f('Hello, {name}!', { name: 'Alice' })
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const vars = args[0];
      return str.replace(/\{(\w+)\}/g, (match, key) =>
        vars[key] !== undefined ? String(vars[key]) : match
      );
    }

    // Positional: _f('Hello %s, you have %d items', 'Alice', 3)
    let idx = 0;
    return str.replace(/%([sdfi])/g, (match, type) => {
      if (idx >= args.length) return match;
      const val = args[idx++];
      switch (type) {
        case 'd': case 'i': return String(Math.trunc(Number(val)));
        case 'f': return String(parseFloat(val));
        case 's': default: return String(val);
      }
    });
  }

  _recordMissing(key, locale) {
    const entry = `[${locale}] ${key}`;
    if (!this._missing.has(entry)) {
      this._missing.add(entry);
      if (this._warnMissing) {
        process.stderr.write(`[i18n] Missing translation: ${entry}\n`);
      }
    }
  }
}

module.exports = Translator;