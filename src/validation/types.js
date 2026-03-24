'use strict';

/**
 * Millas Validation — Typed Field Builders
 *
 * Fluent, chainable validators that serve two purposes simultaneously:
 *   1. Runtime validation — run by Validator.validate() when a shape is applied
 *      to a route. Failures short-circuit to 422 before the handler runs.
 *   2. Docs generation  — read by SchemaInferrer to build the ApiField schema
 *      shown in the docs panel. .example() and .describe() are docs-only.
 *
 * All builders extend BaseValidator and are exported from millas/core/validation.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const { string, number, boolean, array, email, date, file, object } =
 *     require('millas/core/validation');
 *
 *   // In a shape:
 *   shape({
 *     name:     string().required().max(200).example('Jane Doe'),
 *     email:    email().required().example('jane@example.com'),
 *     age:      number().optional().min(13).max(120).example(25),
 *     active:   boolean().optional().example(true),
 *     tags:     array().of(string()).optional().example(['admin', 'user']),
 *     role:     string().required().oneOf(['admin', 'user', 'guest']),
 *     avatar:   file().optional().maxSize('5mb').mimeType(['image/jpeg','image/png']),
 *   })
 *
 *   // Inline in body.validate():
 *   const data = await body.validate({
 *     name:  string().required().max(100),
 *     email: email().required(),
 *   });
 */

const { BaseValidator, _titleCase } = require('./BaseValidator');

// ── StringValidator ────────────────────────────────────────────────────────────

class StringValidator extends BaseValidator {
  constructor() {
    super('Must be a string');
    this._type       = 'string';
    this._minLen     = null;
    this._maxLen     = null;
    this._oneOfVals  = null;
    this._emailCheck = false;
    this._urlCheck   = false;
    this._uuidCheck  = false;
    this._phoneCheck = false;
    this._regexCheck = null;
  }

  _checkType(value) {
    if (typeof value !== 'string') return this._typeError || 'Must be a string';
    return null;
  }

  /** Minimum character length */
  min(n, msg) {
    this._minLen = n;
    return this._addRule(
      v => typeof v === 'string' && v.length >= n,
      msg || `Must be at least ${n} character${n !== 1 ? 's' : ''}`
    );
  }

  /** Maximum character length */
  max(n, msg) {
    this._maxLen = n;
    return this._addRule(
      v => typeof v === 'string' && v.length <= n,
      msg || `Must not exceed ${n} character${n !== 1 ? 's' : ''}`
    );
  }

  /** Restrict to a set of allowed string values */
  oneOf(values, msg) {
    this._oneOfVals = values;
    return this._addRule(
      v => values.includes(v),
      msg || `Must be one of: ${values.join(', ')}`
    );
  }

  /** Must be a valid email address */
  email(msg) {
    this._emailCheck = true;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return this._addRule(
      v => re.test(String(v)),
      msg || 'Must be a valid email address'
    );
  }

  /** Must be a valid http/https URL */
  url(msg) {
    this._urlCheck = true;
    return this._addRule(v => {
      try {
        const u = new URL(String(v));
        return ['http:', 'https:'].includes(u.protocol);
      } catch { return false; }
    }, msg || 'Must be a valid URL');
  }

  /** Must be a valid UUID */
  uuid(msg) {
    this._uuidCheck = true;
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return this._addRule(v => re.test(String(v)), msg || 'Must be a valid UUID');
  }

  /** Must match a regex pattern */
  regex(pattern, msg) {
    this._regexCheck = pattern;
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    return this._addRule(v => re.test(String(v)), msg || 'Format is invalid');
  }

  /** Alias for .regex() — matches the docs API */
  matches(pattern, msg) {
    return this.regex(pattern, msg);
  }

  /** Must be a valid phone number (E.164 or common formats) */
  phone(msg) {
    this._phoneCheck = true;
    return this._addRule(
      v => /^\+?[\d\s\-().]{7,20}$/.test(String(v)),
      msg || 'Must be a valid phone number'
    );
  }

  /**
   * Value must match a corresponding <field>_confirmation field in the data.
   * Used for password confirmation:
   *   password: string().required().min(8).confirmed()
   *   // Automatically checks that password_confirmation matches
   */
  confirmed(msg) {
    this._confirmed = true;
    // The check function receives (value, allData) — we need allData
    // Store a flag; Validator.validate() handles the cross-field check
    // via a custom rule that captures the field name at bind time.
    // We use _addRule with a placeholder that gets replaced in validate().
    this._rules.push({
      _isConfirmed: true,
      message: msg || null,
    });
    return this;
  }

  /** Coerce to string after validation */
  _coerce(value) { return String(value); }
}

// ── EmailValidator — convenience alias for string().email() ──────────────────

class EmailValidator extends StringValidator {
  constructor() {
    super();
    this._type = 'email';
    this.email();
  }
}

// ── NumberValidator ────────────────────────────────────────────────────────────

class NumberValidator extends BaseValidator {
  constructor() {
    super('Must be a number');
    this._type      = 'number';
    this._minVal    = null;
    this._maxVal    = null;
    this._isInt     = false;
    this._isPos     = false;
    this._oneOfVals = null;
  }

  _checkType(value) {
    const n = Number(value);
    if (isNaN(n)) return this._typeError || 'Must be a number';
    return null;
  }

  /** Minimum value */
  min(n, msg) {
    this._minVal = n;
    return this._addRule(
      v => Number(v) >= n,
      msg || `Must be at least ${n}`
    );
  }

  /** Maximum value */
  max(n, msg) {
    this._maxVal = n;
    return this._addRule(
      v => Number(v) <= n,
      msg || `Must not exceed ${n}`
    );
  }

  /** Must be a whole number */
  integer(msg) {
    this._isInt = true;
    return this._addRule(
      v => Number.isInteger(Number(v)),
      msg || 'Must be a whole number'
    );
  }

  /** Must be greater than zero */
  positive(msg) {
    this._isPos = true;
    return this._addRule(
      v => Number(v) > 0,
      msg || 'Must be a positive number'
    );
  }

  /** Restrict to allowed numeric values */
  oneOf(values, msg) {
    this._oneOfVals = values;
    return this._addRule(
      v => values.includes(Number(v)),
      msg || `Must be one of: ${values.join(', ')}`
    );
  }

  _coerce(value) { return Number(value); }
}

// ── BooleanValidator ──────────────────────────────────────────────────────────

class BooleanValidator extends BaseValidator {
  constructor() {
    super('Must be a boolean');
    this._type = 'boolean';
  }

  _checkType(value) {
    const acceptable = [true, false, 'true', 'false', '1', '0', 1, 0, 'yes', 'no'];
    if (!acceptable.includes(value)) return this._typeError || 'Must be a boolean';
    return null;
  }

  _coerce(value) {
    if (value === true  || value === 'true'  || value === 1 || value === '1' || value === 'yes') return true;
    if (value === false || value === 'false' || value === 0 || value === '0' || value === 'no')  return false;
    return Boolean(value);
  }
}

// ── ArrayValidator ────────────────────────────────────────────────────────────

class ArrayValidator extends BaseValidator {
  constructor() {
    super('Must be an array');
    this._type      = 'array';
    this._itemValidator = null;
    this._minLen    = null;
    this._maxLen    = null;
  }

  _checkType(value) {
    if (!Array.isArray(value)) return this._typeError || 'Must be an array';
    return null;
  }

  /**
   * Validate each item in the array with another validator.
   *   array().of(string().min(2))
   *   array().of(number().positive())
   */
  of(validator) {
    this._itemValidator = validator;
    return this._addRule((arr, allData) => {
      if (!Array.isArray(arr)) return true; // type check handles this
      for (let i = 0; i < arr.length; i++) {
        const typeErr = validator._checkType(arr[i], `[${i}]`);
        if (typeErr) return false;
      }
      return true;
    }, `Each item ${this._itemValidator?._typeError || 'is invalid'}`);
  }

  /** Minimum number of items */
  min(n, msg) {
    this._minLen = n;
    return this._addRule(
      arr => Array.isArray(arr) && arr.length >= n,
      msg || `Must have at least ${n} item${n !== 1 ? 's' : ''}`
    );
  }

  /** Maximum number of items */
  max(n, msg) {
    this._maxLen = n;
    return this._addRule(
      arr => Array.isArray(arr) && arr.length <= n,
      msg || `Must have no more than ${n} item${n !== 1 ? 's' : ''}`
    );
  }
}

// ── DateValidator ─────────────────────────────────────────────────────────────

class DateValidator extends BaseValidator {
  constructor() {
    super('Must be a valid date');
    this._type      = 'date';
    this._beforeVal = null;
    this._afterVal  = null;
  }

  _checkType(value) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return this._typeError || 'Must be a valid date';
    return null;
  }

  /** Date must be before this value */
  before(date, msg) {
    this._beforeVal = date;
    const d = new Date(date);
    return this._addRule(
      v => new Date(v) < d,
      msg || `Must be before ${date}`
    );
  }

  /** Date must be after this value */
  after(date, msg) {
    this._afterVal = date;
    const d = new Date(date);
    return this._addRule(
      v => new Date(v) > d,
      msg || `Must be after ${date}`
    );
  }

  /** Date must be in the past (before now) */
  past(msg) {
    return this._addRule(
      v => new Date(v) < new Date(),
      msg || 'Must be a past date'
    );
  }

  /** Date must be in the future (after now) */
  future(msg) {
    return this._addRule(
      v => new Date(v) > new Date(),
      msg || 'Must be a future date'
    );
  }
}

// ── ObjectValidator ───────────────────────────────────────────────────────────

class ObjectValidator extends BaseValidator {
  /**
   * @param {object} [schema] — optional nested field schema
   *   object({ street: string().required(), city: string().required() })
   */
  constructor(schema) {
    super('Must be an object');
    this._type   = 'object';
    this._schema = schema || null;
  }

  _checkType(value) {
    if (typeof value !== 'object' || Array.isArray(value) || value === null) {
      return this._typeError || 'Must be an object';
    }
    return null;
  }

  /** Validate nested object fields (fluent alternative to constructor arg) */
  shape(schema) {
    this._schema = schema;
    return this;
  }
}

// ── FileValidator ─────────────────────────────────────────────────────────────

class FileValidator extends BaseValidator {
  constructor() {
    super('Must be a file');
    this._type         = 'file';
    this._maxSizeBytes = null;
    this._mimeTypes    = null;
  }

  _checkType(value) {
    // Files come through as multer file objects — just check it's present
    if (!value || typeof value !== 'object') return this._typeError || 'Must be a file';
    return null;
  }

  /**
   * Maximum file size.
   * Accepts bytes (number) or human string: '5mb', '500kb', '1gb'
   */
  maxSize(size, msg) {
    const bytes = typeof size === 'number' ? size : _parseSize(size);
    this._maxSizeBytes = bytes;
    return this._addRule(
      v => !v?.size || v.size <= bytes,
      msg || `File must not exceed ${size}`
    );
  }

  /**
   * Allowed MIME types.
   *   file().mimeTypes(['image/jpeg', 'image/png'])
   *   file().mimeTypes('image/jpeg')
   */
  mimeTypes(types, msg) {
    const allowed = Array.isArray(types) ? types : [types];
    this._mimeTypes = allowed;
    return this._addRule(
      v => !v?.mimetype || allowed.includes(v.mimetype),
      msg || `Must be one of: ${allowed.join(', ')}`
    );
  }

  /** Alias for backwards compatibility */
  mimeType(types, msg) { return this.mimeTypes(types, msg); }

  /**
   * Must be an image (jpeg, png, gif, webp, svg).
   *   file().image()
   *   file().image('Please upload an image')
   */
  image(msg) {
    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    this._mimeTypes = imageTypes;
    return this._addRule(
      v => !v?.mimetype || imageTypes.includes(v.mimetype),
      msg || 'Must be an image (jpeg, png, gif, webp, svg)'
    );
  }
}

function _parseSize(str) {
  const s = String(str).toLowerCase().trim();
  const n = parseFloat(s);
  if (s.endsWith('gb')) return n * 1024 * 1024 * 1024;
  if (s.endsWith('mb')) return n * 1024 * 1024;
  if (s.endsWith('kb')) return n * 1024;
  return n;
}

// ── Factory functions ─────────────────────────────────────────────────────────

const string  = () => new StringValidator();
const email   = () => new EmailValidator();
const number  = () => new NumberValidator();
const boolean = () => new BooleanValidator();
const array   = () => new ArrayValidator();
const date    = () => new DateValidator();
const object  = (schema) => new ObjectValidator(schema);
const file    = () => new FileValidator();

module.exports = {
  // Classes (for instanceof checks in SchemaInferrer)
  BaseValidator,
  StringValidator,
  EmailValidator,
  NumberValidator,
  BooleanValidator,
  ArrayValidator,
  DateValidator,
  ObjectValidator,
  FileValidator,
  // Factory functions
  string,
  email,
  number,
  boolean,
  array,
  date,
  object,
  file,
};