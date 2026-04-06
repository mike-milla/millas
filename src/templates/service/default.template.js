module.exports = `class {{ name | pascalCase }}Service {
  constructor() {
    // Initialize service
  }

  async execute() {
    // Service logic here
  }
}

module.exports = {{ name | pascalCase }}Service;
`;
