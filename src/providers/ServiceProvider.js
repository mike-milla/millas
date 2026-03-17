'use strict';

/**
 * ServiceProvider
 *
 * Base class for all Millas service providers.
 *
 * ── Lifecycle hooks (called in this order) ─────────────────────────────────
 *
 *   beforeBoot(container)
 *     Called FIRST — before any provider's register() runs.
 *     Use for setup that must happen before everything else:
 *       - Configuring logging (so register() calls get formatted output)
 *       - Patching globals (console, process handlers)
 *       - Reading config files that other providers depend on
 *     The container exists but has NO bindings yet.
 *     Must be synchronous — async is not supported here.
 *
 *   register(container)
 *     Called after ALL beforeBoot() hooks have run.
 *     Bind things into the container (singletons, factories, instances).
 *     Do NOT resolve other bindings here — they may not exist yet.
 *     Must be synchronous.
 *
 *   boot(container, app)
 *     Called after ALL providers have registered.
 *     Safe to resolve other bindings, set up routes, register
 *     event listeners, mount middleware, etc.
 *     Async-safe — await is fine here.
 *
 * ── Example ────────────────────────────────────────────────────────────────
 *
 *   class AppServiceProvider extends ServiceProvider {
 *     beforeBoot(container) {
 *       // Runs before any register() — good for global setup
 *     }
 *
 *     register(container) {
 *       container.singleton('UserService', UserService);
 *     }
 *
 *     async boot(container, app) {
 *       const db = container.make('db');
 *       await db.migrate();
 *     }
 *   }
 */
class ServiceProvider {
  /**
   * Called before any provider's register() runs.
   * Container exists but has no bindings yet.
   * Must be synchronous.
   *
   * @param {import('./Container')} container
   */
  beforeBoot(container) {}

  /**
   * Register bindings into the container.
   * Called after all beforeBoot() hooks have run.
   * Must be synchronous.
   *
   * @param {import('./Container')} container
   */
  register(container) {}

  /**
   * Bootstrap services after all providers have registered.
   * Safe to resolve other bindings. Async-safe.
   *
   * @param {import('./Container')} container
   * @param {import('express').Application} app
   */
  async boot(container, app) {}
}

module.exports = ServiceProvider;
