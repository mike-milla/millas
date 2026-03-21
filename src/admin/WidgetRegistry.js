'use strict';

/**
 * WidgetRegistry
 *
 * Maps field types to widget descriptors that control how a field is
 * rendered in the admin form and how its raw submitted value is coerced.
 *
 * ── What a widget is ─────────────────────────────────────────────────────────
 *
 * A widget is a plain object with three responsibilities:
 *
 *   type      {string}   — the HTML input type sent to the template
 *                          (text | email | number | checkbox | select | textarea
 *                           | password | date | datetime-local | color | url |
 *                           phone | json | richtext | image | hidden)
 *
 *   coerce    {Function} — (rawValue, fieldDef) => typedValue
 *                          converts the raw string from req.body into the
 *                          correct JS type before the ORM sees it.
 *                          This is the single source of truth for type coercion
 *                          (used by _sanitise() in AdminResource).
 *
 *   validate  {Function} — (value, fieldDef) => string | null
 *                          returns an error message string, or null if valid.
 *                          Called by FormValidator before the ORM write.
 *
 * ── Built-in type → widget mapping ───────────────────────────────────────────
 *
 *   ORM type     Widget type    Notes
 *   ──────────   ───────────    ─────────────────────────────────────────────
 *   id           hidden         never shown in forms
 *   string       text           max length validated from fieldDef.max
 *   text         textarea       4-row textarea
 *   integer      number         parseInt, step=1
 *   bigInteger   number         parseInt, step=1
 *   float        number         parseFloat
 *   decimal      number         parseFloat, step derived from fieldDef.scale
 *   boolean      checkbox       'on'/missing → true/false
 *   enum         select         options from fieldDef.enumValues
 *   timestamp    datetime-local datetime-local input
 *   date         date           date input
 *   json         json           textarea with JSON validation
 *   uuid         text           plain text
 *
 * ── Custom widgets ────────────────────────────────────────────────────────────
 *
 * Register a custom widget globally:
 *
 *   const { WidgetRegistry } = require('millas/src/admin');
 *
 *   WidgetRegistry.register('color', {
 *     type:     'color',
 *     coerce:   (raw) => raw || null,
 *     validate: (val, def) => null,
 *   });
 *
 * Override per-field in AdminConfig:
 *
 *   class PostAdmin extends AdminResource {
 *     static widgets = {
 *       body:   { type: 'richtext' },
 *       cover:  { type: 'image' },
 *       status: { type: 'select' },
 *     };
 *   }
 *
 * ── Using the registry ────────────────────────────────────────────────────────
 *
 *   const widget = WidgetRegistry.resolve('integer', fieldDef);
 *   const typed  = widget.coerce('42', fieldDef);  // → 42
 *   const err    = widget.validate(typed, fieldDef); // → null
 */
class WidgetRegistry {
  constructor() {
    /** @type {Map<string, object>} ORM type → widget descriptor */
    this._widgets = new Map();
    this._registerDefaults();
  }

  // ─── Registration ──────────────────────────────────────────────────────────

  /**
   * Register or override a widget for an ORM field type.
   *
   * @param {string} ormType   — the field.type value (e.g. 'string', 'integer')
   * @param {object} widget    — { type, coerce, validate }
   */
  register(ormType, widget) {
    if (!widget.type)    throw new Error(`[WidgetRegistry] widget for "${ormType}" must have a type`);
    if (!widget.coerce)  widget.coerce   = (v) => v;
    if (!widget.validate) widget.validate = () => null;
    this._widgets.set(ormType, widget);
    return this;
  }

  /**
   * Resolve the widget for a given ORM type.
   * Falls back to a plain text widget if the type is unknown.
   *
   * @param {string} ormType
   * @param {object} [fieldDef] — field definition (used by some built-ins)
   * @returns {object} widget descriptor
   */
  resolve(ormType, fieldDef = {}) {
    return this._widgets.get(ormType) || this._widgets.get('string');
  }

  /**
   * Check if a custom widget is registered for an ORM type.
   */
  has(ormType) {
    return this._widgets.has(ormType);
  }

  /**
   * Return all registered ORM types.
   */
  types() {
    return [...this._widgets.keys()];
  }

  // ─── Default widgets ───────────────────────────────────────────────────────

  _registerDefaults() {

    // ── id ──────────────────────────────────────────────────────────────────
    this.register('id', {
      type:     'hidden',
      coerce:   () => undefined,   // id is never written
      validate: () => null,
    });

    // ── string ──────────────────────────────────────────────────────────────
    this.register('string', {
      type: 'text',
      coerce(raw, def) {
        if (raw === undefined || raw === null) return def?.nullable ? null : '';
        const s = String(raw);
        return s === '' && def?.nullable ? null : s;
      },
      validate(val, def) {
        if ((val === null || val === '' || val === undefined) && !def?.nullable) {
          return 'This field is required.';
        }
        if (def?.max && val && String(val).length > def.max) {
          return `Maximum ${def.max} characters allowed.`;
        }
        return null;
      },
    });

    // ── text ─────────────────────────────────────────────────────────────────
    this.register('text', {
      type: 'textarea',
      coerce(raw, def) {
        if (raw === undefined || raw === null) return def?.nullable ? null : '';
        const s = String(raw);
        return s === '' && def?.nullable ? null : s;
      },
      validate(val, def) {
        if ((val === null || val === '' || val === undefined) && !def?.nullable) {
          return 'This field is required.';
        }
        return null;
      },
    });

    // ── integer ──────────────────────────────────────────────────────────────
    this.register('integer', {
      type: 'number',
      coerce(raw, def) {
        if (raw === '' || raw === null || raw === undefined) {
          return def?.nullable ? null : 0;
        }
        const n = parseInt(raw, 10);
        return isNaN(n) ? (def?.nullable ? null : 0) : n;
      },
      validate(val, def) {
        if ((val === null || val === undefined) && !def?.nullable) {
          return 'This field is required.';
        }
        if (val !== null && val !== undefined && !Number.isInteger(Number(val))) {
          return 'Must be a whole number.';
        }
        return null;
      },
    });

    // ── bigInteger ───────────────────────────────────────────────────────────
    this.register('bigInteger', {
      type: 'number',
      coerce(raw, def) {
        if (raw === '' || raw === null || raw === undefined) return def?.nullable ? null : 0;
        const n = parseInt(raw, 10);
        return isNaN(n) ? (def?.nullable ? null : 0) : n;
      },
      validate: this._widgets.get?.('integer')?.validate || (() => null),
    });

    // ── float ────────────────────────────────────────────────────────────────
    this.register('float', {
      type: 'number',
      coerce(raw, def) {
        if (raw === '' || raw === null || raw === undefined) return def?.nullable ? null : 0;
        const n = parseFloat(raw);
        return isNaN(n) ? (def?.nullable ? null : 0) : n;
      },
      validate(val, def) {
        if ((val === null || val === undefined) && !def?.nullable) return 'This field is required.';
        if (val !== null && val !== undefined && isNaN(Number(val))) return 'Must be a number.';
        return null;
      },
    });

    // ── decimal ──────────────────────────────────────────────────────────────
    this.register('decimal', {
      type: 'number',
      coerce(raw, def) {
        if (raw === '' || raw === null || raw === undefined) return def?.nullable ? null : 0;
        const n = parseFloat(raw);
        return isNaN(n) ? (def?.nullable ? null : 0) : n;
      },
      validate(val, def) {
        if ((val === null || val === undefined) && !def?.nullable) return 'This field is required.';
        if (val !== null && val !== undefined && isNaN(Number(val))) return 'Must be a number.';
        return null;
      },
    });

    // ── boolean ──────────────────────────────────────────────────────────────
    this.register('boolean', {
      type: 'checkbox',
      coerce(raw) {
        if (raw === undefined || raw === null || raw === '' || raw === false || raw === '0' || raw === 'false') return false;
        if (raw === true || raw === 'on' || raw === '1' || raw === 'true') return true;
        return Boolean(raw);
      },
      validate: () => null,  // booleans are always valid (true or false)
    });

    // ── enum ─────────────────────────────────────────────────────────────────
    this.register('enum', {
      type: 'select',
      coerce(raw, def) {
        if (raw === '' || raw === null || raw === undefined) return def?.nullable ? null : (def?.enumValues?.[0] ?? null);
        return raw;
      },
      validate(val, def) {
        if ((val === null || val === undefined) && !def?.nullable) return 'Please select a value.';
        if (val && def?.enumValues && !def.enumValues.includes(val)) {
          return `Invalid value. Must be one of: ${def.enumValues.join(', ')}`;
        }
        return null;
      },
    });

    // ── timestamp ────────────────────────────────────────────────────────────
    this.register('timestamp', {
      type: 'datetime-local',
      coerce(raw, def) {
        if (raw === '' || raw === null || raw === undefined) return def?.nullable ? null : undefined;
        // datetime-local gives 'YYYY-MM-DDTHH:mm' — convert to ISO string
        try {
          const d = new Date(raw);
          return isNaN(d.getTime()) ? (def?.nullable ? null : undefined) : d.toISOString();
        } catch {
          return def?.nullable ? null : undefined;
        }
      },
      validate(val, def) {
        if ((val === null || val === undefined) && !def?.nullable) return 'This field is required.';
        return null;
      },
    });

    // ── date ─────────────────────────────────────────────────────────────────
    this.register('date', {
      type: 'date',
      coerce(raw, def) {
        if (raw === '' || raw === null || raw === undefined) return def?.nullable ? null : undefined;
        return raw; // 'YYYY-MM-DD' — pass through as-is, DB handles it
      },
      validate(val, def) {
        if ((val === null || val === undefined) && !def?.nullable) return 'This field is required.';
        if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) return 'Must be a valid date (YYYY-MM-DD).';
        return null;
      },
    });

    // ── json ─────────────────────────────────────────────────────────────────
    this.register('json', {
      type: 'json',
      coerce(raw, def) {
        if (raw === '' || raw === null || raw === undefined) return def?.nullable ? null : {};
        if (typeof raw === 'object') return raw;
        try { return JSON.parse(raw); } catch { return raw; } // leave as-is, validate will catch
      },
      validate(val, def) {
        if ((val === null || val === undefined) && !def?.nullable) return 'This field is required.';
        if (typeof val === 'string') {
          try { JSON.parse(val); } catch { return 'Must be valid JSON.'; }
        }
        return null;
      },
    });

    // ── uuid ─────────────────────────────────────────────────────────────────
    this.register('uuid', {
      type: 'text',
      coerce(raw, def) {
        if (raw === '' || raw === null || raw === undefined) return def?.nullable ? null : '';
        return String(raw).trim();
      },
      validate(val, def) {
        if ((val === null || val === '' || val === undefined) && !def?.nullable) return 'This field is required.';
        if (val && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
          return 'Must be a valid UUID.';
        }
        return null;
      },
    });

    // ── email (AdminField type, not ORM type — registered for completeness) ──
    this.register('email', {
      type: 'email',
      coerce(raw, def) {
        if (raw === '' || raw === null || raw === undefined) return def?.nullable ? null : '';
        return String(raw).trim().toLowerCase();
      },
      validate(val, def) {
        if ((val === null || val === '' || val === undefined) && !def?.nullable) return 'This field is required.';
        if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return 'Must be a valid email address.';
        return null;
      },
    });

    // ── url ───────────────────────────────────────────────────────────────────
    this.register('url', {
      type: 'url',
      coerce(raw, def) {
        if (raw === '' || raw === null || raw === undefined) return def?.nullable ? null : '';
        return String(raw).trim();
      },
      validate(val, def) {
        if ((val === null || val === '' || val === undefined) && !def?.nullable) return 'This field is required.';
        if (val) {
          try { new URL(val); } catch { return 'Must be a valid URL.'; }
        }
        return null;
      },
    });

    // ── password ──────────────────────────────────────────────────────────────
    this.register('password', {
      type: 'password',
      coerce(raw) {
        // Empty password on edit = keep existing (return undefined so ORM skips it)
        if (raw === '' || raw === null || raw === undefined) return undefined;
        return String(raw);
      },
      validate(val, def) {
        // On edit, empty is allowed (means "don't change password")
        if (val === undefined || val === null || val === '') return null;
        if (val.length < 8) return 'Password must be at least 8 characters.';
        return null;
      },
    });
    // ── fk (ForeignKey) ──────────────────────────────────────────────────────
    // Rendered as a searchable select backed by the /admin/api/:resource/options
    // autocomplete endpoint. Falls back to a plain number input if no related
    // resource is registered.
    this.register('fk', {
      type: 'fk',
      coerce(raw, def) {
        if (raw === '' || raw === null || raw === undefined) return def?.nullable ? null : undefined;
        const n = parseInt(raw, 10);
        return isNaN(n) ? (def?.nullable ? null : undefined) : n;
      },
      validate(val, def) {
        if ((val === null || val === undefined) && !def?.nullable) {
          return 'Please select a related record.';
        }
        return null;
      },
    });

    // ── m2m (ManyToMany) ──────────────────────────────────────────────────
    // Rendered as a dual-list widget (available → chosen).
    // Values submitted as multiple values under the same field name.
    this.register('m2m', {
      type: 'm2m',
      coerce(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.map(v => parseInt(v, 10)).filter(n => !isNaN(n));
        return [parseInt(raw, 10)].filter(n => !isNaN(n));
      },
      validate: () => null,
    });
  }
}

// ── Singleton global registry ─────────────────────────────────────────────────
const widgetRegistry = new WidgetRegistry();

module.exports = { WidgetRegistry, widgetRegistry };
