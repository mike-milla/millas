'use strict';

/**
 * millas/facades/Admin
 *
 *   const { Admin, AdminResource, AdminField, AdminFilter, AdminInline }
 *     = require('millas/facades/Admin');
 *
 *   class PostResource extends AdminResource {
 *     static model       = Post;
 *     static label       = 'Posts';
 *     static searchable  = ['title'];
 *     static dateHierarchy = 'created_at';
 *
 *     static fields() {
 *       return [
 *         AdminField.id(),
 *         AdminField.text('title').sortable().required(),
 *         AdminField.textarea('body').nullable(),
 *         AdminField.boolean('published'),
 *         AdminField.datetime('created_at').readonly(),
 *       ];
 *     }
 *
 *     static inlines = [
 *       new AdminInline({
 *         model: Comment, label: 'Comments',
 *         foreignKey: 'post_id', canCreate: true, canDelete: true,
 *       }),
 *     ];
 *   }
 *
 *   // In AppServiceProvider.boot():
 *   Admin.register(PostResource);
 */

const { Admin, AdminResource, AdminField, AdminFilter, AdminServiceProvider } = require('../core');

let AdminInline;
try { AdminInline = require('../admin/resources/AdminResource').AdminInline; } catch {}

module.exports = {
  Admin,
  AdminResource,
  AdminField,
  AdminFilter,
  AdminInline,
  AdminServiceProvider,
};
