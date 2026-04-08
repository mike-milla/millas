'use strict';

const Command = require('../console/Command');
const fs = require('fs');
const path = require('path');

class KeyCommand extends Command {
  static description = 'Manage application encryption keys';

  async onInit(register) {
    register
      .command(this.generate)
      .bool('show', 'Print the key without writing to .env')
      .bool('force', 'Overwrite existing APP_KEY without confirmation')
      .str('--cipher', v => v.optional(), 'Cipher to use (default: AES-256-CBC)')
      .description('Generate a new application key and write it to .env');
  }

  async generate(show, force, cipher = 'AES-256-CBC') {
    const { Encrypter } = require('../encryption/Encrypter');

    let key;
    try {
      key = Encrypter.generateKey(cipher);
    } catch (err) {
      throw new Error(err.message);
    }

    if (show) {
      this.info(key);
      return;
    }

    const envPath = path.resolve(this.cwd, '.env');

    if (!fs.existsSync(envPath)) {
      this.error('.env file not found.');
      this.error(this.style.muted('Run: millas new <project>  or create a .env file first.\n\n'));
      throw new Error('.env file not found');
    }

    let envContent = fs.readFileSync(envPath, 'utf8');

    const existing = envContent.match(/^APP_KEY=(.+)$/m);
    const hasValue = existing && existing[1] && existing[1].trim() !== '';

    if (hasValue && !force) {
      const ok = await this.confirm('APP_KEY already set. Overwrite?', false);
      if (!ok) {
        this.comment('Key not changed.');
        return;
      }
    }

    if (/^APP_KEY=/m.test(envContent)) {
      envContent = envContent.replace(/^APP_KEY=.*$/m, `APP_KEY=${key}`);
    } else {
      envContent += `\nAPP_KEY=${key}\n`;
    }

    fs.writeFileSync(envPath, envContent, 'utf8');

    this.success('Application key set.');
    this.comment(this.style.muted('APP_KEY=') + this.style.info(key));
  }
}

module.exports = KeyCommand;