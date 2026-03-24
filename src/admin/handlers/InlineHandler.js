'use strict';

const ActivityLog = require('../ActivityLog');
const AdminAuth   = require('../AdminAuth');

/**
 * InlineHandler
 *
 * Handles inline related-record CRUD on the detail page:
 *   POST /admin/:resource/:id/inline/:inlineIndex
 *   POST /admin/:resource/:id/inline/:inlineIndex/:rowId/delete
 */
class InlineHandler {
  constructor(admin) {
    this._admin = admin;
  }

  async store(req, res) {
    const admin = this._admin;
    try {
      const R = admin._resolve(req.params.resource, res);
      if (!R) return;
      if (!admin._verifyCsrf(req, res)) return;

      const idx    = Number(req.params.inlineIndex);
      const inline = (R.inlines || [])[idx];
      if (!inline)           return res.status(404).send('Inline not found.');
      if (!inline.canCreate) return res.status(403).send('Inline create is disabled.');

      const data = {
        ...req.body,
        [inline.foreignKey]: req.params.id,
      };
      delete data._csrf;
      delete data._method;
      delete data._submit;

      await inline.model.create(data);
      ActivityLog.record('create', inline.label, null, `Inline ${inline.label} for #${req.params.id}`, req.adminUser);

      AdminAuth.setFlash(res, 'success', `${inline.label} added.`);
      res.redirect(`${admin._config.prefix}/${R.slug}/${req.params.id}`);
    } catch (err) {
      admin._error(req, res, err);
    }
  }

  async destroy(req, res) {
    const admin = this._admin;
    try {
      const R = admin._resolve(req.params.resource, res);
      if (!R) return;
      if (!admin._verifyCsrf(req, res)) return;

      const idx    = Number(req.params.inlineIndex);
      const inline = (R.inlines || [])[idx];
      if (!inline)           return res.status(404).send('Inline not found.');
      if (!inline.canDelete) return res.status(403).send('Inline delete is disabled.');

      await inline.model.destroy(req.params.rowId);
      ActivityLog.record('delete', inline.label, req.params.rowId, `Inline ${inline.label} #${req.params.rowId}`, req.adminUser);

      AdminAuth.setFlash(res, 'success', 'Record deleted.');
      res.redirect(`${admin._config.prefix}/${R.slug}/${req.params.id}`);
    } catch (err) {
      admin._error(req, res, err);
    }
  }
}

module.exports = InlineHandler;
