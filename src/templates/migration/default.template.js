module.exports = `const { Migration } = require('millas/src');

class {{ name | pascalCase }} extends Migration {
  async up(schema) {
    // Define schema changes here
  }

  async down(schema) {
    // Reverse schema changes here
  }
}

module.exports = {{ name | pascalCase }};
`;
