'use strict';

const ServiceProvider = require('./ServiceProvider');
const Mail            = require('../mail/Mail');
const MailMessage     = require('../mail/MailMessage');

/**
 * MailServiceProvider
 *
 * Configures the Mail facade with config/mail.js settings.
 *
 * Add to bootstrap/app.js:
 *   app.providers([
 *     DatabaseServiceProvider,
 *     AuthServiceProvider,
 *     MailServiceProvider,
 *     AppServiceProvider,
 *   ])
 */
class MailServiceProvider extends ServiceProvider {
  register(container) {
    container.instance('Mail', Mail);
    container.alias('mail', 'Mail');
    container.instance('MailMessage', MailMessage);
  }

  async boot(container) {
    let mailConfig;
    try {
      mailConfig = require((container.make('basePath') || process.cwd()) + '/config/mail');
    } catch {
      mailConfig = {
        default:  process.env.MAIL_DRIVER || 'log',
        from:     { address: 'noreply@millas.dev', name: 'Millas' },
        drivers:  {
          log:  {},
          smtp: {
            host:       process.env.MAIL_HOST     || 'localhost',
            port:       Number(process.env.MAIL_PORT) || 587,
            username:   process.env.MAIL_USERNAME  || '',
            password:   process.env.MAIL_PASSWORD  || '',
            encryption: 'tls',
          },
        },
      };
    }

    Mail.configure(mailConfig);
  }
}

module.exports = MailServiceProvider;