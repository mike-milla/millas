'use strict';

/**
 * millas/core/validation
 *
 * Re-exports everything from the validation layer.
 * Import from here in your app code — never from the internal paths.
 *
 *   const { string, email, number, boolean, array, object, date, file } =
 *     require('millas/core/validation');
 */

const { Validator, ValidationError } = require('../validation/Validator');
const { BaseValidator }              = require('../validation/BaseValidator');
const {
  StringValidator,
  EmailValidator,
  NumberValidator,
  BooleanValidator,
  ArrayValidator,
  DateValidator,
  ObjectValidator,
  FileValidator,
  string,
  email,
  number,
  boolean,
  array,
  date,
  object,
  file,
} = require('../validation/types');

module.exports = {
  // Core classes
  Validator,
  ValidationError,
  BaseValidator,
  // Typed validator classes (for instanceof checks)
  StringValidator,
  EmailValidator,
  NumberValidator,
  BooleanValidator,
  ArrayValidator,
  DateValidator,
  ObjectValidator,
  FileValidator,
  // Factory functions — what developers use
  string,
  email,
  number,
  boolean,
  array,
  date,
  object,
  file,
  // Aliases matching the original zip's core/validation.js exports
  objectField: object,
  fileField:   file,
};