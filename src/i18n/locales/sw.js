'use strict';

/**
 * Swahili (sw) translation catalogue.
 *
 * Only include keys where the translation differs from the source.
 * Missing keys automatically fall back to the fallback locale (en).
 */
module.exports = {

  // ── Auth / validation ────────────────────────────────────────────────────
  'Email is required':                      'Barua pepe inahitajika',
  'Password is required':                   'Nywila inahitajika',
  'Invalid email or password':              'Barua pepe au nywila si sahihi',
  'Your account has been deactivated':      'Akaunti yako imezimwa',
  'Email already in use':                   'Barua pepe hiyo tayari inatumika',
  'Password must be at least 8 characters': 'Nywila lazima iwe na herufi angalau 8',
  'Passwords do not match':                 'Nywila hazifanani',

  // ── CRUD messages ────────────────────────────────────────────────────────
  '%s created successfully':                '%s imeundwa kikamilifu',
  '%s updated successfully':                '%s imesasishwa kikamilifu',
  '%s deleted':                             '%s imefutwa',
  'No records found':                       'Hakuna rekodi zilizopatikana',
  'Record not found':                       'Rekodi haijapatikana',

  // ── Pagination ───────────────────────────────────────────────────────────
  'Showing %d to %d of %d results':         'Inaonyesha %d hadi %d kati ya %d matokeo',
  'Previous':                               'Iliyotangulia',
  'Next':                                   'Inayofuata',

  // ── Plural forms (Swahili uses same form for all counts) ─────────────────
  'You have %d message':                    ['Una ujumbe %d', 'Una ujumbe %d'],
  '%d item selected':                       ['%d kipengele kimechaguliwa', '%d vipengele vimechaguliwa'],
  '%d record deleted':                      ['Rekodi %d imefutwa', 'Rekodi %d zimefutwa'],

  // ── Contextual ───────────────────────────────────────────────────────────
  'menu|File':      'Faili',
  'menu|Edit':      'Hariri',
  'status|active':  'Amilifu',
  'status|inactive':'Haifanyi kazi',
  'status|pending': 'Inasubiri',

  // ── Named interpolation ──────────────────────────────────────────────────
  'Welcome, {name}!':  'Karibu, {name}!',
  'Hello, {name}. You have {count} notifications.':
    'Habari {name}. Una arifa {count}.',
};
