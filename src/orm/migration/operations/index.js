'use strict';

/**
 * operations/index.js
 *
 * Public surface of the operations/ folder.
 *
 * Import from here for the full set:
 *   require('./operations')
 *
 * Or import directly from a sub-module when you only need one concern:
 *   require('./operations/models')   — CreateModel, DeleteModel, RenameModel
 *   require('./operations/fields')   — AddField, RemoveField, AlterField, RenameField
 *   require('./operations/column')   — applyColumn, alterColumn, attachFKConstraints
 *   require('./operations/registry') — deserialise, migrations proxy
 *   require('./operations/special')  — RunSQL
 */

const { BaseOperation }                            = require('./base');
const { applyColumn, alterColumn,
        attachFKConstraints }                       = require('./column');
const { CreateModel, DeleteModel, RenameModel }    = require('./models');
const { AddField, RemoveField,
        AlterField, RenameField }                  = require('./fields');
const { AddIndex, RemoveIndex,
        AlterUniqueTogether, RenameIndex }           = require('./indexes');
const { RunSQL }                                   = require('./special');
const { deserialise, migrations, _tableFromName }  = require('./registry');

module.exports = {
  BaseOperation,
  applyColumn, alterColumn, attachFKConstraints,
  CreateModel, DeleteModel, RenameModel,
  AddField, RemoveField, AlterField, RenameField,
  AddIndex, RemoveIndex, AlterUniqueTogether, RenameIndex,
  RunSQL,
  deserialise, migrations, _tableFromName,
};