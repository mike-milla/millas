module.exports = `const { Model, fields } = require('millas/src');

class {{ name | pascalCase }} extends Model {
  static table = '{{ name | snakeCase | plural }}';
  
  static fields = {
    id: fields.id(),
    created_at: fields.timestamp(),
    updated_at: fields.timestamp(),
  };
}

module.exports = {{ name | pascalCase }};
`;
