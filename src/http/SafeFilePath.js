'use strict';

const path = require('path');
const fs   = require('fs');

/**
 * SafeFilePath
 *
 * Prevents path traversal attacks when constructing file paths from
 * user-provided input.
 *
 * A path traversal attack lets an attacker escape a storage directory by
 * injecting sequences like '../' into a filename:
 *
 *   /storage/uploads/ + ../../etc/passwd  →  /etc/passwd
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const { resolveStoragePath } = require('millas/src/http/SafeFilePath');
 *
 *   // Confine a user-provided filename to a directory
 *   const safePath = resolveStoragePath(req.param('filename'), '/storage/uploads');
 *   return file(safePath);
 *
 *   // With optional existence check
 *   const safePath = resolveStoragePath(filename, '/storage/uploads', { mustExist: true });
 *
 *   // AI file upload — confine to storage root
 *   const safePath = resolveStoragePath(userPath, process.env.STORAGE_ROOT || '/storage');
 *   const f = await AI.files.fromPath(safePath).put();
 *
 * ── What it protects against ──────────────────────────────────────────────────
 *
 *   resolveStoragePath('../../etc/passwd', '/storage/uploads')
 *   // throws PathTraversalError — '../' escapes the storage root
 *
 *   resolveStoragePath('report%2F..%2F..%2Fetc%2Fpasswd', '/storage/uploads')
 *   // throws PathTraversalError — URL-encoded traversal is also caught
 *
 *   resolveStoragePath('/absolute/path/outside', '/storage/uploads')
 *   // throws PathTraversalError — absolute paths that escape the root are rejected
 *
 *   resolveStoragePath('subdir/report.pdf', '/storage/uploads')
 *   // returns '/storage/uploads/subdir/report.pdf'  ✓ safe
 *
 * ── Configuration (config/security.js) ───────────────────────────────────────
 *
 *   files: {
 *     storageRoot: process.env.STORAGE_ROOT || path.join(process.cwd(), 'storage'),
 *   }
 */

// ── PathTraversalError ────────────────────────────────────────────────────────

class PathTraversalError extends Error {
  constructor(userInput, allowedRoot) {
    super(
      `Path traversal attempt blocked. ` +
      `Input "${userInput}" resolves outside the allowed directory "${allowedRoot}".`
    );
    this.name    = 'PathTraversalError';
    this.status  = 403;
    this.code    = 'EPATH_TRAVERSAL';
    this.input   = userInput;
    this.root    = allowedRoot;
  }
}

// ── Core resolution ───────────────────────────────────────────────────────────

/**
 * Resolve a user-provided filename/path within an allowed root directory.
 * Throws PathTraversalError if the resolved path escapes the root.
 *
 * @param {string} userInput   — filename or relative path from user input
 * @param {string} allowedRoot — the directory all files must stay within
 * @param {object} [opts]
 * @param {boolean} [opts.mustExist=false] — throw if file doesn't exist
 * @param {boolean} [opts.allowSubdirs=true] — allow path separators in input
 * @returns {string}  — absolute, safe file path
 * @throws {PathTraversalError}
 */
function resolveStoragePath(userInput, allowedRoot, opts = {}) {
  if (!userInput || typeof userInput !== 'string') {
    throw new PathTraversalError(String(userInput), allowedRoot);
  }

  if (!allowedRoot || typeof allowedRoot !== 'string') {
    throw new Error('[Millas SafeFilePath] allowedRoot must be a non-empty string.');
  }

  // ── Decode URL encoding first ───────────────────────────────────────────────
  // Attackers may use %2F, %2E%2E etc. to bypass naive string checks
  let decoded;
  try {
    decoded = decodeURIComponent(userInput);
  } catch {
    decoded = userInput;
  }

  // ── Reject null bytes ───────────────────────────────────────────────────────
  // Null bytes can truncate paths in some runtimes
  if (decoded.includes('\0') || userInput.includes('\0')) {
    throw new PathTraversalError(userInput, allowedRoot);
  }

  // ── Optionally block subdirectory separators ────────────────────────────────
  if (opts.allowSubdirs === false) {
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes(path.sep)) {
      throw new PathTraversalError(userInput, allowedRoot);
    }
  }

  // ── Resolve both paths to absolute, normalised forms ───────────────────────
  const resolvedRoot  = path.resolve(allowedRoot);
  const resolvedInput = path.resolve(resolvedRoot, decoded);

  // ── The core check: resolved path must start with the root ─────────────────
  // Add path.sep to prevent '/storage/uploads-secret' matching '/storage/uploads'
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;

  if (resolvedInput !== resolvedRoot && !resolvedInput.startsWith(rootWithSep)) {
    throw new PathTraversalError(userInput, allowedRoot);
  }

  // ── Optional existence check ────────────────────────────────────────────────
  if (opts.mustExist && !fs.existsSync(resolvedInput)) {
    const err = new Error(`File not found: ${path.basename(resolvedInput)}`);
    err.status = 404;
    err.code   = 'EFILE_NOT_FOUND';
    throw err;
  }

  return resolvedInput;
}

/**
 * Check if a path is safely within a root directory (non-throwing version).
 *
 * @param {string} userInput
 * @param {string} allowedRoot
 * @returns {boolean}
 */
function isSafeFilePath(userInput, allowedRoot) {
  try {
    resolveStoragePath(userInput, allowedRoot);
    return true;
  } catch {
    return false;
  }
}

// ── SafeFilePath class ────────────────────────────────────────────────────────

class SafeFilePath {
  /**
   * Configure the default storage root.
   * Called by SecurityBootstrap from config/security.js files.storageRoot.
   *
   * @param {string} root
   */
  static setStorageRoot(root) {
    SafeFilePath._storageRoot = root;
  }

  /**
   * Get the configured storage root (or the default).
   */
  static getStorageRoot() {
    return SafeFilePath._storageRoot ||
      process.env.STORAGE_ROOT ||
      path.join(process.cwd(), 'storage');
  }

  /**
   * Resolve a path within the configured default storage root.
   * Convenience wrapper for the common case.
   *
   *   SafeFilePath.resolve('uploads/photo.jpg')
   *   // → '/var/www/myapp/storage/uploads/photo.jpg'
   *
   * @param {string} userInput
   * @param {object} [opts]
   * @returns {string}
   */
  static resolve(userInput, opts = {}) {
    return resolveStoragePath(userInput, SafeFilePath.getStorageRoot(), opts);
  }
}

SafeFilePath._storageRoot = null;

module.exports = { SafeFilePath, resolveStoragePath, isSafeFilePath, PathTraversalError };