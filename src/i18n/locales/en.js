'use strict';

/**
 * English (en) — source language catalogue.
 *
 * For the source language this file acts as documentation:
 * it lists every translatable string in the application.
 * Values are the same as keys — no actual translation needed.
 *
 * Other locale files only need to include keys where the translation
 * differs. Missing keys fall back to this file, then to the raw key.
 *
 * ── Auth ──────────────────────────────────────────────────────────────────
 */
module.exports = {

  // ── Auth / validation ────────────────────────────────────────────────────
  'Email is required':                      'Email is required',
  'Password is required':                   'Password is required',
  'Invalid email or password':              'Invalid email or password',
  'Your account has been deactivated':      'Your account has been deactivated',
  'Email already in use':                   'Email already in use',
  'Password must be at least 8 characters': 'Password must be at least 8 characters',
  'Passwords do not match':                 'Passwords do not match',

  // ── CRUD messages ────────────────────────────────────────────────────────
  '%s created successfully':                '%s created successfully',
  '%s updated successfully':                '%s updated successfully',
  '%s deleted':                             '%s deleted',
  'No records found':                       'No records found',
  'Record not found':                       'Record not found',

  // ── Pagination ───────────────────────────────────────────────────────────
  'Showing %d to %d of %d results':         'Showing %d to %d of %d results',
  'Previous':                               'Previous',
  'Next':                                   'Next',

  // ── Plural examples ──────────────────────────────────────────────────────
  // Array format: [singular_form, plural_form, ...]
  'You have %d message':                    ['You have %d message',  'You have %d messages'],
  '%d item selected':                       ['%d item selected',     '%d items selected'],
  '%d record deleted':                      ['%d record deleted',    '%d records deleted'],

  // ── Contextual examples (context|key) ────────────────────────────────────
  'menu|File':                              'File',
  'menu|Edit':                              'Edit',
  'status|active':                          'Active',
  'status|inactive':                        'Inactive',
  'status|pending':                         'Pending',

  // ── Named interpolation examples ─────────────────────────────────────────
  'Welcome, {name}!':                       'Welcome, {name}!',
  'Hello, {name}. You have {count} notifications.':
    'Hello, {name}. You have {count} notifications.',
};
