'use strict';

/**
 * BaseValidator
 *
 * Foundation class for all field validators.
 * Every validator extends this and adds its own type-specific rules.
 *
 * All methods return `this` for chaining, and accept an optional
 * custom error message as their last argument.
 */
class BaseValidator {
  /**
   * @param {string} [typeError] — message shown when the value fails the base type check
   */
  constructor(typeError) {
    this._typeError    = typeError || null;
    this._required     = false;
    this._requiredMsg  = null;
    this._nullable     = false;
    this._defaultValue = undefined;
    this._customFns    = [];   // [{ fn: async (value, data) => string|null }]
    this._rules        = [];   // [{ check: fn, message: string }] — added by subclasses
    this._label        = null; // field name, set by Validator before running
  }

  // ─── Common modifiers ──────────────────────────────────────────────────────

  /**
   * Mark the field as required — fails if value is absent, null, or empty string.
   *   string().required()
   *   string().required('Name is required')
   */
  required(msg) {
    this._required    = true;
    this._requiredMsg = msg || null;
    return this;
  }

  /**
   * Mark the field as optional (default). Skips all other rules if absent.
   *   string().optional()
   */
  optional() {
    this._required = false;
    return this;
  }

  /**
   * Allow null as a valid value (passes even when null).
   */
  nullable() {
    this._nullable = true;
    return this;
  }

  /**
   * Set a default value used when the field is absent.
   *   string().optional().default('guest')
   *   number().optional().default(0)
   */
  default(value) {
    this._defaultValue = value;
    return this;
  }

  /**
   * Add a custom validation function.
   * Return a string (the error message) to fail, or null/undefined to pass.
   *
   *   string().custom(async (value, allData) => {
   *     const exists = await User.where('email', value).exists();
   *     if (exists) return 'Email is already taken';
   *   })
   */
  custom(fn) {
    this._customFns.push(fn);
    return this;
  }

  /**
   * Set the human-readable label used in default error messages.
   * Automatically set by Validator from the field key.
   *   string().label('Email address')
   */
  label(name) {
    this._label = name;
    return this;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  /**
   * Human-readable field name for error messages.
   */
  _fieldLabel(key) {
    return this._label || _titleCase(key);
  }

  /**
   * Returns true if the value is considered "empty" for required checking.
   */
  _isEmpty(value) {
    return value === undefined || value === null || value === '';
  }

  /**
   * Add a rule to the internal rule list (used by subclasses).
   * @param {Function} check    — (value) => boolean  (true = valid)
   * @param {string}   message  — error message if check fails
   */
  _addRule(check, message) {
    this._rules.push({ check, message });
    return this;
  }

  /**
   * Type check — subclasses override to validate the base type.
   * Returns an error string if invalid, null if valid.
   *
   * @param {*}      value
   * @param {string} key     — field name
   * @returns {string|null}
   */
  _checkType(value, key) {
    return null; // base has no type restriction
  }

  /**
   * Run the full validation for this field.
   *
   * @param {*}      value   — the raw input value
   * @param {string} key     — field name (for error messages)
   * @param {object} allData — entire request data (for cross-field rules)
   * @returns {Promise<{ error: string|null, value: * }>}
   */
  async run(value, key, allData = {}) {
    const label = this._fieldLabel(key);

    // ── Apply default ───────────────────────────────────────────────────────
    if (this._isEmpty(value) && this._defaultValue !== undefined) {
      value = typeof this._defaultValue === 'function'
        ? this._defaultValue()
        : this._defaultValue;
    }

    // ── Null check ──────────────────────────────────────────────────────────
    if (value === null && this._nullable) {
      return { error: null, value: null };
    }

    // ── Required check ──────────────────────────────────────────────────────
    if (this._isEmpty(value)) {
      if (this._required) {
        return {
          error: this._requiredMsg || `${label} is required`,
          value,
        };
      }
      // Optional and empty — skip all other rules
      return { error: null, value };
    }

    // ── Type check ──────────────────────────────────────────────────────────
    const typeErr = this._checkType(value, key);
    if (typeErr) {
      return { error: this._typeError || typeErr, value };
    }

    // ── Field-specific rules ─────────────────────────────────────────────────
    for (const { check, message } of this._rules) {
      if (!check(value, allData)) {
        return { error: message, value };
      }
    }

    // ── Custom functions ─────────────────────────────────────────────────────
    for (const fn of this._customFns) {
      const result = await fn(value, allData);
      if (result) return { error: result, value };
    }

    return { error: null, value };
  }
}

function _titleCase(str) {
  return String(str)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { BaseValidator, _titleCase };
