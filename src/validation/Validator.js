'use strict';

/**
 * Validator
 *
 * Input validation for Millas. Supports both inline usage (req.validate())
 * and route-level declaration (rules declared at route definition time,
 * making validation impossible to forget).
 *
 * ── Rule syntax ───────────────────────────────────────────────────────────────
 *
 *   Rules are pipe-separated strings or arrays of strings:
 *
 *   'required|string|min:2|max:100'
 *   'required|email'
 *   'optional|number|min:0|max:150'
 *   'required|boolean'
 *   'required|array'
 *   'required|in:admin,user,guest'
 *   'required|regex:/^[a-z]+$/i'
 *   'required|uuid'
 *   'required|url'
 *   'required|date'
 *   'optional|string'              — field may be absent; validated if present
 *   'nullable|string'              — field may be null or absent
 *
 * ── Inline usage ──────────────────────────────────────────────────────────────
 *
 *   Route.post('/register', async (req) => {
 *     const data = await req.validate({
 *       name:     'required|string|min:2|max:100',
 *       email:    'required|email',
 *       password: 'required|string|min:8',
 *       age:      'optional|number|min:13',
 *     });
 *     // data is the validated + type-coerced subset of input
 *   });
 *
 * ── Route-level usage (validation before the handler runs) ────────────────────
 *
 *   Route.post('/register', {
 *     validate: {
 *       name:     'required|string|min:2|max:100',
 *       email:    'required|email',
 *       password: 'required|string|min:8',
 *     },
 *   }, async (req) => {
 *     // req.validated contains the safe, validated subset
 *     const { name, email, password } = req.validated;
 *   });
 *
 * ── Error format ──────────────────────────────────────────────────────────────
 *
 *   Throws a 422 ValidationError on failure. Error shape:
 *   {
 *     status:  422,
 *     message: 'Validation failed',
 *     errors: {
 *       email:    ['Email is required', 'Must be a valid email address'],
 *       password: ['Must be at least 8 characters'],
 *     }
 *   }
 */

// ── ValidationError ────────────────────────────────────────────────────────────

class ValidationError extends Error {
  /**
   * @param {object} errors  — { field: [message, ...] }
   */
  constructor(errors) {
    super('Validation failed');
    this.name    = 'ValidationError';
    this.status  = 422;
    this.code    = 'EVALIDATION';
    this.errors  = errors;
  }

  /**
   * Flatten to an array of { field, message } objects.
   */
  toArray() {
    return Object.entries(this.errors).flatMap(([field, messages]) =>
      messages.map(message => ({ field, message }))
    );
  }
}

// ── Built-in rule handlers ─────────────────────────────────────────────────────

const RULES = {

  required(value, _param, field) {
    if (value === undefined || value === null || value === '') {
      return `${_humanise(field)} is required`;
    }
  },

  optional() {
    // Presence marker — no validation, handled at the field level
  },

  nullable() {
    // Allows null — no validation needed here
  },

  string(value, _param, field) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return `${_humanise(field)} must be a string`;
    }
  },

  number(value, _param, field) {
    if (value !== undefined && value !== null) {
      const n = Number(value);
      if (isNaN(n)) return `${_humanise(field)} must be a number`;
    }
  },

  boolean(value, _param, field) {
    if (value !== undefined && value !== null) {
      const acceptable = [true, false, 'true', 'false', '1', '0', 1, 0];
      if (!acceptable.includes(value)) {
        return `${_humanise(field)} must be a boolean`;
      }
    }
  },

  array(value, _param, field) {
    if (value !== undefined && value !== null && !Array.isArray(value)) {
      return `${_humanise(field)} must be an array`;
    }
  },

  object(value, _param, field) {
    if (value !== undefined && value !== null &&
        (typeof value !== 'object' || Array.isArray(value))) {
      return `${_humanise(field)} must be an object`;
    }
  },

  min(value, param, field) {
    if (value === undefined || value === null) return;
    const limit = Number(param);
    if (typeof value === 'string' && !isNaN(Number(value))) {
      // String that represents a number — compare numerically
      if (Number(value) < limit) return `${_humanise(field)} must be at least ${limit}`;
      return;
    }
    if (typeof value === 'string' || Array.isArray(value)) {
      if (value.length < limit) {
        return `${_humanise(field)} must be at least ${limit} character${limit !== 1 ? 's' : ''}`;
      }
    } else if (typeof value === 'number') {
      if (value < limit) return `${_humanise(field)} must be at least ${limit}`;
    }
  },

  max(value, param, field) {
    if (value === undefined || value === null) return;
    const limit = Number(param);
    if (typeof value === 'string' && !isNaN(Number(value))) {
      if (Number(value) > limit) return `${_humanise(field)} must not exceed ${limit}`;
      return;
    }
    if (typeof value === 'string' || Array.isArray(value)) {
      if (value.length > limit) {
        return `${_humanise(field)} must not exceed ${limit} character${limit !== 1 ? 's' : ''}`;
      }
    } else if (typeof value === 'number') {
      if (value > limit) return `${_humanise(field)} must not exceed ${limit}`;
    }
  },

  email(value, _param, field) {
    if (value === undefined || value === null) return;
    // RFC 5322 simplified — catches the common cases without being overly strict
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!re.test(String(value))) {
      return `${_humanise(field)} must be a valid email address`;
    }
  },

  url(value, _param, field) {
    if (value === undefined || value === null) return;
    try {
      const u = new URL(String(value));
      if (!['http:', 'https:'].includes(u.protocol)) {
        return `${_humanise(field)} must be a valid URL (http or https)`;
      }
    } catch {
      return `${_humanise(field)} must be a valid URL`;
    }
  },

  uuid(value, _param, field) {
    if (value === undefined || value === null) return;
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!re.test(String(value))) {
      return `${_humanise(field)} must be a valid UUID`;
    }
  },

  date(value, _param, field) {
    if (value === undefined || value === null) return;
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      return `${_humanise(field)} must be a valid date`;
    }
  },

  in(value, param, field) {
    if (value === undefined || value === null) return;
    const allowed = param.split(',').map(s => s.trim());
    if (!allowed.includes(String(value))) {
      return `${_humanise(field)} must be one of: ${allowed.join(', ')}`;
    }
  },

  regex(value, param, field) {
    if (value === undefined || value === null) return;
    // param format: /pattern/flags  or  pattern
    let re;
    try {
      const match = param.match(/^\/(.+)\/([gimsuy]*)$/);
      re = match ? new RegExp(match[1], match[2]) : new RegExp(param);
    } catch {
      return `${_humanise(field)} has an invalid regex rule`;
    }
    if (!re.test(String(value))) {
      return `${_humanise(field)} format is invalid`;
    }
  },

  confirmed(value, _param, field, allData) {
    // Expects a matching field named <field>_confirmation
    const confirmKey = `${field}_confirmation`;
    if (value !== allData[confirmKey]) {
      return `${_humanise(field)} confirmation does not match`;
    }
  },

  // ── Type coercions (not validators — mutate returned data) ────────────────
  // These are applied in the coerce pass after validation

};

// ── Coercions — applied after validation passes ────────────────────────────────

function coerce(value, ruleNames) {
  if (value === undefined || value === null) return value;
  if (ruleNames.includes('number'))  return Number(value);
  if (ruleNames.includes('boolean')) {
    if (value === 'true'  || value === '1' || value === 1)  return true;
    if (value === 'false' || value === '0' || value === 0)  return false;
    return Boolean(value);
  }
  if (ruleNames.includes('string'))  return String(value);
  return value;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _humanise(field) {
  return field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function _parseRule(ruleStr) {
  const colonIdx = ruleStr.indexOf(':');
  if (colonIdx === -1) return { name: ruleStr.trim(), param: null };
  return {
    name:  ruleStr.slice(0, colonIdx).trim(),
    param: ruleStr.slice(colonIdx + 1).trim(),
  };
}

// ── Validator class ────────────────────────────────────────────────────────────

class Validator {
  /**
   * Validate a data object against a rules map.
   *
   * @param {object} data   — flat input object (e.g. req.all())
   * @param {object} rules  — { field: 'rule1|rule2|...' }
   * @returns {object}       — validated + coerced subset of data
   * @throws {ValidationError}
   */
  static validate(data, rules) {
    const errors  = {};
    const output  = {};

    for (const [field, ruleString] of Object.entries(rules)) {
      const ruleParts = (Array.isArray(ruleString) ? ruleString : ruleString.split('|'))
        .map(r => r.trim())
        .filter(Boolean);

      const ruleNames = ruleParts.map(r => r.split(':')[0].trim());
      const isOptional = ruleNames.includes('optional');
      const isNullable = ruleNames.includes('nullable');

      const value = data[field];

      // Skip optional fields that are absent
      if (isOptional && (value === undefined || value === null || value === '')) {
        continue;
      }

      // Allow null for nullable fields
      if (isNullable && (value === null || value === undefined)) {
        output[field] = null;
        continue;
      }

      const fieldErrors = [];

      for (const rulePart of ruleParts) {
        const { name, param } = _parseRule(rulePart);
        const handler = RULES[name];

        if (!handler) {
          // Unknown rule — fail loudly in development, skip silently in production
          if (process.env.NODE_ENV !== 'production') {
            throw new Error(`[Millas Validator] Unknown rule: "${name}". Check your validation rules for field "${field}".`);
          }
          continue;
        }

        const error = handler(value, param, field, data);
        if (error) fieldErrors.push(error);
      }

      if (fieldErrors.length > 0) {
        errors[field] = fieldErrors;
      } else {
        output[field] = coerce(value, ruleNames);
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new ValidationError(errors);
    }

    return output;
  }

  /**
   * Like validate() but returns { data, errors } instead of throwing.
   * Useful when you want to handle errors manually.
   *
   *   const { data, errors } = Validator.check(input, rules);
   *   if (errors) { ... }
   */
  static check(data, rules) {
    try {
      const result = Validator.validate(data, rules);
      return { data: result, errors: null };
    } catch (err) {
      if (err instanceof ValidationError) {
        return { data: null, errors: err.errors };
      }
      throw err;
    }
  }

  /**
   * Register a custom validation rule globally.
   *
   *   Validator.extend('phone', (value, param, field) => {
   *     if (!/^\+?[\d\s\-]{7,15}$/.test(value)) {
   *       return `${field} must be a valid phone number`;
   *     }
   *   });
   *
   *   // Then use it:
   *   await req.validate({ phone: 'required|phone' });
   */
  static extend(name, handler) {
    if (RULES[name]) {
      throw new Error(`[Millas Validator] Rule "${name}" is already defined. Use Validator.override() to replace it.`);
    }
    RULES[name] = handler;
  }

  /**
   * Override a built-in rule.
   *
   *   Validator.override('email', (value, param, field) => {
   *     // stricter email validation
   *   });
   */
  static override(name, handler) {
    RULES[name] = handler;
  }

  /**
   * Returns the Express middleware that runs route-level validation.
   * Attaches req.validated with the clean, coerced data on success.
   *
   *   app.post('/register', Validator.middleware({ email: 'required|email' }), handler);
   *
   * @param {object} rules
   */
  static middleware(rules) {
    return (req, res, next) => {
      const data = {
        ...req.params,
        ...req.query,
        ...req.body,
      };

      try {
        req.validated = Validator.validate(data, rules);
        next();
      } catch (err) {
        next(err); // passes ValidationError to Express error handler
      }
    };
  }
}

module.exports = { Validator, ValidationError };