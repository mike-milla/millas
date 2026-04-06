const fs = require('fs');
const path = require('path');
const Template = require('./Template');

class SchematicEngine {
  constructor(templatesDir) {
    this.templatesDir = templatesDir;
  }

  load(name) {
    const dir = path.join(this.templatesDir, name);
    const schemaPath = path.join(dir, 'schema.json');
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schematic not found: ${name}`);
    }
    
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    return { schema, dir };
  }

  async generate(name, data, options = {}) {
    const { schema, dir } = this.load(name);
    
    this.#validate(schema, data, options);

    const results = [];
    const allData = { ...data, ...options };

    for (const fileConfig of schema.files) {
      // Skip conditional files if condition not met
      if (fileConfig.condition && !options[fileConfig.condition]) {
        continue;
      }
      
      const templateFile = this.#selectTemplate(schema, fileConfig, options);
      const templatePath = path.join(dir, templateFile);
      
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Template file not found: ${templateFile}`);
      }
      
      const templateContent = require(templatePath);
      const template = new Template(templateContent, { helpers: schema.helpers || {} });
      const rendered = template.render(allData);

      const outputPath = this.#resolveOutputPath(fileConfig.output, allData);

      if (fs.existsSync(outputPath) && !options.force) {
        throw new Error(`File already exists: ${outputPath}. Use --force to overwrite.`);
      }

      this.#ensureDir(path.dirname(outputPath));
      fs.writeFileSync(outputPath, rendered);

      results.push({ path: outputPath, content: rendered });
    }

    return results.length === 1 ? results[0] : results;
  }

  #validate(schema, data, options) {
    for (const arg of schema.arguments || []) {
      const value = data[arg.name];
      
      if (arg.required && !value) {
        throw new Error(`Missing required argument: ${arg.name}`);
      }
      
      if (value && arg.type) {
        const actualType = typeof value;
        if (actualType !== arg.type) {
          throw new Error(`Argument '${arg.name}' must be of type ${arg.type}, got ${actualType}`);
        }
      }
      
      if (value && arg.enum && !arg.enum.includes(value)) {
        throw new Error(`Argument '${arg.name}' must be one of: ${arg.enum.join(', ')}`);
      }
    }
    
    for (const opt of schema.options || []) {
      const value = options[opt.name];
      
      if (value !== undefined && opt.type) {
        const actualType = typeof value;
        if (actualType !== opt.type) {
          throw new Error(`Option '${opt.name}' must be of type ${opt.type}, got ${actualType}`);
        }
      }
      
      if (value && opt.enum && !opt.enum.includes(value)) {
        throw new Error(`Option '${opt.name}' must be one of: ${opt.enum.join(', ')}`);
      }
    }
  }

  #selectTemplate(schema, fileConfig, options) {
    for (const [key, value] of Object.entries(options)) {
      if (value === true) {
        const variant = `${key}.template.js`;
        if (fs.existsSync(path.join(this.templatesDir, schema.name, variant))) {
          return variant;
        }
      }
    }
    return fileConfig.template;
  }

  #resolveOutputPath(pattern, allData) {
    const template = new Template(pattern);
    return path.join(process.cwd(), template.render(allData));
  }

  #ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

module.exports = SchematicEngine;
