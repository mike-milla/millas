module.exports = `const { Shape } = require('millas/src');

class {{ name | pascalCase }}Shape extends Shape {
  static rules = {
    // Define validation rules here
    // Example: name: v => v.string().required(),
  };
}

module.exports = {{ name | pascalCase }}Shape;
`;
