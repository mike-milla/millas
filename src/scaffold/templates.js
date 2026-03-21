'use strict';

function getProjectFiles(projectName) {
  return {

    // ─── package.json ─────────────────────────────────────────────
    'package.json': JSON.stringify({
      name: projectName,
      version: '1.0.0',
      description: `A Millas application`,
      main: 'bootstrap/app.js',
      scripts: {
        start: 'node bootstrap/app.js',
        dev:   'millas serve',
        makemigrations:   'millas makemigration',
        migrate:   'millas migrate',
        serve: 'millas serve',
      },
      dependencies: {
        millas:  'latest',
        express: '^4.18.2',
        dotenv:  '^16.0.3',
      },
    }, null, 2),

    // ─── .env ─────────────────────────────────────────────────────
    '.env': `APP_NAME=${projectName}
APP_ENV=development
APP_PORT=3000
APP_KEY=
APP_URL=http://localhost:3000

DB_CONNECTION=sqlite
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=database/database.sqlite
DB_USERNAME=root
DB_PASSWORD=

MAIL_DRIVER=smtp
MAIL_HOST=smtp.mailtrap.io
MAIL_PORT=2525
MAIL_USERNAME=
MAIL_PASSWORD=

QUEUE_DRIVER=sync

CACHE_DRIVER=memory
`,

    // ─── .env.example ─────────────────────────────────────────────
    '.env.example': `APP_NAME=${projectName}
APP_ENV=development
APP_PORT=3000
APP_KEY=

DB_CONNECTION=sqlite
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=database/database.sqlite
DB_USERNAME=root
DB_PASSWORD=
`,

    // ─── .gitignore ───────────────────────────────────────────────
    '.gitignore': `node_modules/
.env
storage/logs/*.log
storage/uploads/*
!storage/uploads/.gitkeep
database/database.sqlite
`,

    // ─── bootstrap/app.js ─────────────────────────────────────────

    'bootstrap/app.js': `'use strict';

require('dotenv').config();

const path = require('path');
const { Millas } = require('millas');
const AppServiceProvider = require('../providers/AppServiceProvider');

/**
 * Application configuration and bootstrap.
 *
 * Millas.configure(__dirname/..) sets the project root so the framework
 * locates config files, models, and routes without guessing.
 *
 * Core providers (Database, Auth, Admin, Cache, Mail, Queue, Events)
 * are wired automatically — only add your own app providers below.
 *
 * First-time setup:
 *   millas migrate          # creates system tables (users, admin_log, sessions)
 *   millas createsuperuser  # creates your first admin panel user
 */
module.exports = Millas.configure(path.join(__dirname, '..'))
  .withAdmin()
  .routes(Route => {
    require('../routes/web')(Route);
    require('../routes/api')(Route);
  })
  .providers([AppServiceProvider])
  .create();
`,

    // ─── routes/web.js ────────────────────────────────────────────
    'routes/web.js': `'use strict';

/**
 * Web Routes
 *
 * Define your web-facing routes here using the Millas Route API.
 *
 *   Route.get('/path', ControllerClass, 'method')
 *   Route.get('/path', (req, res) => res.json({ ... }))
 *   Route.resource('/posts', PostController)
 *   Route.group({ prefix: '/v1', middleware: ['auth'] }, () => { ... })
 *   Route.auth('/auth')   — registers all auth routes
 */
module.exports = function (Route) {
  // Your web routes here
};
`,

    // ─── routes/api.js ────────────────────────────────────────────
    'routes/api.js': `'use strict';

/**
 * API Routes — all routes are prefixed with /api
 */
module.exports = function (Route) {
  Route.prefix('/api').group(() => {

    Route.get('/health', () =>
      jsonify({ status: 'ok', timestamp: new Date().toISOString() })
    );

    // Your API routes here:
    // Route.resource('/users', UserController);
    // Route.auth('/auth');

  });
};
`,

    // ─── config/app.js ────────────────────────────────────────────
    'config/app.js': `'use strict';

module.exports = {
  name: process.env.APP_NAME || 'Millas',
  env: process.env.APP_ENV || 'development',
  port: parseInt(process.env.APP_PORT, 10) || 3000,
  key: process.env.APP_KEY || '',
  url: process.env.APP_URL || 'http://localhost:3000',
  debug: process.env.APP_ENV !== 'production',
  timezone: 'UTC',
  locale:   'en',
  fallback: 'en',

  // Set use_i18n: true to enable the translation system.
  // Then run: millas lang:publish <locale>
  use_i18n: false,
};
`,

    // ─── config/database.js ───────────────────────────────────────
    'config/database.js': `'use strict';

module.exports = {
  default: process.env.DB_CONNECTION || 'sqlite',

  connections: {
    sqlite: {
      driver: 'sqlite',
      database: process.env.DB_DATABASE || 'database/database.sqlite',
    },
    mysql: {
      driver: 'mysql',
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      database: process.env.DB_DATABASE || 'millas',
      username: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || '',
    },
    postgres: {
      driver: 'postgres',
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      database: process.env.DB_DATABASE || 'millas',
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || '',
    },
  },
};
`,

    // ─── config/auth.js ───────────────────────────────────────────
    'config/auth.js': `'use strict';

module.exports = {
  default: 'jwt',

  guards: {
    jwt: {
      driver: 'jwt',
      secret: process.env.APP_KEY || 'change-me',
      expiresIn: '7d',
    },
    session: {
      driver: 'session',
    },
  },

  providers: {
    users: {
      model: 'User',
    },
  },

  passwordReset: {
    expiresIn: '1h',
  },
};
`,

    // ─── config/admin.js ──────────────────────────────────────────
    'config/admin.js': `'use strict';

/**
 * Admin Panel Configuration
 *
 * Credentials are read from environment variables by default.
 * Set ADMIN_EMAIL and ADMIN_PASSWORD in your .env file, or define
 * static users / a model here.
 */
module.exports = {
  // URL prefix for the admin panel
  prefix: '/admin',

  // Title shown in the browser tab and sidebar
  title: process.env.APP_NAME ? \`\${process.env.APP_NAME} Admin\` : 'Millas Admin',

  auth: {
    // ── Option 1: static user list (simple setups / local dev) ────
    users: [
      {
        email:    process.env.ADMIN_EMAIL    || 'admin@example.com',
        // Use a bcrypt hash in production; plain text is fine for local dev.
        password: process.env.ADMIN_PASSWORD || 'change-me',
        name:     process.env.ADMIN_NAME     || 'Admin',
      },
    ],

    // ── Option 2: model-based lookup ──────────────────────────────
    // Uncomment and set to any Millas Model that has email + password fields.
    // model: require('../app/models/User'),

    // ── Session cookie settings ───────────────────────────────────
    cookieName:   'millas_admin',
    cookieMaxAge: 60 * 60 * 8,        // 8 hours
    rememberAge:  60 * 60 * 24 * 30,  // 30 days ("remember me")

    // ── Brute-force protection ────────────────────────────────────
    maxAttempts:    5,
    lockoutMinutes: 15,
  },
};
`,

    // ─── config/mail.js ───────────────────────────────────────────
    'config/mail.js': `'use strict';

module.exports = {
  default: process.env.MAIL_DRIVER || 'smtp',

  drivers: {
    smtp: {
      host: process.env.MAIL_HOST || 'smtp.mailtrap.io',
      port: parseInt(process.env.MAIL_PORT, 10) || 2525,
      username: process.env.MAIL_USERNAME || '',
      password: process.env.MAIL_PASSWORD || '',
      encryption: 'tls',
    },
  },

  from: {
    address: process.env.MAIL_FROM_ADDRESS || 'hello@millas.dev',
    name: process.env.MAIL_FROM_NAME || 'Millas',
  },
};
`,

    // ─── providers/AppServiceProvider.js ──────────────────────────
    'providers/AppServiceProvider.js': `'use strict';

const { ServiceProvider } = require('millas/core/foundation');

/**
 * AppServiceProvider
 *
 * Register and bootstrap your application services here.
 *
 * beforeBoot(container) — runs first, before any register(). Synchronous.
 *                         Good for patching globals, loading config.
 * register(container)   — bind singletons, factories, instances.
 * boot(container, app)  — all providers registered. Async OK.
 *                         Good for routes, event listeners, admin resources.
 */
class AppServiceProvider extends ServiceProvider {
  register(container) {
    // container.bind('UserService', UserService);
    // container.singleton('Cache', CacheService);
    // container.instance('Config', require('../config/app'));
  }

  async boot(container, app) {
    // Register Admin resources — Admin panel is auto-mounted via .withAdmin()
    // const { Admin } = require('millas');
    // const { AdminResource, AdminField } = require('millas');
    // const Post = require('../app/models/Post');
    //
    // class PostResource extends AdminResource {
    //   static model      = Post;
    //   static label      = 'Posts';
    //   static searchable = ['title', 'body'];
    // }
    //
    // Admin.register(PostResource);
  }
}

module.exports = AppServiceProvider;
`,

    // ─── app/controllers/.gitkeep ────────────────────────────────
    'app/controllers/.gitkeep': '',
    'app/models/.gitkeep': '',
    'app/services/.gitkeep': '',
    'app/middleware/.gitkeep': '',
    'app/jobs/.gitkeep': '',

    // ─── README.md ────────────────────────────────────────────────
    'README.md': `# ${projectName}

A [Millas](https://millas.dev) application.

## Getting Started

\`\`\`bash
# Start the development server
millas serve

# Generate a controller
millas make:controller UserController

# Generate a model
millas make:model User

# Run migrations
millas migrate
\`\`\`

## Project Structure

\`\`\`
app/
  controllers/    # HTTP controllers
  models/         # ORM models
  services/       # Business logic
  middleware/     # HTTP middleware
  jobs/           # Background jobs
bootstrap/
  app.js          # Application entry point
config/           # Configuration files
database/
  migrations/     # Database migrations
  seeders/        # Database seeders
routes/
  web.js          # Web routes
  api.js          # API routes
storage/          # Logs, uploads
providers/        # Service providers
\`\`\`
`,
  };
}

module.exports = { getProjectFiles };