# Middleware

Middleware provides a convenient mechanism for inspecting and filtering HTTP requests entering your application. Millas middleware follows Laravel's design patterns while providing a clean, chainable API.

## Table of Contents

- [Introduction](#introduction)
- [Defining Middleware](#defining-middleware)
- [Registering Middleware](#registering-middleware)
- [Assigning Middleware to Routes](#assigning-middleware-to-routes)
- [Middleware Parameters](#middleware-parameters)
- [Middleware Groups](#middleware-groups)
- [Built-in Middleware](#built-in-middleware)

## Introduction

Middleware acts as a bridge between a request and a response. Each middleware can:
- Inspect the incoming request
- Modify the request context
- Pass control to the next middleware
- Return a response early (short-circuit)

Think of middleware as layers wrapping your application. Each request passes through these layers before reaching your controller.

## Defining Middleware

Create a middleware class with a `handle()` method:

```js
// app/middleware/CheckAge.js
class CheckAge {
  async handle({ req, user }, next) {
    if (user.age < 18) {
      return {
        status: 403,
        body: { error: 'You must be 18 or older' }
      };
    }

    return next();
  }
}

module.exports = CheckAge;
```

### Middleware Context

The `handle()` method receives a context object with:

- `req` - Express request object
- `res` - Express response object
- `user` - Authenticated user (if auth middleware ran)
- `params` - Route parameters
- `query` - Query string parameters
- `body` - Request body
- `headers` - Request headers

### Before & After Middleware

**Before Middleware** (runs before the request reaches the controller):

```js
class BeforeMiddleware {
  async handle(context, next) {
    // Do something before the request
    console.log('Before:', context.req.path);
    
    return next();
  }
}
```

**After Middleware** (runs after the controller):

```js
class AfterMiddleware {
  async handle(context, next) {
    const response = await next();
    
    // Do something after the response
    console.log('After:', response.status);
    
    return response;
  }
}
```

## Registering Middleware

Register middleware in `bootstrap/app.js`:

```js
const CheckAge = require('./app/middleware/CheckAge');

module.exports = Millas.configure(__dirname)
  .middleware('checkAge', CheckAge)
  .middleware('admin', AdminMiddleware)
  .create();
```

Now you can reference middleware by their alias: `'checkAge'`, `'admin'`.

## Assigning Middleware to Routes

### Single Route Middleware

```js
// routes/api.js
Route.get('/dashboard', DashboardController, 'index')
  .middleware('auth');

Route.post('/admin/users', UserController, 'store')
  .middleware(['auth', 'admin']);
```

### Chained Middleware

```js
Route.delete('/posts/:id', PostController, 'destroy')
  .middleware('auth')
  .middleware('checkOwnership')
  .middleware('verifyAction:post_delete');
```

### Route Groups

Apply middleware to multiple routes:

```js
Route.prefix('/api').middleware(['auth']).group(() => {
  Route.get('/profile', ProfileController, 'show');
  Route.put('/profile', ProfileController, 'update');
  Route.delete('/account', AccountController, 'destroy');
});
```

### Nested Groups

```js
Route.prefix('/api').middleware(['auth']).group(() => {
  
  // Public authenticated routes
  Route.get('/posts', PostController, 'index');
  
  // Admin-only routes
  Route.prefix('/admin').middleware(['admin']).group(() => {
    Route.resource('/users', UserController);
    Route.resource('/settings', SettingsController);
  });
});
```

## Middleware Parameters

Pass parameters to middleware for dynamic behavior (Laravel-style):

### Basic Parameters

```js
Route.get('/api/data', DataController, 'index')
  .middleware('throttle:60,1'); // 60 requests per 1 minute
```

### Defining Parameterized Middleware

Use the `fromParams()` static method:

```js
// app/middleware/VerifyActionMiddleware.js
class VerifyActionMiddleware {
  static fromParams([action]) {
    return new VerifyActionMiddleware(action);
  }

  constructor(action) {
    this.action = action;
  }

  async handle({ user }, next) {
    const hasPermission = await user.hasPermission(this.action);
    
    if (!hasPermission) {
      return {
        status: 403,
        body: { error: `Action ${this.action} not allowed` }
      };
    }
    
    return next();
  }
}

module.exports = VerifyActionMiddleware;
```

### Using Parameterized Middleware

```js
Route.prefix('/landlord/payment-methods').middleware(['auth']).group(() => {
  Route.post('/', PaymentMethodController, 'store')
    .middleware('verifyAction:payment_method_create');
  
  Route.put('/:id', PaymentMethodController, 'update')
    .middleware('verifyAction:payment_method_update');
  
  Route.delete('/:id', PaymentMethodController, 'destroy')
    .middleware('verifyAction:payment_method_delete');
});
```

### Multiple Parameters

Separate parameters with commas:

```js
Route.get('/api/search', SearchController, 'index')
  .middleware('cache:300,public'); // 300 seconds, public cache

// Middleware
class CacheMiddleware {
  static fromParams([ttl, visibility]) {
    return new CacheMiddleware(
      parseInt(ttl),
      visibility || 'private'
    );
  }

  constructor(ttl, visibility) {
    this.ttl = ttl;
    this.visibility = visibility;
  }

  async handle({ req, res }, next) {
    res.setHeader('Cache-Control', `${this.visibility}, max-age=${this.ttl}`);
    return next();
  }
}
```

### How It Works

The framework automatically:
1. Parses `'middleware:param1,param2'` syntax
2. Calls `fromParams(['param1', 'param2'])` if it exists
3. Falls back to `new Middleware(param1, param2)` if no `fromParams()`
4. Passes the instance to your route

**No extra configuration needed!**

## Middleware Groups

Define reusable middleware stacks:

```js
// bootstrap/app.js
module.exports = Millas.configure(__dirname)
  .middleware('auth', AuthMiddleware)
  .middleware('admin', AdminMiddleware)
  .middleware('verified', VerifiedMiddleware)
  .create();

// routes/api.js
// Apply multiple middleware at once
Route.prefix('/admin').middleware(['auth', 'admin', 'verified']).group(() => {
  Route.resource('/users', UserController);
});
```

## Built-in Middleware

Millas includes several built-in middleware:

### Auth Middleware

Authenticates users via JWT:

```js
Route.get('/profile', ProfileController, 'show')
  .middleware('auth');
```

Automatically registered as `'auth'` when using `.withAuth()`.

### CSRF Protection

Enabled by default for non-API routes. Configure in `config/app.js`:

```js
module.exports = {
  csrf: {
    exclude: ['/api/', '/webhooks/']
  }
};
```

### CORS Middleware

Enable CORS in `bootstrap/app.js`:

```js
module.exports = Millas.configure(__dirname)
  .withCors()
  .create();
```

Configure in `config/app.js`:

```js
module.exports = {
  cors: {
    origin: ['https://example.com'],
    credentials: true,
    maxAge: 86400
  }
};
```

### Rate Limiting

Throttle requests per IP:

```js
Route.get('/api/search', SearchController, 'index')
  .middleware('throttle:60,1'); // 60 requests per minute
```

### Upload Middleware

Handle file uploads:

```js
const { UploadMiddleware } = require('millas/core/http');

Route.post('/upload', UploadController, 'store')
  .middleware(UploadMiddleware.single('avatar'));

Route.post('/gallery', GalleryController, 'store')
  .middleware(UploadMiddleware.multiple('photos', 10));
```

### Allowed Hosts

Validates the Host header (Django-style). Configure in `config/app.js`:

```js
module.exports = {
  allowedHosts: ['example.com', '*.example.com'],
  env: 'production'
};
```

Automatically allows `localhost`, `127.0.0.1`, `[::1]` in development.

## Advanced Patterns

### Conditional Middleware

```js
class ConditionalMiddleware {
  async handle({ req, user }, next) {
    if (req.path.startsWith('/admin') && !user.isAdmin) {
      return { status: 403, body: { error: 'Admin access required' } };
    }
    
    return next();
  }
}
```

### Middleware with Dependencies

Inject services via constructor:

```js
class LoggingMiddleware {
  constructor(logger) {
    this.logger = logger;
  }

  async handle({ req }, next) {
    this.logger.info(`Request: ${req.method} ${req.path}`);
    return next();
  }
}

// Register with instance
const logger = container.make('Logger');
app.middleware('logging', new LoggingMiddleware(logger));
```

### Terminating Middleware

Middleware that runs after the response is sent:

```js
class AnalyticsMiddleware {
  async handle(context, next) {
    const response = await next();
    
    // This runs after response is sent to client
    setImmediate(() => {
      this.trackAnalytics(context, response);
    });
    
    return response;
  }

  trackAnalytics(context, response) {
    // Send analytics data
  }
}
```

## Best Practices

1. **Keep middleware focused** - Each middleware should do one thing well
2. **Order matters** - Auth before authorization, logging before everything
3. **Use parameters** - Make middleware reusable with parameters
4. **Fail fast** - Return early for unauthorized requests
5. **Use groups** - Group related middleware for cleaner routes
6. **Document parameters** - Clearly document what parameters your middleware accepts

## Example: Complete Permission System

```js
// app/middleware/PermissionMiddleware.js
class PermissionMiddleware {
  static fromParams([permission]) {
    return new PermissionMiddleware(permission);
  }

  constructor(permission) {
    this.permission = permission;
  }

  async handle({ user }, next) {
    if (!user) {
      return { status: 401, body: { error: 'Unauthenticated' } };
    }

    const hasPermission = await this.checkPermission(user, this.permission);
    
    if (!hasPermission) {
      const { Log } = require('millas/core/foundation');
      Log.w('Auth', `User ${user.id} denied: ${this.permission}`);
      
      return {
        status: 403,
        body: { error: 'Insufficient permissions' }
      };
    }
    
    return next();
  }

  async checkPermission(user, permission) {
    // Check database or cache
    const { Permission } = require('../models');
    return Permission.where({ user_id: user.id, name: permission }).exists();
  }
}

module.exports = PermissionMiddleware;

// routes/api.js
Route.prefix('/admin').middleware(['auth']).group(() => {
  Route.get('/users', UserController, 'index')
    .middleware('permission:users.view');
  
  Route.post('/users', UserController, 'store')
    .middleware('permission:users.create');
  
  Route.delete('/users/:id', UserController, 'destroy')
    .middleware('permission:users.delete');
});
```

## Next Steps

- Learn about [Controllers](./controllers.md)
- Explore [Authentication](./authentication.md)
- Read about [Routing](./routing.md)
