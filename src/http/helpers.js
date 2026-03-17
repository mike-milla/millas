'use strict';

const MillasResponse = require('./MillasResponse');
const HttpError      = require('../errors/HttpError');

/**
 * Millas HTTP Helper Functions
 *
 * These are the only response-building tools developers need.
 * Import them at the top of any route/controller file.
 *
 *   const { jsonify, view, redirect, text, abort } = require('millas');
 *
 * Every helper returns a MillasResponse instance. Nothing is written
 * to the socket until the kernel's ResponseDispatcher processes it.
 */

/**
 * Return a JSON response.
 *
 *   return jsonify(users)
 *   return jsonify(user, { status: 201 })
 *   return jsonify({ error: 'Not found' }, { status: 404 })
 *   return jsonify(data).header('X-Total', String(total))
 *   return jsonify(data).cookie('token', jwt, { httpOnly: true })
 *
 * @param {*}      data
 * @param {object} [options]
 * @param {number} [options.status=200]
 * @param {object} [options.headers={}]
 * @returns {MillasResponse}
 */
function jsonify(data, options = {}) {
  return MillasResponse.json(data, options);
}

/**
 * Return an HTML view (template) response.
 *
 *   return view('users/index', { users })
 *   return view('emails/welcome', { user }, { status: 200 })
 *
 * @param {string} template  — template path relative to views directory
 * @param {object} [data={}] — data passed to the template
 * @param {object} [options]
 * @param {number} [options.status=200]
 * @returns {MillasResponse}
 */
function view(template, data = {}, options = {}) {
  return MillasResponse.view(template, data, options);
}

/**
 * Return a redirect response.
 *
 *   return redirect('/login')
 *   return redirect('/dashboard', { status: 301 })
 *   return redirect('back')   // redirects to Referer header or '/'
 *
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.status=302]
 * @returns {MillasResponse}
 */
function redirect(url, options = {}) {
  return MillasResponse.redirect(url, options);
}

/**
 * Return a plain text response.
 *
 *   return text('Hello, world')
 *   return text('Created', { status: 201 })
 *
 * @param {string} content
 * @param {object} [options]
 * @param {number} [options.status=200]
 * @returns {MillasResponse}
 */
function text(content, options = {}) {
  return MillasResponse.text(content, options);
}

/**
 * Return a file response (send / download).
 *
 *   return file('/storage/uploads/report.pdf')
 *   return file('/storage/uploads/report.pdf', { download: true })
 *   return file('/storage/uploads/report.pdf', { download: true, name: 'report.pdf' })
 *
 * @param {string} filePath  — absolute or relative path
 * @param {object} [options]
 * @param {boolean} [options.download=false] — force download (Content-Disposition: attachment)
 * @param {string}  [options.name]           — filename shown to the user on download
 * @returns {MillasResponse}
 */
function file(filePath, options = {}) {
  return MillasResponse.file(filePath, options);
}

/**
 * Return an empty response.
 *
 *   return empty()        // 204 No Content
 *   return empty(200)     // 200 with no body
 *
 * @param {number} [status=204]
 * @returns {MillasResponse}
 */
function empty(status = 204) {
  return MillasResponse.empty(status);
}

/**
 * Throw an HTTP error — caught by the kernel and rendered by ErrorRenderer.
 *
 *   abort(404)
 *   abort(403, 'You are not allowed to do that')
 *   abort(422, 'Validation failed', { email: ['Email is required'] })
 *
 * @param {number} status
 * @param {string} [message]
 * @param {object} [errors]
 * @throws {HttpError}
 */
function abort(status, message, errors = null) {
  throw new HttpError(status, message, errors);
}

/**
 * Throw a 404 Not Found error.
 *   notFound()
 *   notFound('User not found')
 */
function notFound(message = 'Not Found') {
  abort(404, message);
}

/**
 * Throw a 401 Unauthorized error.
 */
function unauthorized(message = 'Unauthorized') {
  abort(401, message);
}

/**
 * Throw a 403 Forbidden error.
 */
function forbidden(message = 'Forbidden') {
  abort(403, message);
}

module.exports = {
  jsonify,
  view,
  redirect,
  text,
  file,
  empty,
  abort,
  notFound,
  unauthorized,
  forbidden,
};
