'use strict';

const BaseCommand = require('../console/BaseCommand');
const fs = require('fs');
const path = require('path');

class KeyCommand extends BaseCommand {
  static description = 'Manage application encryption keys';

  async onInit(register) {
    register
      .command(this.generate)
      .arg('--show', 'Print the key without writing to .env')
      .arg('--force', 'Overwrite existing APP_KEY without confirmation')
      .arg('--cipher', v=>v.string(),'Cipher to use (default: AES-256-CBC)')
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
      this.logger.log('\n  ' + this.style.info(key) + '\n');
      return;
    }

    const envPath = path.resolve(this.cwd, '.env');

    if (!fs.existsSync(envPath)) {
      this.error('.env file not found.');
      this.logger.error(this.style.muted('     Run: millas new <project>  or create a .env file first.\n\n'));
      throw new Error('.env file not found');
    }

    let envContent = fs.readFileSync(envPath, 'utf8');

    const existing = envContent.match(/^APP_KEY=(.+)$/m);
    const hasValue = existing && existing[1] && existing[1].trim() !== '';

    if (hasValue && !force) {
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise(resolve => {
        rl.question(
          this.style.warning('\n  ⚠  APP_KEY already set. Overwrite? (y/N) '),
          ans => { rl.close(); resolve(ans); }
        );
      });
      if ((answer || '').trim().toLowerCase() !== 'y') {
        this.logger.log(this.style.muted('\n  Key not changed.\n'));
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
    this.logger.log('  ' + this.style.muted('APP_KEY=') + this.style.info(key) + '\n');
  }
}

module.exports = KeyCommand;