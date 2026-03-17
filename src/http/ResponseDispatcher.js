'use strict';

const MillasResponse = require('./MillasResponse');

/**
 * ResponseDispatcher
 *
 * Kernel-side utility — handles auto-wrapping plain return values into
 * MillasResponse objects.
 *
 * Actual dispatch to the HTTP engine (setting headers, writing the body)
 * lives in HttpAdapter.dispatch() — that is the only place HTTP-engine
 * APIs are called.
 *
 * This file has zero imports of Express or any HTTP engine.
 */
class ResponseDispatcher {

  /**
   * Auto-wrap a plain JS return value into a MillasResponse.
   *
   * Called when a route handler returns something that is NOT already
   * a MillasResponse — e.g. a plain object, string, number, or array.
   *
   * @param {*} value
   * @returns {MillasResponse}
   */
  static autoWrap(value) {
    if (MillasResponse.isResponse(value)) return value;

    if (value instanceof Error) throw value;

    if (typeof value === 'string') {
      return value.trimStart().startsWith('<')
        ? MillasResponse.html(value)
        : MillasResponse.text(value);
    }

    if (
      typeof value === 'object'  ||
      typeof value === 'number'  ||
      typeof value === 'boolean'
    ) {
      return MillasResponse.json(value);
    }

    return MillasResponse.text(String(value));
  }
}

module.exports = ResponseDispatcher;