'use strict';

const https  = require('https');
const http   = require('http');
const { URL } = require('url');

/**
 * ApiHandler
 *
 * Internal JSON API used by the client-side docs app.
 *
 *   GET  /_api/manifest          → full docs manifest (groups + endpoints)
 *   POST /_api/try               → proxy a real API request
 *   GET  /_api/export/postman    → Postman collection JSON
 *   GET  /_api/export/openapi    → OpenAPI 3.0 JSON
 */
class ApiHandler {
  constructor(docs) {
    this._docs = docs;
  }

  manifest(req, res) {
    try {
      const manifest = this._docs.buildManifest();
      res.json({ ok: true, data: manifest });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }

  /**
   * Proxy a real request from the browser.
   *
   * Request body:
   *   {
   *     method:   'GET' | 'POST' | ...,
   *     url:      'http://localhost:3000/api/v1/users',
   *     headers:  { 'Authorization': 'Bearer ...' },
   *     body:     { ... },      // JSON body for POST/PATCH/PUT
   *     encoding: 'json' | 'form' | 'multipart'
   *   }
   *
   * For multipart: body is forwarded as application/x-www-form-urlencoded
   * (file contents are not proxied — the browser sends field values only).
   * Full file upload proxying requires the client to send a FormData blob,
   * which is handled separately via the browser fetch direct path.
   */
  async tryRequest(req, res) {
    const { method, url, headers = {}, body, encoding } = req.body || {};

    if (!url) {
      return res.status(400).json({ ok: false, error: 'url is required' });
    }

    const start = Date.now();

    try {
      const parsed = new URL(url);
      const lib    = parsed.protocol === 'https:' ? https : http;
      const verb   = (method || 'GET').toUpperCase();
      const hasBody = body && verb !== 'GET' && verb !== 'DELETE';

      let bodyStr       = null;
      let contentType   = 'application/json';

      if (hasBody) {
        if (encoding === 'form' || encoding === 'multipart') {
          // Send as URL-encoded form (file fields are omitted — browser must handle uploads directly)
          const formParts = Object.entries(body)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
          bodyStr     = formParts.join('&');
          contentType = 'application/x-www-form-urlencoded';
        } else {
          bodyStr     = JSON.stringify(body);
          contentType = 'application/json';
        }
      }

      const options = {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   verb,
        headers: {
          'Content-Type': contentType,
          'Accept':       'application/json',
          ...headers,
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      };

      const result = await new Promise((resolve, reject) => {
        const reqOut = lib.request(options, (incoming) => {
          let data = '';
          incoming.on('data', chunk => { data += chunk; });
          incoming.on('end', () => {
            resolve({
              status:  incoming.statusCode,
              headers: incoming.headers,
              body:    data,
            });
          });
        });
        reqOut.on('error', reject);
        if (bodyStr) reqOut.write(bodyStr);
        reqOut.end();
      });

      let parsedBody = result.body;
      try { parsedBody = JSON.parse(result.body); } catch {}

      res.json({
        ok:      true,
        status:  result.status,
        headers: result.headers,
        body:    parsedBody,
        time:    Date.now() - start,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message, time: Date.now() - start });
    }
  }

  exportPostman(req, res) {
    try {
      const manifest  = this._docs.buildManifest();
      const baseUrl   = (req.query.baseUrl || 'http://localhost:3000').replace(/\/$/, '');
      const collection = _toPostman(manifest, baseUrl);
      res.setHeader('Content-Disposition', 'attachment; filename="api-collection.json"');
      res.json(collection);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }

  exportOpenApi(req, res) {
    try {
      const manifest = this._docs.buildManifest();
      const baseUrl  = req.query.baseUrl || 'http://localhost:3000';
      const spec     = _toOpenApi(manifest, baseUrl);
      res.setHeader('Content-Disposition', 'attachment; filename="openapi.json"');
      res.json(spec);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
}

// ── Export helpers ─────────────────────────────────────────────────────────────

function _toPostman(manifest, baseUrl) {
  const items = [];

  for (const group of manifest.groups) {
    const groupItems = group.endpoints.map(ep => {
      // Path params
      const url = (baseUrl + ep.path).replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{{$1}}');

      const item = {
        name: ep.label,
        request: {
          method: ep.verb.toUpperCase(),
          header: [
            { key: 'Content-Type', value: 'application/json' },
            ...(ep.auth ? [{ key: 'Authorization', value: 'Bearer {{token}}' }] : []),
          ],
          url: { raw: url, host: [url] },
        },
      };

      if (ep.body && Object.keys(ep.body).length && ep.verb !== 'get') {
        const example = {};
        for (const [k, f] of Object.entries(ep.body)) {
          example[k] = f.example !== undefined ? f.example : _typeDefault(f.type);
        }
        item.request.body = {
          mode: 'raw',
          raw:  JSON.stringify(example, null, 2),
          options: { raw: { language: 'json' } },
        };
      }

      return item;
    });

    items.push({
      name: group.label,
      item: groupItems,
    });
  }

  return {
    info: {
      name:   manifest.title,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
    variable: [
      { key: 'baseUrl', value: baseUrl },
      { key: 'token',   value: '' },
    ],
  };
}

function _toOpenApi(manifest, baseUrl) {
  const paths = {};

  for (const group of manifest.groups) {
    for (const ep of group.endpoints) {
      const oaPath = ep.path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
      if (!paths[oaPath]) paths[oaPath] = {};

      const operation = {
        summary:     ep.label,
        description: ep.description || '',
        tags:        [group.label],
        parameters:  [],
        responses:   {},
      };

      // Path params
      for (const pName of (ep.pathParams || [])) {
        const pDef = ep.params?.[pName] || {};
        operation.parameters.push({
          name: pName, in: 'path', required: true,
          schema:   { type: pDef.type || 'string' },
          example:  pDef.example,
          description: pDef.description || '',
        });
      }

      // Query params
      for (const [qName, qDef] of Object.entries(ep.query || {})) {
        operation.parameters.push({
          name: qName, in: 'query', required: qDef.required || false,
          schema:  { type: qDef.type || 'string' },
          example: qDef.example,
          description: qDef.description || '',
        });
      }

      // Auth
      if (ep.auth) {
        operation.security = [{ bearerAuth: [] }];
      }

      // Request body
      if (ep.body && Object.keys(ep.body).length && ep.verb !== 'get') {
        const props = {}, required = [];
        for (const [fName, fDef] of Object.entries(ep.body)) {
          props[fName] = { type: fDef.type || 'string', example: fDef.example, description: fDef.description || '' };
          if (fDef.required) required.push(fName);
        }
        operation.requestBody = {
          content: {
            'application/json': {
              schema: { type: 'object', properties: props, ...(required.length ? { required } : {}) },
            },
          },
        };
      }

      // Responses
      if (ep.responses?.length) {
        for (const r of ep.responses) {
          operation.responses[String(r.status)] = {
            description: r.description || _statusText(r.status),
            content: r.example ? {
              'application/json': { example: r.example },
            } : undefined,
          };
        }
      } else {
        operation.responses['200'] = { description: 'OK' };
      }

      paths[oaPath][ep.verb] = operation;
    }
  }

  return {
    openapi: '3.0.3',
    info:    { title: manifest.title, version: '1.0.0' },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    paths,
  };
}

function _typeDefault(type) {
  const m = { string: '', email: 'user@example.com', password: 'secret', number: 0, integer: 0, boolean: false, array: [], json: {} };
  return m[type] ?? '';
}

function _statusText(s) {
  const t = { 200:'OK',201:'Created',204:'No Content',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',422:'Unprocessable Entity',500:'Server Error' };
  return t[s] || 'Response';
}

module.exports = ApiHandler;