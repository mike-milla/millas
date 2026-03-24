'use strict';

const ActivityLog = require('../ActivityLog');

/**
 * ActionHandler
 *
 * Handles bulk and per-row custom actions:
 *   POST /admin/:resource/bulk-delete
 *   POST /admin/:resource/bulk-action
 *   POST /admin/:resource/:id/action/:action
 */
class ActionHandler {
  constructor(admin) {
    this._admin = admin;
  }

  async bulkDestroy(req, res) {
    const admin = this._admin;
    try {
      const R = admin._resolve(req.params.resource, res);
      if (!R) return;
      if (!admin._perm(R, 'delete', req.adminUser)) {
        return res.status(403).send(`You do not have permission to delete ${R._getLabelSingular()} records.`);
      }
      if (!admin._verifyCsrf(req, res)) return;

      const ids = Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids].filter(Boolean);
      if (!ids.length) {
        admin._flash(req, 'error', 'No records selected.');
        return admin._redirectWithFlash(res, `${admin._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
      }

      await R.model.destroy(...ids);
      ActivityLog.record('delete', R.slug, null, `${ids.length} ${R._getLabel()} (bulk)`, req.adminUser);
      admin._flash(req, 'success', `Deleted ${ids.length} record${ids.length > 1 ? 's' : ''}.`);
      admin._redirectWithFlash(res, `${admin._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
    } catch (err) {
      admin._error(req, res, err);
    }
  }

  async bulkAction(req, res) {
    const admin = this._admin;
    try {
      const R = admin._resolve(req.params.resource, res);
      if (!R) return;
      if (!admin._verifyCsrf(req, res)) return;

      const actionIndex = Number(req.body.actionIndex);
      const ids         = Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids].filter(Boolean);
      const action      = (R.actions || [])[actionIndex];

      if (!action) {
        admin._flash(req, 'error', 'Unknown action.');
        return admin._redirectWithFlash(res, `${admin._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
      }

      if (!ids.length) {
        admin._flash(req, 'error', 'No records selected.');
        return admin._redirectWithFlash(res, `${admin._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
      }

      await action.handler(ids, R.model);
      ActivityLog.record('update', R.slug, null, `Bulk action "${action.label}" on ${ids.length} records`, req.adminUser);
      admin._flash(req, 'success', `Action "${action.label}" applied to ${ids.length} record${ids.length > 1 ? 's' : ''}.`);
      admin._redirectWithFlash(res, `${admin._config.prefix}/${R.slug}`, req._flashType, req._flashMessage);
    } catch (err) {
      admin._error(req, res, err);
    }
  }

  async rowAction(req, res) {
    const admin = this._admin;
    try {
      const R = admin._resolve(req.params.resource, res);
      if (!R) return;
      if (!admin._verifyCsrf(req, res)) return;

      const actionName = req.params.action;
      const rowAction  = (R.rowActions || []).find(a => a.action === actionName);

      if (!rowAction || !rowAction.handler) {
        return res.status(404).send(`Row action "${actionName}" not found.`);
      }

      const record = await R.fetchOne(req.params.id);
      const result = await rowAction.handler(record, R.model);

      const redirect = (typeof result === 'string' && result.startsWith('/'))
        ? result
        : `${admin._config.prefix}/${R.slug}`;

      ActivityLog.record('update', R.slug, req.params.id, `Action "${rowAction.label}" on #${req.params.id}`, req.adminUser);
      admin._flash(req, 'success', rowAction.successMessage || `Action "${rowAction.label}" completed.`);
      admin._redirectWithFlash(res, redirect, req._flashType, req._flashMessage);
    } catch (err) {
      admin._error(req, res, err);
    }
  }
}

module.exports = ActionHandler;
