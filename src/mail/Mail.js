'use strict';

const MailMessage    = require('./MailMessage');
const TemplateEngine = require('./TemplateEngine');

/**
 * Mail
 *
 * The primary mail facade.
 *
 * Usage:
 *   const { Mail } = require('millas/src');
 *
 *   // Simple HTML
 *   await Mail.send(
 *     new MailMessage()
 *       .to('alice@example.com', 'Alice')
 *       .subject('Welcome!')
 *       .html('<h1>Hello Alice!</h1>')
 *   );
 *
 *   // Shorthand — object instead of MailMessage
 *   await Mail.send({
 *     to:       'alice@example.com',
 *     subject:  'Welcome!',
 *     template: 'welcome',
 *     data:     { name: 'Alice' },
 *   });
 *
 *   // Raw send with builder callback
 *   await Mail.to('alice@example.com')
 *             .subject('Hi!')
 *             .html('<p>Hi!</p>')
 *             .send();
 */
class Mail {
  constructor() {
    this._driver   = null;
    this._config   = null;
    this._engine   = null;
    this._queue    = null;   // set by QueueServiceProvider in Phase 9
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  /**
   * Configure Mail. Called by MailServiceProvider.
   */
  configure(config) {
    this._config = config;
    this._engine = new TemplateEngine(config.templatesPath);
  }

  /**
   * Set the queue instance for async mail (Phase 9).
   */
  setQueue(queue) {
    this._queue = queue;
  }

  // ─── Primary API ───────────────────────────────────────────────────────────

  /**
   * Send an email immediately.
   *
   * @param {MailMessage|object} message
   */
  async send(message) {
    const msg = await this._resolve(message);
    const driver = this._getDriver();
    return driver.send(msg);
  }

  /**
   * Queue an email for background delivery (requires Phase 9).
   * Falls back to immediate send if no queue configured.
   *
   * @param {MailMessage|object} message
   */
  async queue(message) {
    if (!this._queue) {
      // Graceful degradation — send immediately
      return this.send(message);
    }
    const msg = await this._resolve(message);
    return this._queue.push('mail', msg);
  }

  /**
   * Send later (alias for queue).
   */
  async later(message) {
    return this.queue(message);
  }

  /**
   * Send to multiple recipients in a loop.
   *
   * await Mail.sendBulk([
   *   { to: 'a@b.com', subject: 'Hi', template: 'welcome', data: { name: 'A' } },
   *   { to: 'c@d.com', subject: 'Hi', template: 'welcome', data: { name: 'C' } },
   * ]);
   */
  async sendBulk(messages) {
    return Promise.all(messages.map(m => this.send(m)));
  }

  // ─── Fluent builder entry point ────────────────────────────────────────────

  /**
   * Start building a message fluently.
   * Returns a MailMessage with a .send() shortcut bound to this Mail instance.
   *
   * await Mail.to('alice@test.com').subject('Hi').html('<p>Hi</p>').send();
   */
  to(address, name) {
    const mail = this;
    const msg  = new MailMessage().to(address, name);
    // Attach a .send() shortcut
    msg.send = () => mail.send(msg);
    return msg;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  /**
   * Resolve a MailMessage or plain object into a built message payload.
   */
  async _resolve(message) {
    // Plain object shorthand
    if (!(message instanceof MailMessage)) {
      const msg = new MailMessage();
      if (message.to)       msg.to(message.to, message.toName);
      if (message.cc)       msg.cc(message.cc);
      if (message.bcc)      msg.bcc(message.bcc);
      if (message.from)     msg.from(message.from);
      if (message.replyTo)  msg.replyTo(message.replyTo);
      if (message.subject)  msg.subject(message.subject);
      if (message.html)     msg.html(message.html);
      if (message.text)     msg.text(message.text);
      if (message.template) msg.template(message.template, message.data || {});
      message = msg;
    }

    const defaults = {
      from: this._config?.from
        ? `${this._config.from.name || 'Millas'} <${this._config.from.address}>`
        : 'noreply@millas.dev',
    };

    const built = message.build(defaults);

    // Render template if specified
    if (built._template && this._engine) {
      const rendered = await this._engine.render(built._template, built._data || {});
      built.html = built.html || rendered.html;
      built.text = built.text || rendered.text;
    }

    // Clean up internal properties
    delete built._template;
    delete built._data;

    return built;
  }

  _getDriver() {
    if (this._driver) return this._driver;

    if (!this._config) {
      // No config — use LogDriver so mail never throws in tests/dev
      const LogDriver = require('./drivers/LogDriver');
      return new LogDriver();
    }

    const driverName = this._config.default || 'log';
    const driverConf = this._config.drivers?.[driverName] || {};

    switch (driverName) {
      case 'smtp': {
        const SmtpDriver = require('./drivers/SmtpDriver');
        this._driver = new SmtpDriver(driverConf);
        break;
      }
      case 'sendgrid': {
        const SendGridDriver = require('./drivers/SendGridDriver');
        this._driver = new SendGridDriver(driverConf);
        break;
      }
      case 'mailgun': {
        const MailgunDriver = require('./drivers/MailgunDriver');
        this._driver = new MailgunDriver(driverConf);
        break;
      }
      case 'log':
      default: {
        const LogDriver = require('./drivers/LogDriver');
        this._driver = new LogDriver(driverConf);
        break;
      }
    }

    return this._driver;
  }
}

// Singleton
module.exports = new Mail();
module.exports.Mail        = Mail;
module.exports.MailMessage = MailMessage;
