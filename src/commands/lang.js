'use strict';

const chalk = require('chalk');
const path  = require('path');
const fs    = require('fs');

const DEFAULT_NS = 'messages'; // bare __('key') with no :: goes here

module.exports = function (program) {

  // ── lang:publish <locale> [namespace] ────────────────────────────────────
  //
  //   millas lang:publish sw              → scan app/, write lang/sw/messages.js
  //                                         (and other namespaces found)
  //   millas lang:publish sw auth         → only write lang/sw/auth.js
  //   millas lang:publish sw -d           → include framework defaults too
  //   millas lang:publish sw --fresh      → wipe locale dir and rebuild
  //   millas lang:publish --all           → every locale already in lang/
  //   millas lang:publish --list          → list locales in lang/
  //
  program
    .command('lang:publish [locale] [namespace]')
    .description('Extract _() strings from app/ and write to lang/<locale>/<namespace>.js')
    .option('-d, --defaults',  'Also include built-in Millas framework strings')
    .option('--fresh',         'Clear the namespace file(s) and rebuild from scratch')
    .option('--all',           'Publish to every locale already in lang/')
    .option('--list',          'List available locales and exit')
    .option('--dry-run',       'Preview changes without writing')
    .option('--format <fmt>',  'File format: js or json (default: js)')
    .option('--src <dir>',     'Extra directory to scan (repeatable). Defaults: app/, resources/, routes/, mail/')
    .action(async (locale, namespace, options) => {
      try {
        const cwd      = process.cwd();
        const langPath = path.join(cwd, 'lang');
        const fmt      = options.format || 'js';

        // Resolve scan directories — user config wins, otherwise sensible defaults
        const srcDirs  = resolveScanDirs(cwd, options.src);

        // ── --list ────────────────────────────────────────────────────────
        if (options.list) {
          if (!fs.existsSync(langPath)) {
            console.log(chalk.yellow('\n  lang/ not found — nothing published yet.\n'));
            return;
          }
          const locales = readLocales(langPath);
          if (!locales.length) {
            console.log(chalk.yellow('\n  No locale files in lang/ yet.\n'));
          } else {
            console.log(chalk.cyan('\n  Available locales:\n'));
            for (const loc of locales) {
              const nsFiles = readNamespaces(langPath, loc);
              const nsList  = nsFiles.length ? chalk.gray(` (${nsFiles.join(', ')})`) : '';
              console.log(`    ${chalk.white(loc)}${nsList}`);
            }
            console.log('');
          }
          return;
        }

        // ── Determine target locales ──────────────────────────────────────
        let targets = [];
        if (options.all) {
          targets = readLocales(langPath);
          if (!targets.length) {
            console.log(chalk.yellow('\n  No locales in lang/. Run: millas lang:publish <locale>\n'));
            return;
          }
        } else if (locale) {
          targets = [locale];
        } else {
          console.log(chalk.red('\n  ✖  Specify a locale: millas lang:publish sw\n'));
          console.log(chalk.gray('     millas lang:publish sw'));
          console.log(chalk.gray('     millas lang:publish sw auth'));
          console.log(chalk.gray('     millas lang:publish sw --defaults'));
          console.log(chalk.gray('     millas lang:publish --all\n'));
          process.exit(1);
        }

        // ── Step 1: Extract keys from source ─────────────────────────────
        const relDirs = srcDirs.map(d => path.relative(cwd, d)).filter(Boolean);
        console.log(chalk.gray(`\n  Scanning: ${relDirs.join(', ')}...`));
        const appKeys = extractKeysFromDirs(srcDirs, cwd);

        // ── Step 2: Merge framework defaults if -d ────────────────────────
        if (options.defaults) {
          const defaults = require('../i18n/defaults');
          let added = 0;
          for (const [key, val] of Object.entries(defaults)) {
            if (!appKeys.has(key)) {
              const { namespace: ns, bare } = parseKey(key);
              appKeys.set(key, {
                namespace: ns,
                bare,
                plural:    Array.isArray(val) ? val[1] : null,
                locations: ['[millas]'],
              });
              added++;
            }
          }
          if (added) console.log(chalk.gray(`  + ${added} framework string${added !== 1 ? 's' : ''} (-d)`));
        }

        if (!appKeys.size) {
          console.log(chalk.yellow('\n  No translatable strings found.\n'));
          console.log(chalk.gray('  Use __(), __("ns::key"), _n(), _p(), _f() in your source files.\n'));
          return;
        }

        // ── Step 3: Group keys by namespace ──────────────────────────────
        // Only publish the requested namespace if one was specified
        const grouped = groupByNamespace(appKeys, namespace || null);
        const nsNames = [...grouped.keys()].sort();

        console.log(chalk.cyan(
          `  ${appKeys.size} string${appKeys.size !== 1 ? 's' : ''} → ` +
          `${nsNames.length} namespace${nsNames.length !== 1 ? 's' : ''}: ${nsNames.join(', ')}\n`
        ));

        fs.mkdirSync(langPath, { recursive: true });
        let totalAdded = 0;

        // ── Step 4: Write each locale × namespace combination ─────────────
        for (const loc of targets) {
          const locDir = path.join(langPath, loc);
          fs.mkdirSync(locDir, { recursive: true });

          let locAdded = 0;
          const results = [];

          for (const [ns, nsKeys] of grouped) {
            const filePath = path.join(locDir, `${ns}.${fmt}`);
            const isNew    = !fs.existsSync(filePath);
            const existing = (options.fresh || isNew) ? {} : loadCatalogue(filePath);
            const added    = [];
            const kept     = [];

            for (const { bare, plural } of nsKeys.values()) {
              if (!options.fresh && existing[bare] !== undefined) { kept.push(bare); continue; }
              existing[bare] = loc === 'en'
                ? (plural ? [bare, plural] : bare)
                : (plural ? [null, null] : null);
              added.push(bare);
            }

            if (added.length > 0 && !options.dryRun) {
              writeCatalogue(filePath, existing, fmt);
            }

            locAdded  += added.length;
            totalAdded += added.length;
            results.push({ ns, filePath: path.relative(cwd, filePath), added, kept, isNew });
          }

          // Print per-locale summary
          if (options.dryRun) {
            console.log(chalk.cyan(`  ${loc} — dry run:`));
            results.forEach(r => {
              const tag = r.isNew ? chalk.cyan('(new)') : chalk.gray(`(${r.kept.length} kept)`);
              console.log(`    ${r.ns.padEnd(14)} ${tag} +${r.added.length} keys → ${r.filePath}`);
            });
          } else {
            const action = options.fresh ? 'Rebuilt' : (results.every(r => r.isNew) ? 'Created' : 'Updated');
            console.log(chalk.green(`  ✔  ${loc.padEnd(10)}`) + ` ${action} — ${locAdded} key${locAdded !== 1 ? 's' : ''} added`);
            results.filter(r => r.added.length > 0).forEach(r => {
              console.log(chalk.gray(`       ${r.ns.padEnd(14)} +${r.added.length} → ${r.filePath}`));
            });
          }
        }

        if (options.dryRun) {
          console.log(chalk.yellow('\n  Dry run — nothing written.\n'));
        } else if (totalAdded > 0) {
          console.log(chalk.green(`\n  Done. Fill in null values in lang/ to add translations.`));
          console.log(chalk.gray('  Run millas lang:missing to see what needs translation.\n'));
        } else {
          console.log(chalk.gray('\n  All files already up to date.\n'));
        }

      } catch (err) {
        console.error(chalk.red(`\n  ✖  ${err.message}\n`));
        if (process.env.DEBUG) console.error(err.stack);
        process.exit(1);
      }
    });

  // ── lang:missing [locale] ────────────────────────────────────────────────
  program
    .command('lang:missing [locale]')
    .description('Show untranslated keys in locale files')
    .action(async (locale) => {
      try {
        const langPath = path.join(process.cwd(), 'lang');
        if (!fs.existsSync(langPath)) {
          console.log(chalk.yellow('\n  lang/ not found. Run: millas lang:publish <locale>\n'));
          return;
        }

        const targets = readLocales(langPath)
          .filter(l => l !== 'en')
          .filter(l => !locale || l === locale);

        if (!targets.length) {
          console.log(chalk.yellow(locale
            ? `\n  Locale "${locale}" not found in lang/.\n`
            : '\n  No non-English locales found.\n'));
          return;
        }

        // Load en as source of truth
        const enKeys = loadAllNamespaces(langPath, 'en'); // Map<ns, catalogue>

        let totalMissing = 0;
        console.log('');

        for (const loc of targets) {
          const locKeys = loadAllNamespaces(langPath, loc);
          const missing = [];

          for (const [ns, enCat] of enKeys) {
            const locCat = locKeys.get(ns) || {};
            for (const key of Object.keys(enCat)) {
              const val = locCat[key];
              if (val === null || val === undefined || (Array.isArray(val) && val.some(v => v === null))) {
                missing.push(`${ns}::${key}`);
              }
            }
          }

          const total = [...enKeys.values()].reduce((s, c) => s + Object.keys(c).length, 0);
          const pct   = total ? Math.round(((total - missing.length) / total) * 100) : 100;
          const color = pct === 100 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red;
          totalMissing += missing.length;

          if (!missing.length) {
            console.log(color(`  ${loc.padEnd(10)} ${progressBar(pct, 18)}  100%  Fully translated`));
          } else {
            console.log(color(`  ${loc.padEnd(10)} ${progressBar(pct, 18)}  ${pct}%  ${missing.length} missing:`));
            missing.forEach(k => console.log(chalk.gray(`               - ${JSON.stringify(k)}`)));
          }
        }

        console.log('');
        console.log(totalMissing > 0
          ? chalk.yellow(`  ${totalMissing} key${totalMissing !== 1 ? 's' : ''} need translation.\n`)
          : chalk.green('  All locales fully translated.\n'));

      } catch (err) {
        console.error(chalk.red(`\n  ✖  ${err.message}\n`));
        process.exit(1);
      }
    });

  // ── lang:stats ───────────────────────────────────────────────────────────
  program
    .command('lang:stats')
    .description('Show translation completion % for all locales')
    .action(async () => {
      try {
        const langPath = path.join(process.cwd(), 'lang');
        if (!fs.existsSync(langPath)) {
          console.log(chalk.yellow('\n  lang/ not found. Run: millas lang:publish <locale>\n'));
          return;
        }

        const locales  = readLocales(langPath);
        const enKeys   = loadAllNamespaces(langPath, 'en');
        const total    = [...enKeys.values()].reduce((s, c) => s + Object.keys(c).length, 0);

        console.log(chalk.cyan(`\n  Translation Stats   (source: en, ${total} key${total !== 1 ? 's' : ''})\n`));
        console.log(chalk.gray('  ' + '─'.repeat(55)));

        for (const loc of locales.sort()) {
          if (loc === 'en') {
            console.log(`  ${chalk.bold(loc.padEnd(10))} ${chalk.green(progressBar(100, 18))}  ${chalk.green('100%')}  ${total}/${total}  ${chalk.gray('(source)')}`);
            continue;
          }
          const locKeys    = loadAllNamespaces(langPath, loc);
          let translated   = 0;
          for (const [ns, enCat] of enKeys) {
            const locCat = locKeys.get(ns) || {};
            for (const key of Object.keys(enCat)) {
              const v = locCat[key];
              if (v !== null && v !== undefined && (!Array.isArray(v) || v.every(x => x !== null))) translated++;
            }
          }
          const pct   = total > 0 ? Math.round((translated / total) * 100) : 0;
          const color = pct === 100 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red;
          console.log(`  ${chalk.bold(loc.padEnd(10))} ${color(progressBar(pct, 18))}  ${color((pct + '%').padStart(4))}  ${translated}/${total}`);
        }
        console.log('');

      } catch (err) {
        console.error(chalk.red(`\n  ✖  ${err.message}\n`));
        process.exit(1);
      }
    });

  // ── lang:keys ────────────────────────────────────────────────────────────
  program
    .command('lang:keys')
    .description('List all _() keys found in source files, grouped by namespace')
    .option('--src <dir>', 'Extra directory to scan (uses defaults if not set)')
    .action(async (options) => {
      try {
        const cwd  = process.cwd();
        const keys = extractKeysFromDirs(resolveScanDirs(cwd, options.src), cwd);

        if (!keys.size) {
          console.log(chalk.yellow(`\n  No translatable strings found.\n`));
          return;
        }

        // Group by namespace for display
        const grouped = groupByNamespace(keys, null);
        console.log(chalk.cyan(`\n  ${keys.size} string${keys.size !== 1 ? 's' : ''} across ${grouped.size} namespace${grouped.size !== 1 ? 's' : ''}:\n`));

        for (const [ns, nsKeys] of [...grouped].sort((a, b) => a[0].localeCompare(b[0]))) {
          console.log(chalk.bold(`  [${ns}]`));
          for (const [key, meta] of [...nsKeys].sort((a, b) => a[0].localeCompare(b[0]))) {
            const p    = meta.plural ? chalk.gray(`  [plural: ${JSON.stringify(meta.plural)}]`) : '';
            const locs = meta.locations.slice(0, 2).map(l => chalk.gray(l)).join(', ');
            const more = meta.locations.length > 2 ? chalk.gray(` +${meta.locations.length - 2}`) : '';
            console.log(`    ${chalk.white(JSON.stringify(meta.bare))}${p}`);
            console.log(`      ${locs}${more}`);
          }
          console.log('');
        }

      } catch (err) {
        console.error(chalk.red(`\n  ✖  ${err.message}\n`));
        process.exit(1);
      }
    });
};

// ─── Directory resolution ────────────────────────────────────────────────────────

/**
 * Resolve the list of directories to scan for translatable strings.
 *
 * Priority:
 *   1. config/i18n.js → scan: ['app', 'resources', 'routes', 'mail']
 *   2. --src <dir> CLI flag (adds to defaults, does not replace them)
 *   3. Built-in defaults: app/, resources/, routes/, mail/
 *
 * Only returns directories that actually exist — silently skips missing ones
 * so projects that don't have a resources/ directory don't see warnings.
 */
function resolveScanDirs(cwd, extraSrc) {
  // Try config/i18n.js first
  let configured = null;
  try {
    const i18nConfig = require(path.join(cwd, 'config/i18n'));
    if (Array.isArray(i18nConfig.scan) && i18nConfig.scan.length) {
      configured = i18nConfig.scan;
    }
  } catch { /* no config/i18n.js — use defaults */ }

  const rawDirs = configured || [
    'app',           // controllers, models, services, middleware, jobs
    'resources',     // views (.njk, .html) — resources/views/ is common
    'routes',        // route files often contain inline messages
    'mail',          // email templates
    'providers',     // service providers sometimes have translatable strings
  ];

  // Add any --src flag value on top
  if (extraSrc) rawDirs.push(extraSrc);

  // Resolve to absolute paths and filter to only existing ones
  return [...new Set(rawDirs)]
    .map(d => path.isAbsolute(d) ? d : path.join(cwd, d))
    .filter(d => fs.existsSync(d));
}

/**
 * Extract translatable keys from multiple directories.
 * Merges all results — a key found in multiple places gets all locations tracked.
 */
function extractKeysFromDirs(dirs, cwd) {
  const merged = new Map();
  for (const dir of dirs) {
    const keys = extractKeys(dir, cwd);
    for (const [fullKey, meta] of keys) {
      if (!merged.has(fullKey)) {
        merged.set(fullKey, { ...meta, locations: [...meta.locations] });
      } else {
        // Merge locations from multiple dirs
        const existing = merged.get(fullKey);
        for (const loc of meta.locations) {
          if (!existing.locations.includes(loc)) existing.locations.push(loc);
        }
      }
    }
  }
  return merged;
}

// ─── Namespace parsing ────────────────────────────────────────────────────────

function parseKey(key) {
  const sep = key.indexOf('::');
  if (sep === -1) return { namespace: DEFAULT_NS, bare: key };
  return { namespace: key.slice(0, sep).trim() || DEFAULT_NS, bare: key.slice(sep + 2) };
}

// ─── Key extractor ────────────────────────────────────────────────────────────

/**
 * Scan source files and extract all _() calls.
 * Returns Map<fullKey, { namespace, bare, plural, locations[] }>
 * fullKey is the original string including namespace prefix if present.
 */
function extractKeys(srcPath, cwd) {
  const keys = new Map();
  if (!fs.existsSync(srcPath)) return keys;

  for (const filePath of walkFiles(srcPath, ['.js', '.njk', '.html'])) {
    let source;
    try { source = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
    const rel = path.relative(cwd, filePath);

    // __('key')  __('ns::key')
    scanSingle(source, /\b__\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g, 2, null, rel, keys);

    // _f('key', ...)
    scanSingle(source, /\b_f\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g, 2, null, rel, keys);

    // _n('singular', 'plural', n)
    scanPlural(source, /\b_n\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*(['"`])((?:\\.|(?!\3).)*)\3/g, rel, keys);

    // _fn('singular', 'plural', n)
    scanPlural(source, /\b_fn\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*(['"`])((?:\\.|(?!\3).)*)\3/g, rel, keys);

    // _p('context', 'key') — stored as 'messages::context|key' (context sep is |, not ::)
    let m;
    const pPat = /\b_p\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*(['"`])((?:\\.|(?!\3).)*)\3/g;
    while ((m = pPat.exec(source)) !== null) {
      addKey(keys, `${un(m[2])}|${un(m[4])}`, null, rel);
    }

    // Nunjucks: {{ 'key' | __ }}  {{ 'ns::key' | __ }}
    scanSingle(source, /\{\{[^}]*(['"])((?:\\.|(?!\1).)*)\1\s*\|\s*__/g,  2, null, rel, keys);
    scanSingle(source, /\{\{[^}]*(['"])((?:\\.|(?!\1).)*)\1\s*\|\s*_f/g,  2, null, rel, keys);
  }

  return keys;
}

function scanSingle(source, regex, keyGroup, _pluralGroup, location, keys) {
  let m;
  while ((m = regex.exec(source)) !== null) addKey(keys, un(m[keyGroup]), null, location);
}

function scanPlural(source, regex, location, keys) {
  let m;
  while ((m = regex.exec(source)) !== null) addKey(keys, un(m[2]), un(m[4]), location);
}

function addKey(keys, fullKey, plural, location) {
  if (!fullKey || !fullKey.trim()) return;
  const { namespace, bare } = parseKey(fullKey);
  if (!keys.has(fullKey)) keys.set(fullKey, { namespace, bare, plural: null, locations: [] });
  const e = keys.get(fullKey);
  if (!e.plural && plural) e.plural = plural;
  if (!e.locations.includes(location)) e.locations.push(location);
}

function un(s) {
  return String(s)
    .replace(/\\n/g,'\n').replace(/\\t/g,'\t')
    .replace(/\\'/g,"'").replace(/\\"/g,'"').replace(/\\\\/g,'\\');
}

/**
 * Group extracted keys by namespace.
 * If nsFilter is set, only return that namespace.
 * Returns Map<namespace, Map<fullKey, meta>>
 */
function groupByNamespace(keys, nsFilter) {
  const groups = new Map();
  for (const [fullKey, meta] of keys) {
    const ns = meta.namespace;
    if (nsFilter && ns !== nsFilter) continue;
    if (!groups.has(ns)) groups.set(ns, new Map());
    groups.get(ns).set(fullKey, meta);
  }
  return groups;
}

// ─── Catalogue I/O ────────────────────────────────────────────────────────────

function loadCatalogue(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    try { delete require.cache[require.resolve(filePath)]; } catch {}
    return filePath.endsWith('.json') ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : (require(filePath) || {});
  } catch { return {}; }
}

/**
 * Load all namespace files for a locale.
 * Returns Map<namespace, catalogue>
 */
function loadAllNamespaces(langPath, locale) {
  const result  = new Map();
  const locDir  = path.join(langPath, locale);

  if (fs.existsSync(locDir) && fs.statSync(locDir).isDirectory()) {
    // Subdirectory layout: lang/sw/auth.js, lang/sw/messages.js
    for (const file of fs.readdirSync(locDir).filter(f => /\.(js|json)$/.test(f))) {
      const ns  = file.replace(/\.(js|json)$/, '');
      const cat = loadCatalogue(path.join(locDir, file));
      result.set(ns, cat);
    }
  } else {
    // Flat layout: lang/sw.js — treat everything as 'messages' namespace
    for (const ext of ['.js', '.json']) {
      const flat = path.join(langPath, locale + ext);
      if (fs.existsSync(flat)) {
        result.set(DEFAULT_NS, loadCatalogue(flat));
        break;
      }
    }
  }
  return result;
}

function writeCatalogue(filePath, catalogue, fmt) {
  const sorted = Object.keys(catalogue).sort().reduce((a, k) => { a[k] = catalogue[k]; return a; }, {});
  let content;
  if (fmt === 'json') {
    content = JSON.stringify(sorted, null, 2) + '\n';
  } else {
    const lines = ["'use strict';\n", 'module.exports = {'];
    for (const [k, v] of Object.entries(sorted)) {
      const key = JSON.stringify(k);
      if (v === null)            lines.push(`  ${key}: null,`);
      else if (Array.isArray(v)) lines.push(`  ${key}: [${v.map(x => x === null ? 'null' : JSON.stringify(x)).join(', ')}],`);
      else                       lines.push(`  ${key}: ${JSON.stringify(v)},`);
    }
    lines.push('};\n');
    content = lines.join('\n');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

// ─── Directory helpers ────────────────────────────────────────────────────────

/**
 * Read all locale names from lang/.
 * Handles both flat (sw.js) and subdirectory (sw/) layouts.
 */
function readLocales(langPath) {
  if (!fs.existsSync(langPath)) return [];
  return fs.readdirSync(langPath, { withFileTypes: true })
    .filter(e => (e.isFile() && /\.(js|json)$/.test(e.name)) || e.isDirectory())
    .map(e => e.name.replace(/\.(js|json)$/, ''));
}

/**
 * Read namespace file names for a locale subdirectory.
 */
function readNamespaces(langPath, locale) {
  const locDir = path.join(langPath, locale);
  if (!fs.existsSync(locDir) || !fs.statSync(locDir).isDirectory()) return [];
  return fs.readdirSync(locDir)
    .filter(f => /\.(js|json)$/.test(f))
    .map(f => f.replace(/\.(js|json)$/, ''));
}

function walkFiles(dir, exts) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) results.push(...walkFiles(full, exts));
    else if (exts.some(x => e.name.endsWith(x))) results.push(full);
  }
  return results;
}

function progressBar(pct, width) {
  const f = Math.round((pct / 100) * width);
  return '[' + '█'.repeat(f) + '░'.repeat(width - f) + ']';
}
