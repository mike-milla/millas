'use strict';

const path        = require('path');
const fs          = require('fs');
const ServiceProvider = require('../providers/ServiceProvider');
const Translator  = require('./Translator');

/**
 * I18nServiceProvider
 *
 * Boots the translation system and registers the Trans singleton
 * into the DI container.
 *
 * ── Setup in bootstrap/app.js ─────────────────────────────────────────────
 *
 *   const { Millas } = require('millas');
 *   const I18nServiceProvider = require('millas/src/i18n/I18nServiceProvider');
 *
 *   module.exports = Millas.config()
 *     .providers([I18nServiceProvider, AppServiceProvider])
 *     .create();
 *
 * ── config/app.js ─────────────────────────────────────────────────────────
 *
 *   module.exports = {
 *     locale:   'en',       // default locale
 *     fallback: 'en',       // fallback when translation missing
 *   };
 *
 * ── lang/ directory ───────────────────────────────────────────────────────
 *
 *   Place translation files at <basePath>/lang/:
 *
 *   lang/
 *     en.js     ← source language
 *     sw.js     ← Swahili
 *     fr.js     ← French
 *
 * ── Route-level locale switching ──────────────────────────────────────────
 *
 *   Use the built-in middleware to auto-detect locale from requests:
 *
 *   const { Trans } = require('millas/src/i18n');
 *   app.use(Trans.middleware());
 *
 *   Or manually in a route:
 *   Trans.setLocale('sw');
 */
class I18nServiceProvider extends ServiceProvider {

  register(container) {
    // Register the Trans singleton into the DI container
    const trans = require('./index').Trans;
    container.instance('trans', trans);
    container.instance('Trans', trans);
    container.alias('i18n', 'trans');
  }

  async boot(container, app) {
    const basePath = container.make('basePath') || process.cwd();
    const trans    = container.make('trans');

    // Load config/app.js for locale settings
    let locale   = 'en';
    let fallback = 'en';
    let warnMissing = process.env.NODE_ENV !== 'production';

    try {
      const appConfig = require(path.join(basePath, 'config/app'));
      if (appConfig.locale)   locale   = appConfig.locale;
      if (appConfig.fallback) fallback = appConfig.fallback;
    } catch { /* config/app.js not found or no locale keys */ }

    // Lang path: <basePath>/lang/
    const langPath = path.join(basePath, 'lang');

    trans.configure({ locale, fallback, langPath, warnMissing });

    // Log available locales on startup in debug mode
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      const available = trans.availableLocales();
      if (available.length > 0 && !(available.length === 1 && available[0] === 'en')) {
        process.stdout.write(
          `[i18n] Locale: ${locale} | Fallback: ${fallback} | Available: ${available.join(', ')}\n`
        );
      }
    }
  }
}

module.exports = I18nServiceProvider;
