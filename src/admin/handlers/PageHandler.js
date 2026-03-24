'use strict';

const ActivityLog        = require('../ActivityLog');
const AdminAuth          = require('../AdminAuth');
const { ViewContext }    = require('../ViewContext');

/**
 * PageHandler
 *
 * Handles all resource page routes:
 *   GET    /admin/                       → dashboard
 *   GET    /admin/:resource              → list
 *   GET    /admin/:resource/create       → create form
 *   POST   /admin/:resource              → store
 *   GET    /admin/:resource/:id/edit     → edit form
 *   POST   /admin/:resource/:id          → update
 *   POST   /admin/:resource/:id/delete   → destroy
 *   GET    /admin/:resource/:id          → detail (readonly)
 *   GET    /admin/search                 → global search
 */
class PageHandler {
  constructor(admin) {
    this._admin = admin;
  }

  async dashboard(req, res) {
    const admin = this._admin;
    try {
      const resourceData = await Promise.all(
        admin.resources().map(async (R) => {
          let count = 0;
          let recent = [];
          let recentCount = 0;
          try {
            count  = await R.model.count();
            const result = await R.fetchList({ page: 1, perPage: 5 });
            recent = result.data.map(r => r.toJSON ? r.toJSON() : r);
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

      return admin._render(req, res, 'pages/dashboard.njk', admin._ctxWithFlash(req, res, {
        pageTitle:       'Dashboard',
        activePage:      'dashboard',
        resources:       resourceData,
        activity:        activityData,
        activityTotals,
      }));
    } catch (err) {
      admin._error(req, res, err);
    }
  }

  async list(req, res) {
    const admin = this._admin;
    try {
      const R = admin._resolve(req.params.resource, res);
      if (!R) return;

      const query = {
        page:    Number(req.query.page)    || 1,
        search:  req.query.search          || '',
        sort:    req.query.sort            || 'id',
        order:   req.query.order           || 'desc',
        perPage: Number(req.query.perPage) || R.perPage,
        year:    req.query.year            || null,
        month:   req.query.month           || null,
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
        canCreate: admin._perm(R, 'add',    req.adminUser),
        canEdit:   admin._perm(R, 'change', req.adminUser),
        canDelete: admin._perm(R, 'delete', req.adminUser),
        canView:   admin._perm(R, 'view',   req.adminUser),
      };

      return admin._render(req, res, 'pages/list.njk',
        ViewContext.list(R, {
          rows, result, query, activeFilters, perms,
          baseCtx: admin._ctxWithFlash(req, res, {}),
        }), R);
    } catch (err) {
      admin._error(req, res, err);
    }
  }

  async create(req, res) {
    const admin = this._admin;
    try {
      const R = admin._resolve(req.params.resource, res);
      if (!R) return;
      if (!admin._perm(R, 'add', req.adminUser)) {
        return res.status(403).send(`You do not have permission to add ${R._getLabelSingular()} records.`);
      }

      return admin._render(req, res, 'pages/form.njk',
        ViewContext.create(R, {
          adminPrefix: admin._config.prefix,
          baseCtx:     admin._ctxWithFlash(req, res, {}),
        }), R);
    } catch (err) {
      admin._error(req, res, err);
    }
  }

  async store(req, res) {
    const admin = this._admin;
    try {
      const R = admin._resolve(req.params.resource, res);
      if (!R) return;
      if (!admin._perm(R, 'add', req.adminUser)) {
        return res.status(403).send(`You do not have permission to add ${R._getLabelSingular()} records.`);
      }
      if (!admin._verifyCsrf(req, res)) return;

      const record = await R.create(req.body, { user: req.adminUser, resource: R });
      ActivityLog.record('create', R.slug, record?.id, `New ${R._getLabelSingular()}`, req.adminUser);

      const submit = req.body._submit || 'save';
      if (submit === 'continue' && record?.id) {
        AdminAuth.setFlash(res, 'success', `${R._getLabelSingular()} created. You may continue editing.`);
        return res.redirect(`${admin._config.prefix}/${R.slug}/${record.id}/edit`);
      }
      if (submit === 'add_another') {
        AdminAuth.setFlash(res, 'success', `${R._getLabelSingular()} created. Add another below.`);
        return res.redirect(`${admin._config.prefix}/${R.slug}/create`);
      }

      admin._flash(req, 'success', `${R._getLabelSingular()} created successfully`);
      admin._redirectWithFlash(res, `${admin._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
    } catch (err) {
      if (err.status === 422) {
        const R = admin._resources.get(req.params.resource);
        return admin._render(req, res, 'pages/form.njk',
          ViewContext.create(R, {
            adminPrefix: admin._config.prefix,
            record:      req.body,
            errors:      err.errors || {},
            baseCtx:     admin._ctxWithFlash(req, res, {}),
          }), R);
      }
      admin._error(req, res, err);
    }
  }

  async edit(req, res) {
    const admin = this._admin;
    try {
      const R = admin._resolve(req.params.resource, res);
      if (!R) return;
      if (!admin._perm(R, 'change', req.adminUser)) {
        return res.status(403).send(`You do not have permission to change ${R._getLabelSingular()} records.`);
      }

      const record = await R.fetchOne(req.params.id);
      const data   = record.toJSON ? record.toJSON() : record;

      return admin._render(req, res, 'pages/form.njk',
        ViewContext.edit(R, {
          adminPrefix: admin._config.prefix,
          id:          req.params.id,
          record:      data,
          canDelete:   admin._perm(R, 'delete', req.adminUser),
          baseCtx:     admin._ctxWithFlash(req, res, {}),
        }), R);
    } catch (err) {
      admin._error(req, res, err);
    }
  }

  async update(req, res) {
    const admin = this._admin;
    try {
      const R = admin._resolve(req.params.resource, res);
      if (!R) return;
      if (!admin._perm(R, 'change', req.adminUser)) {
        return res.status(403).send(`You do not have permission to change ${R._getLabelSingular()} records.`);
      }
      if (!admin._verifyCsrf(req, res)) return;

      const method = req.body._method || 'POST';
      if (method === 'PUT' || method === 'POST') {
        await R.update(req.params.id, req.body, { user: req.adminUser, resource: R });
        ActivityLog.record('update', R.slug, req.params.id, `${R._getLabelSingular()} #${req.params.id}`, req.adminUser);

        const submit = req.body._submit || 'save';
        if (submit === 'continue') {
          AdminAuth.setFlash(res, 'success', 'Changes saved. You may continue editing.');
          return res.redirect(`${admin._config.prefix}/${R.slug}/${req.params.id}/edit`);
        }

        admin._flash(req, 'success', `${R._getLabelSingular()} updated successfully`);
        admin._redirectWithFlash(res, `${admin._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
      }
    } catch (err) {
      if (err.status === 422) {
        const R = admin._resources.get(req.params.resource);
        return admin._render(req, res, 'pages/form.njk',
          ViewContext.edit(R, {
            adminPrefix: admin._config.prefix,
            id:          req.params.id,
            record:      { id: req.params.id, ...req.body },
            canDelete:   admin._perm(R, 'delete', req.adminUser),
            errors:      err.errors || {},
            baseCtx:     admin._ctxWithFlash(req, res, {}),
          }), R);
      }
      admin._error(req, res, err);
    }
  }

  async destroy(req, res) {
    const admin = this._admin;
    try {
      const R = admin._resolve(req.params.resource, res);
      if (!R) return;
      if (!admin._perm(R, 'delete', req.adminUser)) {
        return res.status(403).send(`You do not have permission to delete ${R._getLabelSingular()} records.`);
      }
      if (!admin._verifyCsrf(req, res)) return;

      await R.destroy(req.params.id, { user: req.adminUser, resource: R });
      ActivityLog.record('delete', R.slug, req.params.id, `${R._getLabelSingular()} #${req.params.id}`, req.adminUser);
      admin._flash(req, 'success', `${R._getLabelSingular()} deleted`);
      admin._redirectWithFlash(res, `${admin._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
    } catch (err) {
      admin._error(req, res, err);
    }
  }

  async detail(req, res) {
    const admin = this._admin;
    try {
      const R = admin._resolve(req.params.resource, res);
      if (!R) return;
      if (!admin._perm(R, 'view', req.adminUser)) {
        if (admin._perm(R, 'change', req.adminUser)) {
          return res.redirect(`${admin._config.prefix}/${R.slug}/${req.params.id}/edit`);
        }
        return res.status(403).send(`You do not have permission to view ${R._getLabelSingular()} records.`);
      }

      const record = await R.fetchOne(req.params.id);
      const data   = record.toJSON ? record.toJSON() : record;

      const inlineData = await Promise.all(
        (R.inlines || []).map(async (inline, idx) => {
          const rows = await inline.fetchRows(data[R.model.primaryKey || 'id']);
          return { ...inline.toJSON(), rows, inlineIndex: idx };
        })
      );

      return admin._render(req, res, 'pages/detail.njk',
        ViewContext.detail(R, {
          id:         req.params.id,
          record:     data,
          inlineData,
          perms: {
            canEdit:   admin._perm(R, 'change', req.adminUser),
            canDelete: admin._perm(R, 'delete', req.adminUser),
            canCreate: admin._perm(R, 'add',    req.adminUser),
          },
          baseCtx: admin._ctxWithFlash(req, res, {}),
        }), R);
    } catch (err) {
      admin._error(req, res, err);
    }
  }

  async search(req, res) {
    const admin = this._admin;
    try {
      const q = (req.query.q || '').trim();

      if (!q) {
        return admin._render(req, res, 'pages/search.njk',
          ViewContext.search({
            query: '', results: [], total: 0,
            baseCtx: admin._ctxWithFlash(req, res, { activePage: 'search' }),
          }));
      }

      const results = await Promise.all(
        admin.resources().map(async (R) => {
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

      return admin._render(req, res, 'pages/search.njk',
        ViewContext.search({
          query: q, results: filtered, total,
          baseCtx: admin._ctxWithFlash(req, res, { activePage: 'search' }),
        }));
    } catch (err) {
      admin._error(req, res, err);
    }
  }
}

module.exports = PageHandler;
