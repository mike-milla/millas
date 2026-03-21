'use strict';

/**
 * HttpError
 *
 * A structured HTTP error with a status code, message, and optional
 * field-level error map. Thrown by abort(), notFound(), forbidden() etc.
 * and caught by the framework's error handler for consistent responses.
 *
 *   throw new HttpError(404, 'User not found');
 *   throw new HttpError(422, 'Validation failed', { email: ['Required'] });
 */
class HttpError extends Error {
  /**
   * @param {number} status   — HTTP status code
   * @param {string} [message]
   * @param {object|null} [errors]  — field-level errors { field: [msg, ...] }
   */
  constructor(status, message, errors = null) {
    super(message || HttpError.defaultMessage(status));
    this.name    = 'HttpError';
    this.status  = status;
    this.errors  = errors || null;
  }

  static defaultMessage(status) {
    const messages = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      409: 'Conflict',
      410: 'Gone',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };
    return messages[status] || 'Error';
  }
}

module.exports = HttpError;