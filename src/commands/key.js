'use strict';

const chalk  = require('chalk');
const fs     = require('fs');
const path   = require('path');

/**
 * `millas key:generate`
 *
 * Generates a cryptographically random APP_KEY and writes it into the
 * project's .env file — exactly like Laravel's `php artisan key:generate`.
 *
 * ── Behaviour ────────────────────────────────────────────────────────────────
 *
 *   - Reads the .env file in the current working directory
 *   - Replaces (or appends) the APP_KEY= line with the new key
 *   - Prints the key to stdout
 *   - Use --show to print the key without writing to .env
 *   - Use --force to overwrite an existing non-empty APP_KEY without prompting
 *
 * ── Examples ─────────────────────────────────────────────────────────────────
 *
 *   millas key:generate               — generate and write to .env
 *   millas key:generate --show        — print only, don't write
 *   millas key:generate --force       — overwrite existing key without prompt
 *   millas key:generate --cipher AES-128-CBC
 */
module.exports = function (program) {
  program
    .command('key:generate')
    .description('Generate a new application key and write it to .env')
    .option('--show',           'Print the key without writing to .env')
    .option('--force',          'Overwrite existing APP_KEY without confirmation')
    .option('--cipher <cipher>', 'Cipher to use (default: AES-256-CBC)', 'AES-256-CBC')
    .action(async (options) => {
      const { Encrypter } = require('../encryption/Encrypter');

      // Generate the key
      let key;
      try {
        key = Encrypter.generateKey(options.cipher);
      } catch (err) {
        process.stderr.write(chalk.red(`\n  ✖  ${err.message}\n\n`));
        process.exit(1);
      }

      // --show: just print, don't touch .env
      if (options.show) {
        console.log('\n  ' + chalk.cyan(key) + '\n');
        return;
      }

      const envPath = path.resolve(process.cwd(), '.env');

      if (!fs.existsSync(envPath)) {
        process.stderr.write(chalk.red('\n  ✖  .env file not found.\n'));
        process.stderr.write(chalk.dim('     Run: millas new <project>  or create a .env file first.\n\n'));
        process.exit(1);
      }

      let envContent = fs.readFileSync(envPath, 'utf8');

      // Check if APP_KEY already has a value
      const existing = envContent.match(/^APP_KEY=(.+)$/m);
      const hasValue = existing && existing[1] && existing[1].trim() !== '';

      if (hasValue && !options.force) {
        // Prompt for confirmation
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise(resolve => {
          rl.question(
            chalk.yellow('\n  ⚠  APP_KEY already set. Overwrite? (y/N) '),
            ans => { rl.close(); resolve(ans); }
          );
        });
        if ((answer || '').trim().toLowerCase() !== 'y') {
          console.log(chalk.dim('\n  Key not changed.\n'));
          return;
        }
      }

      // Write the key into .env
      if (/^APP_KEY=/m.test(envContent)) {
        // Replace existing line
        envContent = envContent.replace(/^APP_KEY=.*$/m, `APP_KEY=${key}`);
      } else {
        // Append if APP_KEY line is missing entirely
        envContent += `\nAPP_KEY=${key}\n`;
      }

      fs.writeFileSync(envPath, envContent, 'utf8');

      console.log(chalk.green('\n  ✔  Application key set.\n'));
      console.log('  ' + chalk.dim('APP_KEY=') + chalk.cyan(key) + '\n');
    });
};