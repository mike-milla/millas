class Template {
  constructor(content, options = {}) {
    this.content = content;
    this.helpers = options.helpers || {};
  }

  render(data) {
    let result = this.content;
    
    // Handle conditionals: {{#if key}}...{{else}}...{{/if}}
    result = this.#processConditionals(result, data);
    
    // Handle loops: {{#each key}}...{{/each}}
    result = this.#processLoops(result, data);
    
    // Handle variables: {{ name }}, {{ name | filter | filter2 }}
    result = result.replace(/\{\{\s*([^}#/|]+)(\s*\|\s*([^}]+))?\s*\}\}/g, 
      (match, key, _, filters) => {
        let value = data[key.trim()];
        if (value === undefined || value === null) return '';
        if (filters) value = this.#applyFilters(value, filters.trim());
        return value;
      }
    );
    
    return result;
  }

  #processConditionals(content, data) {
    // Handle {{#if !key}} negation
    content = content.replace(/\{\{#if\s+!(\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (match, key, trueBranch, falseBranch = '') => {
        return !data[key] ? trueBranch : falseBranch;
      }
    );
    
    // Handle {{#if key}}
    content = content.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (match, key, trueBranch, falseBranch = '') => {
        return data[key] ? trueBranch : falseBranch;
      }
    );
    
    return content;
  }

  #processLoops(content, data) {
    return content.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (match, key, template) => {
        const items = data[key];
        if (!Array.isArray(items)) return '';
        return items.map(item => {
          const itemTemplate = new Template(template);
          return itemTemplate.render(typeof item === 'object' ? item : { item });
        }).join('');
      }
    );
  }

  #applyFilters(value, filtersStr) {
    const filterNames = filtersStr.split('|').map(f => f.trim());
    return filterNames.reduce((val, filterName) => this.#applyFilter(val, filterName), value);
  }

  #applyFilter(value, filter) {
    if (value === undefined || value === null) return value;
    
    const filters = {
      pascalCase: str => String(str).replace(/(?:^|[-_])(\w)/g, (_, c) => c.toUpperCase()).replace(/[-_]/g, ''),
      camelCase: str => {
        const pascal = String(str).replace(/(?:^|[-_])(\w)/g, (_, c) => c.toUpperCase()).replace(/[-_]/g, '');
        return pascal.charAt(0).toLowerCase() + pascal.slice(1);
      },
      snakeCase: str => String(str).replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c.toLowerCase()).replace(/[-\s]/g, '_'),
      kebabCase: str => String(str).replace(/[A-Z]/g, (c, i) => (i ? '-' : '') + c.toLowerCase()).replace(/[_\s]/g, '-'),
      plural: str => {
        const s = String(str);
        if (s.endsWith('s')) return s;
        if (s.endsWith('y')) return s.slice(0, -1) + 'ies';
        return s + 's';
      },
      singular: str => {
        const s = String(str);
        if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
        if (s.endsWith('s')) return s.slice(0, -1);
        return s;
      },
      lower: str => String(str).toLowerCase(),
      upper: str => String(str).toUpperCase(),
    };
    
    const customFilter = this.helpers[filter];
    if (customFilter) return customFilter(value);
    
    return filters[filter]?.(value) ?? value;
  }
}

module.exports = Template;
