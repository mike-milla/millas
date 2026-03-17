'use strict';

const path        = require('path');
const nunjucks    = require('nunjucks');
const ActivityLog = require('./ActivityLog');
const AdminAuth   = require('./AdminAuth');
const { AdminResource, AdminField, AdminFilter, AdminInline } = require('./resources/AdminResource');

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
    return {
      adminPrefix:    this._config.prefix,
      adminTitle:     this._config.title,
      adminUser:      req.adminUser || null,
      authEnabled:    AdminAuth.enabled,
      resources:      this.resources().map((r, idx) => ({
        slug:     r.slug,
        label:    r._getLabel(),
        singular: r._getLabelSingular(),
        icon:     r.icon,
        canView:  r.canView,
        index:    idx + 1,
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
    if (AdminAuth.enabled) {
      const cookies = req.headers.cookie || '';
      if (cookies.includes(this._config.auth?.cookieName || 'millas_admin')) {
        // Let AdminAuth verify properly
      }
    }

    const flash = AdminAuth.getFlash(req, res);
    res.render('pages/login.njk', {
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
      res.render('pages/login.njk', {
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

      const activityData   = ActivityLog.recent(25);
      const activityTotals = ActivityLog.totals();

      res.render('pages/dashboard.njk', this._ctxWithFlash(req, res, {
        pageTitle:       'Dashboard',
        activePage:      'dashboard',
        resources:       resourceData,
        activity:        activityData,
        activityTotals,
      }));
    } catch (err) {
      this._error(res, err);
    }
  }

  async _list(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;

      const page    = Number(req.query.page)   || 1;
      const search  = req.query.search         || '';
      const sort    = req.query.sort           || 'id';
      const order   = req.query.order          || 'desc';
      const perPage = Number(req.query.perPage) || R.perPage;
      const year    = req.query.year  || null;
      const month   = req.query.month || null;

      // Collect active filters
      const activeFilters = {};
      if (req.query.filter) {
        for (const [k, v] of Object.entries(req.query.filter)) {
          if (v !== '') activeFilters[k] = v;
        }
      }

      const result = await R.fetchList({ page, search, sort, order, perPage, filters: activeFilters, year, month });
      const rows   = result.data.map(r => r.toJSON ? r.toJSON() : r);

      const listFields = R.fields()
        .filter(f => !f._hidden && !f._detailOnly)
        .map(f => f.toJSON());

      res.render('pages/list.njk', this._ctxWithFlash(req, res, {
        pageTitle:     R._getLabel(),
        activeResource: req.params.resource,
        resource: {
          slug:             R.slug,
          label:            R._getLabel(),
          singular:         R._getLabelSingular(),
          icon:             R.icon,
          canCreate:        R.canCreate,
          canEdit:          R.canEdit,
          canDelete:        R.canDelete,
          canView:          R.canView,
          actions:          (R.actions || []).map((a, i) => ({ ...a, index: i, handler: undefined })),
          rowActions:       R.rowActions || [],
          listDisplayLinks: R.listDisplayLinks || [],
          dateHierarchy:    R.dateHierarchy || null,
          prepopulatedFields: R.prepopulatedFields || {},
        },
        rows,
        listFields,
        filters:      R.filters().map(f => f.toJSON()),
        activeFilters,
        sortable:     R.sortable || [],
        total:        result.total,
        page:         result.page,
        perPage:      result.perPage,
        lastPage:     result.lastPage,
        search,
        sort,
        order,
        year,
        month,
      }));
    } catch (err) {
      this._error(res, err);
    }
  }

  async _create(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!R.canCreate) return res.status(403).send('Not allowed');

      res.render('pages/form.njk', this._ctxWithFlash(req, res, {
        pageTitle:     `New ${R._getLabelSingular()}`,
        activeResource: req.params.resource,
        resource: { slug: R.slug, label: R._getLabel(), singular: R._getLabelSingular(), icon: R.icon, canDelete: false },
        formFields:  this._formFields(R),
        formAction:  `${this._config.prefix}/${R.slug}`,
        isEdit:      false,
        record:      {},
        errors:      {},
      }));
    } catch (err) {
      this._error(res, err);
    }
  }

  async _store(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!R.canCreate) return res.status(403).send('Not allowed');

      const record = await R.create(req.body);
      ActivityLog.record('create', R.slug, record?.id, `New ${R._getLabelSingular()}`);

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
        return res.render('pages/form.njk', this._ctxWithFlash(req, res, {
          pageTitle:  `New ${R._getLabelSingular()}`,
          activeResource: req.params.resource,
          resource: { slug: R.slug, label: R._getLabel(), singular: R._getLabelSingular(), icon: R.icon, canDelete: false },
          formFields: this._formFields(R),
          formAction: `${this._config.prefix}/${R.slug}`,
          isEdit:     false,
          record:     req.body,
          errors:     err.errors || {},
        }));
      }
      this._error(res, err);
    }
  }

  async _edit(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!R.canEdit) return res.status(403).send('Not allowed');

      const record = await R.fetchOne(req.params.id);
      const data   = record.toJSON ? record.toJSON() : record;

      res.render('pages/form.njk', this._ctxWithFlash(req, res, {
        pageTitle:     `Edit ${R._getLabelSingular()} #${req.params.id}`,
        activeResource: req.params.resource,
        resource: { slug: R.slug, label: R._getLabel(), singular: R._getLabelSingular(), icon: R.icon, canDelete: R.canDelete },
        formFields:  this._formFields(R),
        formAction:  `${this._config.prefix}/${R.slug}/${req.params.id}`,
        isEdit:      true,
        record:      data,
        errors:      {},
      }));
    } catch (err) {
      this._error(res, err);
    }
  }

  async _update(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!R.canEdit) return res.status(403).send('Not allowed');

      // Support method override
      const method = req.body._method || 'POST';
      if (method === 'PUT' || method === 'POST') {
        await R.update(req.params.id, req.body);
        ActivityLog.record('update', R.slug, req.params.id, `${R._getLabelSingular()} #${req.params.id}`);

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
        return res.render('pages/form.njk', this._ctxWithFlash(req, res, {
          pageTitle:  `Edit ${R._getLabelSingular()} #${req.params.id}`,
          activeResource: req.params.resource,
          resource: { slug: R.slug, label: R._getLabel(), singular: R._getLabelSingular(), icon: R.icon, canDelete: R.canDelete },
          formFields: this._formFields(R),
          formAction: `${this._config.prefix}/${R.slug}/${req.params.id}`,
          isEdit:     true,
          record:     { id: req.params.id, ...req.body },
          errors:     err.errors || {},
        }));
      }
      this._error(res, err);
    }
  }

  async _destroy(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!R.canDelete) return res.status(403).send('Not allowed');

      await R.destroy(req.params.id);
      ActivityLog.record('delete', R.slug, req.params.id, `${R._getLabelSingular()} #${req.params.id}`);
      this._flash(req, 'success', `${R._getLabelSingular()} deleted`);
      this._redirectWithFlash(res, `${this._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
    } catch (err) {
      this._error(res, err);
    }
  }

  // ─── Detail view (readonly) ───────────────────────────────────────────────

  async _detail(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!R.canView) {
        if (R.canEdit) return res.redirect(`${this._config.prefix}/${R.slug}/${req.params.id}/edit`);
        return res.status(403).send('Not allowed');
      }

      const record = await R.fetchOne(req.params.id);
      const data   = record.toJSON ? record.toJSON() : record;

      const detailFields = R.fields()
        .filter(f => f._type !== '__tab__' && f._type !== 'fieldset' && !f._hidden && !f._listOnly)
        .map(f => f.toJSON());

      const tabs = this._buildTabs(R.fields());

      // Load inline related records
      const inlineData = await Promise.all(
        (R.inlines || []).map(async (inline) => {
          const rows = await inline.fetchRows(data[R.model.primaryKey || 'id']);
          return { ...inline.toJSON(), rows };
        })
      );

      res.render('pages/detail.njk', this._ctxWithFlash(req, res, {
        pageTitle:      `${R._getLabelSingular()} #${req.params.id}`,
        activeResource: req.params.resource,
        resource: {
          slug:       R.slug,
          label:      R._getLabel(),
          singular:   R._getLabelSingular(),
          icon:       R.icon,
          canEdit:    R.canEdit,
          canDelete:  R.canDelete,
          canCreate:  R.canCreate,
          rowActions: R.rowActions || [],
        },
        record:      data,
        detailFields,
        tabs,
        hasTabs:     tabs.length > 1,
        inlines:     inlineData,
      }));
    } catch (err) {
      this._error(res, err);
    }
  }

  // ─── Bulk delete ──────────────────────────────────────────────────────────

  async _bulkDestroy(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;
      if (!R.canDelete) return res.status(403).send('Not allowed');

      const ids = Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids].filter(Boolean);
      if (!ids.length) {
        this._flash(req, 'error', 'No records selected.');
        return this._redirectWithFlash(res, `${this._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
      }

      await R.model.destroy(...ids);
      ActivityLog.record('delete', R.slug, null, `${ids.length} ${R._getLabel()} (bulk)`);
      this._flash(req, 'success', `Deleted ${ids.length} record${ids.length > 1 ? 's' : ''}.`);
      this._redirectWithFlash(res, `${this._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
    } catch (err) {
      this._error(res, err);
    }
  }

  // ─── Bulk custom action ───────────────────────────────────────────────────

  async _bulkAction(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;

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
      ActivityLog.record('update', R.slug, null, `Bulk action "${action.label}" on ${ids.length} records`);
      this._flash(req, 'success', `Action "${action.label}" applied to ${ids.length} record${ids.length > 1 ? 's' : ''}.`);
      this._redirectWithFlash(res, `${this._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
    } catch (err) {
      this._error(res, err);
    }
  }

  // ─── Per-row custom action ────────────────────────────────────────────────

  async _rowAction(req, res) {
    try {
      const R = this._resolve(req.params.resource, res);
      if (!R) return;

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

      ActivityLog.record('update', R.slug, req.params.id, `Action "${rowAction.label}" on #${req.params.id}`);
      this._flash(req, 'success', rowAction.successMessage || `Action "${rowAction.label}" completed.`);
      this._redirectWithFlash(res, redirect, req._flashType, req._flashMessage);
    } catch (err) {
      this._error(res, err);
    }
  }

  async _search(req, res) {
    try {
      const q = (req.query.q || '').trim();

      if (!q) {
        return res.render('pages/search.njk', this._ctxWithFlash(req, res, {
          pageTitle: 'Search',
          activePage: 'search',
          query: '',
          results: [],
          total: 0,
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

      res.render('pages/search.njk', this._ctxWithFlash(req, res, {
        pageTitle:  `Search: ${q}`,
        activePage: 'search',
        query:      q,
        results:    filtered,
        total,
      }));
    } catch (err) {
      this._error(res, err);
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
      this._error(res, err);
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

  _resolve(slug, res) {
    const R = this._resources.get(slug);
    if (!R) {
      res.status(404).send(`Resource "${slug}" not registered in Admin`);
      return null;
    }
    return R;
  }

  _error(res, err) {
    const status = err.status || 500;
    res.status(status).send(`
      <html><body style="font-family:'DM Sans',system-ui,sans-serif;padding:48px;background:#f4f5f7;color:#111827">
        <div style="max-width:640px;margin:0 auto">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
            <div style="width:36px;height:36px;background:#fef2f2;border-radius:8px;display:flex;align-items:center;justify-content:center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <h2 style="font-size:17px;font-weight:600;color:#dc2626">Admin Error ${status}</h2>
          </div>
          <pre style="background:#fff;border:1px solid #e3e6ec;padding:20px;border-radius:8px;color:#374151;font-size:12.5px;overflow-x:auto;line-height:1.6">${err.stack || err.message}</pre>
          <a href="javascript:history.back()" style="display:inline-flex;align-items:center;gap:6px;margin-top:16px;color:#2563eb;font-size:13px;text-decoration:none">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            Go back
          </a>
        </div>
      </body></html>
    `);
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
