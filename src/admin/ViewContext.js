'use strict';

const { FormGenerator } = require('./FormGenerator');

/**
 * ViewContext
 *
 * Assembles the template data (context object) for each admin view.
 * Separates "what data does this page need?" from "how do we handle the request?".
 *
 * ── Design principle ──────────────────────────────────────────────────────────
 *
 *   Route handlers in Admin.js are responsible for:
 *     - Auth + permission checks
 *     - Calling the ORM (via AdminResource or QueryEngine)
 *     - Firing hooks
 *     - Redirecting on success
 *
 *   ViewContext is responsible for:
 *     - Assembling the template data object
 *     - Deriving display metadata from AdminResource config
 *     - No DB calls, no business logic, no HTML
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   // In Admin.js handler — replaces inline object literals
 *   const ctx = ViewContext.list(R, { rows, result, query, user, adminPrefix, flash });
 *   return this._render(req, res, 'pages/list.njk', ctx, R);
 *
 * ── What it replaces ──────────────────────────────────────────────────────────
 *
 *   Before — Admin.js _list() contained ~40 lines of inline object assembly:
 *     res.render('pages/list.njk', {
 *       pageTitle: R._getLabel(),
 *       resource: { slug, label, canCreate, canEdit, ... },
 *       rows, listFields, filters, activeFilters, sortable,
 *       total, page, perPage, lastPage, search, sort, order, ...
 *     });
 *
 *   After — 1 line in handler + all assembly logic testable in isolation:
 *     return this._render(req, res, 'pages/list.njk',
 *       ViewContext.list(R, { rows, result, query, perms, flash }), R);
 */
class ViewContext {

  // ─── Base context (shared by all views) ───────────────────────────────────

  /**
   * Base context included in every admin view.
   * Mirrors what Admin._ctx() currently produces.
   *
   * @param {object} opts
   * @param {object}  opts.admin       — Admin singleton (for config + resources)
   * @param {object}  opts.user        — req.adminUser
   * @param {string}  opts.csrfToken
   * @param {object}  [opts.flash={}]
   * @param {string}  [opts.activePage=null]
   * @param {string}  [opts.activeResource=null]
   */
  static base({ admin, user, csrfToken, flash = {}, activePage = null, activeResource = null }) {
    return {
      csrfToken,
      adminPrefix:    admin._config.prefix,
      adminTitle:     admin._config.title,
      adminUser:      user || null,
      authEnabled:    admin._auth?.enabled ?? false,
      resources:      admin.resources()
        .filter(R => R.hasPermission(user || null, 'view'))
        .map((R, idx) => ({
          slug:     R.slug,
          label:    R._getLabel(),
          singular: R._getLabelSingular(),
          icon:     R.icon,
          canView:  R.hasPermission(user || null, 'view'),
          index:    idx + 1,
        })),
      flash,
      activePage,
      activeResource,
    };
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  /**
   * @param {object} opts
   * @param {Array}   opts.resourceData  — per-resource { slug, label, count, recent, ... }
   * @param {Array}   opts.activity      — ActivityLog.recent() result
   * @param {object}  opts.activityTotals
   * @param {object}  opts.baseCtx       — from ViewContext.base()
   */
  static dashboard({ resourceData, activity, activityTotals, baseCtx }) {
    return {
      ...baseCtx,
      pageTitle:      'Dashboard',
      activePage:     'dashboard',
      resources:      resourceData,   // overrides baseCtx.resources with enriched data
      activity,
      activityTotals,
    };
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  /**
   * @param {class}  Resource
   * @param {object} opts
   * @param {Array}   opts.rows          — hydrated + serialised row data
   * @param {object}  opts.result        — fetchList result { total, page, perPage, lastPage }
   * @param {object}  opts.query         — { search, sort, order, page, perPage, year, month }
   * @param {object}  opts.activeFilters — { col__lookup: value }
   * @param {object}  opts.perms         — { canCreate, canEdit, canDelete, canView }
   * @param {object}  opts.baseCtx
   */
  static list(Resource, { rows, result, query, activeFilters, perms, baseCtx }) {
    const listFields = Resource.fields()
      .filter(f => !f._hidden && !f._detailOnly)
      .map(f => f.toJSON());

    return {
      ...baseCtx,
      pageTitle:      Resource._getLabel(),
      activeResource: Resource.slug,
      resource: {
        slug:               Resource.slug,
        label:              Resource._getLabel(),
        singular:           Resource._getLabelSingular(),
        icon:               Resource.icon,
        canCreate:          perms.canCreate,
        canEdit:            perms.canEdit,
        canDelete:          perms.canDelete,
        canView:            perms.canView,
        actions:            (Resource.actions || []).map((a, i) => ({ ...a, index: i, handler: undefined })),
        rowActions:         Resource.rowActions || [],
        listDisplayLinks:   Resource.listDisplayLinks || [],
        dateHierarchy:      Resource.dateHierarchy || null,
        prepopulatedFields: Resource.prepopulatedFields || {},
      },
      rows: rows.map(row => ({
        ...row,
        _rowActions: (Resource.rowActions || []).map(ra => ({
          ...ra,
          href: typeof ra.href === 'function' ? ra.href(row) : ra.href,
        })),
      })),
      listFields,
      filters:      Resource.filters().map(f => f.toJSON()),
      activeFilters,
      sortable:     Resource.sortable || [],
      total:        result.total,
      page:         result.page,
      perPage:      result.perPage,
      lastPage:     result.lastPage,
      search:       query.search,
      sort:         query.sort,
      order:        query.order,
      year:         query.year  || null,
      month:        query.month || null,
    };
  }

  // ─── Create form ───────────────────────────────────────────────────────────

  /**
   * @param {class}  Resource
   * @param {object} opts
   * @param {string}  opts.adminPrefix
   * @param {object}  [opts.record={}]   — pre-filled data (on validation error re-render)
   * @param {object}  [opts.errors={}]
   * @param {object}  opts.baseCtx
   */
  static create(Resource, { adminPrefix, record = {}, errors = {}, baseCtx }) {

    return {
      ...baseCtx,
      pageTitle:      `New ${Resource._getLabelSingular()}`,
      activeResource: Resource.slug,
      resource: {
        slug:     Resource.slug,
        label:    Resource._getLabel(),
        singular: Resource._getLabelSingular(),
        icon:     Resource.icon,
        canDelete: false,
      },
      formFields:  FormGenerator.fromResource(Resource, { isEdit: false }).fields,
      formAction:  `${adminPrefix}/${Resource.slug}`,
      isEdit:      false,
      record,
      errors,
    };
  }

  // ─── Edit form ─────────────────────────────────────────────────────────────

  /**
   * @param {class}  Resource
   * @param {object} opts
   * @param {string}  opts.adminPrefix
   * @param {*}       opts.id            — record primary key
   * @param {object}  opts.record        — existing record data
   * @param {boolean} opts.canDelete
   * @param {object}  [opts.errors={}]
   * @param {object}  opts.baseCtx
   */
  static edit(Resource, { adminPrefix, id, record, canDelete, errors = {}, baseCtx }) {
    return {
      ...baseCtx,
      pageTitle:      `Edit ${Resource._getLabelSingular()} #${id}`,
      activeResource: Resource.slug,
      resource: {
        slug:     Resource.slug,
        label:    Resource._getLabel(),
        singular: Resource._getLabelSingular(),
        icon:     Resource.icon,
        canDelete,
      },
      formFields:  FormGenerator.fromResource(Resource, { isEdit: true }).fields,
      formAction:  `${adminPrefix}/${Resource.slug}/${id}`,
      isEdit:      true,
      record,
      errors,
    };
  }

  // ─── Detail view ───────────────────────────────────────────────────────────

  /**
   * @param {class}  Resource
   * @param {object} opts
   * @param {*}       opts.id
   * @param {object}  opts.record
   * @param {Array}   opts.inlineData
   * @param {object}  opts.perms         — { canEdit, canDelete, canCreate }
   * @param {object}  opts.baseCtx
   */
  static detail(Resource, { id, record, inlineData, perms, baseCtx }) {
    const detailFields = Resource.fields()
      .filter(f => f._type !== '__tab__' && f._type !== 'fieldset' && !f._hidden && !f._listOnly)
      .map(f => f.toJSON());

    const tabs = ViewContext._buildTabs(Resource.fields());

    return {
      ...baseCtx,
      pageTitle:      `${Resource._getLabelSingular()} #${id}`,
      activeResource: Resource.slug,
      resource: {
        slug:       Resource.slug,
        label:      Resource._getLabel(),
        singular:   Resource._getLabelSingular(),
        icon:       Resource.icon,
        canEdit:    perms.canEdit,
        canDelete:  perms.canDelete,
        canCreate:  perms.canCreate,
        rowActions: (Resource.rowActions || []).map(ra => ({
          ...ra,
          href: typeof ra.href === 'function' ? ra.href(record) : ra.href,
        })),
      },
      record,
      detailFields,
      tabs,
      hasTabs:  tabs.length > 1,
      inlines:  inlineData,
    };
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  /**
   * @param {object} opts
   * @param {string}  opts.query
   * @param {Array}   opts.results
   * @param {number}  opts.total
   * @param {object}  opts.baseCtx
   */
  static search({ query, results, total, baseCtx }) {
    return {
      ...baseCtx,
      pageTitle:  query ? `Search: ${query}` : 'Search',
      activePage: 'search',
      query,
      results,
      total,
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Build tab structure for tabbed detail/form rendering.
   * Extracted from Admin._buildTabs() — same logic, centralised here.
   */
  static _buildTabs(fields) {
    const tabs = [];
    let current = null;

    for (const f of fields) {
      if (f._type === 'tab') {
        current = { label: f._label, fields: [] };
        tabs.push(current);
        continue;
      }
      if (f._type === 'fieldset') {
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
}

module.exports = { ViewContext };