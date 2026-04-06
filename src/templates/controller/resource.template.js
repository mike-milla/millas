module.exports = `const { Controller } = require('millas/src');
{{#if model}}
const {{ model | pascalCase }} = require('../models/{{ model | pascalCase }}');
{{/if}}

class {{ name | pascalCase }}Controller extends Controller {
  async index(req, res) {
{{#if model}}
    const items = await {{ model | pascalCase }}.all();
    res.json(items);
{{else}}
    res.json({ message: 'List all {{ name | plural }}' });
{{/if}}
  }

  async show(req, res) {
{{#if model}}
    const item = await {{ model | pascalCase }}.find(req.params.id);
    if (!item) return res.status(404).json({ error: '{{ model | pascalCase }} not found' });
    res.json(item);
{{else}}
    res.json({ message: 'Show {{ name }} with id: ' + req.params.id });
{{/if}}
  }

  async store(req, res) {
{{#if model}}
    const item = await {{ model | pascalCase }}.create(req.body);
    res.status(201).json(item);
{{else}}
    res.status(201).json({ message: 'Create new {{ name }}', data: req.body });
{{/if}}
  }

  async update(req, res) {
{{#if model}}
    const item = await {{ model | pascalCase }}.find(req.params.id);
    if (!item) return res.status(404).json({ error: '{{ model | pascalCase }} not found' });
    await item.update(req.body);
    res.json(item);
{{else}}
    res.json({ message: 'Update {{ name }} with id: ' + req.params.id, data: req.body });
{{/if}}
  }

  async destroy(req, res) {
{{#if model}}
    const item = await {{ model | pascalCase }}.find(req.params.id);
    if (!item) return res.status(404).json({ error: '{{ model | pascalCase }} not found' });
    await item.delete();
    res.status(204).send();
{{else}}
    res.status(204).send();
{{/if}}
  }
}

module.exports = {{ name | pascalCase }}Controller;
`;
