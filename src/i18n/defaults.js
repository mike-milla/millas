'use strict';

/**
 * Millas framework default translatable strings.
 *
 * These are the strings used internally by Millas — validation messages,
 * auth errors, admin panel labels, migration prompts, etc.
 *
 * When a developer runs `millas lang:publish sw --defaults`, these keys
 * are merged into their locale file alongside their own app strings.
 *
 * Organised by module so translators know the context.
 * All values are the English source text — same key = same value for 'en'.
 *
 * Format:
 *   'key':              'English source text'   — simple string
 *   'key':              ['singular', 'plural']  — plural form
 *   'context|key':      'English source text'   — contextual
 */
module.exports = {

  // ── Validation ─────────────────────────────────────────────────────────
  'This field is required.':                        'This field is required.',
  'Maximum {max} characters allowed.':              'Maximum {max} characters allowed.',
  'Must be a whole number.':                        'Must be a whole number.',
  'Must be a number.':                              'Must be a number.',
  'Must be a valid email address.':                 'Must be a valid email address.',
  'Must be a valid URL.':                           'Must be a valid URL.',
  'Must be a valid date (YYYY-MM-DD).':             'Must be a valid date (YYYY-MM-DD).',
  'Must be valid JSON.':                            'Must be valid JSON.',
  'Must be a valid UUID.':                          'Must be a valid UUID.',
  'Please select a value.':                         'Please select a value.',
  'Please select a related record.':                'Please select a related record.',
  'Invalid value. Must be one of: {values}':        'Invalid value. Must be one of: {values}',
  'Password must be at least 8 characters.':        'Password must be at least 8 characters.',

  // ── Auth ───────────────────────────────────────────────────────────────
  'Email is required':                              'Email is required',
  'Password is required':                           'Password is required',
  'Invalid email or password':                      'Invalid email or password',
  'Your account has been deactivated':              'Your account has been deactivated',
  'Email already in use':                           'Email already in use',
  'Passwords do not match':                         'Passwords do not match',
  'Token has expired':                              'Token has expired',
  'Invalid token':                                  'Invalid token',
  'You are not authorized to perform this action':  'You are not authorized to perform this action',

  // ── HTTP errors ────────────────────────────────────────────────────────
  'Not Found':                                      'Not Found',
  'Unauthorized':                                   'Unauthorized',
  'Forbidden':                                      'Forbidden',
  'Unprocessable Entity':                           'Unprocessable Entity',
  'Internal Server Error':                          'Internal Server Error',
  'Too Many Requests':                              'Too Many Requests',
  '{model} #{id} not found':                        '{model} #{id} not found',

  // ── Pagination ─────────────────────────────────────────────────────────
  'Showing {from} to {to} of {total} results':      'Showing {from} to {to} of {total} results',
  'Previous':                                       'Previous',
  'Next':                                           'Next',
  'Page {page} of {total}':                         'Page {page} of {total}',

  // ── CRUD ───────────────────────────────────────────────────────────────
  '{model} created successfully':                   '{model} created successfully',
  '{model} updated successfully':                   '{model} updated successfully',
  '{model} deleted':                                '{model} deleted',
  'No records found':                               'No records found',
  'Record not found':                               'Record not found',

  // ── Plural CRUD ────────────────────────────────────────────────────────
  '{count} record deleted':               ['{count} record deleted',    '{count} records deleted'],
  '{count} record updated':               ['{count} record updated',    '{count} records updated'],

  // ── Admin panel ────────────────────────────────────────────────────────
  'Dashboard':                                      'Dashboard',
  'Search':                                         'Search',
  'Filters':                                        'Filters',
  'Actions':                                        'Actions',
  'Export CSV':                                     'Export CSV',
  'Export JSON':                                    'Export JSON',
  'Save':                                           'Save',
  'Save and continue editing':                      'Save and continue editing',
  'Save and add another':                           'Save and add another',
  'Delete':                                         'Delete',
  'Cancel':                                         'Cancel',
  'Edit':                                           'Edit',
  'Add {model}':                                    'Add {model}',
  'Change {model}':                                 'Change {model}',
  'Delete {model}':                                 'Delete {model}',
  'Are you sure you want to delete {label}?':       'Are you sure you want to delete {label}?',
  'This action cannot be undone.':                  'This action cannot be undone.',
  'No {model} yet':                                 'No {model} yet',
  'Select all':                                     'Select all',
  'Deselect all':                                   'Deselect all',

  // ── Admin status badges (contextual) ───────────────────────────────────
  'status|active':                                  'Active',
  'status|inactive':                                'Inactive',
  'status|pending':                                 'Pending',
  'status|approved':                                'Approved',
  'status|rejected':                                'Rejected',
  'status|draft':                                   'Draft',
  'status|published':                               'Published',

  // ── Admin login ────────────────────────────────────────────────────────
  'Sign in to your account':                        'Sign in to your account',
  'Email address':                                  'Email address',
  'Password':                                       'Password',
  'Remember me':                                    'Remember me',
  'Sign in':                                        'Sign in',
  'Sign out':                                       'Sign out',
  'You have been logged out.':                      'You have been logged out.',

  // ── Migration prompts ──────────────────────────────────────────────────
  'No changes detected.':                           'No changes detected.',
  'Migrations generated:':                          'Migrations generated:',
  'Run: millas migrate   to apply.':                'Run: millas migrate   to apply.',

  // ── Queue ──────────────────────────────────────────────────────────────
  'Job failed: {message}':                          'Job failed: {message}',
  'Job completed: {job}':                           'Job completed: {job}',
};
