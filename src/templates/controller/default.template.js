module.exports = `const { Controller } = require('millas/src');

class {{ name | pascalCase }}Controller extends Controller {
  async handle(req, res) {
    res.json({ message: 'Hello from {{ name | pascalCase }}Controller' });
  }
}

module.exports = {{ name | pascalCase }}Controller;
`;
