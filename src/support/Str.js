'use strict';

const crypto = require('crypto');

/**
 * Str
 *
 * Fluent string manipulation utility.
 *
 * ── Static API (chainable via Str.of()) ──────────────────────────────────────
 *
 *   Str.camel('hello_world')          → 'helloWorld'
 *   Str.snake('HelloWorld')            → 'hello_world'
 *   Str.kebab('Hello World')           → 'hello-world'
 *   Str.pascal('hello world')          → 'HelloWorld'
 *   Str.title('hello world')           → 'Hello World'
 *   Str.slug('Hello World!')           → 'hello-world'
 *   Str.plural('apple')                → 'apples'
 *   Str.singular('apples')            → 'apple'
 *   Str.ucfirst('hello')              → 'Hello'
 *   Str.lcfirst('Hello')              → 'hello'
 *   Str.limit('Hello World', 5)        → 'Hello...'
 *   Str.words('Hello World', 1)        → 'Hello...'
 *   Str.truncate('Hello World', 5)     → 'Hello...'
 *   Str.contains('hello world', 'lo') → true
 *   Str.containsAll('hello world', ['hello','world']) → true
 *   Str.startsWith('hello', 'he')     → true
 *   Str.endsWith('hello', 'lo')       → true
 *   Str.is('foo*', 'foobar')          → true  (glob pattern)
 *   Str.isUuid('...')                 → true
 *   Str.isUrl('https://...')          → true
 *   Str.isEmail('a@b.com')            → true
 *   Str.isJson('{}')                  → true
 *   Str.isAscii('hello')              → true
 *   Str.isEmpty('')                   → true
 *   Str.isNotEmpty('x')              → true
 *   Str.uuid()                        → 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
 *   Str.random(16)                    → random alphanumeric string
 *   Str.pad('5', 3, '0', 'left')      → '005'
 *   Str.padLeft('5', 3, '0')          → '005'
 *   Str.padRight('5', 3, '0')         → '500'
 *   Str.padBoth('5', 5, '-')          → '--5--'
 *   Str.repeat('ab', 3)               → 'ababab'
 *   Str.reverse('hello')              → 'olleh'
 *   Str.wordCount('hello world')      → 2
 *   Str.length('hello')               → 5
 *   Str.substr('hello', 1, 3)         → 'ell'
 *   Str.before('hello world', ' ')    → 'hello'
 *   Str.beforeLast('a/b/c', '/')      → 'a/b'
 *   Str.after('hello world', ' ')     → 'world'
 *   Str.afterLast('a/b/c', '/')       → 'c'
 *   Str.between('(hello)', '(', ')')  → 'hello'
 *   Str.betweenFirst('(a)(b)', '(', ')') → 'a'
 *   Str.replace('hello', 'l', 'r')    → 'herro'
 *   Str.replaceFirst('aaa', 'a', 'b') → 'baa'
 *   Str.replaceLast('aaa', 'a', 'b')  → 'aab'
 *   Str.replaceArray('?', ['a','b'], '? and ?') → 'a and b'
 *   Str.remove('hello world', 'l')    → 'heo word'
 *   Str.squish('  hello   world  ')   → 'hello world'
 *   Str.wrap('hello', '"')            → '"hello"'
 *   Str.unwrap('"hello"', '"')        → 'hello'
 *   Str.mask('password123', '*', 4)   → 'pass*******'
 *   Str.excerpt('hello world foo', 'world', { radius: 3 }) → '...lo world fo...'
 *   Str.headline('hello_world foo')   → 'Hello World Foo'
 *   Str.swap({ Hello: 'Hi' }, 'Hello World') → 'Hi World'
 *   Str.of('hello world')             → FluentString instance
 *
 * ── Fluent API (Str.of()) ──────────────────────────────────────────────────
 *
 *   Str.of('hello world')
 *     .title()
 *     .replace('World', 'Millas')
 *     .append('!')
 *     .toString()
 *   // → 'Hello Millas!'
 */

// ── Irregular plurals ─────────────────────────────────────────────────────────

const IRREGULAR_PLURALS = new Map([
  ['child',   'children'],  ['person',  'people'],   ['man',    'men'],
  ['woman',   'women'],     ['tooth',   'teeth'],     ['foot',   'feet'],
  ['mouse',   'mice'],      ['goose',   'geese'],     ['ox',     'oxen'],
  ['leaf',    'leaves'],    ['knife',   'knives'],    ['wife',   'wives'],
  ['life',    'lives'],     ['wolf',    'wolves'],    ['shelf',  'shelves'],
  ['half',    'halves'],    ['self',    'selves'],    ['elf',    'elves'],
  ['loaf',    'loaves'],    ['calf',    'calves'],    ['wharf',  'wharves'],
  ['thesis',  'theses'],    ['crisis',  'crises'],    ['axis',   'axes'],
  ['analysis','analyses'],  ['basis',   'bases'],     ['datum',  'data'],
  ['medium',  'media'],     ['index',   'indices'],   ['matrix', 'matrices'],
  ['vertex',  'vertices'],  ['appendix','appendices'],['radius', 'radii'],
  ['nucleus', 'nuclei'],    ['cactus',  'cacti'],     ['fungus', 'fungi'],
  ['syllabus','syllabi'],   ['formula', 'formulae'],  ['alumna', 'alumnae'],
  ['alumnus', 'alumni'],    ['quiz',    'quizzes'],   ['ox',     'oxen'],
  ['echo',    'echoes'],    ['embargo', 'embargoes'], ['hero',   'heroes'],
  ['potato',  'potatoes'],  ['tomato',  'tomatoes'],  ['torpedo','torpedoes'],
  ['veto',    'vetoes'],    ['buffalo', 'buffaloes'],
]);

const UNCOUNTABLE = new Set([
  'sheep', 'fish', 'deer', 'moose', 'series', 'species', 'money', 'rice',
  'information', 'equipment', 'news', 'music', 'furniture', 'luggage',
  'software', 'hardware', 'data', 'feedback', 'knowledge', 'traffic',
  'research', 'advice', 'progress', 'water', 'weather', 'aircraft',
  'offspring', 'pokemon', 'bison', 'buffalo', 'cod', 'elk', 'salmon', 'trout',
]);

// ── Core implementation ───────────────────────────────────────────────────────

class Str {

  // ── Case conversion ────────────────────────────────────────────────────────

  /**
   * Convert to camelCase.
   *   Str.camel('hello_world')  → 'helloWorld'
   *   Str.camel('Hello World')  → 'helloWorld'
   */
  static camel(str) {
    return Str._words(str)
      .map((w, i) => i === 0 ? w.toLowerCase() : Str.ucfirst(w.toLowerCase()))
      .join('');
  }

  /**
   * Convert to PascalCase.
   *   Str.pascal('hello world') → 'HelloWorld'
   */
  static pascal(str) {
    return Str._words(str)
      .map(w => Str.ucfirst(w.toLowerCase()))
      .join('');
  }

  /**
   * Convert to snake_case.
   *   Str.snake('helloWorld')   → 'hello_world'
   *   Str.snake('Hello World')  → 'hello_world'
   */
  static snake(str, delimiter = '_') {
    return Str._words(str)
      .map(w => w.toLowerCase())
      .join(delimiter);
  }

  /**
   * Convert to kebab-case.
   *   Str.kebab('helloWorld')   → 'hello-world'
   */
  static kebab(str) {
    return Str.snake(str, '-');
  }

  /**
   * Convert to Title Case.
   *   Str.title('hello world')  → 'Hello World'
   */
  static title(str) {
    return String(str).replace(/\w\S*/g, w => Str.ucfirst(w.toLowerCase()));
  }

  /**
   * Convert to Headline Case — splits on separators, numbers, case boundaries.
   *   Str.headline('hello_world foo-bar') → 'Hello World Foo Bar'
   *   Str.headline('emailAddress')         → 'Email Address'
   */
  static headline(str) {
    return Str._words(str)
      .map(w => Str.ucfirst(w.toLowerCase()))
      .join(' ');
  }

  /**
   * Uppercase first character.
   *   Str.ucfirst('hello') → 'Hello'
   */
  static ucfirst(str) {
    str = String(str);
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Lowercase first character.
   *   Str.lcfirst('Hello') → 'hello'
   */
  static lcfirst(str) {
    str = String(str);
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  /**
   * Convert to URL-friendly slug.
   *   Str.slug('Hello World!')        → 'hello-world'
   *   Str.slug('Hello World', '_')    → 'hello_world'
   */
  static slug(str, separator = '-') {
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
      .toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, '')
      .trim()
      .replace(/[\s-_]+/g, separator);
  }

  // ── Pluralization / singularization ────────────────────────────────────────

  /**
   * Return the plural form of a word.
   *   Str.plural('apple')   → 'apples'
   *   Str.plural('child')   → 'children'
   *   Str.plural('apple', 1) → 'apple'  (count-aware)
   */
  static plural(word, count = 2) {
    word = String(word);
    if (Math.abs(count) === 1) return word;

    const lower = word.toLowerCase();
    if (UNCOUNTABLE.has(lower)) return word;

    // Check irregulars (preserve original casing pattern)
    for (const [singular, plural] of IRREGULAR_PLURALS) {
      if (lower === singular) return _matchCase(word, plural);
      if (lower === plural)   return word;
    }

    // Suffix rules (ordered most-specific → least-specific)
    if (/(quiz)$/i.test(word))                           return word.replace(/(quiz)$/i, '$1zes');
    if (/^(oxen)$/i.test(word))                          return word;
    if (/^(ox)$/i.test(word))                            return word + 'en';
    if (/([m|l])ice$/i.test(word))                       return word;
    if (/([m|l])ouse$/i.test(word))                      return word.replace(/([m|l])ouse$/i, '$1ice');
    if (/(pea)s$/i.test(word))                           return word;
    if (/(pe)ople$/i.test(word))                         return word;
    if (/(matr|vert|append)(ix|ices)$/i.test(word))      return word;
    if (/(matr|vert|append)ix$/i.test(word))             return word.replace(/ix$/i, 'ices');
    if (/(x|ch|ss|sh)$/i.test(word))                    return word + 'es';
    if (/([^aeiouy]|qu)ies$/i.test(word))               return word;
    if (/([^aeiouy]|qu)y$/i.test(word))                 return word.replace(/y$/i, 'ies');
    if (/(hive|tive)s?$/i.test(word))                   return word.replace(/s?$/i, 's');
    if (/([lr])ves$/i.test(word))                        return word;
    if (/([^f])ves$/i.test(word))                        return word;
    if (/([^aeiouy])fe$/i.test(word))                   return word.replace(/fe$/i, 'ves');
    if (/([lr])f$/i.test(word))                         return word.replace(/f$/i, 'ves');
    if (/sis$/i.test(word))                             return word.replace(/sis$/i, 'ses');
    if (/([ti])a$/i.test(word))                         return word;
    if (/([ti])um$/i.test(word))                        return word.replace(/um$/i, 'a');
    if (/(buffal|tomat|potat)o$/i.test(word))           return word + 'es';
    if (/(bu|mis|gas)ses$/i.test(word))                 return word;
    if (/(bus)$/i.test(word))                           return word + 'es';
    if (/(alias|status)$/i.test(word))                  return word + 'es';
    if (/(ax|test)is$/i.test(word))                     return word + 'es';
    if (/s$/i.test(word))                               return word;
    return word + 's';
  }

  /**
   * Return the singular form of a word.
   *   Str.singular('apples')  → 'apple'
   *   Str.singular('children') → 'child'
   */
  static singular(word) {
    word = String(word);
    const lower = word.toLowerCase();
    if (UNCOUNTABLE.has(lower)) return word;

    // Check irregular plurals
    for (const [singular, plural] of IRREGULAR_PLURALS) {
      if (lower === plural) return _matchCase(word, singular);
      if (lower === singular) return word;
    }

    // Suffix rules
    if (/(quiz)zes$/i.test(word))                        return word.replace(/(quiz)zes$/i, '$1');
    if (/(matr)ices$/i.test(word))                       return word.replace(/(matr)ices$/i, '$1ix');
    if (/(vert|ind)ices$/i.test(word))                   return word.replace(/(vert|ind)ices$/i, '$1ex');
    if (/^(ox)en/i.test(word))                           return word.replace(/^(ox)en/i, '$1');
    if (/(alias|status)es$/i.test(word))                 return word.replace(/(alias|status)es$/i, '$1');
    if (/(ax|cris|test)es$/i.test(word))                 return word.replace(/(ax|cris|test)es$/i, '$1is');
    if (/(shoe)s$/i.test(word))                          return word.replace(/(shoe)s$/i, '$1');
    if (/(o)es$/i.test(word))                            return word.replace(/(o)es$/i, '$1');
    if (/(bus)es$/i.test(word))                          return word.replace(/(bus)es$/i, '$1');
    if (/([m|l])ice$/i.test(word))                       return word.replace(/([m|l])ice$/i, '$1ouse');
    if (/(x|ch|ss|sh)es$/i.test(word))                  return word.replace(/(x|ch|ss|sh)es$/i, '$1');
    if (/(m)ovies$/i.test(word))                         return word.replace(/(m)ovies$/i, '$1ovie');
    if (/(s)eries$/i.test(word))                         return word.replace(/(s)eries$/i, '$1eries');
    if (/([^aeiouy]|qu)ies$/i.test(word))               return word.replace(/([^aeiouy]|qu)ies$/i, '$1y');
    if (/([lr])ves$/i.test(word))                        return word.replace(/([lr])ves$/i, '$1f');
    if (/(thi|shea|lea)ves$/i.test(word))               return word.replace(/(thi|shea|lea)ves$/i, '$1f');
    if (/(s)taves$/i.test(word))                         return word.replace(/(s)taves$/i, '$1taff');
    if (/(hive)s$/i.test(word))                          return word.replace(/(hive)s$/i, '$1');
    if (/(dr|l|wh)ives$/i.test(word))                   return word.replace(/(dr|l|wh)ives$/i, '$1ife');
    if (/([^f])ves$/i.test(word))                        return word.replace(/([^f])ves$/i, '$1fe');
    if (/(^analy)(sis|ses)$/i.test(word))               return word.replace(/(^analy)(sis|ses)$/i, '$1sis');
    if (/((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)(sis|ses)$/i.test(word))
                                                         return word.replace(/ses$/i, 'sis');
    if (/(ta|ra)$/i.test(word) && !/(sta|na)ta$/i.test(word))
                                                         return word.replace(/a$/i, 'um');
    if (/(database)s$/i.test(word))                      return word.replace(/(database)s$/i, '$1');
    if (/s$/i.test(word))                               return word.replace(/s$/i, '');
    return word;
  }

  /**
   * Pluralize if count !== 1.
   *   Str.pluralStudly('UserPost', 2) → 'UserPosts'
   */
  static pluralStudly(str, count = 2) {
    const words  = Str._words(str);
    const last   = words[words.length - 1];
    words[words.length - 1] = Str.plural(last, count);
    return words.map(w => Str.ucfirst(w.toLowerCase())).join('');
  }

  // ── Truncation / limiting ──────────────────────────────────────────────────

  /**
   * Limit a string to a number of characters.
   *   Str.limit('Hello World', 5)       → 'Hello...'
   *   Str.limit('Hello World', 5, ' →') → 'Hello →'
   */
  static limit(str, limit = 100, end = '...') {
    str = String(str);
    if (str.length <= limit) return str;
    return str.slice(0, limit) + end;
  }

  /** Alias for limit() */
  static truncate(str, limit = 100, end = '...') {
    return Str.limit(str, limit, end);
  }

  /**
   * Limit a string to a number of words.
   *   Str.words('Hello World Foo', 2) → 'Hello World...'
   */
  static words(str, words = 100, end = '...') {
    str = String(str);
    const arr = str.trim().split(/\s+/);
    if (arr.length <= words) return str;
    return arr.slice(0, words).join(' ') + end;
  }

  /**
   * Extract an excerpt around a phrase.
   *   Str.excerpt('This is a long string', 'long', { radius: 5 })
   *   → '...is a long stri...'
   */
  static excerpt(str, phrase = '', { radius = 100, omission = '...' } = {}) {
    str = String(str);
    if (!phrase) return Str.limit(str, radius * 2, omission);
    const idx = str.toLowerCase().indexOf(phrase.toLowerCase());
    if (idx === -1) return Str.limit(str, radius * 2, omission);
    const start = Math.max(0, idx - radius);
    const end   = Math.min(str.length, idx + phrase.length + radius);
    return (start > 0 ? omission : '') + str.slice(start, end) + (end < str.length ? omission : '');
  }

  // ── Padding ────────────────────────────────────────────────────────────────

  /**
   * Pad a string.
   *   Str.pad('5', 3, '0', 'left')   → '005'
   *   Str.pad('5', 3, '0', 'right')  → '500'
   *   Str.pad('5', 5, '-', 'both')   → '--5--'
   */
  static pad(str, length, pad = ' ', position = 'right') {
    str = String(str);
    if (str.length >= length) return str;
    const needed = length - str.length;
    if (position === 'left')  return pad.repeat(Math.ceil(needed / pad.length)).slice(0, needed) + str;
    if (position === 'both') {
      const lPad = Math.floor(needed / 2);
      const rPad = needed - lPad;
      return pad.repeat(Math.ceil(lPad / pad.length)).slice(0, lPad) + str +
             pad.repeat(Math.ceil(rPad / pad.length)).slice(0, rPad);
    }
    return str + pad.repeat(Math.ceil(needed / pad.length)).slice(0, needed);
  }

  /** Pad left (start). Str.padLeft('5', 3, '0') → '005' */
  static padLeft(str, length, pad = ' ')  { return Str.pad(str, length, pad, 'left'); }

  /** Pad right (end). Str.padRight('5', 3, '0') → '500' */
  static padRight(str, length, pad = ' ') { return Str.pad(str, length, pad, 'right'); }

  /** Pad both sides. Str.padBoth('5', 5, '-') → '--5--' */
  static padBoth(str, length, pad = ' ')  { return Str.pad(str, length, pad, 'both'); }

  // ── Search / detection ─────────────────────────────────────────────────────

  /**
   * Determine if a string contains a given substring (or any from an array).
   *   Str.contains('hello world', 'world')           → true
   *   Str.contains('hello world', ['hello','world']) → true
   */
  static contains(haystack, needles, caseSensitive = true) {
    haystack = String(haystack);
    const h  = caseSensitive ? haystack : haystack.toLowerCase();
    if (Array.isArray(needles)) {
      return needles.some(n => {
        const needle = caseSensitive ? String(n) : String(n).toLowerCase();
        return needle !== '' && h.includes(needle);
      });
    }
    const needle = caseSensitive ? String(needles) : String(needles).toLowerCase();
    return needle !== '' && h.includes(needle);
  }

  /**
   * Determine if a string contains all given substrings.
   *   Str.containsAll('hello world', ['hello', 'world']) → true
   */
  static containsAll(haystack, needles, caseSensitive = true) {
    return needles.every(n => Str.contains(haystack, n, caseSensitive));
  }

  /**
   * Determine if a string starts with a given substring (or any from an array).
   *   Str.startsWith('hello', 'he')        → true
   *   Str.startsWith('hello', ['he','wo']) → true
   */
  static startsWith(haystack, needles) {
    haystack = String(haystack);
    if (Array.isArray(needles)) return needles.some(n => String(n) !== '' && haystack.startsWith(String(n)));
    return String(needles) !== '' && haystack.startsWith(String(needles));
  }

  /**
   * Determine if a string ends with a given substring (or any from an array).
   *   Str.endsWith('hello', 'lo')        → true
   *   Str.endsWith('hello', ['lo','he']) → true
   */
  static endsWith(haystack, needles) {
    haystack = String(haystack);
    if (Array.isArray(needles)) return needles.some(n => String(n) !== '' && haystack.endsWith(String(n)));
    return String(needles) !== '' && haystack.endsWith(String(needles));
  }

  /**
   * Test a string against a pattern — supports * wildcards.
   *   Str.is('foo*', 'foobar')  → true
   *   Str.is('*.js', 'app.js') → true
   *   Str.is(['*.js','*.ts'], 'app.ts') → true
   */
  static is(pattern, value) {
    value = String(value);
    if (Array.isArray(pattern)) return pattern.some(p => Str.is(p, value));
    if (pattern === value) return true;
    const regex = new RegExp('^' + String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return regex.test(value);
  }

  // ── Type checks ────────────────────────────────────────────────────────────

  /** Determine if a string is a valid UUID v4. */
  static isUuid(str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(str));
  }

  /** Determine if a string is a valid URL. */
  static isUrl(str) {
    try { new URL(String(str)); return true; } catch { return false; }
  }

  /** Determine if a string is a valid email address. */
  static isEmail(str) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(str));
  }

  /** Determine if a string is valid JSON. */
  static isJson(str) {
    try { JSON.parse(String(str)); return true; } catch { return false; }
  }

  /** Determine if a string contains only ASCII characters. */
  static isAscii(str) {
    return /^[\x00-\x7F]*$/.test(String(str));
  }

  /** Determine if a string is empty or whitespace-only. */
  static isEmpty(str) {
    return String(str).trim() === '';
  }

  /** Determine if a string is not empty. */
  static isNotEmpty(str) {
    return !Str.isEmpty(str);
  }

  /** Determine if a string contains only alphabetical characters. */
  static isAlpha(str) {
    return /^[a-zA-Z]+$/.test(String(str));
  }

  /** Determine if a string contains only alphanumeric characters. */
  static isAlphanumeric(str) {
    return /^[a-zA-Z0-9]+$/.test(String(str));
  }

  /** Determine if a string contains only numeric characters. */
  static isNumeric(str) {
    return /^-?\d+(\.\d+)?$/.test(String(str).trim());
  }

  // ── Extraction ─────────────────────────────────────────────────────────────

  /**
   * Return everything before the first occurrence of a value.
   *   Str.before('hello world', ' ') → 'hello'
   */
  static before(subject, search) {
    subject = String(subject); search = String(search);
    if (search === '') return subject;
    const idx = subject.indexOf(search);
    return idx === -1 ? subject : subject.slice(0, idx);
  }

  /**
   * Return everything before the last occurrence of a value.
   *   Str.beforeLast('a/b/c', '/') → 'a/b'
   */
  static beforeLast(subject, search) {
    subject = String(subject); search = String(search);
    if (search === '') return subject;
    const idx = subject.lastIndexOf(search);
    return idx === -1 ? subject : subject.slice(0, idx);
  }

  /**
   * Return everything after the first occurrence of a value.
   *   Str.after('hello world', ' ') → 'world'
   */
  static after(subject, search) {
    subject = String(subject); search = String(search);
    if (search === '') return subject;
    const idx = subject.indexOf(search);
    return idx === -1 ? subject : subject.slice(idx + search.length);
  }

  /**
   * Return everything after the last occurrence of a value.
   *   Str.afterLast('a/b/c', '/') → 'c'
   */
  static afterLast(subject, search) {
    subject = String(subject); search = String(search);
    if (search === '') return subject;
    const idx = subject.lastIndexOf(search);
    return idx === -1 ? subject : subject.slice(idx + search.length);
  }

  /**
   * Return the portion of a string between two values.
   *   Str.between('[hello]', '[', ']') → 'hello'
   */
  static between(subject, from, to) {
    if (from === '' || to === '') return subject;
    return Str.beforeLast(Str.after(subject, from), to);
  }

  /**
   * Return the smallest portion of a string between two values.
   *   Str.betweenFirst('[a][b]', '[', ']') → 'a'
   */
  static betweenFirst(subject, from, to) {
    if (from === '' || to === '') return subject;
    return Str.before(Str.after(subject, from), to);
  }

  /**
   * Return a substring.
   *   Str.substr('hello', 1, 3) → 'ell'
   */
  static substr(str, start, length) {
    str = String(str);
    return length !== undefined ? str.slice(start, start + length) : str.slice(start);
  }

  // ── Replacement ────────────────────────────────────────────────────────────

  /**
   * Replace all occurrences of a search string (or array).
   *   Str.replace('hello', 'l', 'r')           → 'herro'
   *   Str.replace(['a','b'], ['x','y'], 'ab')   → 'xy'
   */
  static replace(search, replace, subject, caseSensitive = true) {
    if (Array.isArray(search)) {
      let result = String(subject);
      search.forEach((s, i) => {
        const r = Array.isArray(replace) ? (replace[i] ?? '') : replace;
        result  = Str.replace(s, r, result, caseSensitive);
      });
      return result;
    }
    subject = String(subject);
    const flags = caseSensitive ? 'g' : 'gi';
    return subject.replace(new RegExp(_escapeRegex(String(search)), flags), String(replace));
  }

  /**
   * Replace the first occurrence.
   *   Str.replaceFirst('aaa', 'a', 'b') → 'baa'
   */
  static replaceFirst(search, replace, subject) {
    subject = String(subject); search = String(search);
    if (search === '') return subject;
    const idx = subject.indexOf(search);
    return idx === -1 ? subject : subject.slice(0, idx) + String(replace) + subject.slice(idx + search.length);
  }

  /**
   * Replace the last occurrence.
   *   Str.replaceLast('aaa', 'a', 'b') → 'aab'
   */
  static replaceLast(search, replace, subject) {
    subject = String(subject); search = String(search);
    if (search === '') return subject;
    const idx = subject.lastIndexOf(search);
    return idx === -1 ? subject : subject.slice(0, idx) + String(replace) + subject.slice(idx + search.length);
  }

  /**
   * Replace sequential placeholders with an array of values.
   *   Str.replaceArray('?', ['a', 'b'], '? and ?') → 'a and b'
   */
  static replaceArray(search, replace, subject) {
    subject = String(subject);
    const arr = [...replace];
    return subject.split(String(search)).reduce((acc, part, i) => {
      return i === 0 ? part : acc + (arr.shift() ?? search) + part;
    });
  }

  /**
   * Remove all occurrences of a search string.
   *   Str.remove('hello world', 'l') → 'heo word'
   *   Str.remove('hello world', ['l','o']) → 'he wrd'
   */
  static remove(search, subject, caseSensitive = true) {
    if (Array.isArray(search)) {
      let result = String(subject);
      search.forEach(s => { result = Str.remove(s, result, caseSensitive); });
      return result;
    }
    return Str.replace(search, '', subject, caseSensitive);
  }

  /**
   * Swap multiple keywords in a string.
   *   Str.swap({ Hello: 'Hi', World: 'Earth' }, 'Hello World') → 'Hi Earth'
   */
  static swap(map, subject) {
    subject = String(subject);
    const keys = Object.keys(map).sort((a, b) => b.length - a.length); // longest first
    let result = subject;
    for (const key of keys) {
      result = Str.replace(key, map[key], result);
    }
    return result;
  }

  // ── Padding / wrapping ─────────────────────────────────────────────────────

  /**
   * Wrap a string with another string (or start/end separately).
   *   Str.wrap('hello', '"')        → '"hello"'
   *   Str.wrap('hello', '(', ')')  → '(hello)'
   */
  static wrap(str, before, after) {
    return String(before) + String(str) + String(after ?? before);
  }

  /**
   * Unwrap a string — remove wrapping characters if present.
   *   Str.unwrap('"hello"', '"')       → 'hello'
   *   Str.unwrap('(hello)', '(', ')')  → 'hello'
   */
  static unwrap(str, before, after) {
    str = String(str);
    const end = after ?? before;
    if (str.startsWith(String(before)) && str.endsWith(String(end))) {
      return str.slice(String(before).length, str.length - String(end).length);
    }
    return str;
  }

  // ── Whitespace ─────────────────────────────────────────────────────────────

  /**
   * Remove excess whitespace and trim.
   *   Str.squish('  hello   world  ') → 'hello world'
   */
  static squish(str) {
    return String(str).trim().replace(/\s+/g, ' ');
  }

  // ── Masking ────────────────────────────────────────────────────────────────

  /**
   * Mask a portion of a string with a repeated character.
   *   Str.mask('password123', '*', 4)    → 'pass*******'
   *   Str.mask('password123', '*', 0, 4) → '****word123'
   *   Str.mask('password123', '*', -4)   → 'passwor****'
   */
  static mask(str, character, index, length) {
    str = String(str);
    character = String(character).charAt(0) || '*';
    const len = str.length;

    // Normalise index (supports negative)
    const start = index < 0 ? Math.max(0, len + index) : Math.min(index, len);
    const maskLen = length !== undefined
      ? Math.min(length, len - start)
      : len - start;

    return str.slice(0, start) + character.repeat(maskLen) + str.slice(start + maskLen);
  }

  // ── Generation ─────────────────────────────────────────────────────────────

  /**
   * Generate a UUID v4.
   *   Str.uuid() → '110e8400-e29b-41d4-a716-446655440000'
   */
  static uuid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
  }

  /**
   * Generate a random alphanumeric string.
   *   Str.random(16) → 'aB3kL9mNpQrStUvW'
   */
  static random(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(length);
    return Array.from(bytes, b => chars[b % chars.length]).join('');
  }

  /**
   * Generate a random string of the given length using only lowercase + numbers.
   * Useful for tokens, codes, slugs.
   *   Str.randomToken(8) → 'a3k9mpqr'
   */
  static randomToken(length = 32) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(length);
    return Array.from(bytes, b => chars[b % chars.length]).join('');
  }

  // ── Misc ───────────────────────────────────────────────────────────────────

  /**
   * Repeat a string n times.
   *   Str.repeat('ab', 3) → 'ababab'
   */
  static repeat(str, times) {
    return String(str).repeat(times);
  }

  /**
   * Reverse a string.
   *   Str.reverse('hello') → 'olleh'
   */
  static reverse(str) {
    return String(str).split('').reverse().join('');
  }

  /**
   * Count the number of words.
   *   Str.wordCount('hello world') → 2
   */
  static wordCount(str) {
    return String(str).trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * Return the length of a string.
   *   Str.length('hello') → 5
   */
  static length(str) {
    return String(str).length;
  }

  /**
   * Convert a string to uppercase.
   */
  static upper(str) {
    return String(str).toUpperCase();
  }

  /**
   * Convert a string to lowercase.
   */
  static lower(str) {
    return String(str).toLowerCase();
  }

  /**
   * Finish a string with a single instance of a given value.
   *   Str.finish('path/', '/')  → 'path/'
   *   Str.finish('path', '/')   → 'path/'
   */
  static finish(str, cap) {
    str = String(str); cap = String(cap);
    return str.endsWith(cap) ? str : str + cap;
  }

  /**
   * Begin a string with a single instance of a given value.
   *   Str.start('/path', '/')  → '/path'
   *   Str.start('path', '/')   → '/path'
   */
  static start(str, prefix) {
    str = String(str); prefix = String(prefix);
    return str.startsWith(prefix) ? str : prefix + str;
  }

  /**
   * Determine if two strings match case-insensitively.
   */
  static equalsIgnoreCase(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  /**
   * Convert a string to its ASCII representation (remove non-ASCII).
   *   Str.ascii('héllo') → 'hello'
   */
  static ascii(str) {
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x00-\x7F]/g, '');
  }

  /**
   * Return a fluent string builder wrapping the given value.
   *   Str.of('hello world').title().append('!').toString()
   */
  static of(str) {
    return new FluentString(str);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Split a string into words — handles camelCase, PascalCase,
   * snake_case, kebab-case, spaces and numbers.
   * @private
   */
  static _words(str) {
    return String(str)
      .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase → camel Case
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ABCDef → ABC Def
      .replace(/[-_]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }
}

// ── Fluent string builder ─────────────────────────────────────────────────────

/**
 * FluentString
 *
 * Immutable fluent wrapper around a string value.
 * Every method returns a new FluentString — the original is never mutated.
 *
 *   Str.of('hello world')
 *     .title()
 *     .replace('World', 'Millas')
 *     .append('!')
 *     .toString()
 *   // → 'Hello Millas!'
 */
class FluentString {
  constructor(value = '') {
    this._value = String(value);
  }

  // ── Case ────────────────────────────────────────────────────────────────────
  camel()          { return new FluentString(Str.camel(this._value)); }
  pascal()         { return new FluentString(Str.pascal(this._value)); }
  snake(sep)       { return new FluentString(Str.snake(this._value, sep)); }
  kebab()          { return new FluentString(Str.kebab(this._value)); }
  title()          { return new FluentString(Str.title(this._value)); }
  headline()       { return new FluentString(Str.headline(this._value)); }
  upper()          { return new FluentString(Str.upper(this._value)); }
  lower()          { return new FluentString(Str.lower(this._value)); }
  ucfirst()        { return new FluentString(Str.ucfirst(this._value)); }
  lcfirst()        { return new FluentString(Str.lcfirst(this._value)); }
  slug(sep)        { return new FluentString(Str.slug(this._value, sep)); }
  ascii()          { return new FluentString(Str.ascii(this._value)); }

  // ── Plural / singular ───────────────────────────────────────────────────────
  plural(count)    { return new FluentString(Str.plural(this._value, count)); }
  singular()       { return new FluentString(Str.singular(this._value)); }

  // ── Truncation ─────────────────────────────────────────────────────────────
  limit(n, end)    { return new FluentString(Str.limit(this._value, n, end)); }
  words(n, end)    { return new FluentString(Str.words(this._value, n, end)); }
  truncate(n, end) { return new FluentString(Str.truncate(this._value, n, end)); }
  excerpt(phrase, opts) { return new FluentString(Str.excerpt(this._value, phrase, opts)); }

  // ── Padding ────────────────────────────────────────────────────────────────
  pad(len, ch, pos)  { return new FluentString(Str.pad(this._value, len, ch, pos)); }
  padLeft(len, ch)   { return new FluentString(Str.padLeft(this._value, len, ch)); }
  padRight(len, ch)  { return new FluentString(Str.padRight(this._value, len, ch)); }
  padBoth(len, ch)   { return new FluentString(Str.padBoth(this._value, len, ch)); }

  // ── Extraction ─────────────────────────────────────────────────────────────
  before(s)          { return new FluentString(Str.before(this._value, s)); }
  beforeLast(s)      { return new FluentString(Str.beforeLast(this._value, s)); }
  after(s)           { return new FluentString(Str.after(this._value, s)); }
  afterLast(s)       { return new FluentString(Str.afterLast(this._value, s)); }
  between(a, b)      { return new FluentString(Str.between(this._value, a, b)); }
  betweenFirst(a, b) { return new FluentString(Str.betweenFirst(this._value, a, b)); }
  substr(s, l)       { return new FluentString(Str.substr(this._value, s, l)); }

  // ── Replacement ────────────────────────────────────────────────────────────
  replace(search, rep, cs) { return new FluentString(Str.replace(search, rep, this._value, cs)); }
  replaceFirst(s, r)       { return new FluentString(Str.replaceFirst(s, r, this._value)); }
  replaceLast(s, r)        { return new FluentString(Str.replaceLast(s, r, this._value)); }
  replaceArray(s, arr)     { return new FluentString(Str.replaceArray(s, arr, this._value)); }
  remove(s, cs)            { return new FluentString(Str.remove(s, this._value, cs)); }
  swap(map)                { return new FluentString(Str.swap(map, this._value)); }

  // ── Append / prepend ───────────────────────────────────────────────────────
  /** Append one or more strings. Str.of('hello').append(' ', 'world') → 'hello world' */
  append(...parts)   { return new FluentString(this._value + parts.join('')); }
  /** Prepend one or more strings. Str.of('world').prepend('hello ') → 'hello world' */
  prepend(...parts)  { return new FluentString(parts.join('') + this._value); }
  /** Finish with a cap character. */
  finish(cap)        { return new FluentString(Str.finish(this._value, cap)); }
  /** Ensure starts with a prefix. */
  start(prefix)      { return new FluentString(Str.start(this._value, prefix)); }

  // ── Whitespace ─────────────────────────────────────────────────────────────
  trim(chars)   { return new FluentString(chars ? _trimChars(this._value, chars) : this._value.trim()); }
  ltrim(chars)  { return new FluentString(chars ? _ltrimChars(this._value, chars) : this._value.trimStart()); }
  rtrim(chars)  { return new FluentString(chars ? _rtrimChars(this._value, chars) : this._value.trimEnd()); }
  squish()      { return new FluentString(Str.squish(this._value)); }

  // ── Masking ────────────────────────────────────────────────────────────────
  mask(char, idx, len) { return new FluentString(Str.mask(this._value, char, idx, len)); }

  // ── Wrapping ───────────────────────────────────────────────────────────────
  wrap(before, after)   { return new FluentString(Str.wrap(this._value, before, after)); }
  unwrap(before, after) { return new FluentString(Str.unwrap(this._value, before, after)); }

  // ── Misc ───────────────────────────────────────────────────────────────────
  repeat(n)   { return new FluentString(Str.repeat(this._value, n)); }
  reverse()   { return new FluentString(Str.reverse(this._value)); }

  // ── Checks — return primitives, not fluent ─────────────────────────────────
  contains(n, cs)        { return Str.contains(this._value, n, cs); }
  containsAll(arr, cs)   { return Str.containsAll(this._value, arr, cs); }
  startsWith(n)          { return Str.startsWith(this._value, n); }
  endsWith(n)            { return Str.endsWith(this._value, n); }
  is(pattern)            { return Str.is(pattern, this._value); }
  isUuid()               { return Str.isUuid(this._value); }
  isUrl()                { return Str.isUrl(this._value); }
  isEmail()              { return Str.isEmail(this._value); }
  isJson()               { return Str.isJson(this._value); }
  isAscii()              { return Str.isAscii(this._value); }
  isEmpty()              { return Str.isEmpty(this._value); }
  isNotEmpty()           { return Str.isNotEmpty(this._value); }
  isAlpha()              { return Str.isAlpha(this._value); }
  isAlphanumeric()       { return Str.isAlphanumeric(this._value); }
  isNumeric()            { return Str.isNumeric(this._value); }
  equalsIgnoreCase(b)    { return Str.equalsIgnoreCase(this._value, b); }
  wordCount()            { return Str.wordCount(this._value); }
  length()               { return Str.length(this._value); }

  // ── Tap / pipe ─────────────────────────────────────────────────────────────

  /**
   * Apply a callback and return the FluentString unchanged.
   * Useful for side-effects (logging, debugging) mid-chain.
   *   Str.of('hello').tap(s => console.log(s.toString())).upper()
   */
  tap(callback) {
    callback(this);
    return this;
  }

  /**
   * Pass the FluentString through a callback and return the result.
   * The callback can return a string or FluentString.
   *   Str.of('hello').pipe(s => s.upper().append('!'))
   */
  pipe(callback) {
    const result = callback(this);
    return result instanceof FluentString ? result : new FluentString(String(result));
  }

  /**
   * Apply a callback only when the condition is truthy.
   *   Str.of('hello').when(true, s => s.upper())  → FluentString('HELLO')
   *   Str.of('hello').when(false, s => s.upper()) → FluentString('hello')
   */
  when(condition, callback, otherwise) {
    const cond = typeof condition === 'function' ? condition(this) : condition;
    if (cond) {
      const result = callback(this);
      return result instanceof FluentString ? result : this;
    }
    if (otherwise) {
      const result = otherwise(this);
      return result instanceof FluentString ? result : this;
    }
    return this;
  }

  /**
   * Apply a callback only when the string is empty.
   */
  whenEmpty(callback) {
    return this.when(this.isEmpty(), callback);
  }

  /**
   * Apply a callback only when the string is not empty.
   */
  whenNotEmpty(callback) {
    return this.when(this.isNotEmpty(), callback);
  }

  // ── Conversion ─────────────────────────────────────────────────────────────

  /** Get the raw string value. */
  toString() { return this._value; }

  /** Get the raw string value (alias). */
  value() { return this._value; }

  /** JSON serialization returns the raw string. */
  toJSON() { return this._value; }

  /** Allow implicit string coercion. */
  [Symbol.toPrimitive](hint) {
    return hint === 'number' ? +this._value : this._value;
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match the casing pattern of `original` onto `target`. */
function _matchCase(original, target) {
  if (original === original.toUpperCase()) return target.toUpperCase();
  if (original === original.toLowerCase()) return target.toLowerCase();
  if (original[0] === original[0].toUpperCase()) return Str.ucfirst(target.toLowerCase());
  return target;
}

function _trimChars(str, chars) {
  return _ltrimChars(_rtrimChars(str, chars), chars);
}
function _ltrimChars(str, chars) {
  const escaped = _escapeRegex(chars);
  return str.replace(new RegExp(`^[${escaped}]+`), '');
}
function _rtrimChars(str, chars) {
  const escaped = _escapeRegex(chars);
  return str.replace(new RegExp(`[${escaped}]+$`), '');
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { Str, FluentString };