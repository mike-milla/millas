'use strict';

const path        = require('path');
const nunjucks    = require('nunjucks');
const ActivityLog  = require('./ActivityLog');
const { HookPipeline, AdminHooks } = require('./HookRegistry');
const { FormGenerator }              = require('./FormGenerator');
const { ViewContext }                 = require('./ViewContext');
const AdminAuth   = require('./AdminAuth');
const { AdminResource, AdminField, AdminFilter, AdminInline } = require('./resources/AdminResource');
const LookupParser = require('../orm/query/LookupParser');
const Facade       = require('../facades/Facade');

/**
 * Admin
 *
 * The Millas admin panel.
 * Auto-mounts at /admin by default — no configuration needed.
 *
 * Basic usage (AppServiceProvider.boot):
 *   Admin.register(UserResource);
 *   Admin.mount(route, expressApp);
 *
 * Custom resource:
 *   class UserResource extends AdminResource {
 *     static model      = User;
 *     static label      = 'Users';
 *     static fields() { return [AdminField.id(), AdminField.text('name')]; }
 *   }
 */
class Admin {
  constructor() {
    this._resources = new Map();
    this._config    = {
      prefix: '/admin',
      title:  'Millas Admin',
    };
    this._njk = null;
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  configure(config = {}) {
    Object.assign(this._config, config);

    // Initialise auth if configured
    if (config.auth !== undefined) {
      AdminAuth.configure(config.auth);
    }

    return this;
  }

  // ─── Registration ─────────────────────────────────────────────────────────

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

  // ─── Mount ────────────────────────────────────────────────────────────────

  /**
   * Mount all admin routes onto express directly.
   * Call this AFTER app.boot() in bootstrap/app.js:
   *
   *   Admin.mount(expressApp);
   */
  mount(expressApp) {
    const prefix = this._config.prefix;
    this._njk    = this._setupNunjucks(expressApp);

    // ── Static assets ────────────────────────────────────────────────────────
    // Serve ui.js from the admin source directory as a static file.
    // Loaded by base.njk as /admin/static/ui.js
    // Serve all files from src/admin/static/ at /admin/static/*
    const _staticPath = require('path').join(__dirname, 'static');
    expressApp.use(prefix + '/static', require('express').static(_staticPath, {
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.js'))  res.setHeader('Content-Type', 'application/javascript');
        if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
      },
    }));

    // ── Auth middleware (runs before all admin routes) ──────────
    expressApp.use(prefix, AdminAuth.middleware(prefix));

    // ── Login / logout ──────────────────────────────────────────
    expressApp.get (`${prefix}/login`,  (q, s) => this._loginPage(q, s));
    expressApp.post(`${prefix}/login`,  (q, s) => this._loginSubmit(q, s));
    expressApp.get (`${prefix}/logout`, (q, s) => this._logout(q, s));

    // Dashboard
    expressApp.get(`${prefix}`,     (q, s) => this._dashboard(q, s));
    expressApp.get(`${prefix}/`,    (q, s) => this._dashboard(q, s));

    // Global search
    expressApp.get(`${prefix}/search`, (q, s) => this._search(q, s));

    // Resource routes
    expressApp.get   (`${prefix}/:resource`,                   (q, s) => this._list(q, s));
    expressApp.get   (`${prefix}/:resource/export.:format`,    (q, s) => this._export(q, s));
    expressApp.get   (`${prefix}/:resource/create`,            (q, s) => this._create(q, s));
    expressApp.post  (`${prefix}/:resource`,                   (q, s) => this._store(q, s));
    expressApp.get   (`${prefix}/:resource/:id/edit`,          (q, s) => this._edit(q, s));
    expressApp.get   (`${prefix}/:resource/:id`,               (q, s) => this._detail(q, s));
    expressApp.post  (`${prefix}/:resource/:id`,               (q, s) => this._update(q, s));
    expressApp.post  (`${prefix}/:resource/:id/delete`,        (q, s) => this._destroy(q, s));
    expressApp.post  (`${prefix}/:resource/bulk-delete`,       (q, s) => this._bulkDestroy(q, s));
    expressApp.post  (`${prefix}/:resource/bulk-action`,       (q, s) => this._bulkAction(q, s));
    expressApp.post  (`${prefix}/:resource/:id/action/:action`,(q, s) => this._rowAction(q, s));

    // ── Relationship API ─────────────────────────────────────────────────────
    // Used by FK and M2M widgets to fetch options via autocomplete.
    // Returns JSON: [{ id, label }, ...]
    expressApp.get(`${prefix}/api/:resource/options`, (q, s) => this._apiOptions(q, s));

    // ── Inline CRUD routes ───────────────────────────────────────────────────
    // Inline create:  POST /admin/:resource/:id/inline/:inlineIndex
    // Inline delete:  POST /admin/:resource/:id/inline/:inlineIndex/:rowId/delete
    expressApp.post(`${prefix}/:resource/:id/inline/:inlineIndex`,                    (q, s) => this._inlineStore(q, s));
    expressApp.post(`${prefix}/:resource/:id/inline/:inlineIndex/:rowId/delete`,      (q, s) => this._inlineDestroy(q, s));

    return this;
  }

  // ─── Nunjucks setup ───────────────────────────────────────────────────────

  _setupNunjucks(expressApp) {
    const viewsDir = path.join(__dirname, 'views');
    const env = nunjucks.configure(viewsDir, {
      autoescape: true,
      express:    expressApp,
      noCache:    process.env.NODE_ENV !== 'production',
    });

    // ── Custom filters ───────────────────────────────────────────

    // Resolve a fkResource table name to the registered admin slug (or null)
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
          const colorMap = {
            admin:'purple', user:'blue', active:'green', inactive:'gray',
            pending:'yellow', published:'green', draft:'gray', banned:'red',
            true:'green', false:'gray', 1:'green', 0:'gray',
          };
          const c = (field.colors && field.colors[String(value)]) || colorMap[String(value)] || 'gray';
          return `<span class="badge badge-${c}">${value}</span>`;
        }
        case 'datetime':
          try {
            const d = new Date(value);
            return `<span title="${d.toISOString()}" style="font-size:12.5px">${d.toLocaleString()}</span>`;
          } catch { return String(value); }
        case 'date':
          try { return new Date(value).toLocaleDateString(); } catch { return String(value); }
        case 'password':
          return '<span class="cell-muted" style="letter-spacing:2px">••••••</span>';
        case 'image':
          return value
            ? `<img src="${value}" class="cell-image" alt="">`
            : '<span class="cell-muted">—</span>';
        case 'json':
          return `<code class="cell-mono">${JSON.stringify(value).slice(0, 40)}…</code>`;
        case 'email':
          return `<a href="mailto:${value}" style="color:var(--primary);text-decoration:none">${value}</a>`;
        case 'url':
          return `<a href="${value}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;word-break:break-all">${value}</a>`;
        case 'phone':
          return `<a href="tel:${value}" style="color:var(--primary);text-decoration:none">${value}</a>`;
        case 'color':
          return `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:16px;height:16px;border-radius:3px;background:${value};border:1px solid var(--border);flex-shrink:0"></span><span class="cell-mono">${value}</span></span>`;
        case 'richtext':
          return `<div style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-soft)">${String(value).replace(/<[^>]+>/g, '').slice(0, 80)}</div>`;
        case 'fk': {
          const fkSlug = resolveFkSlug(field.fkResource);
          const prefix = this._config.prefix || '/admin';
          if (fkSlug) {
            return `<span class="fk-cell">${value}<a class="fk-arrow-btn" href="${prefix}/${fkSlug}/${value}" title="View record #${value}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a></span>`;
          }
          return String(value);
        }
        default: {
          const str = String(value);
          return str.length > 60
            ? `<span title="${str}">${str.slice(0, 60)}…</span>`
            : str;
        }
      }
    });

    env.addFilter('adminDetail', (value, field) => {
      if (value === null || value === undefined || value === '') {
        return '<span class="cell-muted">—</span>';
      }
      switch (field.type) {
        case 'boolean':
          return value
            ? '<span class="badge badge-green">Yes</span>'
            : '<span class="badge badge-gray">No</span>';
        case 'badge': {
          const colorMap = { admin:'purple', user:'blue', active:'green', inactive:'gray', pending:'yellow', published:'green', draft:'gray', banned:'red' };
          const c = (field.colors && field.colors[String(value)]) || colorMap[String(value)] || 'gray';
          return `<span class="badge badge-${c}">${value}</span>`;
        }
        case 'datetime':
          try {
            const d = new Date(value);
            return `<span title="${d.toISOString()}">${d.toLocaleString()}</span>`;
          } catch { return String(value); }
        case 'date':
          try { return new Date(value).toLocaleDateString(); } catch { return String(value); }
        case 'password':
          return '<span class="cell-muted" style="letter-spacing:2px">••••••</span>';
        case 'image':
          return `<img src="${value}" style="width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid var(--border)" alt="">`;
        case 'url':
          return `<a href="${value}" target="_blank" rel="noopener" style="color:var(--primary);word-break:break-all">${value} <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`;
        case 'email':
          return `<a href="mailto:${value}" style="color:var(--primary)">${value}</a>`;
        case 'color':
          return `<span style="display:inline-flex;align-items:center;gap:8px"><span style="width:20px;height:20px;border-radius:4px;background:${value};border:1px solid var(--border);flex-shrink:0"></span><span class="cell-mono">${value}</span></span>`;
        case 'json':
          try {
            const pretty = JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2);
            return `<pre style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-family:'DM Mono',monospace;font-size:12px;overflow-x:auto;white-space:pre-wrap;margin:0;color:var(--text-soft)">${pretty}</pre>`;
          } catch { return String(value); }
        case 'richtext':
          return `<div style="line-height:1.6;color:var(--text-soft)">${value}</div>`;
        case 'phone':
          return `<a href="tel:${value}" style="color:var(--primary)">${value}</a>`;
        case 'badge': {
          const colorMap2 = { admin:'purple', user:'blue', active:'green', inactive:'gray', pending:'yellow', published:'green', draft:'gray', banned:'red' };
          const c2 = (field.colors && field.colors[String(value)]) || colorMap2[String(value)] || 'gray';
          return `<span class="badge badge-${c2}">${value}</span>`;
        }
        case 'fk': {
          const fkSlug = resolveFkSlug(field.fkResource);
          const prefix = this._config.prefix || '/admin';
          if (fkSlug) {
            return `<span class="fk-cell fk-cell-detail">${value}<a class="fk-arrow-btn" href="${prefix}/${fkSlug}/${value}" title="View record #${value}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a></span>`;
          }
          return String(value);
        }
        default: {
          const str = String(value);
          return str;
        }
      }
    });
    env.addFilter('dump', (val) => {
      try { return JSON.stringify(val, null, 2); } catch { return String(val); }
    });

    env.addFilter('min', (arr) => Math.min(...arr));

    // tabId: convert a tab name to a CSS/jQuery safe id fragment.
    // Strips everything that is not alphanumeric, underscore, or hyphen.
    // 'Role & Access' → 'Role--Access', 'Details' → 'Details'
    env.addFilter('tabId', (name) =>
      String(name).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''));


    env.addFilter('relativeTime', (iso) => {
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

  // ─── Base render context ──────────────────────────────────────────────────

  _ctx(req, extra = {}) {
    // Resolve the auth user model from the container so we can tag its
    // resource as 'auth' in the sidebar — automatic, no dev config needed.
    let authUserModel = null;
    try {
      const container = Facade._container;
      if (container) {
        const auth = container.make('auth');
        authUserModel = auth?._UserModel || null;
      }
    } catch { /* container not booted yet or auth not registered */ }

    // A resource is in the 'auth' category if:
    //   1. Its model is the configured auth_user model, OR
    //   2. The developer explicitly set static authCategory = 'auth'
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
          canView:  r.hasPermission(req.adminUser || null, 'view'),
          index:    idx + 1,
          category: isAuthResource(r) ? 'auth' : 'app',
        })),
      flash:          extra._flash || {},
      activePage:     extra.activePage || null,
      activeResource: extra.activeResource || null,
      ...extra,
    };
  }

  _ctxWithFlash(req, res, extra = {}) {
    return this._ctx(req, { ...extra, _flash: AdminAuth.getFlash(req, res) });
  }

  // ─── Auth pages ───────────────────────────────────────────────────────────

  async _loginPage(req, res) {
    // Already logged in → redirect to dashboard
    if (AdminAuth.enabled && AdminAuth._getSession(req)) {
      return res.redirect((req.query.next && decodeURIComponent(req.query.next)) || this._config.prefix + '/');
    }

    const flash = AdminAuth.getFlash(req, res);
    return this._render(req, res, 'pages/login.njk', {
      adminTitle:  this._config.title,
      adminPrefix: this._config.prefix,
      flash,
      next: req.query.next || '',
      error: null,
    });
  }

  async _loginSubmit(req, res) {
    const { email, password, remember, next } = req.body;
    const prefix = this._config.prefix;

    if (!AdminAuth.enabled) {
      return res.redirect(next || prefix + '/');
    }

    try {
      await AdminAuth.login(req, res, {
        email,
        password,
        remember: remember === 'on' || remember === '1' || remember === 'true',
      });

      res.redirect(next || prefix + '/');
    } catch (err) {
      return this._render(req, res, 'pages/login.njk', {
        adminTitle:  this._config.title,
        adminPrefix: prefix,
        flash:       {},
        next:        next || '',
        error:       err.message,
        email,        // re-fill email field
      });
    }
  }

  _logout(req, res) {
    AdminAuth.logout(res);
    AdminAuth.setFlash(res, 'success', 'You have been logged out.');
    res.redirect(`${this._config.prefix}/login`);
  }

  // ─── Pages ────────────────────────────────────────────────────────────────

  async _dashboard(req, res) {
    try {
      const resourceData = await Promise.all(
        this.resources().map(async (R) => {
          let count = 0;
          let recent = [];
          let recentCount = 0;
          try {
            count  = await R.model.count();
            const result = await R.fetchList({ page: 1, perPage: 5 });
            recent = result.data.map(r => r.toJSON ? r.toJSON() : r);
            // Count records created in last 7 days for trend indicator
            try {
              const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
              recentCount = await R.model.where('created_at__gte', since).count();
            } catch { /* model may not have created_at */ }
          } catch {}
          return {
            slug:        R.slug,
            label:       R._getLabel(),
            singular:    R._getLabelSingular(),
            icon:        R.icon,
            count,
            recentCount,
            recent,
            listFields:  R.fields()
              .filter(f => f._type !== 'tab' && !f._hidden && !f._detailOnly)
              .slice(0, 4)
              .map(f => f.toJSON()),
          };
        })
      );

      const [activityData, activityTotals] = await Promise.all([
        ActivityLog.recent(25),
        ActivityLog.totals(),
      ]);

      return this._render(req, res, 'pages/dashboard.njk', this._ctxWithFlash(req, res, {
        pageTitle:       'Dashboard',
        activePage:      'dashboard',
        resources:       resourceData,
        activity:        activityData,
        activityTotals,
      }));
    } catch (err) {
      this._error(req, res, err);
    }
  }

  async _list(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;

      // Parse query params
      const query = {
        page:   Number(req.query.page)    || 1,
        search: req.query.search          || '',
        sort:   req.query.sort            || 'id',
        order:  req.query.order           || 'desc',
        perPage:Number(req.query.perPage)  || R.perPage,
        year:   req.query.year            || null,
        month:  req.query.month           || null,
      };

      const activeFilters = {};
      if (req.query.filter) {
        for (const [k, v] of Object.entries(req.query.filter)) {
          if (v !== '') activeFilters[k] = v;
        }
      }

      const result = await R.fetchList({ ...query, filters: activeFilters });
      const rows   = result.data.map(r => r.toJSON ? r.toJSON() : r);

      const perms = {
        canCreate: this._perm(R, 'add',    req.adminUser),
        canEdit:   this._perm(R, 'change', req.adminUser),
        canDelete: this._perm(R, 'delete', req.adminUser),
        canView:   this._perm(R, 'view',   req.adminUser),
      };

      return this._render(req, res, 'pages/list.njk',
        ViewContext.list(R, {
          rows, result, query, activeFilters, perms,
          baseCtx: this._ctxWithFlash(req, res, {}),
        }), R);
    } catch (err) {
      this._error(req, res, err);
    }
  }

  async _create(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!this._perm(R, 'add', req.adminUser)) return res.status(403).send('You do not have permission to add ${R._getLabelSingular()} records.');

      return this._render(req, res, 'pages/form.njk',
        ViewContext.create(R, {
          adminPrefix: this._config.prefix,
          baseCtx:     this._ctxWithFlash(req, res, {}),
        }), R);
    } catch (err) {
      this._error(req, res, err);
    }
  }

  async _store(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!this._perm(R, 'add', req.adminUser)) return res.status(403).send('You do not have permission to add ${R._getLabelSingular()} records.');
      if (!this._verifyCsrf(req, res)) return;

      const record = await R.create(req.body, { user: req.adminUser, resource: R });
      ActivityLog.record('create', R.slug, record?.id, `New ${R._getLabelSingular()}`, req.adminUser);

      const submit = req.body._submit || 'save';
      if (submit === 'continue' && record?.id) {
        AdminAuth.setFlash(res, 'success', `${R._getLabelSingular()} created. You may continue editing.`);
        return res.redirect(`${this._config.prefix}/${R.slug}/${record.id}/edit`);
      }
      if (submit === 'add_another') {
        AdminAuth.setFlash(res, 'success', `${R._getLabelSingular()} created. Add another below.`);
        return res.redirect(`${this._config.prefix}/${R.slug}/create`);
      }

      this._flash(req, 'success', `${R._getLabelSingular()} created successfully`);
      this._redirectWithFlash(res, `${this._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
    } catch (err) {
      if (err.status === 422) {
        const R = this._resources.get(req.params.resource);
        return this._render(req, res, 'pages/form.njk',
          ViewContext.create(R, {
            adminPrefix: this._config.prefix,
            record:      req.body,
            errors:      err.errors || {},
            baseCtx:     this._ctxWithFlash(req, res, {}),
          }), R);
      }
      this._error(req, res, err);
    }
  }

  async _edit(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!this._perm(R, 'change', req.adminUser)) return res.status(403).send('You do not have permission to change ${R._getLabelSingular()} records.');

      const record = await R.fetchOne(req.params.id);
      const data   = record.toJSON ? record.toJSON() : record;

      return this._render(req, res, 'pages/form.njk',
        ViewContext.edit(R, {
          adminPrefix: this._config.prefix,
          id:          req.params.id,
          record:      data,
          canDelete:   this._perm(R, 'delete', req.adminUser),
          baseCtx:     this._ctxWithFlash(req, res, {}),
        }), R);
    } catch (err) {
      this._error(req, res, err);
    }
  }

  async _update(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!this._perm(R, 'change', req.adminUser)) return res.status(403).send('You do not have permission to change ${R._getLabelSingular()} records.');
      if (!this._verifyCsrf(req, res)) return;

      // Support method override
      const method = req.body._method || 'POST';
      if (method === 'PUT' || method === 'POST') {
        await R.update(req.params.id, req.body, { user: req.adminUser, resource: R });
        ActivityLog.record('update', R.slug, req.params.id, `${R._getLabelSingular()} #${req.params.id}`, req.adminUser);

        const submit = req.body._submit || 'save';
        if (submit === 'continue') {
          AdminAuth.setFlash(res, 'success', 'Changes saved. You may continue editing.');
          return res.redirect(`${this._config.prefix}/${R.slug}/${req.params.id}/edit`);
        }

        this._flash(req, 'success', `${R._getLabelSingular()} updated successfully`);
        this._redirectWithFlash(res, `${this._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
      }
    } catch (err) {
      if (err.status === 422) {
        const R = this._resources.get(req.params.resource);
        return this._render(req, res, 'pages/form.njk',
          ViewContext.edit(R, {
            adminPrefix: this._config.prefix,
            id:          req.params.id,
            record:      { id: req.params.id, ...req.body },
            canDelete:   this._perm(R, 'delete', req.adminUser),
            errors:      err.errors || {},
            baseCtx:     this._ctxWithFlash(req, res, {}),
          }), R);
      }
      this._error(req, res, err);
    }
  }

  async _destroy(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!this._perm(R, 'delete', req.adminUser)) return res.status(403).send('You do not have permission to delete ${R._getLabelSingular()} records.');
      if (!this._verifyCsrf(req, res)) return;

      await R.destroy(req.params.id, { user: req.adminUser, resource: R });
      ActivityLog.record('delete', R.slug, req.params.id, `${R._getLabelSingular()} #${req.params.id}`, req.adminUser);
      this._flash(req, 'success', `${R._getLabelSingular()} deleted`);
      this._redirectWithFlash(res, `${this._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
    } catch (err) {
      this._error(req, res, err);
    }
  }

  // ─── Detail view (readonly) ───────────────────────────────────────────────

  async _detail(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!this._perm(R, 'view', req.adminUser)) {
        if (this._perm(R, 'change', req.adminUser)) return res.redirect(`${this._config.prefix}/${R.slug}/${req.params.id}/edit`);
        return res.status(403).send('You do not have permission to view ${R._getLabelSingular()} records.');
      }

      const record = await R.fetchOne(req.params.id);
      const data   = record.toJSON ? record.toJSON() : record;

      // Load inline related records
      const inlineData = await Promise.all(
        (R.inlines || []).map(async (inline, idx) => {
          const rows = await inline.fetchRows(data[R.model.primaryKey || 'id']);
          return { ...inline.toJSON(), rows, inlineIndex: idx };
        })
      );

      return this._render(req, res, 'pages/detail.njk',
        ViewContext.detail(R, {
          id:         req.params.id,
          record:     data,
          inlineData,
          perms: {
            canEdit:   this._perm(R, 'change', req.adminUser),
            canDelete: this._perm(R, 'delete', req.adminUser),
            canCreate: this._perm(R, 'add',    req.adminUser),
          },
          baseCtx: this._ctxWithFlash(req, res, {}),
        }), R);
    } catch (err) {
      this._error(req, res, err);
    }
  }

  // ─── Bulk delete ──────────────────────────────────────────────────────────

  async _bulkDestroy(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!this._perm(R, 'delete', req.adminUser)) return res.status(403).send('You do not have permission to delete ${R._getLabelSingular()} records.');
      if (!this._verifyCsrf(req, res)) return;

      const ids = Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids].filter(Boolean);
      if (!ids.length) {
        this._flash(req, 'error', 'No records selected.');
        return this._redirectWithFlash(res, `${this._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
      }

      await R.model.destroy(...ids);
      ActivityLog.record('delete', R.slug, null, `${ids.length} ${R._getLabel()} (bulk)`, req.adminUser);
      this._flash(req, 'success', `Deleted ${ids.length} record${ids.length > 1 ? 's' : ''}.`);
      this._redirectWithFlash(res, `${this._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
    } catch (err) {
      this._error(req, res, err);
    }
  }

  // ─── Bulk custom action ───────────────────────────────────────────────────

  async _bulkAction(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;

      if (!this._verifyCsrf(req, res)) return;
      const actionIndex = Number(req.body.actionIndex);
      const ids = Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids].filter(Boolean);
      const action = (R.actions || [])[actionIndex];

      if (!action) {
        this._flash(req, 'error', 'Unknown action.');
        return this._redirectWithFlash(res, `${this._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
      }

      if (!ids.length) {
        this._flash(req, 'error', 'No records selected.');
        return this._redirectWithFlash(res, `${this._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
      }

      await action.handler(ids, R.model);
      ActivityLog.record('update', R.slug, null, `Bulk action "${action.label}" on ${ids.length} records`, req.adminUser);
      this._flash(req, 'success', `Action "${action.label}" applied to ${ids.length} record${ids.length > 1 ? 's' : ''}.`);
      this._redirectWithFlash(res, `${this._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
    } catch (err) {
      this._error(req, res, err);
    }
  }

  // ─── Per-row custom action ────────────────────────────────────────────────

  async _rowAction(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;

      if (!this._verifyCsrf(req, res)) return;
      const actionName = req.params.action;
      const rowAction  = (R.rowActions || []).find(a => a.action === actionName);

      if (!rowAction || !rowAction.handler) {
        return res.status(404).send(`Row action "${actionName}" not found.`);
      }

      const record = await R.fetchOne(req.params.id);
      const result = await rowAction.handler(record, R.model);

      // If handler returns a redirect URL, use it; otherwise go back to list
      const redirect = (typeof result === 'string' && result.startsWith('/'))
        ? result
        : `${this._config.prefix}/${R.slug}`;

      ActivityLog.record('update', R.slug, req.params.id, `Action "${rowAction.label}" on #${req.params.id}`, req.adminUser);
      this._flash(req, 'success', rowAction.successMessage || `Action "${rowAction.label}" completed.`);
      this._redirectWithFlash(res, redirect, req._flashType, req._flashMessage);
    } catch (err) {
      this._error(req, res, err);
    }
  }

  // ─── Relationship API ────────────────────────────────────────────────────────

  /**
   * GET /admin/api/:resource/options?q=search&limit=20
   *
   * Returns a JSON array of { id, label } objects for use by FK and M2M
   * widgets in autocomplete selects. The label is derived from the first
   * searchable column on the resource, or falls back to the primary key.
   *
   * Called by the frontend widget via fetch() — no page reload needed.
   */
  async _apiOptions(req, res) {
    try {
      // Look up resource by slug first, then fall back to table name.
      // fkResource on a field is the table name (e.g. 'users') which usually
      // matches the resource slug — but if the developer registered with a
      // custom label the slug may differ. Table-name fallback catches that.
      const slug = req.params.resource;
      let R = this._resources.get(slug);
      if (!R) {
        // Fall back: find a resource whose model.table matches the slug
        for (const resource of this._resources.values()) {
          if (resource.model && resource.model.table === slug) { R = resource; break; }
        }
      }
      if (!R) return res.status(404).json({ error: `Resource "${slug}" not found` });
      if (!R.hasPermission(req.adminUser || null, 'view')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const search  = (req.query.q    || '').trim();
      const page    = Math.max(1, Number(req.query.page)  || 1);
      const perPage = Math.min(Number(req.query.limit) || 20, 100);
      const offset  = (page - 1) * perPage;

      const pk = R.model.primaryKey || 'id';

      // Label column resolution — priority order:
      //   1. resource.fkLabel explicitly set (developer override)
      //   2. resource.searchable[0] — first searchable column
      //   3. Auto-detect from model fields: name > email > title > label > first string field
      //   4. pk as last resort (gives id as label which is unhelpful but safe)
      let labelCol = R.fkLabel || (R.searchable && R.searchable[0]) || null;
      if (!labelCol && R.model) {
        const fields = typeof R.model.getFields === 'function'
          ? R.model.getFields()
          : (R.model.fields || {});
        const preferred = ['name', 'email', 'title', 'label', 'full_name',
                           'fullname', 'username', 'display_name', 'first_name'];
        for (const p of preferred) {
          if (fields[p]) { labelCol = p; break; }
        }
        if (!labelCol) {
          // First string field that isn't a password/token
          const skip = new Set(['password', 'token', 'secret', 'hash', 'remember_token']);
          for (const [col, def] of Object.entries(fields)) {
            if (def.type === 'string' && !skip.has(col) && col !== pk) {
              labelCol = col; break;
            }
          }
        }
      }
      labelCol = labelCol || pk;

      // Resolve fkWhere — look up the field on the SOURCE resource (the one
      // that owns the FK field), not the target resource being queried.
      // e.g. TenantOwnershipResource.tenant_id has .where({ role: 'tenant' })
      //      but we're currently querying UserResource — wrong place to look.
      const fieldName  = (req.query.field || '').trim();
      const fromSlug   = (req.query.from  || '').trim();
      let fkWhere = null;
      if (fieldName && fromSlug) {
        const sourceResource = this._resources.get(fromSlug)
          || [...this._resources.values()].find(r => r.model?.table === fromSlug);
        if (sourceResource) {
          const fieldDef = (sourceResource.fields() || []).find(f => f._name === fieldName);
          if (fieldDef && fieldDef._fkWhere) fkWhere = fieldDef._fkWhere;
        }
      }

      // Helper: apply fkWhere constraints to a knex query builder.
      // Plain object keys are run through LookupParser so __ syntax works:
      //   { role: 'tenant' }            → WHERE role = 'tenant'
      //   { age__gte: 18 }              → WHERE age >= 18
      //   { role__in: ['a','b'] }       → WHERE role IN ('a','b')
      //   { name__icontains: 'alice' }  → WHERE name ILIKE '%alice%'
      const applyScope = (q) => {
        if (!fkWhere) return q;
        if (typeof fkWhere === 'function') return fkWhere(q) || q;
        // Plain object — run each key through LookupParser for __ support
        for (const [key, value] of Object.entries(fkWhere)) {
          LookupParser.apply(q, key, value, R.model);
        }
        return q;
      };

      // Call _db() separately for each query — knex builders are mutable,
      // reusing the same instance across count + select corrupts both queries.
      let countQ = applyScope(R.model._db().count(`${pk} as total`));
      if (search) countQ = countQ.where(labelCol, 'like', `%${search}%`);
      const [{ total }] = await countQ;

      let rowQ = applyScope(R.model._db()
        .select([`${pk} as id`, `${labelCol} as label`])
        .orderBy(labelCol, 'asc')
        .limit(perPage)
        .offset(offset));
      if (search) rowQ = rowQ.where(labelCol, 'like', `%${search}%`);
      const rows = await rowQ;

      return res.json({
        data:     rows,
        total:    Number(total),
        page,
        perPage,
        hasMore:  offset + rows.length < Number(total),
        labelCol,   // lets the frontend show "Search by <field>…" in the placeholder
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── Inline CRUD ──────────────────────────────────────────────────────────────

  /**
   * POST /admin/:resource/:id/inline/:inlineIndex
   *
   * Create a new inline related record.
   * The inlineIndex identifies which AdminInline in R.inlines[] to use.
   */
  async _inlineStore(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!this._verifyCsrf(req, res)) return;

      const idx    = Number(req.params.inlineIndex);
      const inline = (R.inlines || [])[idx];
      if (!inline) return res.status(404).send('Inline not found.');
      if (!inline.canCreate) return res.status(403).send('Inline create is disabled.');

      // Inject the FK value from the parent record ID
      const data = {
        ...req.body,
        [inline.foreignKey]: req.params.id,
      };
      // Strip system fields
      delete data._csrf;
      delete data._method;
      delete data._submit;

      await inline.model.create(data);
      ActivityLog.record('create', inline.label, null, `Inline ${inline.label} for #${req.params.id}`, req.adminUser);

      AdminAuth.setFlash(res, 'success', `${inline.label} added.`);
      res.redirect(`${this._config.prefix}/${R.slug}/${req.params.id}`);
    } catch (err) {
      this._error(req, res, err);
    }
  }

  /**
   * POST /admin/:resource/:id/inline/:inlineIndex/:rowId/delete
   *
   * Delete an inline related record.
   */
  async _inlineDestroy(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!this._verifyCsrf(req, res)) return;

      const idx    = Number(req.params.inlineIndex);
      const inline = (R.inlines || [])[idx];
      if (!inline) return res.status(404).send('Inline not found.');
      if (!inline.canDelete) return res.status(403).send('Inline delete is disabled.');

      await inline.model.destroy(req.params.rowId);
      ActivityLog.record('delete', inline.label, req.params.rowId, `Inline ${inline.label} #${req.params.rowId}`, req.adminUser);

      AdminAuth.setFlash(res, 'success', 'Record deleted.');
      res.redirect(`${this._config.prefix}/${R.slug}/${req.params.id}`);
    } catch (err) {
      this._error(req, res, err);
    }
  }

  async _search(req, res) {
    try {
      const q = (req.query.q || '').trim();

      if (!q) {
        return this._render(req, res, 'pages/search.njk',
          ViewContext.search({
            query: '', results: [], total: 0,
            baseCtx: this._ctxWithFlash(req, res, { activePage: 'search' }),
          }));
      }

      const results = await Promise.all(
        this.resources().map(async (R) => {
          if (!R.searchable || !R.searchable.length) return null;
          try {
            const result = await R.fetchList({ page: 1, perPage: 8, search: q });
            if (!result.data.length) return null;
            return {
              slug:     R.slug,
              label:    R._getLabel(),
              singular: R._getLabelSingular(),
              icon:     R.icon,
              total:    result.total,
              rows:     result.data.map(r => r.toJSON ? r.toJSON() : r),
              listFields: R.fields()
                .filter(f => f._type !== 'tab' && !f._hidden && !f._detailOnly)
                .slice(0, 4)
                .map(f => f.toJSON()),
            };
          } catch { return null; }
        })
      );

      const filtered = results.filter(Boolean);
      const total    = filtered.reduce((s, r) => s + r.total, 0);

      return this._render(req, res, 'pages/search.njk',
        ViewContext.search({
          query: q, results: filtered, total,
          baseCtx: this._ctxWithFlash(req, res, { activePage: 'search' }),
        }));
    } catch (err) {
      this._error(req, res, err);
    }
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  async _export(req, res) {
    try {
      const R      = this._resolve(req.params.resource, res);
      if (!R) return;

      const format = req.params.format; // 'csv' or 'json'
      const search = req.query.search || '';
      const sort   = req.query.sort   || 'id';
      const order  = req.query.order  || 'desc';

      const activeFilters = {};
      if (req.query.filter) {
        for (const [k, v] of Object.entries(req.query.filter)) {
          if (v !== '') activeFilters[k] = v;
        }
      }

      // Fetch all records (no pagination)
      const result = await R.fetchList({
        page: 1, perPage: 100000, search, sort, order, filters: activeFilters,
      });
      const rows = result.data.map(r => r.toJSON ? r.toJSON() : r);

      const fields = R.fields()
        .filter(f => f._type !== 'tab' && !f._hidden)
        .map(f => f.toJSON());

      const filename = `${R.slug}-${new Date().toISOString().slice(0, 10)}`;

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
        return res.json(rows);
      }

      // CSV
      const header = fields.map(f => `"${f.label}"`).join(',');
      const csvRows = rows.map(row =>
        fields.map(f => {
          const v = row[f.name];
          if (v === null || v === undefined) return '';
          const s = String(typeof v === 'object' ? JSON.stringify(v) : v);
          return `"${s.replace(/"/g, '""')}"`;
        }).join(',')
      );

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send([header, ...csvRows].join('\r\n'));
    } catch (err) {
      this._error(req, res, err);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Build form fields with tab metadata injected.
   * readonly fields (from readonlyFields[] or field.readonly()) are
   * passed through with a _isReadonly flag so the template can render
   * them as text instead of inputs.
   */
  _formFields(R) {
    const readonlySet  = new Set(R.readonlyFields || []);
    const prepopFields = R.prepopulatedFields || {};
    let   currentTab   = null;
    let   currentFieldset = null;
    const result       = [];

    for (const f of R.fields()) {
      if (f._type === 'tab') {
        currentTab      = f._label;
        currentFieldset = null;
        continue;
      }
      if (f._type === 'fieldset') {
        // Include fieldset headers as sentinel objects
        result.push({ _isFieldset: true, label: f._label, tab: currentTab });
        currentFieldset = f._label;
        continue;
      }
      if (f._type === 'id' || f._listOnly || f._hidden) continue;

      const json        = f.toJSON();
      json.tab          = currentTab;
      json.fieldset     = currentFieldset;
      json.required     = !f._nullable;
      json.prepopulate  = prepopFields[f._name] || f._prepopulate || null;

      if (readonlySet.has(f._name) || f._readonly) {
        json.isReadonly = true;
      }

      result.push(json);
    }
    return result;
  }

  /**
   * Build tab structure for tabbed form/detail rendering.
   * Returns [{ label, fields }] — one entry per tab.
   * If no tabs defined, returns a single unnamed tab with all fields.
   */
  _buildTabs(fields) {
    const tabs = [];
    let current = null;

    for (const f of fields) {
      if (f._type === 'tab') {
        current = { label: f._label, fields: [] };
        tabs.push(current);
        continue;
      }
      if (f._type === 'fieldset') {
        // Fieldsets are embedded as sentinel entries within a tab's fields
        if (!current) { current = { label: null, fields: [] }; tabs.push(current); }
        current.fields.push({ _isFieldset: true, label: f._label });
        continue;
      }
      if (f._hidden || f._listOnly) continue;
      if (!current) { current = { label: null, fields: [] }; tabs.push(current); }
      current.fields.push(f.toJSON());
    }

    return tabs;
  }

  /**
   * Resolve a permission for a resource + user combination.
   * Single chokepoint — every action gate calls this.
   *
   * @param {class}  R      — AdminResource subclass
   * @param {string} action — 'view'|'add'|'change'|'delete'
   * @param {object} user   — req.adminUser (may be null if auth disabled)
   */
  _perm(R, action, user) {
    return R.hasPermission(user || null, action);
  }

  /**
   * Verify the CSRF token on a mutating request.
   * Checks both req.body._csrf and the X-CSRF-Token header.
   * Returns true if auth is disabled (non-browser clients).
   */
  /**
   * Render a template with before_render / after_render hooks.
   *
   * Replaces direct res.render() calls in every page handler so hooks
   * can inject extra template data or react after a page is sent.
   *
   * @param {object} req
   * @param {object} res
   * @param {string} template  — e.g. 'pages/list.njk'
   * @param {object} ctx       — template data
   * @param {class}  Resource  — AdminConfig subclass (may be null for auth pages)
   */
  async _render(req, res, template, ctx, Resource = null) {
    const start = Date.now();

    // ── before_render ──────────────────────────────────────────────────
    let finalCtx = ctx;
    try {
      const hookCtx = await HookPipeline.run(
        'before_render',
        { view: template, templateCtx: ctx, user: req.adminUser || null, resource: Resource },
        Resource,
        AdminHooks,
      );
      finalCtx = hookCtx.templateCtx || ctx;
    } catch (err) {
      // before_render errors abort the render — surface as a 500
      return this._error(req, res, err);
    }

    // ── Render ──────────────────────────────────────────────────────────
    res.render(template, finalCtx);

    // ── after_render (fire-and-forget) ───────────────────────────────────
    setImmediate(() => {
      HookPipeline.run(
        'after_render',
        { view: template, user: req.adminUser || null, resource: Resource, ms: Date.now() - start },
        Resource,
        AdminHooks,
      ).catch(err => {
        process.stderr.write(`[AdminHooks] after_render error: ${err.message}
`);
      });
    });
  }

  _verifyCsrf(req, res) {
    if (!AdminAuth.enabled) return true;
    const token = req.body?._csrf || req.headers['x-csrf-token'];
    if (AdminAuth.verifyCsrf(req, token)) return true;
    res.status(403).send('CSRF token missing or invalid. Please reload the page and try again.');
    return false;
  }

  _resolve(slug, res) {
    const R = this._resources.get(slug);
    if (!R) {
      res.status(404).send(`Resource "${slug}" not registered in Admin`);
      return null;
    }
    return R;
  }

  _error(req, res, err) {
    const status  = err.status || 500;
    const is404   = status === 404;
    const title   = is404 ? 'Not found' : `Error ${status}`;
    const message = err.message || 'An unexpected error occurred.';
    const stack   = process.env.NODE_ENV !== 'production' && !is404 ? (err.stack || '') : '';

    try {
      const ctx = this._ctxWithFlash(req, res, {
        pageTitle:   title,
        errorStatus: status,
        errorTitle:  title,
        errorMsg:    message,
        errorStack:  stack,
      });
      res.status(status);
      return this._render(req, res, 'pages/error.njk', ctx);
    } catch (_renderErr) {
      // Fallback if template itself fails
      res.status(status).send(`<pre>${message}</pre>`);
    }
  }

  // ─── Flash (cookie-based) ─────────────────────────────────────────────────

  _flash(req, type, message) {
    req._flashType    = type;
    req._flashMessage = message;
  }

  _pullFlash(req) {
    if (req._flashType) return { [req._flashType]: req._flashMessage };
    return {};
  }

  _redirectWithFlash(res, url, type, message) {
    if (type && message) AdminAuth.setFlash(res, type, message);
    res.redirect(url);
  }

  _autoResource(ModelClass) {
    const R = class extends AdminResource {};
    R.model = ModelClass;
    R.label = ModelClass.name + 's';
    R.labelSingular = ModelClass.name;
    return R;
  }
}

// Singleton
const admin = new Admin();
module.exports = admin;
module.exports.Admin         = Admin;
module.exports.AdminResource = AdminResource;
module.exports.AdminField    = AdminField;
module.exports.AdminFilter   = AdminFilter;
module.exports.AdminInline   = AdminInline;