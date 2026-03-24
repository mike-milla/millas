'use strict';

/**
 * ExportHandler
 *
 * Handles resource data exports:
 *   GET /admin/:resource/export.csv
 *   GET /admin/:resource/export.json
 */
class ExportHandler {
  constructor(admin) {
    this._admin = admin;
  }

  async export(req, res) {
    const admin = this._admin;
    try {
      const R      = admin._resolve(req.params.resource, res);
      if (!R) return;

      const format = req.params.format;
      const search = req.query.search || '';
      const sort   = req.query.sort   || 'id';
      const order  = req.query.order  || 'desc';

      const activeFilters = {};
      if (req.query.filter) {
        for (const [k, v] of Object.entries(req.query.filter)) {
          if (v !== '') activeFilters[k] = v;
        }
      }

      const result = await R.fetchList({
        page: 1, perPage: 100000, search, sort, order, filters: activeFilters,
      });
      const rows = result.data.map(r => r.toJSON ? r.toJSON() : r);

      const fields = R.fields()
        .filter(f => f._type !== 'tab' && !f._hidden)
        .map(f => f.toJSON());

      const filename = `${R.slug}-${new Date().toISOString().slice(0, 10)}`;

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
        return res.json(rows);
      }

      // CSV
      const header  = fields.map(f => `"${f.label}"`).join(',');
      const csvRows = rows.map(row =>
        fields.map(f => {
          const v = row[f.name];
          if (v === null || v === undefined) return '';
          const s = String(typeof v === 'object' ? JSON.stringify(v) : v);
          return `"${s.replace(/"/g, '""')}"`;
        }).join(',')
      );

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send([header, ...csvRows].join('\r\n'));
    } catch (err) {
      admin._error(req, res, err);
    }
  }
}

module.exports = ExportHandler;
