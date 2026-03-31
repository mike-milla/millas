'use strict';

const path        = require('path');
const nunjucks    = require('nunjucks');
const ActivityLog  = require('./ActivityLog');
const { HookPipeline, AdminHooks } = require('./HookRegistry');
const AdminAuth   = require('./AdminAuth');
const { AdminResource, AdminField, AdminFilter, AdminInline } = require('./resources/AdminResource');
const Facade       = require('../facades/Facade');

const AuthHandler   = require('./handlers/AuthHandler');
const PageHandler   = require('./handlers/PageHandler');
const ActionHandler = require('./handlers/ActionHandler');
const ApiHandler    = require('./handlers/ApiHandler');
const InlineHandler = require('./handlers/InlineHandler');
const ExportHandler = require('./handlers/ExportHandler');

class Admin {
  constructor() {
    this._resources = new Map();
    this._config    = { prefix: '/admin', title: 'Millas Admin' };
    this._njk       = null;
  }

  configure(config = {}) {
    if (config.prefix) config = { ...config, prefix: config.prefix.replace(/\/+$/, '') };
    Object.assign(this._config, config);
    if (config.auth !== undefined) AdminAuth.configure(config.auth);
    return this;
  }

  register(ResourceOrModel) {
    let Resource = ResourceOrModel;
    if (ResourceOrModel.fields !== undefined &&
        !(ResourceOrModel.prototype instanceof AdminResource)) {
      Resource = this._autoResource(ResourceOrModel);
    }
    this._resources.set(Resource.slug, Resource);
    return this;
  }

  registerMany(list = []) {
    list.forEach(r => this.register(r));
    return this;
  }

  resources() {
    return [...this._resources.values()];
  }

  mount(expressApp) {
    const prefix = this._config.prefix;
    this._njk    = this._setupNunjucks(expressApp);

    const _staticPath = path.join(__dirname, 'static');
    expressApp.use(prefix + '/static', require('express').static(_staticPath, {
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.js'))  res.setHeader('Content-Type', 'application/javascript');
        if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
      },
    }));

    expressApp.use(prefix, AdminAuth.middleware(prefix));

    const auth   = new AuthHandler(this);
    const page   = new PageHandler(this);
    const action = new ActionHandler(this);
    const api    = new ApiHandler(this);
    const inline = new InlineHandler(this);
    const exp    = new ExportHandler(this);

    expressApp.get (`${prefix}/login`,  (q, s) => auth.loginPage(q, s));
    expressApp.post(`${prefix}/login`,  (q, s) => auth.loginSubmit(q, s));
    expressApp.get (`${prefix}/logout`, (q, s) => auth.logout(q, s));

    expressApp.get(`${prefix}`,        (q, s) => page.dashboard(q, s));
    expressApp.get(`${prefix}/`,       (q, s) => page.dashboard(q, s));
    expressApp.get(`${prefix}/search`, (q, s) => page.search(q, s));

    expressApp.get(`${prefix}/api/:resource/options`, (q, s) => api.options(q, s));

    expressApp.get   (`${prefix}/:resource`,                 (q, s) => page.list(q, s));
    expressApp.get   (`${prefix}/:resource/export.:format`,  (q, s) => exp.export(q, s));
    expressApp.get   (`${prefix}/:resource/create`,          (q, s) => page.create(q, s));
    expressApp.post  (`${prefix}/:resource`,                 (q, s) => page.store(q, s));

    // ── Bulk actions — must come before /:resource/:id to avoid wildcard swallowing ──
    expressApp.post(`${prefix}/:resource/bulk-delete`,       (q, s) => action.bulkDestroy(q, s));
    expressApp.post(`${prefix}/:resource/bulk-action`,       (q, s) => action.bulkAction(q, s));

    expressApp.get   (`${prefix}/:resource/:id/edit`,        (q, s) => page.edit(q, s));
    expressApp.get   (`${prefix}/:resource/:id`,             (q, s) => page.detail(q, s));
    expressApp.post  (`${prefix}/:resource/:id`,             (q, s) => page.update(q, s));
    expressApp.post  (`${prefix}/:resource/:id/delete`,      (q, s) => page.destroy(q, s));

    expressApp.post(`${prefix}/:resource/:id/action/:action`,(q, s) => action.rowAction(q, s));

    expressApp.post(`${prefix}/:resource/:id/inline/:inlineIndex`,               (q, s) => inline.store(q, s));
    expressApp.post(`${prefix}/:resource/:id/inline/:inlineIndex/:rowId/delete`, (q, s) => inline.destroy(q, s));

    return this;
  }

  _setupNunjucks(expressApp) {
    const viewsDir = path.join(__dirname, 'views');
    
    // Check if nunjucks is already configured by the main app
    const existingEnv = expressApp.get('nunjucksEnvironment');
    let env;
    
    if (existingEnv) {
      // Create a new environment that includes both search paths
      const mainAppViewsDir = expressApp.get('views');
      env = nunjucks.configure([viewsDir, mainAppViewsDir], {
        autoescape: true,
        express:    expressApp,
        noCache:    process.env.NODE_ENV !== 'production',
      });
    } else {
      env = nunjucks.configure(viewsDir, {
        autoescape: true,
        express:    expressApp,
        noCache:    process.env.NODE_ENV !== 'production',
      });
      expressApp.set('nunjucksEnvironment', env);
    }

    const resolveFkSlug = (tableName) => {
      if (!tableName) return null;
      if (this._resources.has(tableName)) return tableName;
      for (const R of this._resources.values()) {
        if (R.model && R.model.table === tableName) return R.slug;
      }
      return null;
    };

    env.addFilter('adminCell', (value, field) => {
      if (value === null || value === undefined) return '<span class="cell-muted">—</span>';
      switch (field.type) {
        case 'boolean':
          return value
            ? `<span class="bool-yes"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`
            : `<span class="bool-no"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>`;
        case 'badge': {
          const colorMap = { admin:'purple', user:'blue', active:'green', inactive:'gray', pending:'yellow', published:'green', draft:'gray', banned:'red', true:'green', false:'gray', 1:'green', 0:'gray' };
          const c = (field.colors && field.colors[String(value)]) || colorMap[String(value)] || 'gray';
          return `<span class="badge badge-${c}">${value}</span>`;
        }
        case 'datetime':
          try { const d = new Date(value); return `<span title="${d.toISOString()}" style="font-size:12.5px">${d.toLocaleString()}</span>`; } catch { return String(value); }
        case 'date':
          try { return new Date(value).toLocaleDateString(); } catch { return String(value); }
        case 'password':  return '<span class="cell-muted" style="letter-spacing:2px">••••••</span>';
        case 'image':     return value ? `<img src="${value}" class="cell-image" alt="">` : '<span class="cell-muted">—</span>';
        case 'json':      return `<code class="cell-mono">${JSON.stringify(value).slice(0, 40)}…</code>`;
        case 'email':     return `<a href="mailto:${value}" style="color:var(--primary);text-decoration:none">${value}</a>`;
        case 'url':       return `<a href="${value}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;word-break:break-all">${value}</a>`;
        case 'phone':     return `<a href="tel:${value}" style="color:var(--primary);text-decoration:none">${value}</a>`;
        case 'color':     return `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:16px;height:16px;border-radius:3px;background:${value};border:1px solid var(--border);flex-shrink:0"></span><span class="cell-mono">${value}</span></span>`;
        case 'richtext':  return `<div style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-soft)">${String(value).replace(/<[^>]+>/g, '').slice(0, 80)}</div>`;
        case 'fk': {
          const fkSlug = resolveFkSlug(field.fkResource);
          const prefix = this._config.prefix || '/admin';
          return fkSlug
            ? `<span class="fk-cell">${value}<a class="fk-arrow-btn" href="${prefix}/${fkSlug}/${value}" title="View record #${value}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a></span>`
            : String(value);
        }
        default: { const str = String(value); return str.length > 60 ? `<span title="${str}">${str.slice(0, 60)}…</span>` : str; }
      }
    });

    env.addFilter('adminDetail', (value, field) => {
      if (value === null || value === undefined || value === '') return '<span class="cell-muted">—</span>';
      switch (field.type) {
        case 'boolean':  return value ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-gray">No</span>';
        case 'badge': {
          const colorMap = { admin:'purple', user:'blue', active:'green', inactive:'gray', pending:'yellow', published:'green', draft:'gray', banned:'red' };
          const c = (field.colors && field.colors[String(value)]) || colorMap[String(value)] || 'gray';
          return `<span class="badge badge-${c}">${value}</span>`;
        }
        case 'datetime': try { const d = new Date(value); return `<span title="${d.toISOString()}">${d.toLocaleString()}</span>`; } catch { return String(value); }
        case 'date':     try { return new Date(value).toLocaleDateString(); } catch { return String(value); }
        case 'password': return '<span class="cell-muted" style="letter-spacing:2px">••••••</span>';
        case 'image':    return `<img src="${value}" style="width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid var(--border)" alt="">`;
        case 'url':      return `<a href="${value}" target="_blank" rel="noopener" style="color:var(--primary);word-break:break-all">${value}</a>`;
        case 'email':    return `<a href="mailto:${value}" style="color:var(--primary)">${value}</a>`;
        case 'color':    return `<span style="display:inline-flex;align-items:center;gap:8px"><span style="width:20px;height:20px;border-radius:4px;background:${value};border:1px solid var(--border);flex-shrink:0"></span><span class="cell-mono">${value}</span></span>`;
        case 'json':     try { const pretty = JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2); return `<pre style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:12px;overflow-x:auto;white-space:pre-wrap;margin:0;color:var(--text-soft)">${pretty}</pre>`; } catch { return String(value); }
        case 'richtext': return `<div style="line-height:1.6;color:var(--text-soft)">${value}</div>`;
        case 'phone':    return `<a href="tel:${value}" style="color:var(--primary)">${value}</a>`;
        case 'fk': {
          const fkSlug = resolveFkSlug(field.fkResource);
          const prefix = this._config.prefix || '/admin';
          return fkSlug
            ? `<span class="fk-cell fk-cell-detail">${value}<a class="fk-arrow-btn" href="${prefix}/${fkSlug}/${value}" title="View record #${value}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a></span>`
            : String(value);
        }
        default: return String(value);
      }
    });

    env.addFilter('dump',         (val) => { try { return JSON.stringify(val, null, 2); } catch { return String(val); } });
    env.addFilter('min',          (arr) => Math.min(...arr));
    env.addFilter('tabId',        (name) => String(name).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''));
    env.addFilter('relativeTime', (iso)  => {
      try {
        const diff = Date.now() - new Date(iso).getTime();
        const s = Math.floor(diff / 1000);
        if (s < 60)    return 'just now';
        if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
        if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
        return `${Math.floor(s / 86400)}d ago`;
      } catch { return String(iso); }
    });

    return env;
  }

  _ctx(req, extra = {}) {
    let authUserModel = null;
    try {
      const container = Facade._container;
      if (container) {
        const auth = container.make('auth');
        authUserModel = auth?._UserModel || null;
      }
    } catch {}

    const isAuthResource = (r) => {
      if (r.authCategory === 'auth') return true;
      if (authUserModel && r.model && r.model === authUserModel) return true;
      return false;
    };

    return {
      csrfToken:      AdminAuth.enabled ? AdminAuth.csrfToken(req) : 'disabled',
      adminPrefix:    this._config.prefix,
      adminTitle:     this._config.title,
      adminUser:      req.adminUser || null,
      authEnabled:    AdminAuth.enabled,
      resources:      this.resources()
        .filter(r => r.hasPermission(req.adminUser || null, 'view'))
        .map((r, idx) => ({
          slug:     r.slug,
          label:    r._getLabel(),
          singular: r._getLabelSingular(),
          icon:     r.icon,
          group:    r.group || null,
          canView:  r.hasPermission(req.adminUser || null, 'view'),
          index:    idx + 1,
          category: isAuthResource(r) ? 'auth' : 'app',
        })),
      navGroups: (() => {
        const appResources = this.resources()
          .filter(r => r.hasPermission(req.adminUser || null, 'view') && !isAuthResource(r));
        const groupMap = new Map();
        for (const r of appResources) {
          const key = r.group || null;
          if (!groupMap.has(key)) groupMap.set(key, []);
          groupMap.get(key).push({ slug: r.slug, label: r._getLabel(), icon: r.icon });
        }
        const groups = [];
        for (const [key, items] of groupMap) {
          if (key !== null) groups.push({ label: key, resources: items });
        }
        if (groupMap.has(null)) groups.push({ label: null, resources: groupMap.get(null) });
        return groups;
      })(),
      flash:          extra._flash || {},
      activePage:     extra.activePage || null,
      activeResource: extra.activeResource || null,
      ...extra,
    };
  }

  _ctxWithFlash(req, res, extra = {}) {
    return this._ctx(req, { ...extra, _flash: AdminAuth.getFlash(req, res) });
  }

  async _render(req, res, template, ctx, Resource = null) {
    const start = Date.now();
    let finalCtx = ctx;
    try {
      const hookCtx = await HookPipeline.run(
        'before_render',
        { view: template, templateCtx: ctx, user: req.adminUser || null, resource: Resource },
        Resource, AdminHooks,
      );
      finalCtx = hookCtx.templateCtx || ctx;
    } catch (err) {
      return this._error(req, res, err);
    }
    res.render(template, finalCtx);
    setImmediate(() => {
      HookPipeline.run(
        'after_render',
        { view: template, user: req.adminUser || null, resource: Resource, ms: Date.now() - start },
        Resource, AdminHooks,
      ).catch(err => process.stderr.write(`[AdminHooks] after_render error: ${err.message}\n`));
    });
  }

  _perm(R, action, user)  { return R.hasPermission(user || null, action); }

  _verifyCsrf(req, res) {
    if (!AdminAuth.enabled) return true;
    const token = req.body?._csrf || req.headers['x-csrf-token'];
    if (AdminAuth.verifyCsrf(req, token)) return true;
    res.status(403).send('CSRF token missing or invalid. Please reload the page and try again.');
    return false;
  }

  _resolve(slug, res) {
    const R = this._resources.get(slug);
    if (!R) { res.status(404).send(`Resource "${slug}" not registered in Admin`); return null; }
    return R;
  }

  _error(req, res, err) {
    const status  = err.status || 500;
    const is404   = status === 404;
    const message = err.message || 'An unexpected error occurred.';
    const stack   = process.env.NODE_ENV !== 'production' && !is404 ? (err.stack || '') : '';
    try {
      const ctx = this._ctxWithFlash(req, res, {
        pageTitle: is404 ? 'Not found' : `Error ${status}`,
        errorStatus: status, errorTitle: is404 ? 'Not found' : `Error ${status}`,
        errorMsg: message, errorStack: stack,
      });
      res.status(status);
      return this._render(req, res, 'pages/error.njk', ctx);
    } catch { res.status(status).send(`<pre>${message}</pre>`); }
  }

  _flash(req, type, message) { req._flashType = type; req._flashMessage = message; }

  _redirectWithFlash(res, url, type, message) {
    if (type && message) AdminAuth.setFlash(res, type, message);
    res.redirect(url);
  }

  _autoResource(ModelClass) {
    const R = class extends AdminResource {};
    R.model         = ModelClass;
    R.label         = ModelClass.name + 's';
    R.labelSingular = ModelClass.name;
    return R;
  }
}

const admin = new Admin();
module.exports = admin;
module.exports.Admin         = Admin;
module.exports.AdminResource = AdminResource;
module.exports.AdminField    = AdminField;
module.exports.AdminFilter   = AdminFilter;
module.exports.AdminInline   = AdminInline;