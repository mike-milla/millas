'use strict';

const { widgetRegistry } = require('./WidgetRegistry');

/**
 * FormGenerator
 *
 * Derives a complete, validated form schema from:
 *   1. Model field metadata (via Model.getFields())
 *   2. AdminResource configuration (fields(), readonlyFields, fieldsets, widgets)
 *   3. WidgetRegistry (type → widget mapping)
 *
 * The output is a FormSchema — a plain serialisable object that templates
 * consume directly. No HTML is generated here.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   // In Admin.js — replacing the existing _formFields() call
 *   const schema = FormGenerator.fromResource(R, { record, isEdit });
 *   res.render('pages/form.njk', { ...ctx, formFields: schema.fields });
 *
 * ── What FormGenerator adds over the current _formFields() ───────────────────
 *
 *   ✅  Widget type resolution via WidgetRegistry (customisable per field)
 *   ✅  Per-resource widget overrides (static widgets = { body: { type:'richtext' } })
 *   ✅  Validation rule derivation from field definitions
 *   ✅  Step/min/max attributes derived from field definitions (e.g. decimal scale)
 *   ✅  Coerce function available for each field (used by _sanitise)
 *   ✅  FormValidator.validate() — validates a full data object before ORM write
 *   ✅  Consistent field ordering: fieldsets respected, id always excluded
 *
 * ── FormSchema shape ──────────────────────────────────────────────────────────
 *
 *   {
 *     fields: [
 *       {
 *         name:        string,
 *         label:       string,
 *         type:        string,      // widget type (text|number|select|checkbox|…)
 *         ormType:     string,      // original ORM field type
 *         required:    boolean,
 *         nullable:    boolean,
 *         readonly:    boolean,
 *         hidden:      boolean,
 *         tab:         string|null,
 *         fieldset:    string|null,
 *         span:        string|null, // 'full'|'third'|null
 *         options:     array|null,  // for select/radio
 *         placeholder: string|null,
 *         help:        string|null,
 *         min:         number|null,
 *         max:         number|null,
 *         step:        number|null,
 *         prepopulate: string|null,
 *         isReadonly:  boolean,
 *         _isFieldset: boolean,     // sentinel: fieldset heading row
 *       },
 *       ...
 *     ],
 *     tabs:    string[],            // unique tab names in order
 *     hasTab:  boolean,
 *   }
 */
class FormGenerator {

  /**
   * Derive a FormSchema from an AdminResource class.
   *
   * @param {class}  Resource    — AdminResource subclass
   * @param {object} [opts]
   * @param {object} [opts.record={}]  — existing record data (for edit forms)
   * @param {boolean}[opts.isEdit=false]
   * @returns {FormSchema}
   */
  static fromResource(Resource, { record = {}, isEdit = false } = {}) {
    const readonlySet  = new Set(Resource.readonlyFields || []);
    const prepopFields = Resource.prepopulatedFields || {};
    // Per-resource widget overrides: static widgets = { fieldName: { type: 'richtext' } }
    const widgetOverrides = Resource.widgets || {};

    // Get the merged model field map for widget/validation metadata
    const modelFieldMap = Resource.model
      ? (typeof Resource.model.getFields === 'function'
          ? Resource.model.getFields()
          : (Resource.model.fields || {}))
      : {};

    let currentTab     = null;
    let currentFieldset = null;
    const fields       = [];
    const tabNames     = [];

    for (const f of Resource.fields()) {

      // ── Tab separator ─────────────────────────────────────────────────────
      if (f._type === 'tab') {
        currentTab      = f._label;
        currentFieldset = null;
        if (!tabNames.includes(currentTab)) tabNames.push(currentTab);
        continue;
      }

      // ── Fieldset heading ──────────────────────────────────────────────────
      if (f._type === 'fieldset') {
        currentFieldset = f._label;
        fields.push({ _isFieldset: true, label: f._label, tab: currentTab });
        continue;
      }

      // ── Skip id and list-only fields from forms ───────────────────────────
      if (f._type === 'id' || f._listOnly || f._hidden) continue;

      const name    = f._name;

      // ── FK / M2M fields — use AdminField metadata directly ───────────────
      // AdminField.fromModelField() already resolved the correct widget type
      // ('fk' or 'm2m') and the fkResource slug from the model's references.
      // FormGenerator must respect that instead of re-deriving from ormType,
      // because modelFieldMap uses the accessor name ('landlord') while the
      // AdminField uses the column name ('landlord_id') — they can't be matched
      // by name, and even if they could, ormType='integer' would give widget='number'.
      if (f._type === 'fk') {
        const isReadonly = readonlySet.has(name) || f._readonly || false;
        fields.push({
          name,
          label:       f._label,
          type:        'fk',
          ormType:     'integer',
          fkResource:  f._fkResource || null,
          required:    !f._nullable,
          nullable:    !!f._nullable,
          readonly:    isReadonly,
          isReadonly,
          hidden:      false,
          tab:         currentTab,
          fieldset:    currentFieldset,
          span:        f._span || null,
          options:     null,
          placeholder: f._placeholder || null,
          help:        f._help        || null,
          min:         null,
          max:         null,
          step:        null,
          colors:      {},
          isLink:      false,
          prepopulate: null,
          _coerce:     widgetRegistry.resolve('fk').coerce,
          _validate:   widgetRegistry.resolve('fk').validate,
        });
        continue;
      }

      if (f._type === 'm2m') {
        const isReadonly = readonlySet.has(name) || f._readonly || false;
        fields.push({
          name,
          label:       f._label,
          type:        'm2m',
          ormType:     'm2m',
          fkResource:  f._m2mResource || null,
          required:    false,
          nullable:    true,
          readonly:    isReadonly,
          isReadonly,
          hidden:      false,
          tab:         currentTab,
          fieldset:    currentFieldset,
          span:        'full',
          options:     null,
          placeholder: null,
          help:        f._help || null,
          min:         null,
          max:         null,
          step:        null,
          colors:      {},
          isLink:      false,
          prepopulate: null,
          _coerce:     widgetRegistry.resolve('m2m').coerce,
          _validate:   widgetRegistry.resolve('m2m').validate,
        });
        continue;
      }

      // ── All other field types ─────────────────────────────────────────────
      // AdminField carries its own _type (e.g. 'boolean', 'date', 'json',
      // 'email', 'password', 'url', 'phone', 'color', 'richtext', 'select').
      // For these, the AdminField._type IS the widget key — trust it directly
      // rather than re-deriving from modelFieldMap which may not find the field
      // (e.g. custom AdminField.boolean('active') with a name that doesn't
      // match the model's field map exactly).
      //
      // AdminField types that need direct resolution (no ORM equivalent):
      // Map AdminField._type → WidgetRegistry key.
      // AdminField types that don't match ORM type names get aliased here.
      // ── Type resolution ──────────────────────────────────────────────────────
      // Two separate concerns:
      //   ormType      → WidgetRegistry key (coerce/validate functions)
      //   templateType → what field.type the template sees
      //
      // Admin-display types (color, richtext, phone, badge, image) have no ORM
      // equivalent. They map to a string/text registry entry for coerce/validate
      // but the template must receive the original AdminField type to render
      // the correct widget (color picker, WYSIWYG, tel input, etc.).

      // Maps AdminField._type → WidgetRegistry key
      const REGISTRY_TYPE = {
        boolean:  'boolean',
        date:     'date',
        datetime: 'timestamp',
        timestamp:'timestamp',
        json:     'json',
        email:    'email',
        url:      'url',
        password: 'password',
        phone:    'string',    // template renders <input type="tel">
        color:    'string',    // template renders color picker
        richtext: 'text',      // template renders WYSIWYG
        badge:    'string',    // display-only, always readonly on forms
        image:    'string',    // display-only URL, always readonly on forms
        select:   'enum',
        number:   'integer',
        textarea: 'text',
        uuid:     'uuid',
      };

      // These AdminField types must reach the template with their original type
      // string intact — the template switches on it to render the right widget.
      // 'boolean' is intentionally excluded — the template checks 'checkbox'
      // (widget.type from WidgetRegistry), not 'boolean' (AdminField._type).
      const PRESERVE_TYPE = new Set([
        'color', 'richtext', 'phone', 'badge', 'image',
        'date', 'datetime', 'email', 'url', 'password',
        'json', 'number', 'textarea', 'select',
      ]);

      const ormType  = REGISTRY_TYPE[f._type] || modelFieldMap[name]?.type || 'string';
      const fieldDef = modelFieldMap[name] || {};

      // Resolve widget for coerce/validate — per-field override wins
      const override = widgetOverrides[name];
      const widget   = override
        ? { ...widgetRegistry.resolve(ormType, fieldDef), ...override }
        : widgetRegistry.resolve(ormType, fieldDef);

      // badge and image have no meaningful form input — always readonly
      const isBadgeOrImage = f._type === 'badge' || f._type === 'image';
      const isReadonly = isBadgeOrImage || readonlySet.has(name) || f._readonly || false;

      // Template sees the original AdminField type for display types,
      // otherwise the widget type resolved from the registry.
      const templateType = PRESERVE_TYPE.has(f._type) ? f._type : widget.type;

      // Derive step from decimal scale (e.g. scale=2 → step=0.01)
      let step = null;
      if (ormType === 'decimal' || ormType === 'float') {
        const scale = fieldDef.scale ?? 2;
        step = parseFloat((Math.pow(10, -scale)).toFixed(scale));
      } else if (ormType === 'integer' || ormType === 'bigInteger') {
        step = 1;
      }

      // Options for select/enum
      let options = f._options || null;
      if (!options && ormType === 'enum' && fieldDef.enumValues) {
        options = fieldDef.enumValues.map(v => ({ value: v, label: v }));
      }

      fields.push({
        name,
        label:       f._label,
        type:        templateType,
        ormType,

        required:    !isBadgeOrImage && !f._nullable && !fieldDef.nullable,
        nullable:    isBadgeOrImage  || !!(f._nullable || fieldDef.nullable),
        readonly:    isReadonly,
        isReadonly,
        hidden:      false,

        tab:         currentTab,
        fieldset:    currentFieldset,
        span:        f._span || null,

        options,
        placeholder: f._placeholder || null,
        help:        f._help        || null,
        min:         f._min         ?? null,
        max:         f._max         ?? (ormType === 'string' ? (fieldDef.max || null) : null),
        step,
        colors:      f._colors      || {},
        isLink:      f._isLink      || false,
        prepopulate: prepopFields[name] || f._prepopulate || null,

        _coerce:     widget.coerce  || null,
        _validate:   widget.validate || null,
      });
    }

    return {
      fields,
      tabs:   tabNames,
      hasTab: tabNames.length > 0,
    };
  }

  /**
   * Validate a fully coerced data object against the resource's field rules.
   *
   * Called by AdminResource.create() and AdminResource.update() before
   * the ORM write — after _sanitise() has already coerced the types.
   *
   * Returns null if all valid.
   * Returns { fieldName: 'error message', … } if any field fails.
   *
   * @param {class}  Resource — AdminResource subclass
   * @param {object} data     — coerced data object
   * @param {object} [opts]
   * @param {boolean}[opts.isNew=true]
   * @returns {object|null}
   */
  static validate(Resource, data, { isNew = true } = {}) {
    const modelFieldMap = Resource.model
      ? (typeof Resource.model.getFields === 'function'
          ? Resource.model.getFields()
          : (Resource.model.fields || {}))
      : {};

    const widgetOverrides = Resource.widgets || {};
    const errors = {};

    for (const f of Resource.fields()) {
      if (f._type === 'tab' || f._type === 'fieldset') continue;
      if (f._type === 'id' || f._listOnly || f._hidden) continue;

      const name     = f._name;
      const ormType  = modelFieldMap[name]?.type || 'string';
      const fieldDef = modelFieldMap[name] || {};
      const override = widgetOverrides[name];
      const widget   = override
        ? { ...widgetRegistry.resolve(ormType, fieldDef), ...override }
        : widgetRegistry.resolve(ormType, fieldDef);

      const value = data[name];

      // Skip password validation on edit if left blank (means "keep current")
      if (ormType === 'password' && !isNew && (value === undefined || value === null || value === '')) {
        continue;
      }

      if (typeof widget.validate === 'function') {
        const err = widget.validate(value, { ...fieldDef, nullable: f._nullable || fieldDef.nullable });
        if (err) errors[name] = err;
      }
    }

    // Run custom validation hook on the resource if defined
    // static validate(data, errors, isNew) — can add to errors or throw
    if (typeof Resource.validate === 'function') {
      try {
        Resource.validate(data, errors, isNew);
      } catch (err) {
        // If validate() throws an HttpError with errors attached, use those
        if (err.errors) Object.assign(errors, err.errors);
        else errors._form = err.message;
      }
    }

    return Object.keys(errors).length > 0 ? errors : null;
  }
}

module.exports = { FormGenerator };