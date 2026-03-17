'use strict';

/**
 * MailMessage
 *
 * Fluent builder for composing email messages.
 *
 * Usage:
 *   const msg = new MailMessage()
 *     .to('alice@example.com', 'Alice')
 *     .subject('Welcome!')
 *     .html('<h1>Hello Alice</h1>')
 *     .text('Hello Alice');
 *
 * Or with a template:
 *   const msg = new MailMessage()
 *     .to('alice@example.com')
 *     .subject('Welcome!')
 *     .template('welcome', { name: 'Alice' });
 */
class MailMessage {
  constructor() {
    this._to          = [];
    this._cc          = [];
    this._bcc         = [];
    this._from        = null;
    this._replyTo     = null;
    this._subject     = '';
    this._html        = null;
    this._text        = null;
    this._template    = null;
    this._data        = {};
    this._attachments = [];
    this._headers     = {};
    this._priority    = 'normal';
  }

  // ─── Recipients ────────────────────────────────────────────────────────────

  /**
   * Set the To recipient(s).
   * @param {string|Array} address
   * @param {string} name
   */
  to(address, name) {
    this._to = this._normalise(address, name);
    return this;
  }

  /**
   * Add CC recipient(s).
   */
  cc(address, name) {
    this._cc = [...this._cc, ...this._normalise(address, name)];
    return this;
  }

  /**
   * Add BCC recipient(s).
   */
  bcc(address, name) {
    this._bcc = [...this._bcc, ...this._normalise(address, name)];
    return this;
  }

  /**
   * Override the From address for this message.
   */
  from(address, name) {
    this._from = name ? `${name} <${address}>` : address;
    return this;
  }

  /**
   * Set the Reply-To address.
   */
  replyTo(address, name) {
    this._replyTo = name ? `${name} <${address}>` : address;
    return this;
  }

  // ─── Content ───────────────────────────────────────────────────────────────

  /**
   * Set the email subject line.
   */
  subject(subject) {
    this._subject = subject;
    return this;
  }

  /**
   * Set HTML body.
   */
  html(content) {
    this._html = content;
    return this;
  }

  /**
   * Set plain-text body.
   */
  text(content) {
    this._text = content;
    return this;
  }

  /**
   * Use a named template with data.
   * Template is resolved by the TemplateEngine.
   *
   * .template('welcome', { name: 'Alice', verifyUrl: '...' })
   */
  template(name, data = {}) {
    this._template = name;
    this._data     = data;
    return this;
  }

  // ─── Attachments ───────────────────────────────────────────────────────────

  /**
   * Attach a file.
   * @param {string} filePath   — absolute path or Buffer
   * @param {string} filename   — name shown in email
   * @param {string} contentType
   */
  attach(filePath, filename, contentType) {
    this._attachments.push({ path: filePath, filename, contentType });
    return this;
  }

  /**
   * Attach raw content (string or Buffer).
   */
  attachRaw(content, filename, contentType = 'text/plain') {
    this._attachments.push({ content, filename, contentType });
    return this;
  }

  // ─── Meta ──────────────────────────────────────────────────────────────────

  /**
   * Set a custom header.
   */
  header(key, value) {
    this._headers[key] = value;
    return this;
  }

  /**
   * Set message priority: 'high' | 'normal' | 'low'
   */
  priority(level) {
    this._priority = level;
    return this;
  }

  // ─── Build ─────────────────────────────────────────────────────────────────

  /**
   * Build the final message object for the transport driver.
   * Applies defaults from a config object.
   */
  build(defaults = {}) {
    return {
      from:        this._from || defaults.from || 'noreply@millas.dev',
      to:          this._to,
      cc:          this._cc.length     ? this._cc  : undefined,
      bcc:         this._bcc.length    ? this._bcc : undefined,
      replyTo:     this._replyTo       || undefined,
      subject:     this._subject,
      html:        this._html          || undefined,
      text:        this._text          || undefined,
      attachments: this._attachments.length ? this._attachments : undefined,
      headers:     Object.keys(this._headers).length ? this._headers : undefined,
      priority:    this._priority !== 'normal' ? this._priority : undefined,
      // Internal use
      _template:   this._template,
      _data:       this._data,
    };
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _normalise(address, name) {
    if (Array.isArray(address)) {
      return address.map(a =>
        typeof a === 'string' ? a : (a.name ? `${a.name} <${a.address}>` : a.address)
      );
    }
    return [name ? `${name} <${address}>` : address];
  }
}

module.exports = MailMessage;
