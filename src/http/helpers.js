'use strict';

const MillasResponse     = require('./MillasResponse');
const HttpError          = require('../errors/HttpError');
const { isSafeRedirect } = require('./SafeRedirect');

function jsonify(data, options = {}) {
  return MillasResponse.json(data, options);
}

function view(template, data = {}, options = {}) {
  return MillasResponse.view(template, data, options);
}

/**
 * Return a redirect response.
 *
 * Relative paths always work:
 *   return redirect('/dashboard')
 *   return redirect('/login', { status: 301 })
 *
 * Absolute URLs must be listed in app.allowedRedirects (config/app.js).
 * Anything else throws a 400 — the error renderer handles it.
 *
 * redirect('back') uses the Referer header, validated by the same rules.
 */
function redirect(url, options = {}) {
  // Resolve 'back' to the Referer header
  const destination = url === 'back'
    ? (options.referer || (options.req ? options.req.header('referer') : null) || '/')
    : url;

  if (!isSafeRedirect(destination)) {
    const err = new Error(`Redirect to "${destination}" is not allowed. Add it to app.allowedRedirects in config/app.js.`);
    err.status = 400;
    err.code   = 'EREDIRECT_BLOCKED';
    throw err;
  }

  return MillasResponse.redirect(destination, options);
}

function text(content, options = {}) {
  return MillasResponse.text(content, options);
}

/**
 * Serve a file.
 * The path is automatically validated against app.storageRoot (config/app.js).
 * Any path that escapes the storage root throws a 403.
 */
function file(filePath, options = {}) {
  const { resolveStoragePath, SafeFilePath } = require('./SafeFilePath');
  const root = SafeFilePath.getStorageRoot();
  if (root) {
    // Throws PathTraversalError (403) if path escapes root
    const safe = resolveStoragePath(filePath, root);
    return MillasResponse.file(safe, options);
  }
  return MillasResponse.file(filePath, options);
}

function empty(status = 204) {
  return MillasResponse.empty(status);
}

function abort(status, message, errors = null) {
  throw new HttpError(status, message, errors);
}

function notFound(message = 'Not Found')        { abort(404, message); }
function unauthorized(message = 'Unauthorized') { abort(401, message); }
function forbidden(message = 'Forbidden')       { abort(403, message); }

module.exports = {
  jsonify, view, redirect,
  text, file, empty,
  abort, notFound, unauthorized, forbidden,
};