'use strict';

const Admin              = require('./Admin');
const AdminAuth          = require('./AdminAuth');
const ActivityLog        = require('./ActivityLog');
const AdminServiceProvider = require('../providers/AdminServiceProvider');
const { AdminResource, AdminField, AdminFilter, AdminInline } = require('./resources/AdminResource');
const { AdminHooks, HookRegistry, HookPipeline, VALID_EVENTS } = require('./HookRegistry');
const { FormGenerator }  = require('./FormGenerator');
const { WidgetRegistry, widgetRegistry } = require('./WidgetRegistry');
const { QueryEngine }    = require('./QueryEngine');
const { ViewContext }    = require('./ViewContext');

module.exports = {
  Admin,
  AdminAuth,
  ActivityLog,
  AdminResource,
  AdminField,
  AdminFilter,
  AdminInline,
  AdminServiceProvider,
  // Hook system
  AdminHooks,
  HookRegistry,
  HookPipeline,
  VALID_EVENTS,
  // Form system
  FormGenerator,
  WidgetRegistry,
  widgetRegistry,
  // Query + View
  QueryEngine,
  ViewContext,
};
