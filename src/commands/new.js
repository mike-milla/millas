'use strict';

const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');
const ora = require('ora');
const { generateProject } = require('../scaffold/generator');

module.exports = function (program) {
  program
    .command('new <project-name>')
    .description('Create a new Millas project')
    .option('--no-install', 'Skip npm install')
    .action(async (projectName, options) => {
      console.log();
      console.log(chalk.cyan('  ⚡ Millas Framework'));
      console.log(chalk.gray('  Creating a new project...\n'));

      const targetDir = path.resolve(process.cwd(), projectName);

      if (fs.existsSync(targetDir)) {
        console.error(chalk.red(`  ✖ Directory "${projectName}" already exists.\n`));
        process.exit(1);
      }

      const spinner = ora(`  Scaffolding project ${chalk.bold(projectName)}`).start();

      try {
        await generateProject(projectName, targetDir);
        spinner.succeed(chalk.green(`  Project "${projectName}" created successfully!`));

        if (options.install !== false) {
          const installSpinner = ora('  Installing dependencies...').start();
          const { execSync } = require('child_process');
          execSync('npm install', { cwd: targetDir, stdio: 'ignore' });
          installSpinner.succeed(chalk.green('  Dependencies installed!'));
        }

        // Auto-generate APP_KEY into the new project's .env
        try {
          const { Encrypter } = require('../encryption/Encrypter');
          const envPath = path.join(targetDir, '.env');
          const key = Encrypter.generateKey('AES-256-CBC');
          if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8');
            envContent = /^APP_KEY=/m.test(envContent)
              ? envContent.replace(/^APP_KEY=.*$/m, `APP_KEY=${key}`)
              : envContent + `\nAPP_KEY=${key}\n`;
            fs.writeFileSync(envPath, envContent, 'utf8');
            console.log(chalk.green('  ✔  Application key generated.'));
          }
        } catch { /* non-fatal — developer can run millas key:generate */ }

        console.log();
        console.log(chalk.bold('  Next steps:'));
        console.log(chalk.cyan(`    cd ${projectName}`));
        console.log(chalk.cyan('    millas serve'));
        console.log();
      } catch (err) {
        spinner.fail(chalk.red('  Failed to create project.'));
        console.error(chalk.red(`\n  Error: ${err.message}\n`));
        process.exit(1);
      }
    });
};