'use strict';

/**
 * AdminResource
 *
 * Defines how a Model is represented in the admin panel.
 * Subclass this and override properties/methods to customise.
 *
 * Usage:
 *   class UserResource extends AdminResource {
 *     static model      = User;
 *     static label      = 'Users';
 *     static icon       = '👤';
 *     static perPage    = 25;
 *     static searchable = ['name', 'email'];
 *     static sortable   = ['id', 'name', 'email', 'created_at'];
 *
 *     static fields() {
 *       return [
 *         AdminField.id('id'),
 *         AdminField.text('name').label('Full Name').sortable(),
 *         AdminField.email('email').sortable(),
 *         AdminField.badge('role').colors({ admin: 'red', user: 'blue' }),
 *         AdminField.boolean('active'),
 *         AdminField.datetime('created_at').label('Registered'),
 *       ];
 *     }
 *
 *     static filters() {
 *       return [
 *         AdminFilter.select('role', ['admin', 'user']),
 *         AdminFilter.boolean('active'),
 *         AdminFilter.dateRange('created_at'),
 *       ];
 *     }
 *   }
 *
 *   Admin.register(UserResource);
 */
class AdminResource {
  /** @type {typeof import('../orm/model/Model')} The Millas Model class */
  static model = null;

  /** Display name (plural) */
  static label = null;

  /** Singular label */
  static labelSingular = null;

  /** SVG icon id (without ic- prefix) */
  static icon = 'table';

  /** Records per page default */
  static perPage = 20;

  /** Columns to search (SQL LIKE) */
  static searchable = [];

  /** Columns users can click to sort */
  static sortable = ['id', 'created_at'];

  /** Whether to show a Create button */
  static canCreate = true;

  /** Whether to show Edit buttons */
  static canEdit = true;

  /** Whether to show Delete buttons */
  static canDelete = true;

  /** Whether to show a detail/view page */
  static canView = true;

  /**
   * Fields shown as read-only (text) on the edit form.
   * @type {string[]}
   */
  static readonlyFields = [];

  /**
   * Columns in the list view that link to the detail page.
   * Defaults to the first column if empty.
   * @type {string[]}
   */
  static listDisplayLinks = [];

  /**
   * Date field for year/month drill-down filter above the list.
   * e.g. static dateHierarchy = 'created_at'
   * @type {string|null}
   */
  static dateHierarchy = null;

  /**
   * Auto-fill mappings: { targetField: sourceField }
   * When the user types in sourceField, targetField is auto-filled (slugified).
   * e.g. static prepopulatedFields = { slug: 'title' }
   * @type {object}
   */
  static prepopulatedFields = {};

  /**
   * Custom bulk actions shown in the bulk action bar when rows are selected.
   * Each entry: { label, icon, handler: async (ids, model) => void }
   *
   * @example
   *   static actions = [
   *     {
   *       label:   'Publish selected',
   *       icon:    'check',
   *       handler: async (ids, model) => {
   *         await model.bulkUpdate(ids.map(id => ({ id, published: true })));
   *       },
   *     },
   *   ];
   */
  static actions = [];

  /**
   * Custom per-row actions shown in the action dropdown menu.
   * Each entry: { label, icon, href: (row) => string }
   *           OR { label, icon, action: string }  (POST to /admin/:resource/:id/:action)
   *
   * @example
   *   static rowActions = [
   *     { label: 'Preview', icon: 'eye', href: (row) => `/posts/${row.slug}` },
   *     { label: 'Publish', icon: 'check', action: 'publish' },
   *   ];
   */
  static rowActions = [];

  /**
   * Inline related resource classes shown on the detail/edit page.
   * @type {typeof AdminInline[]}
   */
  static inlines = [];

  /** URL-safe slug used in routes */
  static get slug() {
    return (this.label || this.model?.name || 'resource')
      .toLowerCase().replace(/\s+/g, '-');
  }

  /**
   * Define the fields for list, detail, and form views.
   * Use AdminField.tab() and AdminField.fieldset() for layout.
   */
  static fields() {
    if (!this.model?.fields) return [];
    return Object.entries(this.model.fields).map(([name, def]) =>
      AdminField.fromModelField(name, def)
    );
  }

  /** Define filter controls. */
  static filters() {
    return [];
  }

  /**
   * Override to customise how records are fetched.
   * Receives { page, perPage, search, sort, order, filters }
   */
  static async fetchList({ page = 1, perPage, search, sort = 'id', order = 'desc', filters = {}, year, month } = {}) {
    const limit  = perPage || this.perPage;
    const offset = (page - 1) * limit;

    // _db() is available on all ORM versions — it returns a raw knex table query.
    // We build everything via knex directly so this works regardless of whether
    // the ORM changes (changes3) have been applied.
    let q = this.model._db().orderBy(sort, order);

    // ── Search ───────────────────────────────────────────────────────────────
    if (search && this.searchable.length) {
      const cols = this.searchable;
      q = q.where(function () {
        for (const col of cols) {
          this.orWhere(col, 'like', `%${search}%`);
        }
      });
    }

    // ── Filters ──────────────────────────────────────────────────────────────
    // Translate __ lookup syntax into knex calls so filter controls work
    // even without the ORM changes applied.
    for (const [key, value] of Object.entries(filters)) {
      if (value === '' || value === null || value === undefined) continue;

      const dunder = key.lastIndexOf('__');
      if (dunder === -1) {
        q = q.where(key, value);
        continue;
      }

      const col    = key.slice(0, dunder);
      const lookup = key.slice(dunder + 2);

      switch (lookup) {
        case 'exact':   q = q.where(col, value);           break;
        case 'not':     q = q.where(col, '!=', value);     break;
        case 'gt':      q = q.where(col, '>',  value);     break;
        case 'gte':     q = q.where(col, '>=', value);     break;
        case 'lt':      q = q.where(col, '<',  value);     break;
        case 'lte':     q = q.where(col, '<=', value);     break;
        case 'isnull':  q = value ? q.whereNull(col) : q.whereNotNull(col); break;
        case 'in':      q = q.whereIn(col, Array.isArray(value) ? value : [value]); break;
        case 'notin':   q = q.whereNotIn(col, Array.isArray(value) ? value : [value]); break;
        case 'between': q = q.whereBetween(col, value);    break;
        case 'contains':
        case 'icontains': q = q.where(col, 'like', `%${value}%`); break;
        case 'startswith':
        case 'istartswith': q = q.where(col, 'like', `${value}%`); break;
        case 'endswith':
        case 'iendswith': q = q.where(col, 'like', `%${value}`); break;
        default:        q = q.where(key, value);           break;
      }
    }

    // ── Date hierarchy ────────────────────────────────────────────────────────
    if (this.dateHierarchy) {
      const col = this.dateHierarchy;
      if (year) {
        // SQLite / MySQL / PG compatible
        q = q.whereRaw(`strftime('%Y', "${col}") = ?`, [String(year)])
          .catch
          // If strftime not available (PG), fall through — best effort
          || q;
      }
      if (month) {
        q = q.whereRaw(`strftime('%m', "${col}") = ?`, [String(month).padStart(2, '0')]);
      }
    }

    // ── Execute ───────────────────────────────────────────────────────────────
    const [rows, countResult] = await Promise.all([
      q.clone().limit(limit).offset(offset),
      q.clone().count('* as count').first(),
    ]);

    const total = Number(countResult?.count ?? 0);

    return {
      data:     rows.map(r => this.model._hydrate(r)),
      total,
      page:     Number(page),
      perPage:  limit,
      lastPage: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Fetch a single record by id.
   */
  static async fetchOne(id) {
    return this.model.findOrFail(id);
  }

  /**
   * Create a new record from form data.
   */
  static async create(data) {
    return this.model.create(this._sanitise(data));
  }

  /**
   * Update a record from form data.
   */
  static async update(id, data) {
    const record = await this.model.findOrFail(id);
    return record.update(this._sanitise(data));
  }

  /**
   * Delete a record.
   */
  static async destroy(id) {
    return this.model.destroy(id);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  static _sanitise(data) {
    // Remove private/system fields
    const clean = { ...data };
    delete clean.id;
    delete clean._method;
    delete clean._token;
    return clean;
  }

  static _getLabel() {
    return this.label || (this.model?.name ? this.model.name + 's' : 'Records');
  }

  static _getLabelSingular() {
    return this.labelSingular || this.model?.name || 'Record';
  }
}

// ── AdminField ────────────────────────────────────────────────────────────────

class AdminField {
  constructor(name, type) {
    this._name        = name;
    this._type        = type;
    this._label       = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    this._sortable    = false;
    this._hidden      = false;
    this._listOnly    = false;
    this._detailOnly  = false;
    this._readonly    = false;
    this._colors      = {};
    this._format      = null;
    this._nullable    = true;   // defaults to optional; use .required() to enforce
    this._tab         = null;   // tab name this field belongs to
    this._span        = null;   // 'full' | 'third' | null (default half-width)
    this._min         = null;
    this._max         = null;
  }

  // ─── Field types ───────────────────────────────────────────────────────────

  static id(name = 'id')            { return new AdminField(name, 'id'); }
  static text(name)                 { return new AdminField(name, 'text'); }
  static email(name)                { return new AdminField(name, 'email'); }
  static number(name)               { return new AdminField(name, 'number'); }
  static boolean(name)              { return new AdminField(name, 'boolean'); }
  static badge(name)                { return new AdminField(name, 'badge'); }
  static datetime(name)             { return new AdminField(name, 'datetime'); }
  static date(name)                 { return new AdminField(name, 'date'); }
  static image(name)                { return new AdminField(name, 'image'); }
  static textarea(name)             { return new AdminField(name, 'textarea'); }
  static password(name)             { return new AdminField(name, 'password'); }
  static json(name)                 { return new AdminField(name, 'json'); }
  static url(name)                  { return new AdminField(name, 'url'); }
  static phone(name)                { return new AdminField(name, 'phone'); }
  static color(name)                { return new AdminField(name, 'color'); }
  static richtext(name)             { return new AdminField(name, 'richtext'); }

  static select(name, options) {
    const f = new AdminField(name, 'select');
    f._options = Array.isArray(options)
      ? options.map(o => typeof o === 'string' ? { value: o, label: o } : o)
      : [];
    return f;
  }

  /**
   * Tab separator — splits the form into named tabs.
   */
  static tab(label) {
    const f = new AdminField('__tab__', 'tab');
    f._label = label;
    return f;
  }

  /**
   * Fieldset separator — visually groups fields within a tab/form section.
   * Unlike tabs, fieldsets don't switch panels — they just add a heading.
   *
   *   static fields() {
   *     return [
   *       AdminField.fieldset('Personal Info'),
   *       AdminField.text('name').required(),
   *       AdminField.email('email').required(),
   *       AdminField.fieldset('Account Settings'),
   *       AdminField.select('role', ['admin','user']),
   *       AdminField.boolean('active'),
   *     ];
   *   }
   */
  static fieldset(label) {
    const f = new AdminField('__fieldset__', 'fieldset');
    f._label = label;
    return f;
  }

  // ─── Fluent modifiers ──────────────────────────────────────────────────────

  label(l)           { this._label = l;           return this; }
  sortable()         { this._sortable = true;      return this; }
  hidden()           { this._hidden = true;        return this; }
  listOnly()         { this._listOnly = true;      return this; }
  detailOnly()       { this._detailOnly = true;    return this; }
  readonly()         { this._readonly = true;      return this; }
  nullable()         { this._nullable = true;      return this; }
  required()         { this._nullable = false;     return this; }
  full()             { this._span = 'full';        return this; }
  third()            { this._span = 'third';       return this; }
  colors(map)        { this._colors = map;         return this; }
  format(fn)         { this._format = fn;          return this; }
  placeholder(p)     { this._placeholder = p;      return this; }
  help(h)            { this._help = h;             return this; }
  min(n)             { this._min = n;              return this; }
  max(n)             { this._max = n;              return this; }
  inTab(name)        { this._tab = name;           return this; }
  /** Make this column link to the detail page in the list view. */
  link()             { this._isLink = true;        return this; }
  /** Auto-fill this field by slugifying another field as the user types.
   *  e.g. AdminField.text('slug').prepopulate('title')
   */
  prepopulate(src)   { this._prepopulate = src;    return this; }

  // ─── Serialise ─────────────────────────────────────────────────────────────

  toJSON() {
    return {
      name:        this._name,
      type:        this._type,
      label:       this._label,
      sortable:    this._sortable,
      hidden:      this._hidden,
      listOnly:    this._listOnly,
      detailOnly:  this._detailOnly,
      readonly:    this._readonly,
      nullable:    this._nullable,
      colors:      this._colors,
      options:     this._options,
      placeholder: this._placeholder,
      help:        this._help,
      tab:         this._tab,
      span:        this._span,
      min:         this._min,
      max:         this._max,
      isLink:      this._isLink      || false,
      prepopulate: this._prepopulate || null,
    };
  }

  /** Format a raw value for display in the detail/list views. */
  display(value) {
    if (this._format) return this._format(value);
    if (value === null || value === undefined) return '—';
    if (this._type === 'boolean') return value ? 'Yes' : 'No';
    if (this._type === 'datetime' && value) return new Date(value).toLocaleString();
    if (this._type === 'date' && value) return new Date(value).toLocaleDateString();
    if (this._type === 'password') return '••••••••';
    if (this._type === 'json') return JSON.stringify(value, null, 2);
    return String(value);
  }

  static fromModelField(name, fieldDef) {
    const typeMap = {
      id:         () => AdminField.id(name),
      string:     () => AdminField.text(name),
      text:       () => AdminField.textarea(name),
      integer:    () => AdminField.number(name),
      bigInteger: () => AdminField.number(name),
      float:      () => AdminField.number(name),
      decimal:    () => AdminField.number(name),
      boolean:    () => AdminField.boolean(name),
      timestamp:  () => AdminField.datetime(name),
      date:       () => AdminField.date(name),
      enum:       () => AdminField.select(name, fieldDef.enumValues || []),
      json:       () => AdminField.json(name),
    };
    const fn = typeMap[fieldDef.type] || (() => AdminField.text(name));
    const field = fn();
    if (fieldDef.nullable) field.nullable();
    return field;
  }
}

// ── AdminFilter ───────────────────────────────────────────────────────────────

class AdminFilter {
  constructor(name, type) {
    this._name  = name;
    this._type  = type;
    this._label = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  static text(name)              { return new AdminFilter(name, 'text'); }
  static select(name, options)   { const f = new AdminFilter(name, 'select'); f._options = options; return f; }
  static boolean(name)           { return new AdminFilter(name, 'boolean'); }
  static dateRange(name)         { return new AdminFilter(name, 'dateRange'); }
  static number(name)            { return new AdminFilter(name, 'number'); }

  label(l) { this._label = l; return this; }

  toJSON() {
    return {
      name:    this._name,
      type:    this._type,
      label:   this._label,
      options: this._options,
    };
  }
}

// ── AdminInline ───────────────────────────────────────────────────────────────

/**
 * AdminInline
 *
 * Displays related records inline on the detail/edit page of a parent resource.
 * Similar to Django's TabularInline / StackedInline.
 *
 * Usage in a parent resource:
 *
 *   class PostResource extends AdminResource {
 *     static inlines = [
 *       new AdminInline({
 *         model:      Comment,
 *         label:      'Comments',
 *         foreignKey: 'post_id',
 *         fields:     ['id', 'author', 'body', 'created_at'],
 *         canCreate:  true,
 *         canDelete:  true,
 *         perPage:    10,
 *       }),
 *     ];
 *   }
 */
class AdminInline {
  /**
   * @param {object} options
   * @param {class}    options.model       — Millas Model class
   * @param {string}   options.label       — display label (plural)
   * @param {string}   options.foreignKey  — FK column on the related table
   * @param {string[]} [options.fields]    — which columns to show (default: all)
   * @param {boolean}  [options.canCreate] — show add row button (default: false)
   * @param {boolean}  [options.canDelete] — show delete button (default: false)
   * @param {number}   [options.perPage]   — max rows shown (default: 10)
   */
  constructor({ model, label, foreignKey, fields = [], canCreate = false, canDelete = false, perPage = 10 }) {
    this.model      = model;
    this.label      = label || (model?.name ? model.name + 's' : 'Related');
    this.foreignKey = foreignKey;
    this.fields     = fields;
    this.canCreate  = canCreate;
    this.canDelete  = canDelete;
    this.perPage    = perPage;
  }

  /** Fetch related rows for a given parent id. */
  async fetchRows(parentId) {
    if (!this.model || !this.foreignKey) return [];
    try {
      const rows = await this.model._db()
        .where(this.foreignKey, parentId)
        .limit(this.perPage)
        .orderBy('id', 'desc');
      return rows.map(r => this.model._hydrate ? this.model._hydrate(r) : r);
    } catch { return []; }
  }

  /** Serialise to plain object for template rendering. */
  toJSON() {
    const modelFields = this.model?.fields || {};
    const displayFields = this.fields.length
      ? this.fields
      : Object.keys(modelFields).slice(0, 6);

    return {
      label:      this.label,
      foreignKey: this.foreignKey,
      canCreate:  this.canCreate,
      canDelete:  this.canDelete,
      fields:     displayFields.map(name => ({
        name,
        label: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        type:  modelFields[name]?.type || 'text',
      })),
    };
  }
}

module.exports = { AdminResource, AdminField, AdminFilter, AdminInline };
