'use strict';

const chalk = require('chalk');
const { makeController, makeModel, makeMiddleware, makeService, makeJob, makeMigration, makeShape } = require('../scaffold/maker');

module.exports = function (program) {

  program
    .command('make:controller <name>')
    .description('Generate a new controller')
    .option('--resource', 'Generate a resource controller with CRUD methods')
    .action(async (name, options) => {
      await run('Controller', () => makeController(name, options));
    });

  program
    .command('make:model <name>')
    .description('Generate a new model')
    .option('-m, --migration', 'Also create a migration file')
    .action(async (name, options) => {
      await run('Model', () => makeModel(name, options));
    });

  program
    .command('make:middleware <name>')
    .description('Generate a new middleware')
    .action(async (name) => {
      await run('Middleware', () => makeMiddleware(name));
    });

  program
    .command('make:service <name>')
    .description('Generate a new service class')
    .action(async (name) => {
      await run('Service', () => makeService(name));
    });

  program
    .command('make:job <name>')
    .description('Generate a new background job')
    .action(async (name) => {
      await run('Job', () => makeJob(name));
    });

  program
    .command('make:migration <name>')
    .description('Generate a blank migration file')
    .action(async (name) => {
      await run('Migration', () => makeMigration(name));
    });

  program
    .command('make:shape <n>')
    .description('Generate a shape file with Create/Update contracts (app/shapes/)')
    .action(async (name) => {
      await run('Shape', () => makeShape(name));
    });
};

async function run(type, fn) {
  try {
    const filePath = await fn();
    console.log(chalk.green(`\n  ✔ ${type} created: `) + chalk.cyan(filePath) + '\n');
  } catch (err) {
    console.error(chalk.red(`\n  ✖ Failed to create ${type}: ${err.message}\n`));
    process.exit(1);
  }
}