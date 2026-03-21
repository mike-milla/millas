'use strict';

const Translator = require('./Translator');

/**
 * Trans — global translation singleton + shorthand helpers.
 *
 * This is the object you import in controllers, models, views, and commands.
 * It wraps the Translator instance with the Django-style shorthand functions.
 *
 * ── Import styles ──────────────────────────────────────────────────────────
 *
 *   // Named destructuring (recommended)
 *   const { __, _n, _p, _f } = require('millas/src/i18n');
 *
 *   // Full facade for locale control
 *   const { Trans } = require('millas/src/i18n');
 *   Trans.setLocale('sw');
 *
 * ── API ────────────────────────────────────────────────────────────────────
 *
 *   __('Hello')
 *   → 'Habari'   (when locale=sw)
 *   → 'Hello'    (when locale=en or no translation found)
 *
 *   _n('You have %d message', 'You have %d messages', 3)
 *   → 'Una ujumbe 3'
 *
 *   _p('menu', 'File')
 *   → 'Faili'   (contextual — same word, different contexts)
 *
 *   _f('Welcome, {name}!', { name: 'Alice' })
 *   → 'Karibu, Alice!'
 *
 *   _f('Hello %s, you have %d items', 'Alice', 5)
 *   → 'Habari Alice, una vitu 5'
 *
 *   _fn('You have %d item', 'You have %d items', 3)
 *   → 'Una vitu 3'
 *
 * ── In templates (Nunjucks) ────────────────────────────────────────────────
 *
 *   Add the filters via I18nServiceProvider (done automatically):
 *
 *   {{ 'Hello' | __ }}
 *   {{ 'You have %d messages' | _n(count) }}
 *   {{ 'Welcome, {name}!' | _f({ name: user.name }) }}
 *
 * ── In CLI commands ────────────────────────────────────────────────────────
 *
 *   const { __ } = require('millas/src/i18n');
 *   console.log(__('Migrations applied successfully.'));
 */

// ── Singleton Translator instance ────────────────────────────────────────────
const Trans = new Translator();

// ── Shorthand functions ───────────────────────────────────────────────────────

/**
 * gettext — translate a string.
 *
 *   __('Hello')
 *   __('Hello', 'sw')    // explicit locale override
 *
 * @param {string} key
 * @param {string} [locale]
 * @returns {string}
 */
function __(key, locale) {
  return Trans.translate(key, locale);
}

/**
 * ngettext — singular/plural translation.
 *
 *   _n('You have %d message', 'You have %d messages', count)
 *
 * Note: this does NOT interpolate %d — call _fn() if you also need
 * the count substituted into the string.
 *
 * @param {string} singular
 * @param {string} plural
 * @param {number} count
 * @param {string} [locale]
 * @returns {string}
 */
function _n(singular, plural, count, locale) {
  return Trans.ngettext(singular, plural, count, locale);
}

/**
 * pgettext — contextual translation.
 *
 *   _p('menu', 'File')     // the menu item "File"
 *   _p('action', 'File')   // the action "to file something"
 *
 * @param {string} context
 * @param {string} key
 * @param {string} [locale]
 * @returns {string}
 */
function _p(context, key, locale) {
  return Trans.pgettext(context, key, locale);
}

/**
 * format — translate + interpolate named or positional variables.
 *
 *   _f('Welcome, {name}!', { name: 'Alice' })
 *   _f('Hello %s, you have %d items', 'Alice', 5)
 *
 * @param {string} key
 * @param {...*}   args
 * @returns {string}
 */
function _f(key, ...args) {
  return Trans.format(key, ...args);
}

/**
 * nformat — plural translation + interpolation.
 *
 *   _fn('You have %d item', 'You have %d items', count)
 *   // → 'You have 3 items'  (count is auto-interpolated as first %d)
 *
 * @param {string} singular
 * @param {string} plural
 * @param {number} count
 * @param {...*}   args  — additional interpolation values after count
 * @returns {string}
 */
function _fn(singular, plural, count, ...args) {
  return Trans.nformat(singular, plural, count, ...args);
}

/**
 * lazy — returns a lazy-evaluated translation proxy.
 *
 * Useful when the translation needs to be stored before the locale is set
 * (e.g. in class-level constants, model field labels).
 *
 *   const label = lazy__('Email address');
 *   // label() → 'Anwani ya barua pepe'   (evaluated at call time)
 *
 * @param {string} key
 * @returns {Function}
 */
function lazy__(key) {
  return () => Trans.translate(key);
}

module.exports = {
  // Singleton for locale control + advanced usage
  Trans,

  // Shorthand functions
  __,
  _n,
  _p,
  _f,
  _fn,
  lazy__,
};
