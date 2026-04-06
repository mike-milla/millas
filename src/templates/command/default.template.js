module.exports = `const { BaseCommand } = require('millas/src/console');

class {{ name | pascalCase }}Command extends BaseCommand {
  static signature = '{{ name | kebabCase }}';
  static description = '{{ name | pascalCase }} command description';

  async run(args, opts) {
    this.info('Running {{ name | pascalCase }}Command');
    // Command logic here
  }
}

module.exports = {{ name | pascalCase }}Command;
`;
