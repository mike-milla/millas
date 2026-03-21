'use strict';

/**
 * SafeRedirect — INTERNAL MODULE
 *
 * Not part of the developer API. Developers use redirect() from helpers.js.
 * This module is configured by SecurityBootstrap from config/app.js.
 */

let _allowedOrigins = [];
let _appOrigin      = null;

function _parseOrigin(url) {
  try { return new URL(url).origin; } catch { return null; }
}

function _getLower() {
  return _allowedOrigins.map(o => _parseOrigin(o)).filter(Boolean);
}

function isSafeRedirect(url) {
  if (!url || typeof url !== 'string') return false;

  const trimmed = url.trim();
  const lower   = trimmed.toLowerCase().replace(/\s/g, '');

  // Block dangerous schemes
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return false;
  }

  // Relative paths (not protocol-relative) are always safe
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;

  // Absolute URL — parse and check origin
  let parsed;
  try { parsed = new URL(trimmed); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;

  const allowed = new Set([
    ..._getLower(),
    ...(_appOrigin ? [_appOrigin] : []),
  ]);

  return allowed.has(parsed.origin);
}

class SafeRedirect {
  static configure(origins = []) {
    _allowedOrigins = origins;
  }

  static setAppUrl(url) {
    _appOrigin = _parseOrigin(url);
  }

  static isSafe(url) {
    return isSafeRedirect(url);
  }
}

module.exports = { SafeRedirect, isSafeRedirect };