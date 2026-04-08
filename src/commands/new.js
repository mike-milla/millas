'use strict';

const Command = require('../console/Command');
const fs = require('fs-extra');
const path = require('path');
const ora = require('ora');
const { generateProject } = require('../scaffold/generator');

class NewCommand extends Command {
  static description = 'Create a new Millas project';

  async onInit(register) {
    register
      .command(async (projectName, install) => {
        this.logger.log('');
        this.logger.log(this.style.info('  ⚡ Millas Framework'));
        this.logger.log(this.style.muted('  Creating a new project...\n'));

        const targetDir = path.resolve(this.cwd, projectName);

        if (fs.existsSync(targetDir)) {
          throw new Error(`Directory "${projectName}" already exists.`);
        }

        const spinner = ora(`  Scaffolding project ${this.style.bold(projectName)}`).start();

        try {
          await generateProject(projectName, targetDir);
          spinner.succeed(this.style.success(`  Project "${projectName}" created successfully!`));

          if (install !== false) {
            const installSpinner = ora('  Installing dependencies...').start();
            const { execSync } = require('child_process');
            execSync('npm install', { cwd: targetDir, stdio: 'ignore' });
            installSpinner.succeed(this.style.success('  Dependencies installed!'));
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
              this.logger.log(this.style.success('  ✔  Application key generated.'));
            }
          } catch { /* non-fatal — developer can run millas key:generate */ }

          this.logger.log('');
          this.logger.log(this.style.bold('  Next steps:'));
          this.logger.log(this.style.info(`    cd ${projectName}`));
          this.logger.log(this.style.info('    millas serve'));
          this.logger.log('');
        } catch (err) {
          spinner.fail(this.style.danger('  Failed to create project.'));
          throw err;
        }
      })
      .name('new')
      .str('projectName', 'Project name')
      .bool('install', 'Install dependencies')
      .description('Create a new Millas project');
  }
}

module.exports = NewCommand;
