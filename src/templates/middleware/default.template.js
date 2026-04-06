module.exports = `const { Middleware } = require('millas/src');

class {{ name | pascalCase }}Middleware extends Middleware {
  async handle(req, res, next) {
    // Add your middleware logic here
    next();
  }
}

module.exports = {{ name | pascalCase }}Middleware;
`;
