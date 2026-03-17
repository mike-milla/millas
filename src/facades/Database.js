'use strict';

/**
 * millas/facades/Database
 *
 * ORM models, field definitions, and query builder.
 *
 *   const { Model, fields } = require('millas/facades/Database');
 *
 *   class Post extends Model {
 *     static table = 'posts';
 *     static fields = {
 *       id:         fields.id(),
 *       title:      fields.string({ max: 255 }),
 *       author:     fields.ForeignKey('User', { relatedName: 'posts' }),
 *       published:  fields.boolean({ default: false }),
 *       created_at: fields.timestamp(),
 *       updated_at: fields.timestamp(),
 *     };
 *   }
 */

const {
  Model,
  fields,
  QueryBuilder,
  DatabaseManager,
  SchemaBuilder,
  MigrationRunner,
  ModelInspector,
  DatabaseServiceProvider,
} = require('../core');

module.exports = {
  Model,
  fields,
  QueryBuilder,
  DatabaseManager,
  SchemaBuilder,
  MigrationRunner,
  ModelInspector,
  DatabaseServiceProvider,
};
