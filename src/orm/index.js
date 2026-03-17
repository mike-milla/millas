'use strict';

const Model           = require('./model/Model');
const { fields }      = require('./fields');
const QueryBuilder    = require('./query/QueryBuilder');
const Q               = require('./query/Q');
const { AggregateExpression, Sum, Avg, Min, Max, Count } = require('./query/Aggregates');
const LookupParser    = require('./query/LookupParser');
const DatabaseManager = require('./drivers/DatabaseManager');
const SchemaBuilder   = require('./migration/SchemaBuilder');
const MigrationRunner = require('./migration/MigrationRunner');
const ModelInspector  = require('./migration/ModelInspector');
const { HasOne, HasMany, BelongsTo, BelongsToMany } = require('./relations');

module.exports = {
  // Core
  Model,
  fields,
  QueryBuilder,
  DatabaseManager,
  SchemaBuilder,
  MigrationRunner,
  ModelInspector,

  // Query helpers
  Q,
  LookupParser,

  // Aggregate expressions
  Sum, Avg, Min, Max, Count,
  AggregateExpression,

  // Relations
  HasOne,
  HasMany,
  BelongsTo,
  BelongsToMany,
};
