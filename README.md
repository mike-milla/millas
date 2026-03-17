# Millas Framework

> A modern, batteries-included backend framework for Node.js.  
> Built on Express. Inspired by Laravel, Django, and FastAPI.

## Quick Start

```bash
npm install -g millas

millas new my-app
cd my-app
millas serve
```

## What's included (Phases 1–7)

| Phase | Feature |
|-------|---------|
| 1 | CLI + Project Scaffolding |
| 2 | Router (`Route.get/post/resource/group/prefix/middleware`) |
| 3 | Controllers + Middleware Pipeline + Built-in middleware |
| 4 | Dependency Injection Container + Service Providers |
| 5 | ORM + Models (`Model.find/create/where/paginate`) |
| 6 | Migration System (`millas makemigrations`, `millas migrate`) |
| 7 | Auth System (JWT, bcrypt, `Auth.login/register`, `AuthMiddleware`) |

## CLI Reference

```bash
# Project
millas new <name>
millas serve

# Generators
millas make:controller UserController --resource
millas make:model User --migration
millas make:middleware AuthMiddleware
millas make:service PaymentService
millas make:job SendEmailJob

# Migrations
millas makemigrations
millas migrate
millas migrate:rollback
millas migrate:fresh
millas migrate:status
millas migrate:reset
millas migrate:refresh
millas db:seed

# Utilities
millas route:list
```

## Routing

```js
// routes/api.js
module.exports = function (Route) {
  Route.get('/users', UserController, 'index');
  Route.resource('/posts', PostController);

  Route.prefix('/api/v1').middleware(['auth']).group(() => {
    Route.resource('/orders', OrderController);
  });

  // Register all auth routes at once
  Route.auth('/auth');
};
```

## Models

```js
const { Model, fields } = require('millas/src');

class User extends Model {
  static table  = 'users';
  static fields = {
    id:         fields.id(),
    name:       fields.string({ max: 100 }),
    email:      fields.string({ unique: true }),
    password:   fields.string(),
    role:       fields.enum(['admin', 'user'], { default: 'user' }),
    created_at: fields.timestamp(),
    updated_at: fields.timestamp(),
  };
}
```

## Authentication

```js
const { Auth } = require('millas/src');

// Register
const user = await Auth.register({ name, email, password });

// Login
const { user, token } = await Auth.login(email, password);

// Protect routes
Route.prefix('/api').middleware(['auth']).group(() => {
  Route.get('/me', UserController, 'me');
});

// Inside controller
const user = await Auth.user(req);
```

## Service Providers

```js
class AppServiceProvider extends ServiceProvider {
  register(container) {
    container.singleton('PaymentService', PaymentService);
  }
  async boot(container, app) {
    // called after all providers registered
  }
}
```

## Roadmap

- Phase 8:  Mail (SMTP, SendGrid, Mailgun)
- Phase 9:  Queues (Redis, DB drivers)
- Phase 10: Event System
- Phase 11: Caching + File Storage
- Phase 12: Admin Panel
- Phase 13: Testing Utilities
- Phase 14: Production Optimizations

## License

MIT
