'use strict';

/**
 * HttpError
 *
 * A structured error that carries an HTTP status code.
 * Thrown by Controller.abort() and the validation system.
 * Caught automatically by the Router's global error handler.
 *
 * Usage:
 *   throw new HttpError(404, 'User not found')
 *   throw new HttpError(422, 'Validation failed', { email: ['email is required'] })
 */
class HttpError extends Error {
  /**
   * @param {number} status   HTTP status code
   * @param {string} message  Human-readable message
   * @param {object} errors   Optional field-level errors (for validation)
   */
  constructor(status = 500, message = 'Internal Server Error', errors = null) {
    super(message);
    this.name       = 'HttpError';
    this.status     = status;
    this.statusCode = status;
    this.errors     = errors;
  }
}

module.exports = HttpError;
