'use strict';

const LookupParser = require('../../orm/query/LookupParser');

/**
 * ApiHandler
 *
 * Handles the internal JSON API used by FK and M2M widgets:
 *   GET /admin/api/:resource/options?q=&page=&limit=&field=&from=
 *
 * Returns paginated { id, label } pairs for autocomplete selects.
 */
class ApiHandler {
  constructor(admin) {
    this._admin = admin;
  }

  async options(req, res) {
    const admin = this._admin;
    try {
      const slug = req.params.resource;
      let R = admin._resources.get(slug);
      if (!R) {
        for (const resource of admin._resources.values()) {
          if (resource.model && resource.model.table === slug) { R = resource; break; }
        }
      }
      if (!R) return res.status(404).json({ error: `Resource "${slug}" not found` });
      if (!R.hasPermission(req.adminUser || null, 'view')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const search  = (req.query.q    || '').trim();
      const page    = Math.max(1, Number(req.query.page)  || 1);
      const perPage = Math.min(Number(req.query.limit) || 20, 100);
      const offset  = (page - 1) * perPage;
      const pk      = R.model.primaryKey || 'id';

      // Label column resolution — priority:
      //   1. resource.fkLabel (developer override)
      //   2. resource.searchable[0]
      //   3. Auto-detect: name > email > title > label > first string field
      //   4. pk fallback
      let labelCol = R.fkLabel || (R.searchable && R.searchable[0]) || null;
      if (!labelCol && R.model) {
        const fields = typeof R.model.getFields === 'function'
          ? R.model.getFields()
          : (R.model.fields || {});
        const preferred = ['name', 'email', 'title', 'label', 'full_name',
                           'fullname', 'username', 'display_name', 'first_name'];
        for (const p of preferred) {
          if (fields[p]) { labelCol = p; break; }
        }
        if (!labelCol) {
          const skip = new Set(['password', 'token', 'secret', 'hash', 'remember_token']);
          for (const [col, def] of Object.entries(fields)) {
            if (def.type === 'string' && !skip.has(col) && col !== pk) {
              labelCol = col; break;
            }
          }
        }
      }
      labelCol = labelCol || pk;

      // Resolve fkWhere from the source resource's field definition
      const fieldName = (req.query.field || '').trim();
      const fromSlug  = (req.query.from  || '').trim();
      let fkWhere = null;
      if (fieldName && fromSlug) {
        const sourceResource = admin._resources.get(fromSlug)
          || [...admin._resources.values()].find(r => r.model?.table === fromSlug);
        if (sourceResource) {
          const fieldDef = (sourceResource.fields() || []).find(f => f._name === fieldName);
          if (fieldDef && fieldDef._fkWhere) fkWhere = fieldDef._fkWhere;
        }
      }

      const applyScope = (q) => {
        if (!fkWhere) return q;
        if (typeof fkWhere === 'function') return fkWhere(q) || q;
        for (const [key, value] of Object.entries(fkWhere)) {
          LookupParser.apply(q, key, value, R.model);
        }
        return q;
      };

      let countQ = applyScope(R.model._db().count(`${pk} as total`));
      if (search) countQ = countQ.where(labelCol, 'like', `%${search}%`);
      const [{ total }] = await countQ;

      let rowQ = applyScope(R.model._db()
        .select([`${pk} as id`, `${labelCol} as label`])
        .orderBy(labelCol, 'asc')
        .limit(perPage)
        .offset(offset));
      if (search) rowQ = rowQ.where(labelCol, 'like', `%${search}%`);
      const rows = await rowQ;

      return res.json({
        data:     rows,
        total:    Number(total),
        page,
        perPage,
        hasMore:  offset + rows.length < Number(total),
        labelCol,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}

module.exports = ApiHandler;
