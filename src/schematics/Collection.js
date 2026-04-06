const SchematicEngine = require('./SchematicEngine');

class Collection {
  constructor(name, templatesDir) {
    this.name = name;
    this.engine = new SchematicEngine(templatesDir);
    this.schematics = new Map();
  }

  add(name, schematicName) {
    this.schematics.set(name, schematicName);
    return this;
  }

  async generate(name, data, options = {}) {
    const schematicName = this.schematics.get(name);
    if (!schematicName) {
      throw new Error(`Schematic '${name}' not found in collection '${this.name}'`);
    }
    return await this.engine.generate(schematicName, data, options);
  }

  list() {
    return Array.from(this.schematics.keys());
  }
}

module.exports = Collection;
