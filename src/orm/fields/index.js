'use strict';

class FieldDefinition {
    constructor(type, options = {}) {
        this.type = type;
        this.options = options;
        this.nullable = options.nullable ?? false;
        this.unique = options.unique ?? false;
        this.default = options.default !== undefined ? options.default : undefined;
        this.primary = options.primary ?? false;
        this.unsigned = options.unsigned ?? false;
        this.max = options.max ?? null;
        this.enumValues = options.enumValues ?? null;
        this.references = options.references ?? null;
        this._isForeignKey = options._isForeignKey ?? false;
        this._isOneToOne = options._isOneToOne ?? false;
        this._isManyToMany = options._isManyToMany ?? false;
        this._fkModel = options._fkModel ?? null;
        this._fkModelRef = options._fkModelRef ?? null;
        this._fkToField = options._fkToField ?? 'id';
        this._fkOnDelete = options._fkOnDelete ?? 'CASCADE';
        this._fkRelatedName = options._fkRelatedName ?? null;
        this._m2mThrough = options._m2mThrough ?? null;
    }

    nullable_(val = true) {
        this.nullable = val;
        return this;
    }

    unique_(val = true) {
        this.unique = val;
        return this;
    }

    default_(val) {
        this.default = val;
        return this;
    }

    unsigned_(val = true) {
        this.unsigned = val;
        return this;
    }

    references_(table, col) {
        this.references = {table, column: col};
        return this;
    }
}

function _makeModelRef(model) {
    if (typeof model === 'function') return model;
    if (model === 'self') return null;
    return () => {
        const path = require('path');
        const modelsDir = path.join(process.cwd(), 'app', 'models');
        try {
            return require(path.join(modelsDir, model));
        } catch {
            try {
                const fs = require('fs');
                const files = fs.readdirSync(modelsDir);
                const match = files.find(f =>
                    f.replace(/\.js$/, '').toLowerCase() === model.toLowerCase()
                );
                if (match) return require(path.join(modelsDir, match));
            } catch {
            }
            return null;
        }
    };
}

const fields = {

    id(options = {}) {
        return new FieldDefinition('id', {primary: true, unsigned: true, ...options});
    },

    string(options = {}) {
        return new FieldDefinition('string', {max: 255, ...options});
    },

    text(options = {}) {
        return new FieldDefinition('text', options);
    },

    integer(options = {}) {
        return new FieldDefinition('integer', options);
    },

    bigInteger(options = {}) {
        return new FieldDefinition('bigInteger', options);
    },

    float(options = {}) {
        return new FieldDefinition('float', options);
    },

    decimal(precision = 8, scale = 2, options = {}) {
        return new FieldDefinition('decimal', {precision, scale, ...options});
    },

    boolean(options = {}) {
        return new FieldDefinition('boolean', options);
    },

    json(options = {}) {
        return new FieldDefinition('json', options);
    },

    date(options = {}) {
        return new FieldDefinition('date', options);
    },

    timestamp(options = {}) {
        return new FieldDefinition('timestamp', {nullable: true, ...options});
    },

    enum(values, options = {}) {
        return new FieldDefinition('enum', {enumValues: values, ...options});
    },

    uuid(options = {}) {
        return new FieldDefinition('uuid', options);
    },

    /**
     * ForeignKey — Django-style.
     *
     * Declares the integer column AND wires the BelongsTo relation automatically.
     * No `static relations` block needed.
     *
     * Field name convention:
     *   author    → accessor: book.author()   column: author_id
     *   author_id → accessor: book.author()   column: author_id
     *
     * @param {string|Function} model        'Author' | () => Author | 'self'
     * @param {object}  [opts]
     * @param {boolean} [opts.nullable]      allow NULL (default: false)
     * @param {string}  [opts.onDelete]      CASCADE|SET NULL|RESTRICT|PROTECT|DO_NOTHING (default: CASCADE)
     * @param {string}  [opts.relatedName]   reverse accessor on target, e.g. 'books' → author.books()
     *                                       pass '+' to suppress the reverse relation
     * @param {string}  [opts.toField]       target column (default: 'id')
     *
     * @example
     *   author:    fields.ForeignKey('Author', { onDelete: 'CASCADE', relatedName: 'books' })
     *   editor:    fields.ForeignKey('User',   { nullable: true, onDelete: 'SET NULL' })
     *   parent:    fields.ForeignKey('self',   { nullable: true, relatedName: 'children' })
     */
    ForeignKey(model, opts = {}) {
        return new FieldDefinition('integer', {
            unsigned: true,
            nullable: opts.nullable ?? false,
            _isForeignKey: true,
            _fkModel: model,
            _fkModelRef: _makeModelRef(model),
            _fkToField: opts.toField ?? 'id',
            _fkOnDelete: opts.onDelete ?? 'CASCADE',
            _fkRelatedName: opts.relatedName ?? null,
        });
    },

    /**
     * OneToOne — unique ForeignKey. Both directions wired automatically.
     *
     * @example
     *   user: fields.OneToOne('User', { relatedName: 'profile' })
     *   // profile.user() and user.profile() both work
     */
    OneToOne(model, opts = {}) {
        return new FieldDefinition('integer', {
            unsigned: true,
            unique: true,
            nullable: opts.nullable ?? false,
            _isForeignKey: true,
            _isOneToOne: true,
            _fkModel: model,
            _fkModelRef: _makeModelRef(model),
            _fkToField: opts.toField ?? 'id',
            _fkOnDelete: opts.onDelete ?? 'CASCADE',
            _fkRelatedName: opts.relatedName ?? null,
        });
    },

    /**
     * ManyToMany — no DB column. Generates pivot table migration.
     * Pivot table auto-named: sorted model names joined with underscore.
     *
     * @example
     *   tags: fields.ManyToMany('Tag', { relatedName: 'courses' })
     *   tags: fields.ManyToMany('Tag', { through: 'course_tags', relatedName: 'courses' })
     */
    ManyToMany(model, opts = {}) {
        return new FieldDefinition('m2m', {
            nullable: true,
            _isManyToMany: true,
            _fkModel: model,
            _fkModelRef: _makeModelRef(model),
            _fkRelatedName: opts.relatedName ?? null,
            _m2mThrough: opts.through ?? null,
        });
    },

    /** Legacy — kept for backward compatibility. Prefer ForeignKey(). */
    foreignId(column, options = {}) {
        const [table, col] = column.endsWith('_id')
            ? [column.slice(0, -3) + 's', 'id']
            : [null, null];
        return new FieldDefinition('integer', {
            unsigned: true,
            nullable: options.nullable ?? false,
            references: table ? {table, column: col} : null,
            ...options,
        });
    },
    CASCADE: "CASCADE",
    SET_NULL: "SET_NULL"
};

module.exports = {fields, FieldDefinition};
