'use strict';

/**
 * SendGridDriver
 *
 * Sends mail via the SendGrid Web API v3.
 * Does not require any extra npm package — uses the built-in https module.
 *
 * Config (config/mail.js):
 *   drivers: {
 *     sendgrid: {
 *       key: process.env.SENDGRID_API_KEY,
 *     }
 *   }
 */
class SendGridDriver {
  constructor(config = {}) {
    this._apiKey = config.key || process.env.SENDGRID_API_KEY;
    if (!this._apiKey) {
      throw new Error('SendGridDriver: API key is required (config/mail.js → drivers.sendgrid.key)');
    }
  }

  async send(message) {
    const payload = {
      personalizations: [{
        to:  this._toRecipients(message.to),
        cc:  message.cc  ? this._toRecipients(message.cc)  : undefined,
        bcc: message.bcc ? this._toRecipients(message.bcc) : undefined,
        subject: message.subject,
      }],
      from:     this._parseAddress(message.from),
      reply_to: message.replyTo ? this._parseAddress(message.replyTo) : undefined,
      content: [
        ...(message.text ? [{ type: 'text/plain', value: message.text }] : []),
        ...(message.html ? [{ type: 'text/html',  value: message.html }] : []),
      ],
      attachments: message.attachments
        ? message.attachments.map(a => ({
            content:  Buffer.isBuffer(a.content)
              ? a.content.toString('base64')
              : Buffer.from(a.content || '').toString('base64'),
            filename: a.filename,
            type:     a.contentType,
          }))
        : undefined,
    };

    return this._post('/v3/mail/send', payload);
  }

  async _post(path, body) {
    return new Promise((resolve, reject) => {
      const https   = require('https');
      const data    = JSON.stringify(body);
      const options = {
        hostname: 'api.sendgrid.com',
        port:     443,
        path,
        method:   'POST',
        headers:  {
          'Authorization': `Bearer ${this._apiKey}`,
          'Content-Type':  'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end',  () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode });
          } else {
            reject(new Error(`SendGrid API error ${res.statusCode}: ${raw}`));
          }
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  _toRecipients(addresses) {
    return [].concat(addresses).map(a => this._parseAddress(a));
  }

  _parseAddress(address) {
    const match = String(address).match(/^(.+?)\s*<(.+?)>$/);
    if (match) return { name: match[1].trim(), email: match[2].trim() };
    return { email: address };
  }
}

module.exports = SendGridDriver;
