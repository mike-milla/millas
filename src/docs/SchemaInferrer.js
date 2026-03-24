'use strict';

/**
 * SchemaInferrer
 *
 * Reads a shape's "in" / "query" schema (BaseValidator instances) and
 * maps them to ApiField objects for the docs panel.
 *
 * This is the bridge between the validation layer and the docs layer.
 * Developers write their shape once — SchemaInferrer makes sure the
 * docs panel reflects it accurately.
 *
 * ── Mapping ───────────────────────────────────────────────────────────────────
 *
 *   StringValidator              → ApiField.text()
 *   StringValidator + .email()   → ApiField.email()
 *   StringValidator + .url()     → ApiField.url()
 *   StringValidator + .uuid()    → ApiField.uuid()
 *   StringValidator + .phone()   → ApiField.phone()
 *   StringValidator + .oneOf()   → ApiField.select([...])
 *   EmailValidator               → ApiField.email()
 *   NumberValidator              → ApiField.number()
 *   NumberValidator + .integer() → ApiField.integer()
 *   BooleanValidator             → ApiField.boolean()
 *   ArrayValidator               → ApiField.array()
 *   DateValidator                → ApiField.date()
 *   FileValidator                → ApiField.file()
 *   ObjectValidator              → ApiField.json()
 *
 * All validators:
 *   ._required  → ApiField.required() / .nullable()
 *   ._example   → ApiField.example(value)
 *   ._describe  → ApiField.description(text)
 *   ._minLen / ._minVal → ApiField.min(n)
 *   ._maxLen / ._maxVal → ApiField.max(n)
 */

'use strict';

const {
  StringValidator,
  EmailValidator,
  NumberValidator,
  BooleanValidator,
  ArrayValidator,
  DateValidator,
  ObjectValidator,
  FileValidator,
  BaseValidator,
} = require('../validation/types');

/**
 * Infer an ApiField-compatible JSON descriptor from a BaseValidator instance.
 * Returns a plain object matching ApiField.toJSON() shape.
 *
 * @param {string}        fieldName
 * @param {BaseValidator} validator
 * @returns {object}  ApiField-compatible JSON
 */
function inferField(fieldName, validator) {
  if (!(validator instanceof BaseValidator)) return null;

  // Determine the ApiField type
  let type = 'string';

  if (validator instanceof EmailValidator) {
    type = 'email';
  } else if (validator instanceof StringValidator) {
    if (validator._emailCheck) type = 'email';
    else if (validator._urlCheck)  type = 'url';
    else if (validator._uuidCheck) type = 'uuid';
    else if (validator._phoneCheck) type = 'phone';
    else if (validator._oneOfVals)  type = 'select';
    else type = 'string';
  } else if (validator instanceof NumberValidator) {
    type = validator._isInt ? 'integer' : 'number';
  } else if (validator instanceof BooleanValidator) {
    type = 'boolean';
  } else if (validator instanceof ArrayValidator) {
    type = 'array';
  } else if (validator instanceof DateValidator) {
    type = 'date';
  } else if (validator instanceof ObjectValidator) {
    type = 'json';
  } else if (validator instanceof FileValidator) {
    type = 'file';
  }

  // Build enum for select fields
  let enumVals = null;
  if (type === 'select' && validator._oneOfVals) {
    enumVals = validator._oneOfVals.map(v => ({ value: String(v), label: String(v) }));
  }

  // Determine min/max from the validator instance properties
  const minVal = validator._minLen ?? validator._minVal ?? null;
  const maxVal = validator._maxLen ?? validator._maxVal ?? null;

  return {
    name:        fieldName,
    type,
    required:    validator._required  || false,
    nullable:    validator._nullable  || false,
    example:     validator._example !== undefined ? validator._example : undefined,
    description: validator._describe  || validator._label || null,
    default:     validator._defaultValue !== undefined ? validator._defaultValue : undefined,
    enum:        enumVals,
    min:         minVal,
    max:         maxVal,
    format:      null,
  };
}

/**
 * Infer an entire schema map (from shape.in or shape.query) into an
 * object of ApiField-compatible JSON descriptors.
 *
 * @param {object} schema  — { fieldName: BaseValidator, ... }
 * @returns {object}       — { fieldName: ApiFieldJSON, ... }
 */
function inferFields(schema) {
  if (!schema || typeof schema !== 'object') return {};
  const out = {};
  for (const [name, validator] of Object.entries(schema)) {
    const field = inferField(name, validator);
    if (field) out[name] = field;
  }
  return out;
}

module.exports = { inferField, inferFields };