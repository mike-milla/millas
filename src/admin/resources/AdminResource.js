'use strict';

const { normaliseField } = require('../../orm/migration/ProjectState');
const { HookPipeline, AdminHooks } = require('../HookRegistry');
const { FormGenerator }              = require('../FormGenerator');
const { QueryEngine }                = require('../QueryEngine');

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

  /** Bootstrap Icons name (e.g. 'house', 'people', 'credit-card') */
  static icon = 'table';

  /**
   * Sidebar group label. Resources with the same group are rendered under
   * the same collapsible section in the admin sidebar.
   *
   *   static group = 'Property & Units';
   *   static group = 'Payments';
   *   static group = 'KYC';
   *
   * Resources with no group are placed under a default 'Resources' section.
   */
  static group = null;

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
    // Use getFields() to get the merged field map (honours abstract inheritance).
    // Falls back to .fields for models that don't yet have getFields().
    const fieldMap = typeof this.model?.getFields === 'function'
      ? this.model.getFields()
      : (this.model?.fields || {});
    if (!Object.keys(fieldMap).length) return [];
    return Object.entries(fieldMap).map(([name, def]) =>
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
  /**
   * Fetch a paginated, filtered, sorted list of records.
   *
   * Delegates to QueryEngine which handles:
   *   - Django __ lookup syntax filtering
   *   - Full-text search across searchable columns
   *   - Date hierarchy drill-down
   *   - Column pruning (list_display only)
   *   - Parallel data + count queries
   *
   * Override this method in a subclass to customise the query entirely:
   *
   *   static async fetchList(opts) {
   *     const base = await super.fetchList(opts);
   *     // post-process base.data ...
   *     return base;
   *   }
   */
  static async fetchList(opts = {}) {
    const engine = new QueryEngine(this);
    return engine.fetchList(opts);
  }

  /**
   * Fetch a single record by id.
   */
  static async fetchOne(id) {
    return this.model.findOrFail(id);
  }

  /**
   * Create a new record from form data.
   * Fires before_save (with isNew=true) and after_save hooks.
   *
   * before_save can:
   *   - Mutate and return data (e.g. hash a password, set created_by)
   *   - Throw to abort the create with an error shown to the admin user
   *
   * @param {object} rawData  — raw req.body
   * @param {object} [ctx]    — { user, resource } injected by Admin.js handler
   */
  static async create(rawData, ctx = {}) {
    let data = this._sanitise(rawData);

    // ── before_save ──────────────────────────────────────────────────────
    const beforeCtx = await HookPipeline.run(
      'before_save',
      { data, user: ctx.user || null, isNew: true, resource: this },
      this,
      AdminHooks,
    );
    data = beforeCtx.data;

    // ── Validate ────────────────────────────────────────────────────────────
    const createErrors = FormGenerator.validate(this, data, { isNew: true });
    if (createErrors) {
      const err = new Error('Validation failed');
      err.status = 422;
      err.errors = createErrors;
      throw err;
    }

    // ── ORM write ────────────────────────────────────────────────────────
    const record = await this.model.create(data);

    // ── after_save ───────────────────────────────────────────────────────
    await HookPipeline.run(
      'after_save',
      { record, user: ctx.user || null, isNew: true, resource: this },
      this,
      AdminHooks,
    );

    return record;
  }

  /**
   * Update a record from form data.
   * Fires before_save (with isNew=false) and after_save hooks.
   *
   * @param {*}      id      — primary key
   * @param {object} rawData — raw req.body
   * @param {object} [ctx]   — { user, resource } injected by Admin.js handler
   */
  static async update(id, rawData, ctx = {}) {
    let data = this._sanitise(rawData);

    // ── before_save ──────────────────────────────────────────────────────
    const beforeCtx = await HookPipeline.run(
      'before_save',
      { data, user: ctx.user || null, isNew: false, resource: this },
      this,
      AdminHooks,
    );
    data = beforeCtx.data;

    // ── Validate ────────────────────────────────────────────────────────────
    const updateErrors = FormGenerator.validate(this, data, { isNew: false });
    if (updateErrors) {
      const err = new Error('Validation failed');
      err.status = 422;
      err.errors = updateErrors;
      throw err;
    }

    // ── ORM write ────────────────────────────────────────────────────────
    const record = await this.model.findOrFail(id);
    await record.update(data);

    // ── after_save ───────────────────────────────────────────────────────
    await HookPipeline.run(
      'after_save',
      { record, user: ctx.user || null, isNew: false, resource: this },
      this,
      AdminHooks,
    );

    return record;
  }

  /**
   * Delete a record.
   * Fires before_delete (can abort by throwing) and after_delete hooks.
   *
   * @param {*}      id    — primary key
   * @param {object} [ctx] — { user, resource } injected by Admin.js handler
   */
  static async destroy(id, ctx = {}) {
    // Load the record first so before_delete hooks can inspect it
    const record = await this.model.findOrFail(id);

    // ── before_delete ────────────────────────────────────────────────────
    await HookPipeline.run(
      'before_delete',
      { record, user: ctx.user || null, resource: this },
      this,
      AdminHooks,
    );

    // ── ORM delete ───────────────────────────────────────────────────────
    await this.model.destroy(id);

    // ── after_delete ─────────────────────────────────────────────────────
    await HookPipeline.run(
      'after_delete',
      { id, record, user: ctx.user || null, resource: this },
      this,
      AdminHooks,
    );
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Sanitise and type-coerce raw HTML form data before passing to the ORM.
   *
   * HTML forms submit everything as strings. Without coercion:
   *   - checkboxes come in as 'on' or missing entirely (not false)
   *   - numbers come in as '42' (string), breaking integer/decimal columns
   *   - nullable fields come in as '' (empty string) instead of null
   *   - booleans come in as 'true'/'false' strings
   *
   * This method reads the model's field definitions and coerces each value
   * to the correct type before the ORM sees it.
   *
   * @param {object} data   — raw req.body
   * @param {object} [model] — optional model class override (defaults to this.model)
   */
  static _sanitise(data, model) {
    const clean = { ...data };

    // Strip system / framework fields — never write these
    delete clean.id;
    delete clean._method;
    delete clean._token;
    delete clean._csrf;
    delete clean._submit;

    // Get the merged field map for type coercion
    const M = model || this.model;
    const fieldMap = M
      ? (typeof M.getFields === 'function' ? M.getFields() : (M.fields || {}))
      : {};

    // ── Boolean fields: checkbox sends 'on' when checked, nothing when unchecked ──
    // We must explicitly set false for unchecked boxes because the key is absent.
    for (const [name, def] of Object.entries(fieldMap)) {
      if (def && def.type === 'boolean') {
        const raw = clean[name];
        if (raw === undefined || raw === null || raw === '') {
          // Unchecked checkbox — HTML sends nothing, default to false
          clean[name] = false;
        } else if (raw === 'on' || raw === '1' || raw === 'true' || raw === true) {
          clean[name] = true;
        } else if (raw === '0' || raw === 'false' || raw === false) {
          clean[name] = false;
        } else {
          clean[name] = Boolean(raw);
        }
      }
    }

    // ── Coerce remaining types ────────────────────────────────────────────────
    for (const [key, raw] of Object.entries(clean)) {
      const def = fieldMap[key];
      if (!def) continue; // unknown field — leave as-is, ORM will reject if invalid

      switch (def.type) {
        case 'integer':
        case 'bigInteger': {
          if (raw === '' || raw === null || raw === undefined) {
            clean[key] = def.nullable ? null : 0;
          } else {
            const n = parseInt(raw, 10);
            clean[key] = isNaN(n) ? (def.nullable ? null : 0) : n;
          }
          break;
        }
        case 'float':
        case 'decimal': {
          if (raw === '' || raw === null || raw === undefined) {
            clean[key] = def.nullable ? null : 0;
          } else {
            const n = parseFloat(raw);
            clean[key] = isNaN(n) ? (def.nullable ? null : 0) : n;
          }
          break;
        }
        case 'boolean':
          // Already handled above
          break;
        case 'string':
        case 'text': {
          if (raw === '' || raw === undefined) {
            // Empty string on a nullable field → null; on required field → keep as ''
            // so the validator can complain rather than silently nulling it
            clean[key] = def.nullable ? null : '';
          }
          break;
        }
        case 'json': {
          if (typeof raw === 'string' && raw.trim() !== '') {
            try { clean[key] = JSON.parse(raw); } catch { /* leave as string, let validator catch */ }
          } else if (raw === '' || raw === undefined) {
            clean[key] = def.nullable ? null : {};
          }
          break;
        }
        case 'date':
        case 'timestamp': {
          if (raw === '' || raw === null || raw === undefined) {
            clean[key] = def.nullable ? null : undefined;
            if (clean[key] === undefined) delete clean[key];
          }
          break;
        }
        case 'id':
          // Never write id — already deleted above
          delete clean[key];
          break;
        case 'password':
          // Blank password on an edit form means "keep the current hash" —
          // remove the key entirely so it is never written to the DB and
          // never passed to before_save. Non-blank values pass through as-is;
          // the developer hashes them in before_save using Hash.make().
          if (raw === '' || raw === null || raw === undefined) {
            delete clean[key];
          }
          break;
        default:
          // string-like fields: leave as-is
      }
    }

    return clean;
  }

  static _getLabel() {
    return this.label || (this.model?.name ? this.model.name + 's' : 'Records');
  }

  static _getLabelSingular() {
    return this.labelSingular || this.model?.name || 'Record';
  }

  // ─── Per-user permission resolution ───────────────────────────────────────

  /**
   * Resolve whether `user` has `action` permission for this resource.
   *
   * action: 'view' | 'add' | 'change' | 'delete'
   *
   * Rules (Django-matching):
   *   1. Superusers (is_superuser=true) always get true.
   *   2. The static boolean flag (canView/canCreate/canEdit/canDelete) is
   *      the class-level default — if false, nobody gets in regardless.
   *   3. Non-superuser staff check user.permissions — a JSON array of
   *      permission strings like ['{slug}.view', '{slug}.add', ...].
   *      An empty/missing permissions array means no access.
   *
   * Override this method in a resource subclass for custom logic:
   *
   *   static hasPermission(user, action) {
   *     if (action === 'delete') return false; // nobody can delete
   *     return super.hasPermission(user, action);
   *   }
   *
   * @param {object|null} user   — req.adminUser (live User model instance)
   * @param {string}      action — 'view'|'add'|'change'|'delete'
   * @returns {boolean}
   */
  static hasPermission(user, action) {
    // Map action → static boolean flag
    const flagMap = {
      view:   'canView',
      add:    'canCreate',
      change: 'canEdit',
      delete: 'canDelete',
    };
    const flag = flagMap[action];

    // Class-level hard disable — applies to everyone including superusers
    if (flag && this[flag] === false) return false;

    // No user context (auth disabled) — fall back to static flag
    if (!user) return flag ? this[flag] !== false : true;

    // Superusers bypass all per-user permission checks
    if (user.is_superuser || user.is_superuser === 1) return true;

    // Non-superuser staff — check permissions array
    // Format: '{slug}.{action}'  e.g. 'users.view', 'posts.add'
    const permKey = `${this.slug}.${action}`;
    const userPerms = this._parsePermissions(user.permissions);
    return userPerms.has(permKey);
  }

  /**
   * Parse user.permissions into a Set of permission strings.
   * Handles: JSON string, plain array, comma-separated string, null/undefined.
   */
  static _parsePermissions(raw) {
    if (!raw) return new Set();
    try {
      if (Array.isArray(raw)) return new Set(raw);
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.startsWith('[')) return new Set(JSON.parse(trimmed));
        return new Set(trimmed.split(',').map(s => s.trim()).filter(Boolean));
      }
    } catch {}
    return new Set();
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

  /**
   * FK relation field — renders as a searchable select.
   * resourceSlug: the admin resource slug to fetch options from.
   *   AdminField.fk('user_id', 'users').label('User')
   */
  static fk(name, resourceSlug) {
    const f = new AdminField(name, 'fk');
    f._fkResource = resourceSlug || null;
    return f;
  }

  /**
   * M2M relation field — renders as a dual-list widget.
   *   AdminField.m2m('tags', 'tags').label('Tags')
   */
  static m2m(name, resourceSlug) {
    const f = new AdminField(name, 'm2m');
    f._m2mResource = resourceSlug || null;
    return f;
  }

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
  /**
   * Scope the FK dropdown to records matching these constraints.
   * Accepts a plain object (col = val pairs) or a function for advanced queries.
   *
   *   AdminField.fk('tenant_id',  'users').where({ role: 'tenant' })
   *   AdminField.fk('landlord_id','users').where({ role: 'landlord', is_active: true })
   *   AdminField.fk('user_id',    'users').where(q => q.whereIn('role', ['admin', 'moderator']))
   */
  where(constraints) { this._fkWhere = constraints; return this; }

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
      fkResource:  this._fkResource  || null,
      fkWhere:     this._fkWhere     || null,
      m2mResource: this._m2mResource || null,
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
    // Normalise first — raw FieldDefinition from fields.ForeignKey() has
    // _isForeignKey=true but references=null until normaliseField resolves
    // _fkModel into { table, column, onDelete }. Without this, fkResource
    // is always null and the dropdown never loads.
    const def = normaliseField(fieldDef);

    // ── FK / M2M detection ────────────────────────────────────────────────
    // ForeignKey fields are integer type but carry _isForeignKey flag.
    // ManyToMany fields carry _isManyToMany flag.
    if (def._isManyToMany) {
      const f = AdminField.m2m(name, null);
      f._nullable = true;
      return f;
    }
    if (def._isForeignKey) {
      // Django convention: declared as 'landlord' → DB column 'landlord_id'.
      const colName = name.endsWith('_id') ? name : name + '_id';

      // references.table is now resolved by normaliseField (e.g. 'users')
      const resourceSlug = def.references?.table || null;

      const f = AdminField.fk(colName, resourceSlug);
      f._label = _toLabel(name);
      if (def.nullable) f._nullable = true;
      return f;
    }

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
    // Use getFields() for merged inheritance support; fall back to .fields
    const modelFields = typeof this.model?.getFields === 'function'
      ? this.model.getFields()
      : (this.model?.fields || {});
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a snake_case field name to a Title Case label.
 * 'landlord_id' → 'Landlord', 'user_id' → 'User', 'created_at' → 'Created At'
 */
function _toLabel(name) {
  return name
    .replace(/_id$/, '')           // strip _id suffix
    .replace(/_/g, ' ')            // underscores → spaces
    .replace(/\w/g, c => c.toUpperCase()); // Title Case
}

module.exports = { AdminResource, AdminField, AdminFilter, AdminInline };