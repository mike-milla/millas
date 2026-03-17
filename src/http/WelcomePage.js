'use strict';

/**
 * WelcomePage
 *
 * Renders a branded welcome page when no GET / route is defined.
 * Automatically removed once the developer registers their own / route.
 *
 * Only shown to browser requests (Accept: text/html).
 * API clients always receive JSON.
 */
class WelcomePage {

  /**
   * Returns an Express middleware that serves the welcome page for GET /
   * only when no user-defined route has been registered for that path.
   *
   * @param {string} version  — package version shown in the page
   */
  static handler(version = '') {
    return function millaWelcome(req, res) {
      const accept = req.headers?.accept || '';
      const wantsHtml = accept.includes('text/html') && !accept.startsWith('application/json');

      if (!wantsHtml) {
        return res.json({
          framework: 'Millas',
          version,
          message:   'Welcome to your Millas app. Define your routes in routes/api.js.',
          docs:      'https://millas.dev/docs',
        });
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(WelcomePage._render(version));
    };
  }

  static _render(version) {
    const ver = version ? `v${version}` : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Welcome — Millas</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --orange:      #f97316;
      --orange-dark: #ea580c;
      --orange-dim:  #fff7ed;
      --orange-mid:  #fed7aa;
      --bg:          #fafafa;
      --surface:     #ffffff;
      --border:      #e5e7eb;
      --text:        #111827;
      --muted:       #6b7280;
      --code-bg:     #fff7ed;
      --code-fg:     #c2410c;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --orange:      #fb923c;
        --orange-dark: #f97316;
        --orange-dim:  #1c0f00;
        --orange-mid:  #7c2d12;
        --bg:          #0c0c0c;
        --surface:     #141414;
        --border:      #262626;
        --text:        #f5f5f5;
        --muted:       #737373;
        --code-bg:     #1a0e00;
        --code-fg:     #fb923c;
      }
    }

    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
    }

    /* ── Logo mark ── */
    .logo {
      width: 64px;
      height: 64px;
      background: linear-gradient(135deg, var(--orange), var(--orange-dark));
      border-radius: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 28px;
      box-shadow: 0 8px 32px color-mix(in srgb, var(--orange) 35%, transparent);
    }
    .logo svg { width: 34px; height: 34px; }

    /* ── Card ── */
    .card {
      padding: 48px 52px;
      max-width: 560px;
      width: 100%;
      text-align: center;
    }

    h1 {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -.5px;
      color: var(--text);
      line-height: 1.2;
    }
    h1 span { color: var(--orange); }

    .version {
      display: inline-block;
      margin-top: 10px;
      background: var(--orange-dim);
      color: var(--orange-dark);
      border: 1px solid var(--orange-mid);
      border-radius: 99px;
      font-size: 12px;
      font-weight: 600;
      padding: 3px 12px;
      font-family: 'Cascadia Code', 'Fira Code', monospace;
    }

    .tagline {
      margin-top: 16px;
      font-size: 15px;
      color: var(--muted);
      line-height: 1.6;
    }

    /* ── Divider ── */
    .divider {
      height: 1px;
      background: var(--border);
      margin: 32px 0;
    }

    /* ── Quickstart block ── */
    .qs-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .8px;
      color: var(--muted);
      margin-bottom: 12px;
    }

    .code-block {
      background: var(--code-bg);
      border: 1px solid var(--orange-mid);
      border-radius: 12px;
      padding: 18px 20px;
      text-align: left;
      font-family: 'Cascadia Code', 'Fira Code', 'SF Mono', monospace;
      font-size: 13px;
      line-height: 1.9;
      color: var(--code-fg);
    }
    .code-block .comment { color: var(--muted); font-style: italic; }
    .code-block .kw      { color: var(--orange-dark); font-weight: 700; }
    .code-block .str     { color: #16a34a; }

    /* ── Links row ── */
    .links {
      margin-top: 28px;
      display: flex;
      justify-content: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 18px;
      border-radius: 99px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      transition: opacity .15s;
    }
    .link:hover { opacity: .8; }
    .link-primary {
      background: linear-gradient(135deg, var(--orange), var(--orange-dark));
      color: #fff;
    }
    .link-ghost {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
    }

    /* ── Footer note ── */
    .note {
      margin-top: 36px;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.6;
    }
    .note strong { color: var(--orange); font-family: monospace; font-weight: 600; }
  </style>
</head>
<body>

  <div class="logo">
    <!-- M lettermark -->
    <svg viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 27V7l13 13L30 7v20" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>

  <div class="card">
    <h1>Welcome to <span>Millas</span></h1>
    ${ver ? `<div class="version">${_esc(ver)}</div>` : ''}

    <p class="tagline">
      Your app is running. Define your first route and this page will disappear.
    </p>

    <div class="divider"></div>

    <div class="qs-label">Get started</div>
    <div class="code-block">
<span class="comment">// routes/api.js</span>
<span class="kw">module</span>.exports = <span class="kw">function</span> (Route) {
  Route.get(<span class="str">'/'</span>, () => ({
    message: <span class="str">'Hello from Millas!'</span>
  }));
};
    </div>

    <div class="links">
      <a class="link link-primary" href="https://id-preview--ae4ed87b-a9d5-434d-8559-1e8c30972a28.lovable.app" target="_blank">
        📖 Documentation
      </a>
      <a class="link link-ghost" href="https://github.com/millas-framework/millas" target="_blank">
        GitHub
      </a>
    </div>
  </div>

  <p class="note">
    This page is shown because no route is registered for <strong>GET /</strong>.<br>
    It will never appear in production to end users.
  </p>

</body>
</html>`;
  }
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = WelcomePage;