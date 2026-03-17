'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

/**
 * ErrorRenderer
 *
 * Renders errors as either JSON (API requests) or a rich HTML error page
 * (browser requests in development) inspired by Laravel's Ignition and
 * Django's debug page.
 *
 * In production, browser errors show a clean minimal page with no internals.
 * JSON responses are always clean regardless of environment.
 *
 * Features (dev HTML mode):
 *   - Error type, message, and status code
 *   - Source file with the error line highlighted in context
 *   - Full stack trace with collapsible frames
 *   - Request details (method, URL, headers, body, query)
 *   - Environment info (Node version, env name, app name)
 *   - Skips node_modules frames (collapsed by default)
 */
class ErrorRenderer {

  /**
   * Express error-handler middleware factory.
   * Use instead of the inline error handler in Router.mountFallbacks().
   *
   *   app.use(ErrorRenderer.handler());
   */
  static handler() {
    return function millaErrorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
      ErrorRenderer.render(err, req, res);
    };
  }

  /**
   * 404 handler middleware factory.
   *
   *   app.use(ErrorRenderer.notFound());
   */
  static notFound() {
    return function millaNotFound(req, res) {
      const err = Object.assign(new Error(`Cannot ${req.method} ${req.path}`), {
        status: 404,
        statusCode: 404,
      });
      ErrorRenderer.render(err, req, res);
    };
  }

  /**
   * Render an error to the response — JSON or HTML based on Accept header.
   */
  static render(err, req, res) {
    const status  = err.status || err.statusCode || 500;
    const isDev   = process.env.NODE_ENV !== 'production';
    const wantsHtml = ErrorRenderer._wantsHtml(req);

    res.status(status);

    if (!wantsHtml) {
      // ── JSON response ──────────────────────────────────────────────────────
      const body = {
        error:   status >= 500 ? 'Internal Server Error' : err.message,
        message: err.message,
        status,
        ...(err.errors && { errors: err.errors }),
        ...(isDev && status >= 500 && { stack: err.stack }),
      };
      return res.json(body);
    }

    if (!isDev || status < 500 && !err._forceDebug) {
      // ── Production / 4xx HTML ──────────────────────────────────────────────
      return res.send(ErrorRenderer._renderSimple(status, err.message));
    }

    // ── Development HTML — full debug page ────────────────────────────────────
    res.send(ErrorRenderer._renderDebug(err, req, status));
  }

  // ─── HTML renderers ────────────────────────────────────────────────────────

  static _renderSimple(status, message) {
    const title = ErrorRenderer._statusTitle(status);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${status} ${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f8f9fa;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:48px;max-width:480px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.06)}
    .code{font-size:72px;font-weight:800;color:#111;line-height:1}
    .title{font-size:20px;font-weight:600;color:#374151;margin:12px 0 8px}
    .msg{font-size:14px;color:#6b7280}
  </style>
</head>
<body>
  <div class="card">
    <div class="code">${status}</div>
    <div class="title">${title}</div>
    <div class="msg">${_esc(message)}</div>
  </div>
</body>
</html>`;
  }

  static _renderDebug(err, req, status) {
    const frames  = ErrorRenderer._parseStack(err);
    const appFrames = frames.filter(f => !f.isVendor);
    const firstApp  = appFrames[0] || frames[0];
    const source    = firstApp ? ErrorRenderer._getSourceContext(firstApp.file, firstApp.line, 8) : null;
    const title     = `${err.name || 'Error'}: ${err.message}`;
    const statusTitle = ErrorRenderer._statusTitle(status);

    // Request details
    const reqInfo = {
      method:  req.method,
      url:     req.originalUrl || req.url,
      headers: req.headers,
      query:   req.query,
      body:    req.body,
      ip:      req.ip || req.connection?.remoteAddress,
    };

    // Environment info
    const envInfo = {
      'Node.js':    process.version,
      'Environment': process.env.NODE_ENV || 'development',
      'App':         process.env.APP_NAME || path.basename(process.cwd()),
      'Platform':    `${os.type()} ${os.arch()}`,
      'PID':         process.pid,
      'Uptime':      `${Math.floor(process.uptime())}s`,
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${_esc(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      /* ── Light mode (system default) ── */
      --bg:       #f4f5f7;
      --surface:  #ffffff;
      --surface2: #f0f1f4;
      --surface3: #e8eaef;
      --border:   #dde0e8;
      --text:     #111827;
      --muted:    #6b7280;
      --xmuted:   #9ca3af;
      --red:      #dc2626;
      --orange:   #ea580c;
      --yellow:   #d97706;
      --green:    #16a34a;
      --blue:     #2563eb;
      --purple:   #7c3aed;
      --cyan:     #0891b2;
      --hl-bg:    #fef2f2;
      --hl-border:#fecaca;
      --hl-text:  #b91c1c;

      /* HTTP method tag colors — light */
      --tag-get-bg:    #f0fdf4; --tag-get-fg:    #15803d;
      --tag-post-bg:   #eff6ff; --tag-post-fg:   #1d4ed8;
      --tag-put-bg:    #fff7ed; --tag-put-fg:    #c2410c;
      --tag-patch-bg:  #f5f3ff; --tag-patch-fg:  #6d28d9;
      --tag-delete-bg: #fef2f2; --tag-delete-fg: #b91c1c;

      /* Status badge — light */
      --badge-500-bg:  #fef2f2; --badge-500-fg: #b91c1c; --badge-500-border: #fecaca;
      --badge-4xx-bg:  #fffbeb; --badge-4xx-fg: #b45309; --badge-4xx-border: #fde68a;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg:       #0f0f13;
        --surface:  #18181f;
        --surface2: #1e1e27;
        --surface3: #25252f;
        --border:   #2a2a36;
        --text:     #e2e2ef;
        --muted:    #8b8ba0;
        --xmuted:   #555568;
        --red:      #f87171;
        --orange:   #fb923c;
        --yellow:   #fbbf24;
        --green:    #4ade80;
        --blue:     #60a5fa;
        --purple:   #a78bfa;
        --cyan:     #22d3ee;
        --hl-bg:    #2d1f1f;
        --hl-border:#7f1d1d;
        --hl-text:  #fca5a5;

        --tag-get-bg:    #052e16; --tag-get-fg:    #4ade80;
        --tag-post-bg:   #172554; --tag-post-fg:   #60a5fa;
        --tag-put-bg:    #1c1917; --tag-put-fg:    #fb923c;
        --tag-patch-bg:  #2e1065; --tag-patch-fg:  #a78bfa;
        --tag-delete-bg: #450a0a; --tag-delete-fg: #f87171;

        --badge-500-bg:  #450a0a; --badge-500-fg: #fca5a5; --badge-500-border: #991b1b;
        --badge-4xx-bg:  #451a03; --badge-4xx-fg: #fde68a; --badge-4xx-border: #92400e;
      }
    }

    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
      line-height: 1.5;
      min-height: 100vh;
    }

    /* ── Header ── */
    .header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 20px 28px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }
    .status-badge {
      flex-shrink: 0;
      background: var(--badge-500-bg);
      color: var(--badge-500-fg);
      border: 1px solid var(--badge-500-border);
      border-radius: 8px;
      padding: 6px 14px;
      font-size: 18px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
    .status-4xx .status-badge {
      background: var(--badge-4xx-bg);
      color:      var(--badge-4xx-fg);
      border-color: var(--badge-4xx-border);
    }
    .header-body { flex: 1; min-width: 0; }
    .error-type  { font-size: 12px; font-weight: 600; color: var(--red); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
    .error-msg   { font-size: 20px; font-weight: 700; color: var(--text); word-break: break-word; line-height: 1.3; }
    .error-file  { font-size: 12px; color: var(--muted); margin-top: 6px; font-family: 'Cascadia Code', 'Fira Code', monospace; }

    /* ── Layout ── */
    .layout {
      display: grid;
      grid-template-columns: 1fr 300px;
      gap: 0;
      min-height: calc(100vh - 80px);
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
    }
    .main   { border-right: 1px solid var(--border); overflow: hidden; }
    .aside  { background: var(--surface); }

    /* ── Section ── */
    .section { border-bottom: 1px solid var(--border); }
    .section-header {
      padding: 14px 20px;
      background: var(--surface2);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .8px;
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }
    .section-header:hover { background: var(--surface3); }
    .section-header .toggle { margin-left: auto; color: var(--xmuted); font-size: 10px; transition: transform .2s; }
    .section-header.collapsed .toggle { transform: rotate(-90deg); }
    .section-body { }
    .section-body.hidden { display: none; }

    /* ── Source viewer ── */
    .source {
      font-family: 'Cascadia Code', 'Fira Code', 'SF Mono', 'Consolas', monospace;
      font-size: 13px;
      line-height: 1.6;
      overflow-x: auto;
    }
    .source-line {
      display: flex;
      align-items: stretch;
      min-height: 22px;
    }
    .source-line.hl {
      background: var(--hl-bg);
      border-left: 3px solid var(--red);
    }
    .source-line:not(.hl) { border-left: 3px solid transparent; }
    .line-no {
      flex-shrink: 0;
      width: 52px;
      text-align: right;
      padding: 0 12px;
      color: var(--xmuted);
      font-size: 12px;
      user-select: none;
    }
    .source-line.hl .line-no { color: var(--red); }
    .line-code {
      flex: 1;
      padding: 0 16px 0 8px;
      white-space: pre;
      color: var(--text);
      word-break: break-all;
    }
    .source-line.hl .line-code { color: var(--hl-text); }

    /* ── Stack trace ── */
    .frame {
      padding: 10px 20px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      transition: background .1s;
    }
    .frame:hover { background: var(--surface2); }
    .frame.vendor { opacity: .45; }
    .frame.active { background: var(--surface2); border-left: 3px solid var(--blue); }
    .frame-fn   { font-family: monospace; font-size: 13px; color: var(--blue); font-weight: 600; }
    .frame-file { font-size: 12px; color: var(--muted); margin-top: 2px; font-family: monospace; }
    .frame-file span { color: var(--text); }
    .vendor-group {
      padding: 8px 20px;
      font-size: 11px;
      color: var(--xmuted);
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .vendor-group:hover { color: var(--muted); }

    /* ── Request / env panels ── */
    .info-table { width: 100%; border-collapse: collapse; }
    .info-table td {
      padding: 8px 16px;
      font-size: 12.5px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    .info-table td:first-child {
      color: var(--muted);
      font-weight: 600;
      white-space: nowrap;
      width: 38%;
      font-family: monospace;
    }
    .info-table td:last-child { color: var(--text); word-break: break-all; }
    .tag {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 99px;
      font-size: 11px;
      font-weight: 700;
      font-family: monospace;
    }
    .tag-get    { background: var(--tag-get-bg);    color: var(--tag-get-fg); }
    .tag-post   { background: var(--tag-post-bg);   color: var(--tag-post-fg); }
    .tag-put    { background: var(--tag-put-bg);    color: var(--tag-put-fg); }
    .tag-patch  { background: var(--tag-patch-bg);  color: var(--tag-patch-fg); }
    .tag-delete { background: var(--tag-delete-bg); color: var(--tag-delete-fg); }
    pre.json-val {
      background: var(--surface3);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 12px;
      font-family: monospace;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--cyan);
      max-height: 200px;
      overflow-y: auto;
    }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  </style>
</head>
<body>

<!-- Header -->
<div class="header${status < 500 ? ' status-4xx' : ''}">
  <div class="status-badge">${status}</div>
  <div class="header-body">
    <div class="error-type">${_esc(err.name || 'Error')} &nbsp;·&nbsp; ${_esc(statusTitle)}</div>
    <div class="error-msg">${_esc(err.message)}</div>
    ${firstApp ? `<div class="error-file">${_esc(ErrorRenderer._shortPath(firstApp.file))} : ${firstApp.line}</div>` : ''}
  </div>
</div>

<div class="layout">

  <!-- ── Main column ── -->
  <div class="main">

    ${source ? `
    <!-- Source viewer -->
    <div class="section">
      <div class="section-header" onclick="toggle(this)">
        <span>Source</span>
        <span style="color:var(--muted);font-size:11px;font-weight:400;font-family:monospace">${_esc(ErrorRenderer._shortPath(firstApp.file))}</span>
        <span class="toggle">▾</span>
      </div>
      <div class="section-body source">
        ${source.map(l => `<div class="source-line${l.highlight ? ' hl' : ''}">
          <span class="line-no">${l.no}</span>
          <span class="line-code">${_esc(l.text)}</span>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- Stack trace -->
    <div class="section">
      <div class="section-header" onclick="toggle(this)">
        <span>Stack Trace</span>
        <span style="color:var(--muted);font-size:11px;font-weight:400">${frames.length} frames</span>
        <span class="toggle">▾</span>
      </div>
      <div class="section-body" id="stack-body">
        ${ErrorRenderer._renderFrames(frames)}
      </div>
    </div>

    <!-- Request -->
    <div class="section">
      <div class="section-header" onclick="toggle(this)">
        <span>Request</span>
        <span class="tag tag-${reqInfo.method.toLowerCase()}">${reqInfo.method}</span>
        <span style="color:var(--muted);font-size:11px;font-weight:400;font-family:monospace">${_esc(reqInfo.url)}</span>
        <span class="toggle">▾</span>
      </div>
      <div class="section-body">
        <table class="info-table">
          <tr><td>URL</td><td style="font-family:monospace">${_esc(reqInfo.url)}</td></tr>
          <tr><td>IP</td><td>${_esc(reqInfo.ip || '—')}</td></tr>
          ${reqInfo.query && Object.keys(reqInfo.query).length ? `<tr><td>Query</td><td><pre class="json-val">${_esc(JSON.stringify(reqInfo.query, null, 2))}</pre></td></tr>` : ''}
          ${reqInfo.body && Object.keys(reqInfo.body || {}).length ? `<tr><td>Body</td><td><pre class="json-val">${_esc(JSON.stringify(reqInfo.body, null, 2))}</pre></td></tr>` : ''}
        </table>
        <details style="padding:0">
          <summary style="padding:8px 16px;font-size:11px;color:var(--xmuted);cursor:pointer;list-style:none">Show all headers ▾</summary>
          <table class="info-table">
            ${Object.entries(reqInfo.headers).map(([k, v]) =>
              `<tr><td>${_esc(k)}</td><td style="font-family:monospace;font-size:11px">${_esc(String(v))}</td></tr>`
            ).join('')}
          </table>
        </details>
      </div>
    </div>

    ${err.errors ? `
    <!-- Validation errors -->
    <div class="section">
      <div class="section-header" onclick="toggle(this)">
        <span>Validation Errors</span>
        <span class="toggle">▾</span>
      </div>
      <div class="section-body">
        <pre class="json-val" style="margin:12px 16px">${_esc(JSON.stringify(err.errors, null, 2))}</pre>
      </div>
    </div>` : ''}

  </div>

  <!-- ── Aside ── -->
  <div class="aside">

    <!-- Env info -->
    <div class="section">
      <div class="section-header" style="cursor:default">
        <span>Environment</span>
      </div>
      <div class="section-body">
        <table class="info-table">
          ${Object.entries(envInfo).map(([k, v]) =>
            `<tr><td>${_esc(k)}</td><td>${_esc(String(v))}</td></tr>`
          ).join('')}
        </table>
      </div>
    </div>

    <!-- All frames as mini list in aside -->
    <div class="section">
      <div class="section-header" style="cursor:default">
        <span>App Frames</span>
      </div>
      <div class="section-body">
        ${frames.filter(f => !f.isVendor).map((f, i) => `
        <div class="frame${i === 0 ? ' active' : ''}" style="padding:8px 16px" onclick="jumpToFrame(${frames.indexOf(f)})">
          <div class="frame-fn">${_esc(f.fn)}</div>
          <div class="frame-file" style="font-size:11px">${_esc(ErrorRenderer._shortPath(f.file))} <span>:${f.line}</span></div>
        </div>`).join('')}
      </div>
    </div>

    <!-- Millas watermark -->
    <div style="padding:16px;text-align:center;color:var(--xmuted);font-size:11px;border-top:1px solid var(--border);margin-top:auto">
      Millas Framework &nbsp;·&nbsp; Dev Error Page
    </div>

  </div>
</div>

<script>
  function toggle(header) {
    const body = header.nextElementSibling;
    header.classList.toggle('collapsed');
    body.classList.toggle('hidden');
  }

  function jumpToFrame(idx) {
    const frames = document.querySelectorAll('#stack-body .frame');
    frames.forEach((f, i) => f.classList.toggle('active', i === idx));
  }
</script>
</body>
</html>`;
  }

  // ─── Stack trace helpers ───────────────────────────────────────────────────

  static _parseStack(err) {
    const lines = (err.stack || '').split('\n').slice(1);
    return lines.map(line => {
      const m1 = line.match(/^\s+at (.+?) \((.+?):(\d+):(\d+)\)$/);
      const m2 = line.match(/^\s+at (.+?):(\d+):(\d+)$/);
      if (m1) return { fn: m1[1], file: m1[2], line: +m1[3], col: +m1[4], isVendor: _isVendor(m1[2]) };
      if (m2) return { fn: '<anonymous>', file: m2[1], line: +m2[2], col: +m2[3], isVendor: _isVendor(m2[1]) };
      return null;
    }).filter(Boolean);
  }

  static _getSourceContext(file, lineNo, context = 7) {
    try {
      if (!file || file.startsWith('node:') || !fs.existsSync(file)) return null;
      const src   = fs.readFileSync(file, 'utf8').split('\n');
      const start = Math.max(0, lineNo - context - 1);
      const end   = Math.min(src.length, lineNo + context);
      return src.slice(start, end).map((text, i) => ({
        no:        start + i + 1,
        text:      text.replace(/\t/g, '  '),
        highlight: (start + i + 1) === lineNo,
      }));
    } catch { return null; }
  }

  static _renderFrames(frames) {
    let html = '';
    let vendorCount = 0;
    let vendorBuf   = [];

    const flush = () => {
      if (vendorBuf.length) {
        html += `<div class="vendor-group" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
          ▸ ${vendorBuf.length} vendor frame${vendorBuf.length > 1 ? 's' : ''} (node_modules / internals)
        </div>
        <div style="display:none">${vendorBuf.join('')}</div>`;
        vendorBuf = [];
      }
    };

    frames.forEach((f, i) => {
      const frameHtml = `<div class="frame${i === 0 ? ' active' : ''}${f.isVendor ? ' vendor' : ''}" onclick="jumpToFrame(${i})">
        <div class="frame-fn">${_esc(f.fn)}</div>
        <div class="frame-file">${_esc(ErrorRenderer._shortPath(f.file))} <span>:${f.line}:${f.col}</span></div>
      </div>`;

      if (f.isVendor && i > 0) {
        vendorBuf.push(frameHtml);
      } else {
        flush();
        html += frameHtml;
      }
    });

    flush();
    return html;
  }

  static _shortPath(file) {
    if (!file) return '';
    const cwd = process.cwd();
    if (file.startsWith(cwd)) return file.slice(cwd.length + 1);
    return file.replace(/.*node_modules/, '…/node_modules');
  }

  static _statusTitle(status) {
    const titles = {
      400: 'Bad Request',        401: 'Unauthorized',
      403: 'Forbidden',          404: 'Not Found',
      405: 'Method Not Allowed', 408: 'Request Timeout',
      409: 'Conflict',           410: 'Gone',
      413: 'Payload Too Large',  422: 'Unprocessable Entity',
      429: 'Too Many Requests',  500: 'Internal Server Error',
      501: 'Not Implemented',    502: 'Bad Gateway',
      503: 'Service Unavailable',504: 'Gateway Timeout',
    };
    return titles[status] || 'Error';
  }

  static _wantsHtml(req) {
    const accept = req.headers?.accept || '';
    return accept.includes('text/html') && !accept.startsWith('application/json');
  }
}

// ── Private helpers ────────────────────────────────────────────────────────────

function _isVendor(file) {
  return !file || file.startsWith('node:') || file.includes('node_modules') || file.includes('<');
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = ErrorRenderer;
