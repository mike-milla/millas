module.exports = `const { Job } = require('millas/src');

class {{ name | pascalCase }}Job extends Job {
  async handle(data) {
    // Job logic here
    this.logger.info('Processing {{ name | pascalCase }}Job', data);
  }
}

module.exports = {{ name | pascalCase }}Job;
`;
