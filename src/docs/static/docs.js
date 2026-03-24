/* ─────────────────────────────────────────────────────────────────────────────
 * Millas API Docs — Single-file client app
 * No build step. Vanilla JS, no dependencies.
 * ─────────────────────────────────────────────────────────────────────────── */

'use strict';

// Read prefix + admin prefix from data attributes — avoids inline script CSP violation
const _appEl       = document.getElementById('app') || {};
const PREFIX       = _appEl.dataset?.prefix      || '/docs';
const ADMIN_PREFIX = _appEl.dataset?.adminPrefix  || '/admin';

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  manifest:    null,
  activeEp:    null,   // { groupIdx, epIdx }
  loading:     false,
  response:    null,   // last "Try it" response
  trying:      false,
  search:      '',
  env: {
    baseUrl: localStorage.getItem('docs_baseUrl') || window.location.origin,
    token:   localStorage.getItem('docs_token')   || '',
  },
  environments: JSON.parse(localStorage.getItem('docs_envs') || 'null') || [
    { name: 'Local',      baseUrl: window.location.origin,           token: '' },
    { name: 'Staging',    baseUrl: 'https://staging.example.com',    token: '' },
    { name: 'Production', baseUrl: 'https://api.example.com',        token: '' },
  ],
  activeEnvIdx: parseInt(localStorage.getItem('docs_activeEnv') || '0'),
  _envModal: null,   // UI.Modal instance — managed by UI, not state
  fieldValues: {},    // { fieldKey: value }  — persisted per endpoint
  activeTab:   'curl',
  bodyMode:    'form',   // 'form' | 'raw'
  history:     [],       // last 20 requests globally
  showHistory: false,
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  // Load from active environment on startup
  _syncEnvFromActive();
  render();
  try {
    const r = await fetch(`${PREFIX}/_api/manifest`);
    const j = await r.json();
    if (!j.ok || !j.data) {
      const msg = j.error || 'Server returned an error';
      document.getElementById('app').innerHTML =
        `<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>Failed to load manifest: ${msg}</p></div>`;
      return;
    }
    state.manifest = j.data;
    // Auto-open all groups
    state.openGroups = new Set(state.manifest.groups.map((_, i) => i));
    render();
  } catch (err) {
    document.getElementById('app').innerHTML =
      `<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>Failed to load manifest: ${err.message}</p></div>`;
  }
}

function _syncEnvFromActive() {
  const env = state.environments[state.activeEnvIdx];
  if (env) {
    state.env.baseUrl = env.baseUrl;
    state.env.token   = env.token;
  }
}

function _saveEnvs() {
  localStorage.setItem('docs_envs',       JSON.stringify(state.environments));
  localStorage.setItem('docs_activeEnv',  String(state.activeEnvIdx));
  localStorage.setItem('docs_baseUrl',    state.env.baseUrl);
  localStorage.setItem('docs_token',      state.env.token);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function render() {
  const app = document.getElementById('app');
  if (!app) return;

  const m = state.manifest;
  const title = m ? m.title : 'API Docs';

  app.innerHTML = `
    <aside class="sidebar">
      ${renderSidebar(m, title)}
    </aside>
    <div class="main">
      ${renderEnvBar()}
      <div class="detail">
        ${renderDetail()}
      </div>
    </div>
  `;

  bindEvents();
}

function renderSidebar(m, title) {
  if (!m) {
    return `
      <div class="sidebar-header">
        <div class="sidebar-logo"><i class="bi bi-code-slash"></i></div>
        <h1>${title}</h1>
      </div>
      <div class="empty-state" style="padding:32px;text-align:center;">
        <div class="spinner"></div>
        <p style="margin-top:12px;color:var(--text-3)">Loading…</p>
      </div>`;
  }

  const groups = filterGroups(m.groups, state.search);

  let groupHtml = '';
  groups.forEach((group, gi) => {
    const isOpen = !state.openGroups || state.openGroups.has(gi);
    const eps    = group.endpoints.map((ep, ei) => {
      const isActive = state.activeEp &&
                       state.activeEp.group === group.slug &&
                       state.activeEp.ep === ep.path + ep.verb;
      return `
        <div class="sidebar-ep ${isActive ? 'active' : ''}"
             data-group="${group.slug}" data-ep="${ep.path}|${ep.verb}">
          <div class="sidebar-ep-left">
            <span class="verb-badge verb-${ep.verb.toUpperCase()}">${ep.verb.toUpperCase()}</span>
          </div>
          <div class="sidebar-ep-info">
            <div class="ep-name">
              ${ep.label}
              ${ep.auth ? '<i class="bi bi-lock-fill" style="color:var(--purple);font-size:9px;margin-left:3px;"></i>' : ''}
            </div>
            <div class="ep-path-hint">${_esc(ep.shortPath || ep.path)}</div>
          </div>
        </div>`;
    }).join('');

    groupHtml += `
      <div class="sidebar-group ${isOpen ? 'open' : ''}" data-group-idx="${gi}">
        <div class="sidebar-group-header" data-toggle="${gi}">
          <i class="bi bi-${group.icon || 'code-slash'}"></i>
          <span>${group.label}</span>
          <span class="group-count-badge">${group.endpoints.length}</span>
          <i class="bi bi-chevron-right sidebar-group-chevron"></i>
        </div>
        <div class="sidebar-group-endpoints">${eps}</div>
      </div>`;
  });

  return `
    <div class="sidebar-header">
      <div class="sidebar-logo"><i class="bi bi-braces"></i></div>
      <h1>${title}</h1>
    </div>
    <div class="sidebar-search">
      <input type="text" placeholder="Search endpoints…" id="search-input" value="${_esc(state.search)}" />
    </div>
    <div class="sidebar-scroll">${groupHtml || '<div style="padding:20px;color:var(--text-3);text-align:center;">No results</div>'}</div>
    <div class="sidebar-footer">
      ${countEndpoints(m)} endpoints &nbsp;·&nbsp; ${m.groups.length} groups
    </div>`;
}

function renderEnvBar() {
  const activeEnv = state.environments[state.activeEnvIdx] || {};
  const envOptions = state.environments.map((e, i) =>
    `<option value="${i}" ${i === state.activeEnvIdx ? 'selected' : ''}>${_esc(e.name)}</option>`
  ).join('');

  return `
    <div class="env-bar">
      <label>Env</label>
      <select class="env-select" id="env-select">${envOptions}</select>
      <button class="btn btn-ghost btn-sm" id="env-manage-btn" title="Manage environments">
        <i class="bi bi-pencil"></i>
      </button>
      <label style="margin-left:4px;">URL</label>
      <input type="text" class="base-url-input" id="env-baseUrl"
             value="${_esc(state.env.baseUrl)}" placeholder="http://localhost:3000" />
      <label>Token</label>
      <input type="text" class="token-input" id="env-token"
             value="${_esc(state.env.token)}" placeholder="eyJ..." />
      <div class="export-btn">
        <button class="btn btn-ghost btn-sm" id="export-postman">
          <i class="bi bi-box-arrow-down"></i> Postman
        </button>
        <button class="btn btn-ghost btn-sm" id="export-openapi">
          <i class="bi bi-filetype-json"></i> OpenAPI
        </button>
      </div>
    </div>
`;  // env modal is opened via UI.Modal — not rendered inline
}

function _openEnvModal() {
  // Build modal body as a live DOM element so inputs work without re-renders
  const body = document.createElement('div');

  function _rebuildRows() {
    body.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'field-table';
    table.style.marginBottom = '12px';
    table.innerHTML = '<thead><tr><th>Name</th><th>Base URL</th><th>Token</th><th></th></tr></thead>';
    const tbody = document.createElement('tbody');

    state.environments.forEach((e, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input class="field-input" data-idx="${i}" data-field="name"
                   value="${_esc(e.name)}" placeholder="Environment name" /></td>
        <td><input class="field-input" data-idx="${i}" data-field="baseUrl"
                   value="${_esc(e.baseUrl)}" placeholder="https://..." /></td>
        <td><input class="field-input" data-idx="${i}" data-field="token"
                   value="${_esc(e.token)}" placeholder="eyJ..." /></td>
        <td>
          <button class="btn btn-ghost btn-sm env-del-btn" data-idx="${i}"
                  ${state.environments.length <= 1 ? 'disabled' : ''}>
            <i class="bi bi-trash"></i>
          </button>
        </td>`;
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    body.appendChild(table);

    // Add env button
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-sm';
    addBtn.innerHTML = '<i class="bi bi-plus"></i> Add environment';
    addBtn.addEventListener('click', () => {
      state.environments.push({ name: `Env ${state.environments.length + 1}`, baseUrl: '', token: '' });
      _saveEnvs();
      _rebuildRows();
    });
    body.appendChild(addBtn);

    // Wire input events
    body.querySelectorAll('[data-idx]').forEach(inp => {
      inp.addEventListener('input', e => {
        const idx   = parseInt(e.target.dataset.idx);
        const field = e.target.dataset.field;
        if (!field) return;
        state.environments[idx][field] = e.target.value;
        if (idx === state.activeEnvIdx) {
          state.env.baseUrl = state.environments[idx].baseUrl;
          state.env.token   = state.environments[idx].token;
          const urlBar = document.getElementById('env-baseUrl');
          const tokBar = document.getElementById('env-token');
          if (urlBar) urlBar.value = state.env.baseUrl;
          if (tokBar) tokBar.value = state.env.token;
        }
        _saveEnvs();
      });
    });

    // Wire delete buttons
    body.querySelectorAll('.env-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        state.environments.splice(idx, 1);
        if (state.activeEnvIdx >= state.environments.length) state.activeEnvIdx = 0;
        _syncEnvFromActive();
        _saveEnvs();
        _rebuildRows();
        // Refresh env select in the bar
        const sel = document.getElementById('env-select');
        if (sel) {
          while (sel.options.length) sel.remove(0);
          state.environments.forEach((e, i) => {
            const opt = new Option(e.name, i, false, i === state.activeEnvIdx);
            sel.add(opt);
          });
        }
      });
    });
  }

  _rebuildRows();

  // Use UI.Modal — Portal rendering, FocusTrap, ScrollLock, Escape handling
  const m = UI.Modal.create({
    title:   'Manage Environments',
    content: body,
    size:    'lg',
    onClose: () => { state._envModal = null; },
  });

  state._envModal = m;
  m.open();
}

function renderDetail() {
  if (!state.manifest) {
    return `<div class="empty-state"><div class="spinner"></div></div>`;
  }

  if (!state.activeEp) {
    const total = countEndpoints(state.manifest);
    const groups = state.manifest.groups.length;
    return `
      <div class="empty-state">
        <i class="bi bi-braces" style="font-size:48px;color:var(--border-2)"></i>
        <p style="font-weight:600;color:var(--text-2);">Select an endpoint to get started</p>
        <p style="font-size:12px;color:var(--text-3);">${total} endpoints &nbsp;·&nbsp; ${groups} groups</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-width:400px;margin-top:8px;">
          ${state.manifest.groups.slice(0,8).map(g =>
            `<span style="font-size:11px;padding:3px 10px;border-radius:20px;background:var(--bg-3);border:1px solid var(--border);color:var(--text-2);">
              <i class="bi bi-${g.icon || 'code-slash'}"></i> ${g.label}
             </span>`
          ).join('')}
        </div>
      </div>`;
  }

  const ep = getActiveEp();
  if (!ep) return `<div class="empty-state"><p>Endpoint not found</p></div>`;

  // Find the group this endpoint belongs to for description
  const epGroup = state.manifest.groups.find(g => g.slug === state.activeEp.group);

  return `
    ${renderEpHeader(ep)}
    ${epGroup?.description && !state.activeEp._descShown ? `
    <div class="section" style="background:var(--accent-bg);border-left:3px solid var(--accent);padding:12px 20px;">
      <span style="font-size:12px;color:var(--text-2);">
        <i class="bi bi-info-circle" style="color:var(--accent);margin-right:6px;"></i>${_esc(epGroup.description)}
      </span>
    </div>` : ''}
    ${renderTryBar(ep)}
    ${renderParams(ep)}
    ${renderQueryParams(ep)}
    ${renderBody(ep)}
    ${renderExpectedResponses(ep)}
    ${state.response ? renderResponse(state.response) : ''}
    ${state.response ? renderCodeSnippets(ep) : ''}
    ${renderHistory()}
  `;
}

function renderEpHeader(ep) {
  const authBadge = ep.auth
    ? `<span class="badge badge-auth"><i class="bi bi-lock-fill"></i> Auth required</span>`
    : `<span class="badge badge-public">Public</span>`;
  const depBadge = ep.deprecated ? `<span class="badge badge-deprecated">Deprecated</span>` : '';
  const autoBadge = ep.autoDiscovered ? `<span class="badge badge-auto">Auto-discovered</span>` : '';

  return `
    <div class="ep-header">
      <div class="ep-header-top">
        <span class="verb-badge verb-${ep.verb.toUpperCase()}">${ep.verb.toUpperCase()}</span>
        <code class="ep-path">${_esc(ep.shortPath || ep.path)}</code>
        ${authBadge}${depBadge}${autoBadge}
      </div>
      <div class="ep-label">${_esc(ep.label)}</div>
      ${ep.description ? `<div class="ep-description">${_esc(ep.description)}</div>` : ''}
    </div>`;
}

function renderTryBar(ep) {
  const url = buildUrl(ep);
  return `
    <div class="try-bar">
      <input type="text" class="try-url" id="try-url" value="${_esc(url)}"
             title="Press Enter to send" />
      <button class="btn btn-ghost btn-sm" id="copy-url-btn" title="Copy URL">
        <i class="bi bi-clipboard"></i>
      </button>
      <button class="btn btn-primary" id="try-btn" ${state.trying ? 'disabled' : ''}>
        ${state.trying
          ? '<span class="spinner"></span> Sending…'
          : '<i class="bi bi-play-fill"></i> Send'}
      </button>
    </div>`;
}

function renderParams(ep) {
  const allParams = [...(ep.pathParams || [])];
  if (!allParams.length) return '';

  const rows = allParams.map(name => {
    const def = ep.params?.[name] || {};
    const key = `param:${name}`;
    const val = state.fieldValues[key] !== undefined ? state.fieldValues[key] : (def.example ?? '');
    return `
      <tr>
        <td><span class="field-name">${name}</span></td>
        <td><span class="field-type">string</span></td>
        <td><span class="field-required">required</span></td>
        <td>
          <input class="field-input" data-key="${key}" value="${_esc(String(val))}"
                 placeholder="${_esc(String(def.example ?? ''))}" />
          ${def.description ? `<div class="field-desc">${_esc(def.description)}</div>` : ''}
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="section">
      <div class="section-title"><i class="bi bi-link-45deg"></i> Path Parameters</div>
      <table class="field-table">
        <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderQueryParams(ep) {
  const q = ep.query || {};
  if (!Object.keys(q).length) return '';

  const rows = Object.entries(q).map(([name, def]) => {
    const key = `query:${name}`;
    const val = state.fieldValues[key] !== undefined ? state.fieldValues[key] : (def.example ?? '');
    return `
      <tr>
        <td><span class="field-name">${name}</span></td>
        <td><span class="field-type">${def.type || 'string'}</span></td>
        <td>${def.required ? '<span class="field-required">required</span>' : '<span style="color:var(--text-3);font-size:11px">optional</span>'}</td>
        <td>
          <input class="field-input" data-key="${key}" value="${_esc(String(val))}"
                 placeholder="${_esc(String(def.example ?? ''))}" />
          ${def.description ? `<div class="field-desc">${_esc(def.description)}</div>` : ''}
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="section">
      <div class="section-title"><i class="bi bi-question-circle"></i> Query Parameters</div>
      <table class="field-table">
        <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderBody(ep) {
  const body = ep.body || {};
  if (!Object.keys(body).length || ep.verb === 'get') return '';

  const isRaw  = state.bodyMode === 'raw';
  const rawKey = `raw:${ep.verb}:${ep.path}`;

  // Build raw JSON from current field values for initial raw content
  const currentObj = {};
  for (const [name, def] of Object.entries(body)) {
    const k   = `body:${name}`;
    const val = state.fieldValues[k] !== undefined ? state.fieldValues[k] : (def.example ?? '');
    if (val !== '' && val !== undefined) currentObj[name] = val;
  }
  const rawVal = state.fieldValues[rawKey] !== undefined
    ? state.fieldValues[rawKey]
    : JSON.stringify(currentObj, null, 2);

  const rows = Object.entries(body).map(([name, def]) => {
    const key = `body:${name}`;
    const val = state.fieldValues[key] !== undefined ? state.fieldValues[key] : (def.example ?? '');
    const input = renderFieldInput(key, def, val);
    return `
      <tr>
        <td><span class="field-name">${name}</span></td>
        <td><span class="field-type">${def.type || 'string'}</span></td>
        <td>${def.required ? '<span class="field-required">required</span>' : '<span style="color:var(--text-3);font-size:11px">optional</span>'}</td>
        <td>
          ${input}
          ${def.description ? `<div class="field-desc">${_esc(def.description)}</div>` : ''}
          ${def.enum ? `<div class="field-desc">Options: ${def.enum.map(e => typeof e === 'object' ? e.value : e).join(', ')}</div>` : ''}
        </td>
      </tr>`;
  }).join('');

  const isMultipart = ep.bodyEncoding === 'multipart';

  return `
    <div class="section">
      <div class="section-title" style="justify-content:space-between;">
        <span><i class="bi bi-body-text"></i> Request Body
          <span style="margin-left:6px;font-size:10px;color:var(--text-3)">${ep.bodyEncoding || 'json'}</span>
        </span>
        <div class="body-mode-toggle">
          <button class="mode-btn ${!isRaw ? 'active' : ''}" data-mode="form">Form</button>
          <button class="mode-btn ${isRaw  ? 'active' : ''}" data-mode="raw">Raw JSON</button>
        </div>
      </div>
      ${isRaw ? `
        <textarea class="field-input raw-body-input" id="raw-body-input" data-key="${rawKey}"
                  rows="10" style="width:100%;resize:vertical;font-family:var(--mono);font-size:12px;"
                  placeholder='{"key": "value"}'>${_esc(rawVal)}</textarea>` : `
        <table class="field-table">
          <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`}
      ${isMultipart ? `
        <div style="margin-top:8px;padding:8px 10px;background:rgba(154,103,0,.06);border:1px solid rgba(154,103,0,.2);border-radius:var(--radius);font-size:11px;color:var(--orange);">
          <i class="bi bi-info-circle"></i>
          This endpoint accepts file uploads. The "Try it" panel sends non-file fields only.
          Use a tool like Postman or curl for full multipart upload testing.
        </div>` : ''}
    </div>`;
}

function renderFieldInput(key, def, val) {
  if (def.type === 'boolean') {
    return `<input type="checkbox" class="field-input boolean-input" data-key="${key}" data-type="boolean"
                   ${val === true || val === 'true' ? 'checked' : ''} />`;
  }
  if (def.type === 'select' && def.enum) {
    const opts = def.enum.map(e => {
      const v = typeof e === 'object' ? e.value : e;
      const l = typeof e === 'object' ? e.label : e;
      return `<option value="${_esc(v)}" ${val == v ? 'selected' : ''}>${_esc(l)}</option>`;
    }).join('');
    return `<select class="field-input" data-key="${key}"><option value="">— select —</option>${opts}</select>`;
  }
  if (def.type === 'array') {
    const textVal = Array.isArray(val) ? JSON.stringify(val) : String(val ?? '');
    return `
      <input class="field-input" data-key="${key}" data-type="array"
             value="${_esc(textVal)}" placeholder='[1, 2, 3] or ["a", "b"]' />
      <div class="field-desc">Enter a JSON array</div>`;
  }
  if (def.type === 'json') {
    const textVal = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? '');
    return `<textarea class="field-input" data-key="${key}" rows="3" style="resize:vertical">${_esc(textVal)}</textarea>`;
  }
  const inputType = def.type === 'email' ? 'email'
                  : def.type === 'password' ? 'password'
                  : def.type === 'number' || def.type === 'integer' ? 'number'
                  : 'text';
  return `<input type="${inputType}" class="field-input" data-key="${key}"
                 value="${_esc(String(val ?? ''))}" placeholder="${_esc(String(def.example ?? ''))}" />`;
}

function renderExpectedResponses(ep) {
  const resps = ep.responses || [];
  if (!resps.length) return '';

  const items = resps.map(r => `
    <div class="response-doc">
      <span class="status-badge ${_statusClass(r.status)}">${r.status}</span>
      <div>
        ${r.description ? `<div style="font-size:12px;color:var(--text-2)">${_esc(r.description)}</div>` : ''}
        ${r.example ? `<pre class="code-block" style="margin-top:6px;max-height:120px">${_esc(JSON.stringify(r.example, null, 2))}</pre>` : ''}
      </div>
    </div>`).join('');

  return `
    <div class="section">
      <div class="section-title"><i class="bi bi-card-list"></i> Expected Responses</div>
      ${items}
    </div>`;
}

function renderResponse(r) {
  // ── 204 No Content and other empty bodies ──────────────────────────────
  const isEmpty = r.status === 204 || r.body === '' || r.body === null || r.body === undefined;
  const bodyStr = isEmpty
    ? null
    : (typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2));

  // ── Response headers ───────────────────────────────────────────────────
  const importantHeaders = ['content-type', 'x-request-id', 'x-ratelimit-limit',
    'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after', 'location',
    'cache-control', 'etag', 'last-modified', 'authorization', 'www-authenticate'];
  const headers = r.headers || {};
  const headerRows = Object.entries(headers)
    .filter(([k]) => importantHeaders.includes(k.toLowerCase()) || k.toLowerCase().startsWith('x-'))
    .map(([k, v]) => `
      <tr>
        <td style="font-family:var(--mono);font-size:11px;color:var(--accent);white-space:nowrap;padding:4px 8px;">${_esc(k)}</td>
        <td style="font-family:var(--mono);font-size:11px;color:var(--text-2);padding:4px 8px;word-break:break-all;">${_esc(String(v))}</td>
      </tr>`).join('');

  const headersSection = headerRows ? `
    <div style="margin-top:12px;">
      <div class="section-title" style="margin-bottom:6px;"><i class="bi bi-list-ul"></i> Response Headers</div>
      <table class="field-table" style="font-size:11px;">
        <thead><tr><th>Header</th><th>Value</th></tr></thead>
        <tbody>${headerRows}</tbody>
      </table>
    </div>` : '';

  // ── Body ───────────────────────────────────────────────────────────────
  const bodySection = isEmpty
    ? `<div style="padding:16px;text-align:center;color:var(--text-3);font-size:12px;background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius);">
        <i class="bi bi-check-circle" style="color:var(--green);font-size:18px;display:block;margin-bottom:6px;"></i>
        ${r.status} ${_statusText(r.status)} — no response body
       </div>`
    : `<pre class="code-block" id="response-body">${_syntaxHighlight(bodyStr)}</pre>`;

  return `
    <div class="response-section section" style="background:var(--bg-2);border-top:1px solid var(--border)">
      <div class="section-title"><i class="bi bi-arrow-return-left"></i> Response</div>
      <div class="response-meta">
        <span class="status-badge ${_statusClass(r.status)}">${r.status} ${_statusText(r.status)}</span>
        <span class="response-time"><i class="bi bi-clock"></i> ${r.time}ms</span>
        ${!isEmpty ? `
        <button class="btn btn-ghost btn-sm" id="copy-response">
          <i class="bi bi-clipboard"></i> Copy
        </button>
        <button class="btn btn-ghost btn-sm" id="clear-response">
          <i class="bi bi-x"></i> Clear
        </button>` : `
        <button class="btn btn-ghost btn-sm" id="clear-response">
          <i class="bi bi-x"></i> Clear
        </button>`}
      </div>
      ${bodySection}
      ${headersSection}
    </div>`;
}

function renderHistory() {
  if (!state.history.length) return '';

  const rows = state.history.map((h, i) => `
    <tr class="history-row" data-idx="${i}" style="cursor:pointer;">
      <td><span class="verb-badge verb-${h.verb.toUpperCase()}" style="font-size:9px;">${h.verb.toUpperCase()}</span></td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text-2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(h.label)}</td>
      <td><span class="status-badge ${_statusClass(h.status)}" style="font-size:10px;">${h.status}</span></td>
      <td style="font-size:11px;color:var(--text-3);">${h.time}ms</td>
      <td style="font-size:11px;color:var(--text-3);">${h.ts}</td>
    </tr>`).join('');

  const expanded = state.showHistory;

  return `
    <div class="section" style="background:var(--bg);">
      <div class="section-title" style="cursor:pointer;justify-content:space-between;" id="toggle-history">
        <span><i class="bi bi-clock-history"></i> Request History
          <span class="group-count-badge" style="margin-left:6px;">${state.history.length}</span>
        </span>
        <i class="bi bi-chevron-${expanded ? 'up' : 'down'}" style="font-size:11px;"></i>
      </div>
      ${expanded ? `
      <table class="field-table">
        <thead><tr><th>Method</th><th>Endpoint</th><th>Status</th><th>Time</th><th>At</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:8px;">
        <button class="btn btn-ghost btn-sm" id="clear-history">
          <i class="bi bi-trash"></i> Clear history
        </button>
      </div>` : ''}
    </div>`;
}

function renderCodeSnippets(ep) {
  const url   = document.getElementById('try-url')?.value || buildUrl(ep);
  const body  = collectBody(ep);
  const token = state.env.token;
  const verb  = ep.verb.toUpperCase();

  const curlLines = [`curl -X ${verb} "${url}"`];
  if (ep.auth && token) curlLines.push(`  -H "Authorization: Bearer ${token}"`);
  curlLines.push(`  -H "Content-Type: application/json"`);
  if (body && verb !== 'GET') curlLines.push(`  -d '${JSON.stringify(body)}'`);
  const curlStr = curlLines.join(' \\\n');

  const fetchHeaders = { 'Content-Type': 'application/json' };
  if (ep.auth && token) fetchHeaders['Authorization'] = `Bearer ${token}`;
  const fetchStr = `fetch("${url}", {
  method: "${verb}",
  headers: ${JSON.stringify(fetchHeaders, null, 2)},${body && verb !== 'GET' ? `\n  body: JSON.stringify(${JSON.stringify(body, null, 2)}),` : ''}
})
  .then(r => r.json())
  .then(console.log);`;

  const axiosStr = `axios.${ep.verb}("${url}"${body && verb !== 'GET' ? `, ${JSON.stringify(body, null, 2)}` : ''}, {
  headers: ${JSON.stringify(fetchHeaders, null, 2)},
}).then(r => console.log(r.data));`;

  const active = state.activeTab;
  return `
    <div class="section">
      <div class="section-title"><i class="bi bi-code"></i> Code</div>
      <div class="tabs">
        <button class="tab-btn ${active==='curl'?'active':''}"   data-tab="curl">curl</button>
        <button class="tab-btn ${active==='fetch'?'active':''}"  data-tab="fetch">fetch</button>
        <button class="tab-btn ${active==='axios'?'active':''}"  data-tab="axios">axios</button>
      </div>
      <div class="tab-panel ${active==='curl' ?'active':''}" data-panel="curl">
        <pre class="code-block">${_esc(curlStr)}</pre>
      </div>
      <div class="tab-panel ${active==='fetch'?'active':''}" data-panel="fetch">
        <pre class="code-block">${_esc(fetchStr)}</pre>
      </div>
      <div class="tab-panel ${active==='axios'?'active':''}" data-panel="axios">
        <pre class="code-block">${_esc(axiosStr)}</pre>
      </div>
    </div>`;
}

// ── Events ─────────────────────────────────────────────────────────────────────

function bindEvents() {
  // Search
  const search = document.getElementById('search-input');
  if (search) {
    search.addEventListener('input', e => { state.search = e.target.value; render(); });
  }

  // Env bar
  // Environment selector
  const envSelect = document.getElementById('env-select');
  if (envSelect) {
    envSelect.addEventListener('change', e => {
      state.activeEnvIdx = parseInt(e.target.value);
      _syncEnvFromActive();
      _saveEnvs();
      render();
    });
  }

  const envManageBtn = document.getElementById('env-manage-btn');
  if (envManageBtn) {
    envManageBtn.addEventListener('click', () => {
      // Open environment manager using the shared UI.Modal from admin
      if (state._envModal) { state._envModal.close(); return; }
      _openEnvModal();
    });
  }

  const baseUrl = document.getElementById('env-baseUrl');
  if (baseUrl) {
    baseUrl.addEventListener('change', e => {
      state.env.baseUrl = e.target.value;
      if (state.environments[state.activeEnvIdx]) {
        state.environments[state.activeEnvIdx].baseUrl = e.target.value;
      }
      _saveEnvs();
      renderDetailOnly();
    });
  }

  const tokenInput = document.getElementById('env-token');
  if (tokenInput) {
    tokenInput.addEventListener('change', e => {
      state.env.token = e.target.value;
      if (state.environments[state.activeEnvIdx]) {
        state.environments[state.activeEnvIdx].token = e.target.value;
      }
      _saveEnvs();
    });
  }

  // Group toggles
  document.querySelectorAll('.sidebar-group-header').forEach(el => {
    el.addEventListener('click', () => {
      const idx  = parseInt(el.dataset.toggle);
      const open = !state.openGroups;
      if (!state.openGroups) state.openGroups = new Set();
      if (state.openGroups.has(idx)) state.openGroups.delete(idx);
      else state.openGroups.add(idx);
      render();
    });
  });

  // Endpoint selection
  document.querySelectorAll('.sidebar-ep').forEach(el => {
    el.addEventListener('click', () => {
      const [path, verb] = el.dataset.ep.split('|');
      state.activeEp   = { group: el.dataset.group, ep: path + verb };
      state.response   = null;
      state.bodyMode   = 'form';   // reset to form view on each endpoint
      // Load saved field values for this endpoint
      const savedKey   = `fields:${verb}:${path}`;
      state.fieldValues = JSON.parse(localStorage.getItem(savedKey) || '{}');
      render();
    });
  });

  // Field inputs
  document.querySelectorAll('[data-key]').forEach(el => {
    el.addEventListener('input', e => {
      const key = e.target.dataset.key;
      const isCheckbox = e.target.type === 'checkbox';
      state.fieldValues[key] = isCheckbox ? e.target.checked : e.target.value;
      // Save to localStorage
      const ep = getActiveEp();
      if (ep) {
        const savedKey = `fields:${ep.verb}:${ep.path}`;
        localStorage.setItem(savedKey, JSON.stringify(state.fieldValues));
      }
      // Re-render URL bar only
      const tryUrl = document.getElementById('try-url');
      if (tryUrl && ep) tryUrl.value = buildUrl(ep);
    });
  });

  // Try it
  const tryBtn = document.getElementById('try-btn');
  if (tryBtn) {
    tryBtn.addEventListener('click', sendRequest);
  }

  // Copy response
  const copyBtn = document.getElementById('copy-response');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const pre = document.getElementById('response-body');
      if (pre) {
        navigator.clipboard.writeText(pre.textContent);
        UI.Toast.show('Response copied to clipboard', 'success', 2000);
      }
    });
  }

  // Code tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === state.activeTab));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === state.activeTab));
    });
  });

  // Export
  const exportPostman = document.getElementById('export-postman');
  if (exportPostman) {
    exportPostman.addEventListener('click', () => {
      const url = `${PREFIX}/_api/export/postman?baseUrl=${encodeURIComponent(state.env.baseUrl)}`;
      window.open(url, '_blank');
    });
  }

  const exportOpenApi = document.getElementById('export-openapi');
  if (exportOpenApi) {
    exportOpenApi.addEventListener('click', () => {
      const url = `${PREFIX}/_api/export/openapi?baseUrl=${encodeURIComponent(state.env.baseUrl)}`;
      window.open(url, '_blank');
    });
  }
}

// ── Send request ───────────────────────────────────────────────────────────────

async function sendRequest() {
  const ep  = getActiveEp();
  if (!ep) return;

  const tryUrl = document.getElementById('try-url');
  const url    = tryUrl ? tryUrl.value : buildUrl(ep);
  const body   = collectBody(ep);
  const headers = {};
  if (ep.auth && state.env.token) {
    headers['Authorization'] = `Bearer ${state.env.token}`;
  }

  state.trying  = true;
  state.response = null;
  renderDetailOnly();

  try {
    const r = await fetch(`${PREFIX}/_api/try`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ method: ep.verb.toUpperCase(), url, headers, body, encoding: ep.bodyEncoding }),
    });
    const j = await r.json();
    state.response = j.ok ? j : { status: 0, body: j.error, time: 0 };
  } catch (err) {
    state.response = { status: 0, body: err.message, time: 0 };
  }

  state.trying = false;

  // Show toast on error status
  if (state.response && state.response.status >= 400) {
    UI.Toast.show(`${state.response.status} — ${_statusText(state.response.status)}`, 'error', 3000);
  } else if (state.response && state.response.status > 0) {
    UI.Toast.show(`${state.response.status} ${_statusText(state.response.status)}`, 'success', 2000);
  } else if (state.response && state.response.status === 0) {
    UI.Toast.show('Request failed — check console', 'error', 4000);
  }

  // Push to history (keep last 20)
  if (state.response) {
    const ep = getActiveEp();
    state.history.unshift({
      verb:   ep ? ep.verb : '?',
      path:   ep ? ep.path : url,
      label:  ep ? ep.label : url,
      url,
      status: state.response.status,
      time:   state.response.time,
      body:   state.response.body,
      headers: state.response.headers,
      ts:     new Date().toLocaleTimeString(),
    });
    if (state.history.length > 20) state.history.pop();
  }

  renderDetailOnly();
}

function renderDetailOnly() {
  const detail = document.querySelector('.detail');
  if (!detail) return;
  detail.innerHTML = renderDetail();
  bindDetailEvents();
}

function bindDetailEvents() {
  const tryBtn = document.getElementById('try-btn');
  if (tryBtn) tryBtn.addEventListener('click', sendRequest);

  const copyBtn = document.getElementById('copy-response');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const pre = document.getElementById('response-body');
      if (pre) {
        navigator.clipboard.writeText(pre.textContent);
        UI.Toast.show('Response copied to clipboard', 'success', 2000);
      }
    });
  }

  document.querySelectorAll('[data-key]').forEach(el => {
    el.addEventListener('input', e => {
      const key = e.target.dataset.key;
      state.fieldValues[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      const ep = getActiveEp();
      if (ep) {
        localStorage.setItem(`fields:${ep.verb}:${ep.path}`, JSON.stringify(state.fieldValues));
        const tryUrl = document.getElementById('try-url');
        if (tryUrl) tryUrl.value = buildUrl(ep);
      }
    });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === state.activeTab));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === state.activeTab));
    });
  });

  const exportPostman = document.getElementById('export-postman');
  if (exportPostman) exportPostman.addEventListener('click', () => window.open(`${PREFIX}/_api/export/postman?baseUrl=${encodeURIComponent(state.env.baseUrl)}`, '_blank'));

  const exportOpenApi = document.getElementById('export-openapi');
  if (exportOpenApi) exportOpenApi.addEventListener('click', () => window.open(`${PREFIX}/_api/export/openapi?baseUrl=${encodeURIComponent(state.env.baseUrl)}`, '_blank'));

  // Body mode toggle
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.bodyMode = btn.dataset.mode;
      renderDetailOnly();
    });
  });

  // Raw body textarea — save to fieldValues
  const rawInput = document.getElementById('raw-body-input');
  if (rawInput) {
    rawInput.addEventListener('input', e => {
      state.fieldValues[e.target.dataset.key] = e.target.value;
    });
  }

  // Clear response
  const clearBtn = document.getElementById('clear-response');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      state.response = null;
      renderDetailOnly();
    });
  }

  // Copy URL button
  const copyUrlBtn = document.getElementById('copy-url-btn');
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', () => {
      const tryUrl = document.getElementById('try-url');
      if (tryUrl) {
        navigator.clipboard.writeText(tryUrl.value);
        UI.Toast.show('URL copied', 'info', 1500);
      }
    });
  }

  // Enter key in URL bar fires request
  const tryUrl = document.getElementById('try-url');
  if (tryUrl) {
    tryUrl.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendRequest();
    });
  }

  // History toggle
  const toggleHistory = document.getElementById('toggle-history');
  if (toggleHistory) {
    toggleHistory.addEventListener('click', () => {
      state.showHistory = !state.showHistory;
      renderDetailOnly();
    });
  }

  // Clear history — confirm via UI.Confirm
  const clearHistory = document.getElementById('clear-history');
  if (clearHistory) {
    clearHistory.addEventListener('click', () => {
      UI.Confirm.show({
        title:   'Clear history?',
        message: 'All recorded requests will be removed.',
        confirm: 'Clear',
        cancel:  'Keep',
        danger:  true,
      }).then(ok => {
        if (!ok) return;
        state.history = [];
        state.showHistory = false;
        renderDetailOnly();
        UI.Toast.show('History cleared', 'info', 2000);
      });
    });
  }

  // Click history row — restore response
  document.querySelectorAll('.history-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.idx);
      const h   = state.history[idx];
      if (h) {
        state.response = { status: h.status, body: h.body, headers: h.headers, time: h.time };
        renderDetailOnly();
      }
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getActiveEp() {
  if (!state.activeEp || !state.manifest) return null;
  for (const g of state.manifest.groups) {
    if (g.slug !== state.activeEp.group) continue;
    for (const ep of g.endpoints) {
      if (ep.path + ep.verb === state.activeEp.ep) return ep;
    }
  }
  return null;
}

function buildUrl(ep) {
  let url = (state.env.baseUrl || '').replace(/\/$/, '') + ep.path;
  // Substitute path params
  url = url.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    const key = `param:${name}`;
    return state.fieldValues[key] || `:${name}`;
  });
  // Append query params
  const qp = ep.query || {};
  const qs = Object.entries(qp)
    .map(([k]) => {
      const val = state.fieldValues[`query:${k}`];
      return val !== undefined && val !== '' ? `${encodeURIComponent(k)}=${encodeURIComponent(val)}` : null;
    })
    .filter(Boolean)
    .join('&');
  if (qs) url += '?' + qs;
  return url;
}

function collectBody(ep) {
  const body = ep.body || {};
  if (!Object.keys(body).length || ep.verb === 'get') return null;

  // Raw JSON mode — parse directly from textarea
  if (state.bodyMode === 'raw') {
    const rawKey = `raw:${ep.verb}:${ep.path}`;
    const raw    = state.fieldValues[rawKey] || '';
    try { return raw ? JSON.parse(raw) : null; } catch { return raw || null; }
  }

  // Form mode
  const out = {};
  for (const [k, def] of Object.entries(body)) {
    const val = state.fieldValues[`body:${k}`];
    if (val !== undefined && val !== '') {
      if (def.type === 'number' || def.type === 'integer') out[k] = Number(val);
      else if (def.type === 'boolean') out[k] = val === true || val === 'true';
      else if (def.type === 'json')  { try { out[k] = JSON.parse(val); } catch { out[k] = val; } }
      else if (def.type === 'array') { try { out[k] = JSON.parse(val); } catch { out[k] = val; } }
      else out[k] = val;
    } else if (def.example !== undefined) {
      out[k] = def.example;
    }
  }
  return Object.keys(out).length ? out : null;
}

function filterGroups(groups, search) {
  if (!search) return groups;
  const q = search.toLowerCase();
  return groups
    .map(g => ({
      ...g,
      endpoints: g.endpoints.filter(ep =>
        ep.label.toLowerCase().includes(q) ||
        ep.path.toLowerCase().includes(q)  ||
        ep.verb.includes(q)
      ),
    }))
    .filter(g => g.endpoints.length);
}

function countEndpoints(m) {
  return m.groups.reduce((s, g) => s + g.endpoints.length, 0);
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _statusClass(s) {
  if (s >= 200 && s < 300) return 'status-2xx';
  if (s >= 300 && s < 400) return 'status-3xx';
  if (s >= 400 && s < 500) return 'status-4xx';
  return 'status-5xx';
}

function _statusText(s) {
  const t = {200:'OK',201:'Created',204:'No Content',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',422:'Unprocessable Entity',429:'Too Many Requests',500:'Server Error'};
  return t[s] || '';
}


// ── Syntax highlighting ────────────────────────────────────────────────────────
function _syntaxHighlight(str) {
  if (!str) return '';
  // Try to pretty-print if it's JSON
  try {
    const parsed = JSON.parse(str);
    str = JSON.stringify(parsed, null, 2);
  } catch {}

  // Escape HTML first
  str = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Colorize JSON tokens
  return str.replace(
    /("(\u[a-zA-Z0-9]{4}|\[^u]|[^\"])*"(\s*:)?|(true|false|null)|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'syn-number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'syn-key' : 'syn-string';
      } else if (/true|false/.test(match)) {
        cls = 'syn-bool';
      } else if (/null/.test(match)) {
        cls = 'syn-null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

// ── Start ─────────────────────────────────────────────────────────────────────
// Wait for UI to be available (loaded by shell before docs.js)
(function waitForUI() {
  if (typeof UI !== 'undefined') {
    init();
  } else {
    // ui.js not yet loaded (edge case) — retry
    setTimeout(waitForUI, 10);
  }
})();