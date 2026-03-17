'use strict';

const { BaseValidator, _titleCase } = require('./BaseValidator');

// ── StringValidator ────────────────────────────────────────────────────────────

class StringValidator extends BaseValidator {
  /**
   * @param {string} [typeError] — shown when value is not a string
   *
   *   string('Must be text')
   *   string().required('Name is required').min(2, 'Too short')
   */
  constructor(typeError) {
    super(typeError || null);
  }

  _checkType(value) {
    if (typeof value !== 'string') return 'Must be a string';
    return null;
  }

  /** Minimum character length. */
  min(n, msg) {
    return this._addRule(
      v => String(v).length >= n,
      msg || ((key) => `${this._fieldLabel(key)} must be at least ${n} character${n === 1 ? '' : 's'}`)
    );
  }

  /** Maximum character length. */
  max(n, msg) {
    return this._addRule(
      v => String(v).length <= n,
      msg || ((key) => `${this._fieldLabel(key)} must not exceed ${n} character${n === 1 ? '' : 's'}`)
    );
  }

  /** Exact character length. */
  length(n, msg) {
    return this._addRule(
      v => String(v).length === n,
      msg || ((key) => `${this._fieldLabel(key)} must be exactly ${n} character${n === 1 ? '' : 's'}`)
    );
  }

  /** Match a regex pattern. */
  matches(regex, msg) {
    return this._addRule(
      v => regex.test(String(v)),
      msg || ((key) => `${this._fieldLabel(key)} format is invalid`)
    );
  }

  /** Must be one of the allowed values. */
  oneOf(values, msg) {
    return this._addRule(
      v => values.includes(v),
      msg || ((key) => `${this._fieldLabel(key)} must be one of: ${values.join(', ')}`)
    );
  }

  /** Letters only. */
  alpha(msg) {
    return this._addRule(
      v => /^[a-zA-Z]+$/.test(v),
      msg || ((key) => `${this._fieldLabel(key)} must contain only letters`)
    );
  }

  /** Letters and numbers only. */
  alphanumeric(msg) {
    return this._addRule(
      v => /^[a-zA-Z0-9]+$/.test(v),
      msg || ((key) => `${this._fieldLabel(key)} must contain only letters and numbers`)
    );
  }

  /** Valid URL. */
  url(msg) {
    return this._addRule(v => {
      try { new URL(v); return true; } catch { return false; }
    }, msg || ((key) => `${this._fieldLabel(key)} must be a valid URL`));
  }

  /** Lowercase only. */
  lowercase(msg) {
    return this._addRule(
      v => v === v.toLowerCase(),
      msg || ((key) => `${this._fieldLabel(key)} must be lowercase`)
    );
  }

  /** Uppercase only. */
  uppercase(msg) {
    return this._addRule(
      v => v === v.toUpperCase(),
      msg || ((key) => `${this._fieldLabel(key)} must be uppercase`)
    );
  }

  /**
   * Must match another field in the request (e.g. password confirmation).
   *   string().required().confirmed()                  // checks password_confirmation
   *   string().required().confirmed('confirmPassword') // custom field name
   */
  confirmed(field, msg) {
    this._confirmedField = field || null; // resolved at run-time
    this._confirmedMsg   = msg   || null;
    return this;
  }

  /**
   * Trim whitespace before validation (and in the returned value).
   */
  trim() {
    this._trim = true;
    return this;
  }

  async run(value, key, allData) {
    // Apply trim
    if (this._trim && typeof value === 'string') value = value.trim();

    const result = await super.run(value, key, allData);
    if (result.error) return result;

    // confirmed() check
    if (this._confirmedField !== undefined) {
      const confirmKey = this._confirmedField || `${key}_confirmation`;
      const match      = allData[confirmKey];
      if (result.value !== match) {
        return {
          error: this._confirmedMsg || `${this._fieldLabel(key)} confirmation does not match`,
          value,
        };
      }
    }

    return result;
  }
}

// ── EmailValidator ─────────────────────────────────────────────────────────────

class EmailValidator extends StringValidator {
  /**
   *   email()
   *   email('Please enter a valid email')
   */
  constructor(typeError) {
    super(typeError);
    // Auto-apply email format check
    this._emailCheck = true;
  }

  _checkType(value) {
    const base = super._checkType(value);
    if (base) return base;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return this._typeError || 'Must be a valid email address';
    }
    return null;
  }
}

// ── NumberValidator ────────────────────────────────────────────────────────────

class NumberValidator extends BaseValidator {
  constructor(typeError) {
    super(typeError || null);
    this._integer = false;
  }

  _checkType(value) {
    const n = Number(value);
    if (isNaN(n)) return this._typeError || 'Must be a number';
    return null;
  }

  /** Coerce string to number in the returned value. */
  async run(value, key, allData) {
    const result = await super.run(value, key, allData);
    // Coerce to number on success
    if (!result.error && result.value !== null && result.value !== undefined && result.value !== '') {
      result.value = Number(result.value);
    }
    return result;
  }

  /** Must be an integer. */
  integer(msg) {
    return this._addRule(
      v => Number.isInteger(Number(v)),
      msg || ((key) => `${this._fieldLabel(key)} must be an integer`)
    );
  }

  /** Minimum value. */
  min(n, msg) {
    return this._addRule(
      v => Number(v) >= n,
      msg || ((key) => `${this._fieldLabel(key)} must be at least ${n}`)
    );
  }

  /** Maximum value. */
  max(n, msg) {
    return this._addRule(
      v => Number(v) <= n,
      msg || ((key) => `${this._fieldLabel(key)} must be at most ${n}`)
    );
  }

  /** Must be positive (> 0). */
  positive(msg) {
    return this._addRule(
      v => Number(v) > 0,
      msg || ((key) => `${this._fieldLabel(key)} must be positive`)
    );
  }

  /** Must be negative (< 0). */
  negative(msg) {
    return this._addRule(
      v => Number(v) < 0,
      msg || ((key) => `${this._fieldLabel(key)} must be negative`)
    );
  }

  /** Must be between min and max (inclusive). */
  between(min, max, msg) {
    return this._addRule(
      v => Number(v) >= min && Number(v) <= max,
      msg || ((key) => `${this._fieldLabel(key)} must be between ${min} and ${max}`)
    );
  }
}

// ── BooleanValidator ───────────────────────────────────────────────────────────

class BooleanValidator extends BaseValidator {
  constructor(typeError) {
    super(typeError || null);
  }

  _checkType(value) {
    const truthy  = [true, 'true',  '1', 1, 'yes', 'on'];
    const falsy   = [false,'false', '0', 0, 'no',  'off'];
    if (!truthy.includes(value) && !falsy.includes(value)) {
      return this._typeError || 'Must be a boolean (true/false)';
    }
    return null;
  }

  async run(value, key, allData) {
    const result = await super.run(value, key, allData);
    if (!result.error && result.value !== null && result.value !== undefined && result.value !== '') {
      const truthy = [true, 'true', '1', 1, 'yes', 'on'];
      result.value = truthy.includes(result.value);
    }
    return result;
  }

  /** Must be true. */
  isTrue(msg) {
    return this._addRule(
      v => [true, 'true', '1', 1, 'yes', 'on'].includes(v),
      msg || ((key) => `${this._fieldLabel(key)} must be accepted`)
    );
  }
}

// ── DateValidator ──────────────────────────────────────────────────────────────

class DateValidator extends BaseValidator {
  constructor(typeError) {
    super(typeError || null);
  }

  _checkType(value) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return this._typeError || 'Must be a valid date';
    return null;
  }

  async run(value, key, allData) {
    const result = await super.run(value, key, allData);
    if (!result.error && result.value !== null && result.value !== undefined && result.value !== '') {
      result.value = new Date(result.value);
    }
    return result;
  }

  /** Must be after a given date. */
  after(date, msg) {
    const d = new Date(date);
    return this._addRule(
      v => new Date(v) > d,
      msg || ((key) => `${this._fieldLabel(key)} must be after ${d.toDateString()}`)
    );
  }

  /** Must be before a given date. */
  before(date, msg) {
    const d = new Date(date);
    return this._addRule(
      v => new Date(v) < d,
      msg || ((key) => `${this._fieldLabel(key)} must be before ${d.toDateString()}`)
    );
  }

  /** Must be in the future. */
  future(msg) {
    return this._addRule(
      v => new Date(v) > new Date(),
      msg || ((key) => `${this._fieldLabel(key)} must be a future date`)
    );
  }

  /** Must be in the past. */
  past(msg) {
    return this._addRule(
      v => new Date(v) < new Date(),
      msg || ((key) => `${this._fieldLabel(key)} must be a past date`)
    );
  }
}

// ── ArrayValidator ─────────────────────────────────────────────────────────────

class ArrayValidator extends BaseValidator {
  constructor(typeError) {
    super(typeError || null);
    this._itemValidator = null;
  }

  _checkType(value) {
    if (!Array.isArray(value)) return this._typeError || 'Must be an array';
    return null;
  }

  /**
   * Validate each item in the array with a given validator.
   *   array().of(string().min(1))
   *   array().of(number().positive())
   */
  of(validator) {
    this._itemValidator = validator;
    return this;
  }

  /** Minimum number of items. */
  min(n, msg) {
    return this._addRule(
      v => Array.isArray(v) && v.length >= n,
      msg || ((key) => `${this._fieldLabel(key)} must have at least ${n} item${n === 1 ? '' : 's'}`)
    );
  }

  /** Maximum number of items. */
  max(n, msg) {
    return this._addRule(
      v => Array.isArray(v) && v.length <= n,
      msg || ((key) => `${this._fieldLabel(key)} must have at most ${n} item${n === 1 ? '' : 's'}`)
    );
  }

  /** Exact number of items. */
  length(n, msg) {
    return this._addRule(
      v => Array.isArray(v) && v.length === n,
      msg || ((key) => `${this._fieldLabel(key)} must have exactly ${n} item${n === 1 ? '' : 's'}`)
    );
  }

  /** No duplicate values. */
  unique(msg) {
    return this._addRule(
      v => Array.isArray(v) && new Set(v).size === v.length,
      msg || ((key) => `${this._fieldLabel(key)} must not contain duplicates`)
    );
  }

  async run(value, key, allData) {
    const result = await super.run(value, key, allData);
    if (result.error || !result.value || !this._itemValidator) return result;

    // Validate each item
    const items  = result.value;
    const errors = [];

    for (let i = 0; i < items.length; i++) {
      const itemResult = await this._itemValidator.run(items[i], `${key}[${i}]`, allData);
      if (itemResult.error) errors.push(`Item ${i}: ${itemResult.error}`);
      else items[i] = itemResult.value; // apply coercions (e.g. string→number)
    }

    if (errors.length) return { error: errors.join('; '), value };

    return { error: null, value: items };
  }
}

// ── ObjectValidator ────────────────────────────────────────────────────────────

class ObjectValidator extends BaseValidator {
  /**
   * Validate a nested object against a schema.
   *
   *   object({
   *     street: string().required(),
   *     city:   string().required(),
   *     zip:    string().matches(/^\d{5}$/, 'Invalid ZIP'),
   *   }).optional()
   */
  constructor(schema = {}, typeError) {
    super(typeError || null);
    this._schema = schema;
  }

  _checkType(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return this._typeError || 'Must be an object';
    }
    return null;
  }

  async run(value, key, allData) {
    const result = await super.run(value, key, allData);
    if (result.error || !result.value || !Object.keys(this._schema).length) return result;

    // Validate each field in the nested schema
    const { errors, validated } = await Validator._runSchema(this._schema, result.value);

    if (Object.keys(errors).length) {
      // Prefix field names with parent key
      const prefixed = {};
      for (const [k, v] of Object.entries(errors)) {
        prefixed[`${key}.${k}`] = v;
      }
      return { error: prefixed, value, _nested: true };
    }

    return { error: null, value: validated };
  }
}

// ── FileValidator ──────────────────────────────────────────────────────────────

class FileValidator extends BaseValidator {
  constructor(typeError) {
    super(typeError || null);
  }

  _checkType(value) {
    // File objects from multer have .originalname, .size, .mimetype
    if (!value || typeof value !== 'object' || !value.originalname) {
      return this._typeError || 'Must be a valid file';
    }
    return null;
  }

  /** Must be an image (by MIME type). */
  image(msg) {
    return this._addRule(
      v => v.mimetype && v.mimetype.startsWith('image/'),
      msg || ((key) => `${this._fieldLabel(key)} must be an image`)
    );
  }

  /**
   * Maximum file size.
   *   file().maxSize('2mb')
   *   file().maxSize('500kb')
   *   file().maxSize(1024 * 1024)   // bytes
   */
  maxSize(size, msg) {
    const bytes = typeof size === 'string' ? _parseSize(size) : size;
    return this._addRule(
      v => v.size <= bytes,
      msg || ((key) => `${this._fieldLabel(key)} must be smaller than ${typeof size === 'string' ? size : _formatSize(size)}`)
    );
  }

  /** Allowed MIME types. */
  mimeTypes(types, msg) {
    return this._addRule(
      v => types.includes(v.mimetype),
      msg || ((key) => `${this._fieldLabel(key)} must be one of: ${types.join(', ')}`)
    );
  }

  /** Allowed file extensions. */
  extensions(exts, msg) {
    return this._addRule(v => {
      const ext = v.originalname.split('.').pop().toLowerCase();
      return exts.map(e => e.toLowerCase().replace(/^\./, '')).includes(ext);
    }, msg || ((key) => `${this._fieldLabel(key)} must have one of these extensions: ${exts.join(', ')}`));
  }
}

function _parseSize(str) {
  const n  = parseFloat(str);
  const unit = str.replace(/[\d.]/g, '').trim().toLowerCase();
  const map  = { b: 1, kb: 1024, mb: 1024**2, gb: 1024**3 };
  return n * (map[unit] || 1);
}

function _formatSize(bytes) {
  if (bytes >= 1024**3) return `${(bytes/1024**3).toFixed(1)}GB`;
  if (bytes >= 1024**2) return `${(bytes/1024**2).toFixed(1)}MB`;
  if (bytes >= 1024)    return `${(bytes/1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

// ── Validator (the runner) ─────────────────────────────────────────────────────

/**
 * Validator
 *
 * Runs a schema of field validators against a data object.
 * Throws HttpError 422 on failure — caught by the router.
 *
 * Used by RequestContext.body.validate() and directly:
 *
 *   const data = await Validator.validate(allData, {
 *     name:  string().required('Name is required').max(100),
 *     email: email().required(),
 *     age:   number().optional().min(0),
 *   });
 *
 * Also supports the legacy pipe-string format for backward compat:
 *   const data = await Validator.validate(allData, {
 *     name:  'required|string|min:2',
 *     email: 'required|email',
 *   });
 */
class Validator {
  static async validate(data, schema) {
    const { errors, validated } = await Validator._runSchema(schema, data);

    if (Object.keys(errors).length) {
      const HttpError = require('../errors/HttpError');
      throw new HttpError(422, 'Validation failed', errors);
    }

    return validated;
  }

  static async _runSchema(schema, data) {
    const errors    = {};
    const validated = {};

    for (const [key, rule] of Object.entries(schema)) {
      const value = data[key];

      // ── New API: validator instance ──────────────────────────────────────
      if (rule instanceof BaseValidator) {
        const result = await rule.run(value, key, data);

        if (result.error) {
          if (result._nested) {
            // Object validator returns prefixed nested errors
            Object.assign(errors, result.error);
          } else {
            // Resolve lazy message functions
            errors[key] = typeof result.error === 'function'
              ? result.error(key)
              : result.error;
          }
        } else if (result.value !== undefined) {
          validated[key] = result.value;
        }
        continue;
      }

      // ── Legacy API: pipe string ──────────────────────────────────────────
      if (typeof rule === 'string') {
        const err = Validator._runPipeRules(key, value, rule);
        if (err) {
          errors[key] = err;
        } else if (value !== undefined) {
          validated[key] = value;
        }
        continue;
      }
    }

    return { errors, validated };
  }

  /** Backward-compatible pipe-string validation. */
  static _runPipeRules(field, value, ruleString) {
    const label   = _titleCase(field);
    const rules   = ruleString.split('|').map(r => r.trim());
    const isEmpty = value === undefined || value === null || value === '';

    for (const rule of rules) {
      const [name, arg] = rule.split(':');

      switch (name) {
        case 'required':
          if (isEmpty) return `${label} is required`;
          break;
        case 'optional':
          if (isEmpty) return null;
          break;
        case 'string':
          if (!isEmpty && typeof value !== 'string') return `${label} must be a string`;
          break;
        case 'number':
          if (!isEmpty && isNaN(Number(value))) return `${label} must be a number`;
          break;
        case 'boolean':
          if (!isEmpty && ![true,false,'true','false','1','0',1,0].includes(value))
            return `${label} must be a boolean`;
          break;
        case 'email':
          if (!isEmpty && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
            return `${label} must be a valid email address`;
          break;
        case 'min':
          if (!isEmpty) {
            if (typeof value === 'string' && value.length < Number(arg))
              return `${label} must be at least ${arg} characters`;
            if (typeof value === 'number' && value < Number(arg))
              return `${label} must be at least ${arg}`;
          }
          break;
        case 'max':
          if (!isEmpty) {
            if (typeof value === 'string' && value.length > Number(arg))
              return `${label} must not exceed ${arg} characters`;
            if (typeof value === 'number' && value > Number(arg))
              return `${label} must not exceed ${arg}`;
          }
          break;
        case 'url':
          try { if (!isEmpty) new URL(value); } catch { return `${label} must be a valid URL`; }
          break;
        case 'in':
          if (!isEmpty && !arg.split(',').includes(String(value)))
            return `${label} must be one of: ${arg}`;
          break;
        case 'alpha':
          if (!isEmpty && !/^[a-zA-Z]+$/.test(value)) return `${label} must contain only letters`;
          break;
        case 'alphanumeric':
          if (!isEmpty && !/^[a-zA-Z0-9]+$/.test(value)) return `${label} must contain only letters and numbers`;
          break;
        default: break;
      }
    }
    return null;
  }
}

module.exports = {
  Validator,
  BaseValidator,
  StringValidator,
  EmailValidator,
  NumberValidator,
  BooleanValidator,
  DateValidator,
  ArrayValidator,
  ObjectValidator,
  FileValidator,

  // Shorthand factory functions — the primary developer-facing API
  string:  (msg) => new StringValidator(msg),
  email:   (msg) => new EmailValidator(msg),
  number:  (msg) => new NumberValidator(msg),
  boolean: (msg) => new BooleanValidator(msg),
  date:    (msg) => new DateValidator(msg),
  array:   (msg) => new ArrayValidator(msg),
  object:  (schema, msg) => new ObjectValidator(schema, msg),
  file:    (msg) => new FileValidator(msg),
};
