'use strict';

/**
 * SmtpDriver
 *
 * Sends mail via SMTP using nodemailer.
 *
 * Config (config/mail.js):
 *   drivers: {
 *     smtp: {
 *       host:       'smtp.mailtrap.io',
 *       port:       2525,
 *       username:   'user',
 *       password:   'pass',
 *       encryption: 'tls',   // 'tls' | 'ssl' | false
 *     }
 *   }
 */
class SmtpDriver {
  constructor(config = {}) {
    this._config    = config;
    this._transport = null;
  }

  async send(message) {
    const transport = this._getTransport();
    return transport.sendMail(this._toNodemailer(message));
  }

  _getTransport() {
    if (this._transport) return this._transport;

    const nodemailer = require('nodemailer');
    const cfg        = this._config;

    const secure = cfg.encryption === 'ssl';
    const tls    = cfg.encryption === 'tls' ? { rejectUnauthorized: false } : undefined;

    this._transport = nodemailer.createTransport({
      host:   cfg.host     || 'localhost',
      port:   cfg.port     || 587,
      secure,
      auth:   cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
      tls,
    });

    return this._transport;
  }

  _toNodemailer(msg) {
    return {
      from:        msg.from,
      to:          Array.isArray(msg.to)  ? msg.to.join(', ')  : msg.to,
      cc:          Array.isArray(msg.cc)  ? msg.cc.join(', ')  : msg.cc,
      bcc:         Array.isArray(msg.bcc) ? msg.bcc.join(', ') : msg.bcc,
      replyTo:     msg.replyTo,
      subject:     msg.subject,
      html:        msg.html,
      text:        msg.text,
      attachments: msg.attachments,
      headers:     msg.headers,
      priority:    msg.priority,
    };
  }
}

module.exports = SmtpDriver;
