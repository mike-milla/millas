module.exports = `const { Migration } = require('millas/src');

class Create{{ name | pascalCase | plural }}Table extends Migration {
  async up(schema) {
    await schema.createTable('{{ name | snakeCase | plural }}', (table) => {
      table.id();
      table.timestamps();
    });
  }

  async down(schema) {
    await schema.dropTable('{{ name | snakeCase | plural }}');
  }
}

module.exports = Create{{ name | pascalCase | plural }}Table;
`;
