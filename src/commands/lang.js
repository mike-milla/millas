'use strict';

const BaseCommand = require('../console/BaseCommand');
const path = require('path');
const fs = require('fs');
const {string} = require("../core/validation");

const DEFAULT_NS = 'messages';

class LangCommand extends BaseCommand {
  static description = 'Manage application translations';

  async onInit(register) {
    register
      .command(this.publish)
      .arg('locale', 'Target locale (e.g., sw, fr)')
      .arg('namespace',v=>v.string(),  'Specific namespace to publish')
      .arg('--defaults', 'Include built-in Millas framework strings')
      .arg('--fresh', 'Clear namespace files and rebuild from scratch')
      .arg('--all', 'Publish to every locale in lang/')
      .arg('--list', 'List available locales and exit')
      .arg('--dry-run', 'Preview changes without writing')
      .arg('--format',v=>v.string(), 'File format: js or json (default: js)')
      .arg('--src',v=>v.string(), 'Extra directory to scan')
      .description('Extract _() strings from app/ and write to lang/<locale>/<namespace>.js');

    register
      .command(this.missing)
      .arg('locale', 'Target locale to check')
      .description('Show untranslated keys in locale files');

    register
      .command(this.stats)
      .description('Show translation completion % for all locales');

    register
      .command(this.keys)
      .arg('--src',v=>v.string(), 'Extra directory to scan')
      .description('List all _() keys found in source files, grouped by namespace');
  }

  async publish(locale, namespace, defaults, fresh, all, list, dryRun, format, src) {
    const langPath = path.join(this.cwd, 'lang');
    const fmt = format || 'js';
    const srcDirs = this.#resolveScanDirs(src);

    if (list) {
      this.#handleList(langPath);
      return;
    }

    const targets = this.#resolveTargets(locale, all, langPath);
    if (!targets) return;

    const relDirs = srcDirs.map(d => path.relative(this.cwd, d)).filter(Boolean);
    this.logger.log(this.style.secondary(`\n  Scanning: ${relDirs.join(', ')}...`));
    const appKeys = this.#extractKeysFromDirs(srcDirs);

    if (defaults) {
      const added = this.#mergeDefaults(appKeys);
      if (added) this.logger.log(this.style.secondary(`  + ${added} framework string${added !== 1 ? 's' : ''} (-d)`));
    }

    if (!appKeys.size) {
      this.warn('No translatable strings found.');
      this.logger.log(this.style.secondary('  Use __(), __("ns::key"), _n(), _p(), _f() in your source files.\n'));
      return;
    }

    const grouped = this.#groupByNamespace(appKeys, namespace || null);
    const nsNames = [...grouped.keys()].sort();

    this.logger.log(this.style.info(
      `  ${appKeys.size} string${appKeys.size !== 1 ? 's' : ''} → ` +
      `${nsNames.length} namespace${nsNames.length !== 1 ? 's' : ''}: ${nsNames.join(', ')}\n`
    ));

    fs.mkdirSync(langPath, { recursive: true });
    let totalAdded = 0;

    for (const loc of targets) {
      const locDir = path.join(langPath, loc);
      fs.mkdirSync(locDir, { recursive: true });

      let locAdded = 0;
      const results = [];

      for (const [ns, nsKeys] of grouped) {
        const filePath = path.join(locDir, `${ns}.${fmt}`);
        const isNew = !fs.existsSync(filePath);
        const existing = (fresh || isNew) ? {} : this.#loadCatalogue(filePath);
        const added = [];
        const kept = [];

        for (const { bare, plural } of nsKeys.values()) {
          if (!fresh && existing[bare] !== undefined) { kept.push(bare); continue; }
          existing[bare] = loc === 'en'
            ? (plural ? [bare, plural] : bare)
            : (plural ? [null, null] : null);
          added.push(bare);
        }

        if (added.length > 0 && !dryRun) {
          this.#writeCatalogue(filePath, existing, fmt);
        }

        locAdded += added.length;
        totalAdded += added.length;
        results.push({ ns, filePath: path.relative(this.cwd, filePath), added, kept, isNew });
      }

      if (dryRun) {
        this.logger.log(this.style.info(`  ${loc} — dry run:`));
        results.forEach(r => {
          const tag = r.isNew ? this.style.info('(new)') : this.style.secondary(`(${r.kept.length} kept)`);
          this.logger.log(`    ${r.ns.padEnd(14)} ${tag} +${r.added.length} keys → ${r.filePath}`);
        });
      } else {
        const action = fresh ? 'Rebuilt' : (results.every(r => r.isNew) ? 'Created' : 'Updated');
        this.logger.log(this.style.success(`  ✔  ${loc.padEnd(10)}`) + ` ${action} — ${locAdded} key${locAdded !== 1 ? 's' : ''} added`);
        results.filter(r => r.added.length > 0).forEach(r => {
          this.logger.log(this.style.secondary(`       ${r.ns.padEnd(14)} +${r.added.length} → ${r.filePath}`));
        });
      }
    }

    if (dryRun) {
      this.warn('Dry run — nothing written.');
    } else if (totalAdded > 0) {
      this.success('Done. Fill in null values in lang/ to add translations.');
      this.logger.log(this.style.secondary('  Run millas lang:missing to see what needs translation.\n'));
    } else {
      this.logger.log(this.style.secondary('\n  All files already up to date.\n'));
    }
  }

  async missing(locale) {
    const langPath = path.join(this.cwd, 'lang');
    if (!fs.existsSync(langPath)) {
      this.warn('lang/ not found. Run: millas lang:publish <locale>');
      return;
    }

    const targets = this.#readLocales(langPath)
      .filter(l => l !== 'en')
      .filter(l => !locale || l === locale);

    if (!targets.length) {
      this.warn(locale
        ? `Locale "${locale}" not found in lang/.`
        : 'No non-English locales found.');
      return;
    }

    const enKeys = this.#loadAllNamespaces(langPath, 'en');
    let totalMissing = 0;
    this.logger.log('');

    for (const loc of targets) {
      const locKeys = this.#loadAllNamespaces(langPath, loc);
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
      const pct = total ? Math.round(((total - missing.length) / total) * 100) : 100;
      const color = pct === 100 ? this.style.success : pct >= 50 ? this.style.warning : this.style.danger;
      totalMissing += missing.length;

      if (!missing.length) {
        this.logger.log(color(`  ${loc.padEnd(10)} ${this.#progressBar(pct, 18)}  100%  Fully translated`));
      } else {
        this.logger.log(color(`  ${loc.padEnd(10)} ${this.#progressBar(pct, 18)}  ${pct}%  ${missing.length} missing:`));
        missing.forEach(k => this.logger.log(this.style.secondary(`               - ${JSON.stringify(k)}`)));
      }
    }

    this.logger.log('');
    this.logger.log(totalMissing > 0
      ? this.style.warning(`  ${totalMissing} key${totalMissing !== 1 ? 's' : ''} need translation.\n`)
      : this.style.success('  All locales fully translated.\n'));
  }

  async stats() {
    const langPath = path.join(this.cwd, 'lang');
    if (!fs.existsSync(langPath)) {
      this.warn('lang/ not found. Run: millas lang:publish <locale>');
      return;
    }

    const locales = this.#readLocales(langPath);
    const enKeys = this.#loadAllNamespaces(langPath, 'en');
    const total = [...enKeys.values()].reduce((s, c) => s + Object.keys(c).length, 0);

    this.logger.log(this.style.info(`\n  Translation Stats   (source: en, ${total} key${total !== 1 ? 's' : ''})\n`));
    this.logger.log(this.style.secondary('  ' + '─'.repeat(55)));

    for (const loc of locales.sort()) {
      if (loc === 'en') {
        this.logger.log(`  ${this.style.bold(loc.padEnd(10))} ${this.style.success(this.#progressBar(100, 18))}  ${this.style.success('100%')}  ${total}/${total}  ${this.style.secondary('(source)')}`);
        continue;
      }
      const locKeys = this.#loadAllNamespaces(langPath, loc);
      let translated = 0;
      for (const [ns, enCat] of enKeys) {
        const locCat = locKeys.get(ns) || {};
        for (const key of Object.keys(enCat)) {
          const v = locCat[key];
          if (v !== null && v !== undefined && (!Array.isArray(v) || v.every(x => x !== null))) translated++;
        }
      }
      const pct = total > 0 ? Math.round((translated / total) * 100) : 0;
      const color = pct === 100 ? this.style.success : pct >= 50 ? this.style.warning : this.style.danger;
      this.logger.log(`  ${this.style.bold(loc.padEnd(10))} ${color(this.#progressBar(pct, 18))}  ${color((pct + '%').padStart(4))}  ${translated}/${total}`);
    }
    this.logger.log('');
  }

  async keys(src) {
    const keys = this.#extractKeysFromDirs(this.#resolveScanDirs(src));

    if (!keys.size) {
      this.warn('No translatable strings found.');
      return;
    }

    const grouped = this.#groupByNamespace(keys, null);
    this.logger.log(this.style.info(`\n  ${keys.size} string${keys.size !== 1 ? 's' : ''} across ${grouped.size} namespace${grouped.size !== 1 ? 's' : ''}:\n`));

    for (const [ns, nsKeys] of [...grouped].sort((a, b) => a[0].localeCompare(b[0]))) {
      this.logger.log(this.style.bold(`  [${ns}]`));
      for (const [key, meta] of [...nsKeys].sort((a, b) => a[0].localeCompare(b[0]))) {
        const p = meta.plural ? this.style.secondary(`  [plural: ${JSON.stringify(meta.plural)}]`) : '';
        const locs = meta.locations.slice(0, 2).map(l => this.style.secondary(l)).join(', ');
        const more = meta.locations.length > 2 ? this.style.secondary(` +${meta.locations.length - 2}`) : '';
        this.logger.log(`    ${this.style.light(JSON.stringify(meta.bare))}${p}`);
        this.logger.log(`      ${locs}${more}`);
      }
      this.logger.log('');
    }
  }

  #handleList(langPath) {
    if (!fs.existsSync(langPath)) {
      this.warn('lang/ not found — nothing published yet.');
      return;
    }
    const locales = this.#readLocales(langPath);
    if (!locales.length) {
      this.warn('No locale files in lang/ yet.');
    } else {
      this.logger.log(this.style.info('\n  Available locales:\n'));
      for (const loc of locales) {
        const nsFiles = this.#readNamespaces(langPath, loc);
        const nsList = nsFiles.length ? this.style.secondary(` (${nsFiles.join(', ')})`) : '';
        this.logger.log(`    ${this.style.light(loc)}${nsList}`);
      }
      this.logger.log('');
    }
  }

  #resolveTargets(locale, all, langPath) {
    if (all) {
      const targets = this.#readLocales(langPath);
      if (!targets.length) {
        this.warn('No locales in lang/. Run: millas lang:publish <locale>');
        return null;
      }
      return targets;
    }
    
    if (locale) {
      return [locale];
    }

    this.error('Specify a locale: millas lang:publish sw');
    this.logger.log(this.style.secondary('     millas lang:publish sw'));
    this.logger.log(this.style.secondary('     millas lang:publish sw auth'));
    this.logger.log(this.style.secondary('     millas lang:publish sw --defaults'));
    this.logger.log(this.style.secondary('     millas lang:publish --all\n'));
    throw new Error('Locale required');
  }

  #resolveScanDirs(extraSrc) {
    let configured = null;
    try {
      const i18nConfig = require(path.join(this.cwd, 'config/i18n'));
      if (Array.isArray(i18nConfig.scan) && i18nConfig.scan.length) {
        configured = i18nConfig.scan;
      }
    } catch { }

    const rawDirs = configured || ['app', 'resources', 'routes', 'mail', 'providers'];
    if (extraSrc) rawDirs.push(extraSrc);

    return [...new Set(rawDirs)]
      .map(d => path.isAbsolute(d) ? d : path.join(this.cwd, d))
      .filter(d => fs.existsSync(d));
  }

  #extractKeysFromDirs(dirs) {
    const merged = new Map();
    for (const dir of dirs) {
      const keys = this.#extractKeys(dir);
      for (const [fullKey, meta] of keys) {
        if (!merged.has(fullKey)) {
          merged.set(fullKey, { ...meta, locations: [...meta.locations] });
        } else {
          const existing = merged.get(fullKey);
          for (const loc of meta.locations) {
            if (!existing.locations.includes(loc)) existing.locations.push(loc);
          }
        }
      }
    }
    return merged;
  }

  #extractKeys(srcPath) {
    const keys = new Map();
    if (!fs.existsSync(srcPath)) return keys;

    for (const filePath of this.#walkFiles(srcPath, ['.js', '.njk', '.html'])) {
      let source;
      try { source = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
      const rel = path.relative(this.cwd, filePath);

      this.#scanSingle(source, /\b__\(\s*(['\"`])((?:\\.|(?!\1).)*)\1/g, 2, null, rel, keys);
      this.#scanSingle(source, /\b_f\(\s*(['\"`])((?:\\.|(?!\1).)*)\1/g, 2, null, rel, keys);
      this.#scanPlural(source, /\b_n\(\s*(['\"`])((?:\\.|(?!\1).)*)\1\s*,\s*(['\"`])((?:\\.|(?!\3).)*)\3/g, rel, keys);
      this.#scanPlural(source, /\b_fn\(\s*(['\"`])((?:\\.|(?!\1).)*)\1\s*,\s*(['\"`])((?:\\.|(?!\3).)*)\3/g, rel, keys);

      let m;
      const pPat = /\b_p\(\s*(['\"`])((?:\\.|(?!\1).)*)\1\s*,\s*(['\"`])((?:\\.|(?!\3).)*)\3/g;
      while ((m = pPat.exec(source)) !== null) {
        this.#addKey(keys, `${this.#unescape(m[2])}|${this.#unescape(m[4])}`, null, rel);
      }

      this.#scanSingle(source, /\{\{[^}]*(['\"])((?:\\.|(?!\1).)*)\1\s*\|\s*__/g, 2, null, rel, keys);
      this.#scanSingle(source, /\{\{[^}]*(['\"])((?:\\.|(?!\1).)*)\1\s*\|\s*_f/g, 2, null, rel, keys);
    }

    return keys;
  }

  #scanSingle(source, regex, keyGroup, _pluralGroup, location, keys) {
    let m;
    while ((m = regex.exec(source)) !== null) this.#addKey(keys, this.#unescape(m[keyGroup]), null, location);
  }

  #scanPlural(source, regex, location, keys) {
    let m;
    while ((m = regex.exec(source)) !== null) this.#addKey(keys, this.#unescape(m[2]), this.#unescape(m[4]), location);
  }

  #addKey(keys, fullKey, plural, location) {
    if (!fullKey || !fullKey.trim()) return;
    const { namespace, bare } = this.#parseKey(fullKey);
    if (!keys.has(fullKey)) keys.set(fullKey, { namespace, bare, plural: null, locations: [] });
    const e = keys.get(fullKey);
    if (!e.plural && plural) e.plural = plural;
    if (!e.locations.includes(location)) e.locations.push(location);
  }

  #unescape(s) {
    return String(s)
      .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
      .replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  #parseKey(key) {
    const sep = key.indexOf('::');
    if (sep === -1) return { namespace: DEFAULT_NS, bare: key };
    return { namespace: key.slice(0, sep).trim() || DEFAULT_NS, bare: key.slice(sep + 2) };
  }

  #groupByNamespace(keys, nsFilter) {
    const groups = new Map();
    for (const [fullKey, meta] of keys) {
      const ns = meta.namespace;
      if (nsFilter && ns !== nsFilter) continue;
      if (!groups.has(ns)) groups.set(ns, new Map());
      groups.get(ns).set(fullKey, meta);
    }
    return groups;
  }

  #mergeDefaults(appKeys) {
    const defaults = require('../i18n/defaults');
    let added = 0;
    for (const [key, val] of Object.entries(defaults)) {
      if (!appKeys.has(key)) {
        const { namespace: ns, bare } = this.#parseKey(key);
        appKeys.set(key, {
          namespace: ns,
          bare,
          plural: Array.isArray(val) ? val[1] : null,
          locations: ['[millas]'],
        });
        added++;
      }
    }
    return added;
  }

  #loadCatalogue(filePath) {
    if (!fs.existsSync(filePath)) return {};
    try {
      try { delete require.cache[require.resolve(filePath)]; } catch { }
      return filePath.endsWith('.json') ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : (require(filePath) || {});
    } catch { return {}; }
  }

  #loadAllNamespaces(langPath, locale) {
    const result = new Map();
    const locDir = path.join(langPath, locale);

    if (fs.existsSync(locDir) && fs.statSync(locDir).isDirectory()) {
      for (const file of fs.readdirSync(locDir).filter(f => /\.(js|json)$/.test(f))) {
        const ns = file.replace(/\.(js|json)$/, '');
        const cat = this.#loadCatalogue(path.join(locDir, file));
        result.set(ns, cat);
      }
    } else {
      for (const ext of ['.js', '.json']) {
        const flat = path.join(langPath, locale + ext);
        if (fs.existsSync(flat)) {
          result.set(DEFAULT_NS, this.#loadCatalogue(flat));
          break;
        }
      }
    }
    return result;
  }

  #writeCatalogue(filePath, catalogue, fmt) {
    const sorted = Object.keys(catalogue).sort().reduce((a, k) => { a[k] = catalogue[k]; return a; }, {});
    let content;
    if (fmt === 'json') {
      content = JSON.stringify(sorted, null, 2) + '\n';
    } else {
      const lines = ["'use strict';\n", 'module.exports = {'];
      for (const [k, v] of Object.entries(sorted)) {
        const key = JSON.stringify(k);
        if (v === null) lines.push(`  ${key}: null,`);
        else if (Array.isArray(v)) lines.push(`  ${key}: [${v.map(x => x === null ? 'null' : JSON.stringify(x)).join(', ')}],`);
        else lines.push(`  ${key}: ${JSON.stringify(v)},`);
      }
      lines.push('};\n');
      content = lines.join('\n');
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  #readLocales(langPath) {
    if (!fs.existsSync(langPath)) return [];
    return fs.readdirSync(langPath, { withFileTypes: true })
      .filter(e => (e.isFile() && /\.(js|json)$/.test(e.name)) || e.isDirectory())
      .map(e => e.name.replace(/\.(js|json)$/, ''));
  }

  #readNamespaces(langPath, locale) {
    const locDir = path.join(langPath, locale);
    if (!fs.existsSync(locDir) || !fs.statSync(locDir).isDirectory()) return [];
    return fs.readdirSync(locDir)
      .filter(f => /\.(js|json)$/.test(f))
      .map(f => f.replace(/\.(js|json)$/, ''));
  }

  #walkFiles(dir, exts) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) results.push(...this.#walkFiles(full, exts));
      else if (exts.some(x => e.name.endsWith(x))) results.push(full);
    }
    return results;
  }

  #progressBar(pct, width) {
    const f = Math.round((pct / 100) * width);
    return '[' + '█'.repeat(f) + '░'.repeat(width - f) + ']';
  }
}

module.exports = LangCommand;
