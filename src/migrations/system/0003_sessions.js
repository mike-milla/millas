'use strict';

const { CreateModel } = require('../../orm/migration/operations');

/**
 * System migration: millas_sessions
 * Equivalent to Django's django_session.
 */
module.exports = {
  dependencies: [['system', '0001_users']],

  operations: [
    new CreateModel('millas_sessions', {
      session_key: { type: 'string',    max: 64,  nullable: false, unique: false, default: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null },
      user_id:     { type: 'integer',   unsigned: true, nullable: false, unique: false, default: null, max: null, enumValues: null, references: { table: 'users', column: 'id', onDelete: 'CASCADE' }, precision: null, scale: null },
      payload:     { type: 'text',      nullable: true,  unique: false, default: null, max: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null },
      ip_address:  { type: 'string',    max: 45,  nullable: true,  unique: false, default: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null },
      user_agent:  { type: 'string',    max: 512, nullable: true,  unique: false, default: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null },
      expires_at:  { type: 'timestamp', nullable: false, unique: false, default: null, max: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null },
      created_at:  { type: 'timestamp', nullable: true,  unique: false, default: null, max: null, unsigned: false, enumValues: null, references: null, precision: null, scale: null },
    }),
  ],
};
