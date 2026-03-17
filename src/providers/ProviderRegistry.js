'use strict';

/**
 * ProviderRegistry
 *
 * Manages the lifecycle of all service providers:
 *
 *   1. Load — require() each provider file
 *   2. Register — call provider.register(container) on all providers
 *   3. Boot — call provider.boot(container, app) on all providers
 *
 * This two-phase approach (register then boot) ensures every binding
 * exists before any provider tries to resolve another.
 *
 * Usage (in bootstrap/app.js):
 *
 *   const registry = new ProviderRegistry(container, app);
 *   registry.add(AppServiceProvider);
 *   registry.add('./providers/DatabaseServiceProvider');
 *   await registry.boot();
 */
class ProviderRegistry {
  constructor(container, expressApp) {
    this._container = container;
    this._app       = expressApp;
    this._providers = [];
  }

  /**
   * Add a provider class or path to the registry.
   * @param {Function|string} provider — class or file path
   */
  add(provider) {
    let Cls = provider;

    if (typeof provider === 'string') {
      Cls = require(provider);
      // Support ES module default export
      if (Cls.default) Cls = Cls.default;
    }

    this._providers.push(new Cls());
    return this;
  }

  /**
   * Add multiple providers at once.
   * @param {Array} providers
   */
  addMany(providers = []) {
    for (const p of providers) this.add(p);
    return this;
  }

  /**
   * Run the full provider lifecycle in order:
   *   Phase 0 — beforeBoot   (synchronous, no bindings yet — for global setup)
   *   Phase 1 — register     (synchronous, bind into container)
   *   Phase 2 — boot         (async-safe, all bindings exist)
   */
  async boot() {
    // Phase 0: beforeBoot — runs before ANY register() call.
    // Synchronous only. Used for global setup that must happen first
    // (e.g. LogServiceProvider patches console here so all register()
    // calls already produce formatted output).
    for (const provider of this._providers) {
      if (typeof provider.beforeBoot === 'function') {
        provider.beforeBoot(this._container);
      }
    }

    // Phase 1: register all bindings
    for (const provider of this._providers) {
      if (typeof provider.register === 'function') {
        provider.register(this._container);
      }
    }

    // Phase 2: boot all providers (async-safe)
    for (const provider of this._providers) {
      if (typeof provider.boot === 'function') {
        await provider.boot(this._container, this._app);
      }
    }
  }

  /**
   * Return a list of provider class names (for debugging).
   */
  list() {
    return this._providers.map(p => p.constructor.name);
  }
}

module.exports = ProviderRegistry;
