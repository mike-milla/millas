'use strict';

/**
 * PageHandler
 *
 * Serves the single-page docs app shell.
 * All content is loaded client-side via /_api/manifest.
 */
class PageHandler {
  constructor(docs) {
    this._docs = docs;
  }

  index(req, res) {
    const cfg        = this._docs._config;
    const adminPrefix = cfg.adminPrefix || '/admin';
    res.send(_shell(cfg.title, cfg.prefix, adminPrefix));
  }
}

function _shell(title, prefix, adminPrefix) {
  // Bootstrap Icons is served from the admin's local vendor directory —
  // no CDN, no CSP violation. Both admin and docs are framework internals
  // so sharing the vendor path is intentional and safe.
  const biCss = `${adminPrefix}/static/vendor/bi/bootstrap-icons.min.css`;

  // __DOCS_PREFIX__ is passed via a data attribute on #app instead of an
  // inline <script> block — avoids the script-src 'unsafe-inline' CSP error.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="${prefix}/static/docs.css?v=5" />
  <link rel="stylesheet" href="${biCss}" />
</head>
<body>
  <div id="app" data-prefix="${prefix}" data-admin-prefix="${adminPrefix}"></div>
  <!-- ui.js from admin — Portal, Modal, Drawer, Toast, Confirm, Tooltip, Dropdown -->
  <script src="${adminPrefix}/static/ui.js"></script>
  <script src="${prefix}/static/docs.js?v=10"></script>
</body>
</html>`;
}

module.exports = PageHandler;