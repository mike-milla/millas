'use strict';

const path = require('path');
const BaseCommand = require('../console/BaseCommand');
const SchematicEngine = require('../schematics/SchematicEngine');

class MakeCommand extends BaseCommand {
  static description = 'Generate application scaffolding';

  #engine = new SchematicEngine(path.join(__dirname, '../templates'));

  async onInit(register) {
    register
      .command(async (name, resource,model) => {
        const result = await this.#generate('controller', name, {resource,model});
        this.success(`Created: ${result.path}`);
      })
      .name('controller')
      .arg('name')
      .arg('--resource')
      .arg('--model', v => v.string())
      .description('Generate a new controller');

    register
      .command(async (name, migration) => {
          console.log(name,migration)
        const timestamp = Date.now();
        const results = await this.#generate('model', name, { migration, timestamp });
        if (Array.isArray(results)) {
          results.forEach(r => this.success(`Created: ${r.path}`));
        } else {
          this.success(`Created: ${results.path}`);
        }
      })
      .name('model')
      .arg('name')
      .arg('--migration')
      .description('Generate a new model');

    register
      .command(async (name) => {
        const result = await this.#generate('middleware', name);
        this.success(`Created: ${result.path}`);
      })
      .name('middleware')
      .arg('name')
      .description('Generate a new middleware');

    register
      .command(async (name) => {
        const result = await this.#generate('service', name);
        this.success(`Created: ${result.path}`);
      })
      .name('service')
      .arg('name')
      .description('Generate a new service class');

    register
      .command(async (name) => {
        const result = await this.#generate('job', name);
        this.success(`Created: ${result.path}`);
      })
      .name('job')
      .arg('name')
      .description('Generate a new background job');

    register
      .command(async (name) => {
        const timestamp = Date.now();
        const result = await this.#generate('migration', name, {timestamp });
        this.success(`Created: ${result.path}`);
      })
      .name('migration')
      .arg('name')
      .description('Generate a blank migration file');

    register
      .command(async (name) => {
        const result = await this.#generate('shape', name);
        this.success(`Created: ${result.path}`);
      })
      .name('shape')
      .arg('name')
      .description('Generate a shape file with Create/Update contracts (app/shapes/)');

    register
      .command(async (name) => {
        const result = await this.#generate('command', name);
        this.success(`Created: ${result.path}`);
      })
      .name('command')
      .arg('name')
      .description('Generate a new custom console command in app/commands/');
  }

  async #generate(type, name, options) {
      return await this.#engine.generate(type, {name}, options);
  }
}

module.exports = MakeCommand;
