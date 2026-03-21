'use strict';

const { CreateModel } = require('../../orm/migration/operations');

/**
 * System migration: millas_admin_log
 * Equivalent to Django's django_admin_log.
 */
module.exports = {
  dependencies: [['system', '0001_users']],

  operations: [
    new CreateModel('millas_admin_log', {
      id:         { type: 'id',        unsigned: true,  nullable: false, unique: false, default: null, max: null, enumValues: null, references: null, precision: null, scale: null },
      user_id:    { type: 'integer',   unsigned: true,  nullable: true,  unique: false, default: null, max: null, enumValues: null, references: { table: 'users', column: 'id', onDelete: 'SET NULL' }, precision: null, scale: null },
      user_email: { type: 'string',    max: 255,        nullable: true,  unique: false, default: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null },
      resource:   { type: 'string',    max: 100,        nullable: false, unique: false, default: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null },
      record_id:  { type: 'string',    max: 100,        nullable: true,  unique: false, default: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null },
      action:     { type: 'enum',      enumValues: ['create','update','delete'], nullable: false, unique: false, default: null, max: null, unsigned: false, references: null, precision: null, scale: null },
      label:      { type: 'string',    max: 255,        nullable: true,  unique: false, default: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null },
      change_msg: { type: 'text',      nullable: true,  unique: false, default: null, max: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null },
      created_at: { type: 'timestamp', nullable: true,  unique: false, default: null, max: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null },
    }),
  ],
};