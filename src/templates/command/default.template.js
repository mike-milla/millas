module.exports = `const { Command } = require('millas/console');

class {{ name | pascalCase }}Command extends Command {
  static description = '{{ name | pascalCase }} command description';

  async onInit(register) {
    register
      .command(async () => {
        this.info('Running {{ name | pascalCase }}');
        // Command logic here
      })
      .description('{{ name | pascalCase }} command description');
  }
}

module.exports = {{ name | pascalCase }}Command;
`;
