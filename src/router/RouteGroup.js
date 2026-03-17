'use strict';

/**
 * RouteGroup
 *
 * Represents a single group context pushed onto the group stack.
 * Holds prefix, middleware array, and name prefix for the group.
 */
class RouteGroup {
  constructor(attributes = {}) {
    this.prefix     = attributes.prefix     || '';
    this.middleware = Array.isArray(attributes.middleware)
      ? attributes.middleware
      : (attributes.middleware ? [attributes.middleware] : []);
    this.name       = attributes.name       || '';
  }
}

module.exports = RouteGroup;
