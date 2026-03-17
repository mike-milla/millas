'use strict';

/**
 * Container
 *
 * Millas dependency injection container.
 *
 * Three binding types:
 *
 *   container.bind('UserService', UserService)
 *     — fresh instance each time make() is called
 *
 *   container.singleton('DB', DatabaseService)
 *     — same instance returned on every make()
 *
 *   container.instance('Config', configObject)
 *     — register a pre-built value or object directly
 *
 * Auto-resolution:
 *   If a class constructor lists dependencies by name in a static
 *   `inject` array, the container resolves them automatically:
 *
 *   class OrderService {
 *     static inject = ['UserService', 'PaymentService'];
 *     constructor(userService, paymentService) { ... }
 *   }
 *
 *   container.bind('OrderService', OrderService);
 *   const svc = container.make('OrderService');
 *   // UserService and PaymentService injected automatically
 */
class Container {
  constructor() {
    this._bindings   = new Map();   // abstract → { concrete, type }
    this._resolved   = new Map();   // abstract → instance  (singletons)
    this._aliases    = new Map();   // alias    → abstract
    this._tags       = new Map();   // tag      → [abstract, ...]
    this._resolving  = new Set();   // circular dependency guard
  }

  // ─── Registration ────────────────────────────────────────────────────────────

  /**
   * Bind an abstract name to a concrete class or factory.
   * A new instance is created every time make() is called.
   *
   * container.bind('UserService', UserService)
   * container.bind('Logger', () => new Logger({ level: 'debug' }))
   */
  bind(abstract, concrete) {
    this._bindings.set(abstract, { concrete, type: 'transient' });
    // Clear any resolved singleton if re-bound
    this._resolved.delete(abstract);
    return this;
  }

  /**
   * Bind as a singleton — the same instance is returned on every make().
   *
   * container.singleton('DB', DatabaseService)
   */
  singleton(abstract, concrete) {
    this._bindings.set(abstract, { concrete, type: 'singleton' });
    this._resolved.delete(abstract);
    return this;
  }

  /**
   * Register a pre-built value directly.
   * make() always returns this exact value.
   *
   * container.instance('Config', { port: 3000 })
   * container.instance('App', expressApp)
   */
  instance(abstract, value) {
    this._bindings.set(abstract, { concrete: null, type: 'instance' });
    this._resolved.set(abstract, value);
    return this;
  }

  /**
   * Register an alias for an abstract name.
   *
   * container.alias('db', 'DatabaseService')
   * container.make('db') // resolves DatabaseService
   */
  alias(alias, abstract) {
    this._aliases.set(alias, abstract);
    return this;
  }

  /**
   * Tag multiple bindings under a group name.
   *
   * container.tag(['MySQLDriver', 'SQLiteDriver'], 'db.drivers')
   * container.tagged('db.drivers') // → [MySQLDriver instance, SQLiteDriver instance]
   */
  tag(abstracts, tag) {
    if (!this._tags.has(tag)) this._tags.set(tag, []);
    for (const a of [].concat(abstracts)) {
      this._tags.get(tag).push(a);
    }
    return this;
  }

  // ─── Resolution ──────────────────────────────────────────────────────────────

  /**
   * Resolve a binding by name, building and injecting dependencies.
   *
   * const svc = container.make('UserService')
   * const svc = container.make(UserService)   // class reference also works
   */
  make(abstract, overrides = {}) {
    // Accept class references directly
    if (typeof abstract === 'function') {
      return this._build(abstract, overrides);
    }

    // Resolve alias
    const resolved = this._aliases.get(abstract) || abstract;

    // Guard against circular deps
    if (this._resolving.has(resolved)) {
      throw new Error(
        `Circular dependency detected while resolving "${resolved}".`
      );
    }

    const binding = this._bindings.get(resolved);

    if (!binding) {
      throw new Error(
        `"${resolved}" is not bound in the container. ` +
        `Did you forget to call container.bind('${resolved}', MyClass)?`
      );
    }

    // Pre-built instance
    if (binding.type === 'instance') {
      return this._resolved.get(resolved);
    }

    // Return cached singleton
    if (binding.type === 'singleton' && this._resolved.has(resolved)) {
      return this._resolved.get(resolved);
    }

    this._resolving.add(resolved);
    let instance;

    try {
      instance = this._build(binding.concrete, overrides);
    } finally {
      this._resolving.delete(resolved);
    }

    if (binding.type === 'singleton') {
      this._resolved.set(resolved, instance);
    }

    return instance;
  }

  /**
   * Resolve all bindings under a tag.
   *
   * const drivers = container.tagged('db.drivers')
   */
  tagged(tag) {
    const abstracts = this._tags.get(tag);
    if (!abstracts) return [];
    return abstracts.map(a => this.make(a));
  }

  /**
   * Check whether a name is bound.
   */
  has(abstract) {
    const resolved = this._aliases.get(abstract) || abstract;
    return this._bindings.has(resolved);
  }

  /**
   * Call a method or function, auto-injecting its declared dependencies.
   *
   * container.call(myService, 'processOrder', { orderId: 123 })
   * container.call(myFunction)
   */
  call(target, method, extras = {}) {
    if (typeof target === 'function') {
      return this._callFunction(target, extras);
    }
    if (typeof target === 'object' && typeof target[method] === 'function') {
      return this._callFunction(target[method].bind(target), extras);
    }
    throw new Error(`Cannot call "${method}" on the given target.`);
  }

  /**
   * Forget a resolved singleton (force re-instantiation on next make()).
   */
  forgetInstance(abstract) {
    this._resolved.delete(abstract);
    return this;
  }

  /**
   * Remove a binding entirely.
   */
  unbind(abstract) {
    this._bindings.delete(abstract);
    this._resolved.delete(abstract);
    return this;
  }

  /**
   * List all registered abstract names.
   */
  bindings() {
    return [...this._bindings.keys()];
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  /**
   * Build a concrete class or factory, resolving its inject[] dependencies.
   */
  _build(concrete, overrides = {}) {
    if (concrete === null || concrete === undefined) {
      throw new Error('Cannot build a null concrete.');
    }

    // Factory function (not a class constructor)
    if (this._isFactory(concrete)) {
      return concrete(this, overrides);
    }

    // Class — resolve static inject[] array
    const deps = this._resolveDependencies(concrete, overrides);
    return new concrete(...deps);
  }

  /**
   * Resolve the inject[] static array on a class.
   *
   * class MyService {
   *   static inject = ['Logger', 'Config'];
   * }
   */
  _resolveDependencies(Cls, overrides = {}) {
    const inject = Cls.inject || [];
    return inject.map(dep => {
      if (dep in overrides) return overrides[dep];
      return this.make(dep);
    });
  }

  /**
   * Detect whether `fn` is a plain factory function vs a class constructor.
   * Heuristic: class constructors start with an uppercase letter.
   */
  _isFactory(fn) {
    if (typeof fn !== 'function') return false;
    const str = fn.toString();
    // Arrow functions and non-class functions = factory
    if (str.startsWith('class ')) return false;
    if (/^function\s+[A-Z]/.test(str)) return false; // old-style class
    // Check if it's a regular function (not a constructor-style)
    const name = fn.name || '';
    return !(name[0] && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase());
  }

  _callFunction(fn, extras = {}) {
    const inject = fn.inject || [];
    const deps   = inject.map(dep => dep in extras ? extras[dep] : this.make(dep));
    return fn(...deps);
  }
}

module.exports = Container;
