'use strict';

/**
 * Http
 *
 * Fluent HTTP client facade. Laravel-style API for making outbound HTTP requests.
 * Built on the Node.js native fetch (Node 18+) — no extra dependencies.
 *
 * ── Quick usage ──────────────────────────────────────────────────────────────
 *
 *   const { Http } = require('millas/facades/Http');
 *
 *   // GET
 *   const res  = await Http.get('https://api.example.com/users');
 *   const data = res.json();
 *
 *   // POST JSON
 *   const res = await Http.post('https://api.example.com/users', { name: 'Alice' });
 *
 *   // With headers + auth
 *   const res = await Http.withToken(token)
 *                         .withHeaders({ 'X-App': 'millas' })
 *                         .get('https://api.example.com/me');
 *
 *   // Form data
 *   const res = await Http.asForm()
 *                         .post('https://api.example.com/login', { email, password });
 *
 *   // Retry on failure
 *   const res = await Http.retry(3, 200)
 *                         .get('https://api.example.com/data');
 *
 *   // Base URL
 *   const client = Http.baseUrl('https://api.example.com');
 *   const users  = await client.get('/users');
 *   const post   = await client.post('/posts', { title: 'Hello' });
 */

// ── HttpResponse ──────────────────────────────────────────────────────────────

class HttpResponse {
  /**
   * @param {Response} fetchResponse — native fetch Response
   * @param {string}   body          — raw response body text
   */
  constructor(fetchResponse, body) {
    this._response = fetchResponse;
    this._body     = body;
    this._parsed   = null;
  }

  // ── Status ────────────────────────────────────────────────────────────────

  /** HTTP status code. */
  get status() { return this._response.status; }

  /** HTTP status text (e.g. "OK", "Not Found"). */
  get statusText() { return this._response.statusText; }

  /** True if status is 200–299. */
  get ok() { return this._response.ok; }

  /** True if status is 200. */
  get isOk() { return this._response.status === 200; }

  /** True if status is 201. */
  get isCreated() { return this._response.status === 201; }

  /** True if status is 204. */
  get isEmpty() { return this._response.status === 204; }

  /** True if status is 301 or 302. */
  get isRedirect() { return [301, 302, 303, 307, 308].includes(this._response.status); }

  /** True if status is 400. */
  get isBadRequest() { return this._response.status === 400; }

  /** True if status is 401. */
  get isUnauthorized() { return this._response.status === 401; }

  /** True if status is 403. */
  get isForbidden() { return this._response.status === 403; }

  /** True if status is 404. */
  get isNotFound() { return this._response.status === 404; }

  /** True if status is 422. */
  get isUnprocessable() { return this._response.status === 422; }

  /** True if status is 429. */
  get isTooManyRequests() { return this._response.status === 429; }

  /** True if status is 500–599. */
  get isServerError() { return this._response.status >= 500; }

  /** True if status is 400–499. */
  get isClientError() { return this._response.status >= 400 && this._response.status < 500; }

  /** True if request failed (4xx or 5xx). */
  get failed() { return !this._response.ok; }

  // ── Body ──────────────────────────────────────────────────────────────────

  /** Raw response body as a string. */
  body() { return this._body; }

  /**
   * Parse the response body as JSON.
   * Parsed result is cached — safe to call multiple times.
   */
  json() {
    if (this._parsed === null) {
      try {
        this._parsed = JSON.parse(this._body);
      } catch {
        this._parsed = this._body;
      }
    }
    return this._parsed;
  }

  /**
   * Get a key from the parsed JSON body.
   *   res.data('user.name')   — supports dot notation
   *   res.data('users.0.id')
   */
  data(key) {
    const parsed = this.json();
    if (!key) return parsed;
    return key.split('.').reduce((obj, k) => obj?.[k], parsed) ?? null;
  }

  /** Response headers as a plain object. */
  get headers() {
    const h = {};
    this._response.headers.forEach((value, key) => { h[key] = value; });
    return h;
  }

  /** Get a specific response header. */
  header(name) {
    return this._response.headers.get(name);
  }

  // ── Throwing helpers ──────────────────────────────────────────────────────

  /**
   * Throw an HttpClientError if the request failed (4xx or 5xx).
   * Chainable — returns this on success.
   *
   *   const res = await Http.get(url).throw();
   */
  throw() {
    if (this.failed) {
      throw new HttpClientError(
        `HTTP request failed with status ${this.status}`,
        this
      );
    }
    return this;
  }

  /**
   * Throw only on server errors (5xx).
   */
  throwOnServerError() {
    if (this.isServerError) {
      throw new HttpClientError(
        `Server error: ${this.status}`,
        this
      );
    }
    return this;
  }

  /**
   * Throw only on client errors (4xx).
   */
  throwOnClientError() {
    if (this.isClientError) {
      throw new HttpClientError(
        `Client error: ${this.status}`,
        this
      );
    }
    return this;
  }
}

// ── HttpClientError ───────────────────────────────────────────────────────────

class HttpClientError extends Error {
  constructor(message, response) {
    super(message);
    this.name     = 'HttpClientError';
    this.response = response;
    this.status   = response?.status;
  }
}

// ── PendingRequest (the fluent builder) ───────────────────────────────────────

class PendingRequest {
  constructor(defaults = {}) {
    this._headers      = { ...defaults.headers };
    this._baseUrl      = defaults.baseUrl      || '';
    this._timeout      = defaults.timeout      || 30000;
    this._retries      = defaults.retries      || 0;
    this._retryDelay   = defaults.retryDelay   || 100;
    this._bodyFormat   = defaults.bodyFormat   || 'json';  // 'json' | 'form' | 'multipart' | 'raw'
    this._beforeSend   = defaults.beforeSend   || null;    // (request) => request
    this._afterReceive = defaults.afterReceive || null;    // (response) => response
    this._throwOnError = defaults.throwOnError || false;
    this._pool         = null;
    this._auth         = null;
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  /** Set a base URL prefixed to every request. */
  baseUrl(url) {
    this._baseUrl = url.replace(/\/$/, '');
    return this;
  }

  /**
   * Merge additional headers.
   *
   *   Http.withHeaders({ 'X-Tenant': tenantId }).get(url)
   */
  withHeaders(headers) {
    Object.assign(this._headers, headers);
    return this;
  }

  /**
   * Add a Bearer token Authorization header.
   *
   *   Http.withToken(accessToken).get(url)
   */
  withToken(token, type = 'Bearer') {
    this._headers['Authorization'] = `${type} ${token}`;
    return this;
  }

  /**
   * HTTP Basic auth.
   *
   *   Http.withBasicAuth('user', 'pass').get(url)
   */
  withBasicAuth(username, password) {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    this._headers['Authorization'] = `Basic ${encoded}`;
    return this;
  }

  /**
   * Add cookies to the request.
   *
   *   Http.withCookies({ session: 'abc123' }).get(url)
   */
  withCookies(cookies) {
    const cookieStr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ');
    this._headers['Cookie'] = cookieStr;
    return this;
  }

  /**
   * Set a custom user-agent.
   *
   *   Http.withUserAgent('MyApp/1.0').get(url)
   */
  withUserAgent(ua) {
    this._headers['User-Agent'] = ua;
    return this;
  }

  /**
   * Set the Accept header.
   *
   *   Http.accept('text/html').get(url)
   *   Http.accept('application/xml').get(url)
   */
  accept(contentType) {
    this._headers['Accept'] = contentType;
    return this;
  }

  /** Accept application/json (default). */
  acceptJson() {
    return this.accept('application/json');
  }

  /**
   * Set request timeout in milliseconds.
   *
   *   Http.timeout(5000).get(url)
   */
  timeout(ms) {
    this._timeout = ms;
    return this;
  }

  /**
   * Retry failed requests.
   *
   *   Http.retry(3).get(url)
   *   Http.retry(3, 500).get(url)     // 500ms delay between retries
   */
  retry(times, delay = 100) {
    this._retries    = times;
    this._retryDelay = delay;
    return this;
  }

  // ── Body format ───────────────────────────────────────────────────────────

  /**
   * Send body as JSON (default).
   * Sets Content-Type: application/json.
   */
  asJson() {
    this._bodyFormat = 'json';
    return this;
  }

  /**
   * Send body as application/x-www-form-urlencoded.
   * Useful for OAuth endpoints, legacy form APIs.
   *
   *   Http.asForm().post(url, { grant_type: 'client_credentials' })
   */
  asForm() {
    this._bodyFormat = 'form';
    return this;
  }

  /**
   * Send body as multipart/form-data.
   * Use for file uploads.
   *
   *   Http.asMultipart().post(url, formData)
   */
  asMultipart() {
    this._bodyFormat = 'multipart';
    return this;
  }

  /**
   * Send body as plain text.
   */
  withBody(body, contentType = 'text/plain') {
    this._rawBody        = body;
    this._rawContentType = contentType;
    this._bodyFormat     = 'raw';
    return this;
  }

  // ── Hooks ─────────────────────────────────────────────────────────────────

  /**
   * Run a callback before the request is sent.
   * Receives and must return the options object.
   *
   *   Http.beforeSending(opts => {
   *     opts.headers['X-Timestamp'] = Date.now();
   *     return opts;
   *   }).get(url)
   */
  beforeSending(fn) {
    this._beforeSend = fn;
    return this;
  }

  /**
   * Run a callback after the response is received.
   * Receives and must return the HttpResponse.
   *
   *   Http.afterReceiving(res => {
   *     Log.d('Http', `${res.status} ${url}`);
   *     return res;
   *   }).get(url)
   */
  afterReceiving(fn) {
    this._afterReceive = fn;
    return this;
  }

  /**
   * Automatically throw HttpClientError on 4xx/5xx responses.
   */
  throwOnFailure() {
    this._throwOnError = true;
    return this;
  }

  // ── HTTP verbs ────────────────────────────────────────────────────────────

  /**
   * Send a GET request.
   *
   *   Http.get('https://api.example.com/users')
   *   Http.get('https://api.example.com/users', { page: 1, per_page: 20 })
   */
  async get(url, query = {}) {
    return this._send('GET', url, null, query);
  }

  /**
   * Send a HEAD request.
   */
  async head(url, query = {}) {
    return this._send('HEAD', url, null, query);
  }

  /**
   * Send a POST request.
   *
   *   Http.post('https://api.example.com/users', { name: 'Alice', email: 'alice@example.com' })
   */
  async post(url, data = {}) {
    return this._send('POST', url, data);
  }

  /**
   * Send a PUT request.
   *
   *   Http.put('https://api.example.com/users/1', { name: 'Alice' })
   */
  async put(url, data = {}) {
    return this._send('PUT', url, data);
  }

  /**
   * Send a PATCH request.
   *
   *   Http.patch('https://api.example.com/users/1', { name: 'Alice' })
   */
  async patch(url, data = {}) {
    return this._send('PATCH', url, data);
  }

  /**
   * Send a DELETE request.
   *
   *   Http.delete('https://api.example.com/users/1')
   */
  async delete(url, data = {}) {
    return this._send('DELETE', url, data);
  }

  /**
   * Send an OPTIONS request.
   */
  async options(url) {
    return this._send('OPTIONS', url, null);
  }

  // ── Pool (concurrent requests) ────────────────────────────────────────────

  /**
   * Send multiple requests concurrently and get all responses.
   *
   *   const [users, posts] = await Http.pool(http => [
   *     http.get('https://api.example.com/users'),
   *     http.get('https://api.example.com/posts'),
   *   ]);
   */
  async pool(callback) {
    const requests = callback(this);
    return Promise.all(requests);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  async _send(method, url, data, query = {}) {
    const fullUrl = this._buildUrl(url, query);
    let   attempt = 0;
    const maxTries = this._retries + 1;

    while (attempt < maxTries) {
      attempt++;
      try {
        const response = await this._attempt(method, fullUrl, data);
        if (this._throwOnError) response.throw();
        return response;
      } catch (err) {
        const isLast = attempt >= maxTries;

        // Don't retry HttpClientError (those are intentional throws)
        if (err instanceof HttpClientError) throw err;

        if (isLast) throw err;

        await _sleep(this._retryDelay * attempt); // exponential-ish backoff
      }
    }
  }

  async _attempt(method, url, data) {
    const controller  = new AbortController();
    const timeoutId   = setTimeout(() => controller.abort(), this._timeout);

    const headers = {
      Accept: 'application/json',
      ...this._headers,
    };

    let body;

    if (data !== null && data !== undefined && method !== 'GET' && method !== 'HEAD') {
      if (this._bodyFormat === 'json') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(data);

      } else if (this._bodyFormat === 'form') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(data).toString();

      } else if (this._bodyFormat === 'multipart') {
        // FormData — let fetch set the Content-Type with boundary
        if (data instanceof FormData) {
          body = data;
        } else {
          const fd = new FormData();
          for (const [k, v] of Object.entries(data)) fd.append(k, v);
          body = fd;
        }

      } else if (this._bodyFormat === 'raw') {
        headers['Content-Type'] = this._rawContentType;
        body = this._rawBody;
      }
    }

    let opts = {
      method,
      headers,
      body,
      signal: controller.signal,
    };

    if (this._beforeSend) {
      opts = await this._beforeSend(opts);
    }

    let fetchResponse;
    try {
      fetchResponse = await fetch(url, opts);
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new HttpClientError(`Request timed out after ${this._timeout}ms`, null);
      }
      throw new HttpClientError(`Network error: ${err.message}`, null);
    } finally {
      clearTimeout(timeoutId);
    }

    const text = await fetchResponse.text();
    let response = new HttpResponse(fetchResponse, text);

    if (this._afterReceive) {
      response = await this._afterReceive(response);
    }

    return response;
  }

  _buildUrl(url, query = {}) {
    // Prepend base URL if url is relative
    let full = url.startsWith('http') ? url : `${this._baseUrl}${url}`;

    const params = Object.entries(query).filter(([, v]) => v !== undefined && v !== null);
    if (params.length) {
      const qs = new URLSearchParams(params).toString();
      full += (full.includes('?') ? '&' : '?') + qs;
    }

    return full;
  }
}

// ── Http namespace (entry point) ──────────────────────────────────────────────

/**
 * HttpClient service.
 *
 * Registered in the container under 'http'.
 * Access via the Http facade — never instantiate directly.
 *
 * Every method creates a fresh PendingRequest so calls are stateless.
 */
const HttpClient = {
  // ── Shorthand verb methods (create a fresh PendingRequest each time) ──────

  get:     (url, query)  => new PendingRequest().get(url, query),
  head:    (url, query)  => new PendingRequest().head(url, query),
  post:    (url, data)   => new PendingRequest().post(url, data),
  put:     (url, data)   => new PendingRequest().put(url, data),
  patch:   (url, data)   => new PendingRequest().patch(url, data),
  delete:  (url, data)   => new PendingRequest().delete(url, data),
  options: (url)         => new PendingRequest().options(url),

  // ── Fluent builder starters ───────────────────────────────────────────────

  /** Set a base URL for all requests on this client. */
  baseUrl:       (url)           => new PendingRequest().baseUrl(url),

  /** Add headers. */
  withHeaders:   (headers)       => new PendingRequest().withHeaders(headers),

  /** Bearer token auth. */
  withToken:     (token, type)   => new PendingRequest().withToken(token, type),

  /** HTTP Basic auth. */
  withBasicAuth: (user, pass)    => new PendingRequest().withBasicAuth(user, pass),

  /** Add request cookies. */
  withCookies:   (cookies)       => new PendingRequest().withCookies(cookies),

  /** Set User-Agent header. */
  withUserAgent: (ua)            => new PendingRequest().withUserAgent(ua),

  /** Set Accept header. */
  accept:        (type)          => new PendingRequest().accept(type),

  /** Accept application/json. */
  acceptJson:    ()              => new PendingRequest().acceptJson(),

  /** Set timeout in ms. */
  timeout:       (ms)            => new PendingRequest().timeout(ms),

  /** Retry on failure. */
  retry:         (times, delay)  => new PendingRequest().retry(times, delay),

  /** Send as JSON (default). */
  asJson:        ()              => new PendingRequest().asJson(),

  /** Send as form-urlencoded. */
  asForm:        ()              => new PendingRequest().asForm(),

  /** Send as multipart/form-data. */
  asMultipart:   ()              => new PendingRequest().asMultipart(),

  /** Hook before sending. */
  beforeSending: (fn)            => new PendingRequest().beforeSending(fn),

  /** Hook after receiving. */
  afterReceiving: (fn)           => new PendingRequest().afterReceiving(fn),

  /** Throw on 4xx/5xx. */
  throwOnFailure: ()             => new PendingRequest().throwOnFailure(),

  /** Send multiple concurrent requests. */
  pool:          (cb)            => new PendingRequest().pool(cb),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  HttpClient,
  PendingRequest,
  HttpResponse,
  HttpClientError,
};