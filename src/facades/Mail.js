'use strict';

const { createFacade } = require('./Facade');
// const { MailMessage, TemplateEngine, SmtpDriver, SendGridDriver, MailgunDriver, LogDriver, MailServiceProvider } = require('../core');

/**
 * Mail facade.
 *
 * @class
 * @property {function(MailMessage|object): Promise<void>} send
 * @property {function(MailMessage|object): Promise<void>} queue
 * @property {function(string, string=): MailMessage}      to
 * @property {function(object): void}                      swap
 * @property {function(): void}                            restore
 *
 * — MailMessage builder (returned by Mail.to())
 * @property {function(string, string=): MailMessage}           MailMessage.prototype.to
 * @property {function(string, string=): MailMessage}           MailMessage.prototype.cc
 * @property {function(string, string=): MailMessage}           MailMessage.prototype.bcc
 * @property {function(string, string=): MailMessage}           MailMessage.prototype.from
 * @property {function(string, string=): MailMessage}           MailMessage.prototype.replyTo
 * @property {function(string): MailMessage}                    MailMessage.prototype.subject
 * @property {function(string): MailMessage}                    MailMessage.prototype.html
 * @property {function(string): MailMessage}                    MailMessage.prototype.text
 * @property {function(string, object=): MailMessage}           MailMessage.prototype.view
 * @property {function(string, string=, string=): MailMessage}  MailMessage.prototype.attach
 * @property {function(number): MailMessage}                    MailMessage.prototype.priority
 * @property {function(): Promise<void>}                        MailMessage.prototype.send
 * @property {function(): Promise<void>}                        MailMessage.prototype.queue
 *
 * @see src/mail/Mail.js
 */
class Mail extends createFacade('mail') {}

module.exports = Mail