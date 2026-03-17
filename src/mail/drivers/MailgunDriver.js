'use strict';

/**
 * MailgunDriver
 *
 * Sends mail via the Mailgun API v3.
 * No extra npm package needed.
 *
 * Config (config/mail.js):
 *   drivers: {
 *     mailgun: {
 *       key:    process.env.MAILGUN_API_KEY,
 *       domain: process.env.MAILGUN_DOMAIN,
 *       region: 'us',   // 'us' | 'eu'
 *     }
 *   }
 */
class MailgunDriver {
  constructor(config = {}) {
    this._key    = config.key    || process.env.MAILGUN_API_KEY;
    this._domain = config.domain || process.env.MAILGUN_DOMAIN;
    this._region = config.region || 'us';

    if (!this._key)    throw new Error('MailgunDriver: API key is required');
    if (!this._domain) throw new Error('MailgunDriver: domain is required');
  }

  async send(message) {
    const params = new URLSearchParams();

    const toStr = [].concat(message.to).join(', ');
    params.append('from',    message.from);
    params.append('to',      toStr);
    params.append('subject', message.subject);

    if (message.cc)   params.append('cc',  [].concat(message.cc).join(', '));
    if (message.bcc)  params.append('bcc', [].concat(message.bcc).join(', '));
    if (message.html) params.append('html', message.html);
    if (message.text) params.append('text', message.text);

    const host = this._region === 'eu'
      ? 'api.eu.mailgun.net'
      : 'api.mailgun.net';

    return this._post(host, `/v3/${this._domain}/messages`, params.toString());
  }

  _post(host, path, body) {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const auth  = Buffer.from(`api:${this._key}`).toString('base64');

      const options = {
        hostname: host,
        port:     443,
        path,
        method:   'POST',
        headers:  {
          'Authorization': `Basic ${auth}`,
          'Content-Type':  'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end',  () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(raw || '{}'));
          } else {
            reject(new Error(`Mailgun error ${res.statusCode}: ${raw}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = MailgunDriver;
