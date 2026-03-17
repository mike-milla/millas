'use strict';

/**
 * Facade
 *
 * Base class for all Millas facades.
 *
 * A facade is a static proxy to a service that lives in the DI container.
 * Instead of importing the service directly, developers use the facade and
 * the framework resolves the correct instance transparently.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 *   class Cache extends Facade {
 *     static get facadeAccessor() { return 'cache'; }
 *   }
 *
 *   Cache.get('key')
 *   // ↓ Facade.__get intercepts 'get'
 *   // ↓ container.make('cache')  → the Cache singleton
 *   // ↓ singleton.get('key')
 *
 * ── Benefits over direct singleton re-export ─────────────────────────────────
 *
 *   1. Swappable — rebind 'cache' in the container and every call site
 *      automatically uses the new implementation, zero changes.
 *
 *   2. Testable — swap the binding to a mock/fake in tests:
 *        Facade.swap('cache', fakeCacheInstance);
 *
 *   3. Lazy — the service is only resolved from the container on first call,
 *      not at require() time. Safe to import facades before boot.
 *
 *   4. Consistent — all services have the same access pattern regardless of
 *      how they were registered (singleton, instance, factory).
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   const { Cache } = require('millas/facades/Cache');
 *
 *   await Cache.get('user:1');
 *   await Cache.set('user:1', user, 300);
 *   await Cache.remember('stats', 60, () => Stats.compute());
 */
class Facade {
  /**
   * The container key this facade resolves to.
   * Every subclass must override this.
   *
   * @returns {string}
   */
  static get facadeAccessor() {
    throw new Error(
      `Facade "${this.name}" must define a static facadeAccessor getter.\n` +
      `  static get facadeAccessor() { return 'myService'; }`
    );
  }

  // ── Container binding ──────────────────────────────────────────────────────

  /**
   * The shared container instance.
   * Set by AppInitialiser once the container is fully booted.
   * All facades share a single reference.
   */
  static _container = null;

  /**
   * Per-facade instance overrides — used by swap() for testing.
   * key: facadeAccessor string → value: override instance
   */
  static _overrides = new Map();

  /**
   * Called by AppInitialiser after the container is booted.
   * Wires all facades to the live container in one call.
   *
   * @param {import('../container/Container')} container
   */
  static setContainer(container) {
    Facade._container = container;
  }

  /**
   * Resolve the underlying service instance.
   * Uses the override if one has been swapped in (for testing).
   *
   * @returns {object}
   */
  static _resolveInstance() {
    const accessor = this.facadeAccessor;

    if (Facade._overrides.has(accessor)) {
      return Facade._overrides.get(accessor);
    }

    if (!Facade._container) {
      throw new Error(
        `[Millas] Facade "${this.name}" used before the application was booted.\n` +
        `The container is not yet available. ` +
        `Make sure you're not calling facade methods at module load time ` +
        `(outside of route handlers, controllers, or provider boot methods).`
      );
    }

    return Facade._container.make(accessor);
  }

  // ── Testing helpers ────────────────────────────────────────────────────────

  /**
   * Swap the facade's underlying instance for testing.
   * The swap is scoped to the accessor key so it only affects this facade.
   *
   *   Cache.swap({ get: async () => 'mocked' });
   *   const val = await Cache.get('key');  // → 'mocked'
   *   Cache.restore();
   *
   * @param {object} instance
   */
  static swap(instance) {
    Facade._overrides.set(this.facadeAccessor, instance);
  }

  /**
   * Remove a test swap and return to the real container binding.
   */
  static restore() {
    Facade._overrides.delete(this.facadeAccessor);
  }

  /**
   * Remove all test swaps.
   */
  static restoreAll() {
    Facade._overrides.clear();
  }
}

// ── Proxy handler ─────────────────────────────────────────────────────────────
//
// Intercepts every static property access on a Facade subclass.
// If the property isn't a real static member of the class, it's assumed
// to be a method or property on the underlying service instance.
//
// This means Cache.get → resolves the 'cache' service → calls .get on it.
// It also means Cache.set, Cache.remember, Cache.tags, etc. all work
// without listing them explicitly.

const FACADE_OWN_PROPS = new Set([
  'facadeAccessor',
  '_container',
  '_overrides',
  'setContainer',
  '_resolveInstance',
  'swap',
  'restore',
  'restoreAll',
  'name',
  'prototype',
  'length',
]);

const FacadeProxyHandler = {
  get(target, prop, receiver) {
    // Let real static members through untouched
    if (FACADE_OWN_PROPS.has(prop) || prop in target) {
      return Reflect.get(target, prop, receiver);
    }

    // Symbol access (Symbol.toPrimitive, Symbol.iterator, etc.) — pass through
    if (typeof prop === 'symbol') {
      return Reflect.get(target, prop, receiver);
    }

    // Proxy the call to the resolved service instance
    return (...args) => target._resolveInstance()[prop](...args);
  },
};

/**
 * Create a Facade subclass that is automatically wrapped in a Proxy.
 * Used internally — subclasses extend this instead of Facade directly.
 *
 * @example
 * class Cache extends createFacade('cache') {}
 */
function createFacade(accessor) {
  class BoundFacade extends Facade {
    static get facadeAccessor() { return accessor; }
  }
  return new Proxy(BoundFacade, FacadeProxyHandler);
}

module.exports = Facade;
module.exports.createFacade = createFacade;
module.exports.FacadeProxyHandler = FacadeProxyHandler;