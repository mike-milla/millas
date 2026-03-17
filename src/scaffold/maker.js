'use strict';

const fs = require('fs-extra');
const path = require('path');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveAppPath(...segments) {
  return path.resolve(process.cwd(), ...segments);
}

function timestamp() {
  return new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
}

function pascalCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function write(filePath, content) {
  await fs.ensureDir(path.dirname(filePath));
  if (await fs.pathExists(filePath)) {
    throw new Error(`File already exists: ${filePath}`);
  }
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

// ─── Generators ───────────────────────────────────────────────────────────────

async function makeController(name, options = {}) {
  const className = pascalCase(name.endsWith('Controller') ? name : `${name}Controller`);
  const filePath = resolveAppPath('app/controllers', `${className}.js`);

  const resource = options.resource;

  const content = resource
    ? `'use strict';

const { Controller } = require('millas');
const { string, email, number } = require('millas/validation');

/**
 * ${className}
 *
 * Resource controller — handles CRUD operations.
 */
class ${className} extends Controller {
  /** GET /${name.toLowerCase()}s */
  async index({ query }) {
    return this.ok({ data: [] });
  }

  /** GET /${name.toLowerCase()}s/:id */
  async show({ params }) {
    return this.ok({ data: { id: params.id } });
  }

  /** POST /${name.toLowerCase()}s */
  async store({ body }) {
    const data = await body.validate({
      // name: string().required().max(255),
    });
    return this.created({ data });
  }

  /** PUT /${name.toLowerCase()}s/:id */
  async update({ params, body }) {
    const data = body.except(['id']);
    return this.ok({ data: { id: params.id, ...data } });
  }

  /** DELETE /${name.toLowerCase()}s/:id */
  async destroy({ params }) {
    return this.noContent();
  }
}

module.exports = ${className};
`
    : `'use strict';

const { Controller } = require('millas');

/**
 * ${className}
 */
class ${className} extends Controller {
  async index({ query }) {
    return this.ok({ message: 'Hello from ${className}' });
  }
}

module.exports = ${className};
`;

  return write(filePath, content);
}

async function makeModel(name, options = {}) {
  const className = pascalCase(name);
  const tableName = name.toLowerCase() + 's';
  const filePath = resolveAppPath('app/models', `${className}.js`);

  const content = `'use strict';

const { Model, fields } = require('millas');

/**
 * ${className} Model
 *
 * Represents the "${tableName}" table.
 * Run: millas makemigrations  — to generate the migration.
 * Run: millas migrate         — to apply it.
 */
class ${className} extends Model {
  static table = '${tableName}';

  static fields = {
    id:         fields.id(),
    created_at: fields.timestamp(),
    updated_at: fields.timestamp(),
  };
}

module.exports = ${className};
`;

  const result = await write(filePath, content);

  if (options.migration) {
    await makeMigration(`create_${tableName}_table`);
  }

  return result;
}

async function makeMiddleware(name) {
  const className = pascalCase(name.endsWith('Middleware') ? name : `${name}Middleware`);
  const filePath = resolveAppPath('app/middleware', `${className}.js`);

  const content = `'use strict';

const { Middleware } = require('millas');

/**
 * ${className}
 *
 * Usage:
 *   1. Register in bootstrap/app.js:
 *        middlewareRegistry.register('${name.toLowerCase()}', ${className});
 *
 *   2. Apply to routes:
 *        Route.middleware(['${name.toLowerCase()}']).group(() => { ... });
 */
class ${className} extends Middleware {
  /**
   * Handle the incoming request.
   * Call next() to continue, or return a response to halt the chain.
   */
  async handle({ req }, next) {
    // Destructure what you need: { params, body, query, user, headers, req }
    // Return a MillasResponse to short-circuit, or call next() to continue.

    return next();
  }
}

module.exports = ${className};
`;

  return write(filePath, content);
}

async function makeService(name) {
  const className = pascalCase(name.endsWith('Service') ? name : `${name}Service`);
  const filePath = resolveAppPath('app/services', `${className}.js`);

  const content = `'use strict';

/**
 * ${className}
 *
 * Business logic service.
 * Register in AppServiceProvider:
 *   container.bind('${className}', ${className});
 */
class ${className} {
  constructor() {
    // Inject dependencies here (Phase 4)
  }
}

module.exports = ${className};
`;

  return write(filePath, content);
}

async function makeJob(name) {
  const className = pascalCase(name.endsWith('Job') ? name : `${name}Job`);
  const filePath = resolveAppPath('app/jobs', `${className}.js`);

  const content = `'use strict';

/**
 * ${className}
 *
 * Background job — dispatched via:
 *   dispatch(new ${className}(payload))
 *
 * Phase 9: Queue system will process this job.
 */
class ${className} {
  constructor(payload = {}) {
    this.payload = payload;
  }

  /**
   * Execute the job.
   */
  async handle() {
    // Your job logic here
    console.log('${className} running with:', this.payload);
  }
}

module.exports = ${className};
`;

  return write(filePath, content);
}

async function makeMigration(name) {
  const fileName = `${timestamp()}_${name}.js`;
  const filePath = resolveAppPath('database/migrations', fileName);

  const content = `'use strict';

/**
 * Migration: ${name}
 */
module.exports = {
  async up(db) {
    // Write your migration here
    // Example:
    // await db.schema.createTable('users', (table) => {
    //   table.id();
    //   table.string('name');
    //   table.string('email').unique();
    //   table.timestamps();
    // });
  },

  async down(db) {
    // Rollback logic here
    // await db.schema.dropTableIfExists('users');
  },
};
`;

  return write(filePath, content);
}

module.exports = {
  makeController,
  makeModel,
  makeMiddleware,
  makeService,
  makeJob,
  makeMigration,
};
