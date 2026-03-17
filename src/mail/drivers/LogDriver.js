'use strict';

/**
 * LogDriver
 *
 * Development mail driver — logs messages to the console
 * instead of actually sending them.
 *
 * Set MAIL_DRIVER=log in .env to activate.
 * Also used as a fallback when no driver is configured.
 */
class LogDriver {
  constructor(config = {}) {
    this._silent = config.silent || false;
  }

  async send(message) {
    if (this._silent) return { logged: true, message };

    const sep = '─'.repeat(60);
    console.log(`\n  📧 Mail (LogDriver)\n  ${sep}`);
    console.log(`  From:    ${message.from}`);
    console.log(`  To:      ${[].concat(message.to).join(', ')}`);
    if (message.cc)  console.log(`  CC:      ${[].concat(message.cc).join(', ')}`);
    if (message.bcc) console.log(`  BCC:     ${[].concat(message.bcc).join(', ')}`);
    console.log(`  Subject: ${message.subject}`);
    if (message.text) {
      console.log(`  \n  ${message.text.slice(0, 200)}${message.text.length > 200 ? '...' : ''}`);
    }
    console.log(`  ${sep}\n`);

    return { logged: true, message };
  }
}

module.exports = LogDriver;
