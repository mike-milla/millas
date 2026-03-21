'use strict';

/**
 * HookRegistry + HookPipeline
 *
 * The Millas admin hook system — inspired by Django's signals and WordPress hooks.
 *
 * ── Supported events ──────────────────────────────────────────────────────────
 *
 *   before_save    fired before create or update reaches the ORM
 *                  ctx: { data, user, isNew, resource }
 *                  return value replaces data → allows mutation
 *
 *   after_save     fired after a successful create or update
 *                  ctx: { record, user, isNew, resource }
 *
 *   before_delete  fired before destroy() reaches the ORM
 *                  ctx: { record, user, resource }
 *                  throw to abort the delete
 *
 *   after_delete   fired after a successful delete
 *                  ctx: { id, user, resource }
 *
 *   before_render  fired before a template is rendered
 *                  ctx: { view, templateCtx, user, resource }
 *                  return value replaces templateCtx → allows injection
 *
 *   after_render   fired after a response is sent (fire-and-forget)
 *                  ctx: { view, user, resource, ms }
 *
 *   before_action  fired before a bulk action handler runs
 *                  ctx: { ids, action, user, resource }
 *
 *   after_action   fired after a bulk action completes
 *                  ctx: { ids, action, result, user, resource }
 *
 * ── Hook resolution order ────────────────────────────────────────────────────
 *
 *   1. Global hooks (registered via AdminHooks.on())  — run first
 *   2. Resource-level hooks (static methods on AdminConfig subclass)
 *      e.g.  static async before_save(data, ctx) { ... }
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const { AdminHooks } = require('./HookRegistry');
 *
 *   // Global — runs for every resource
 *   AdminHooks.on('after_save', async (ctx) => {
 *     await Cache.invalidate(ctx.resource.slug);
 *   });
 *
 *   // Global — abort a delete with a business rule
 *   AdminHooks.on('before_delete', async (ctx) => {
 *     if (ctx.record.status === 'published') {
 *       throw new Error('Cannot delete a published record.');
 *     }
 *   });
 *
 *   // Per-resource — defined as static methods on AdminConfig subclass
 *   class PostAdmin extends AdminConfig {
 *     static async before_save(data, ctx) {
 *       if (ctx.isNew) data.created_by = ctx.user?.id;
 *       return data;   // MUST return data (possibly mutated)
 *     }
 *     static async after_save(record, ctx) {
 *       if (ctx.isNew) await Mailer.send('welcome', record);
 *     }
 *     static async before_delete(record, ctx) {
 *       if (record.is_protected) throw new Error('This record is protected.');
 *     }
 *   }
 */

const VALID_EVENTS = new Set([
  'before_save',
  'after_save',
  'before_delete',
  'after_delete',
  'before_render',
  'after_render',
  'before_action',
  'after_action',
]);

class HookRegistry {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._hooks = new Map();
    for (const event of VALID_EVENTS) {
      this._hooks.set(event, []);
    }
  }

  /**
   * Register a global hook.
   *
   * @param {string}   event   — one of the VALID_EVENTS
   * @param {Function} handler — async (ctx) => void | data
   * @param {object}   [opts]
   * @param {number}   [opts.priority=10] — lower runs first (like WordPress)
   */
  on(event, handler, { priority = 10 } = {}) {
    if (!VALID_EVENTS.has(event)) {
      throw new Error(
        `[AdminHooks] Unknown event "${event}". ` +
        `Valid events: ${[...VALID_EVENTS].join(', ')}`
      );
    }
    if (typeof handler !== 'function') {
      throw new Error(`[AdminHooks] Hook handler for "${event}" must be a function.`);
    }

    handler._priority = priority;
    this._hooks.get(event).push(handler);
    // Keep sorted by priority after each insertion
    this._hooks.get(event).sort((a, b) => (a._priority || 10) - (b._priority || 10));
    return this; // chainable
  }

  /**
   * Remove a previously registered global hook.
   * Pass the exact same function reference used in .on().
   */
  off(event, handler) {
    if (!this._hooks.has(event)) return this;
    const list = this._hooks.get(event).filter(h => h !== handler);
    this._hooks.set(event, list);
    return this;
  }

  /**
   * Remove all global hooks for an event (or all events if none specified).
   * Useful in tests to reset state between test cases.
   */
  clear(event = null) {
    if (event) {
      if (this._hooks.has(event)) this._hooks.set(event, []);
    } else {
      for (const e of VALID_EVENTS) this._hooks.set(e, []);
    }
    return this;
  }

  /**
   * Return the list of global hooks for an event.
   * @param {string} event
   * @returns {Function[]}
   */
  getHandlers(event) {
    return this._hooks.get(event) || [];
  }
}

// ── HookPipeline ──────────────────────────────────────────────────────────────

class HookPipeline {
  /**
   * Run the full hook pipeline for an event.
   *
   * Pipeline order:
   *   1. Global hooks (from HookRegistry)
   *   2. Resource-level static method on AdminConfig (if defined)
   *
   * For before_save:
   *   - ctx.data is passed to each hook
   *   - If a hook returns a non-undefined value, that becomes the new ctx.data
   *   - Final ctx.data is what reaches the ORM
   *
   * For before_delete / before_render / before_action:
   *   - Hooks may throw to abort the operation
   *   - Return value is used if present (for before_render: replaces templateCtx)
   *
   * For after_* events:
   *   - Fire-and-forget for after_render (errors are swallowed, never crash the request)
   *   - Errors in other after_* hooks are logged but don't affect the response
   *
   * @param {string}   event    — hook event name
   * @param {object}   ctx      — context passed to all handlers
   * @param {class}    Resource — AdminConfig subclass (may have static hook methods)
   * @param {HookRegistry} registry — the global hook registry
   * @returns {Promise<object>} — possibly mutated ctx
   */
  static async run(event, ctx, Resource, registry) {
    // ── 1. Global hooks ────────────────────────────────────────────────────
    const globalHandlers = registry.getHandlers(event);

    for (const handler of globalHandlers) {
      try {
        const result = await handler(ctx);
        // For before_save: allow handler to return mutated data
        if (result !== undefined && event === 'before_save') {
          ctx.data = result;
        }
        // For before_render: allow handler to mutate templateCtx
        if (result !== undefined && event === 'before_render') {
          ctx.templateCtx = result;
        }
      } catch (err) {
        if (event.startsWith('after_')) {
          // after_* errors must never crash the response — log and continue
          process.stderr.write(`[AdminHooks] Error in global "${event}" hook: ${err.message}\n`);
        } else {
          throw err; // before_* errors abort the operation
        }
      }
    }

    // ── 2. Resource-level hook method ──────────────────────────────────────
    // e.g. static async before_save(data, ctx) on the AdminConfig subclass
    if (Resource && typeof Resource[event] === 'function') {
      try {
        // Convention: first arg is the "primary subject", second is the full ctx
        // before_save(data, ctx)         → returns mutated data
        // after_save(record, ctx)        → no return needed
        // before_delete(record, ctx)     → throw to abort
        // after_delete(id, ctx)          → no return needed
        // before_render(templateCtx,ctx) → returns mutated templateCtx
        // before_action(ids, ctx)        → throw to abort
        let primaryArg;
        switch (event) {
          case 'before_save':    primaryArg = ctx.data;        break;
          case 'after_save':     primaryArg = ctx.record;      break;
          case 'before_delete':  primaryArg = ctx.record;      break;
          case 'after_delete':   primaryArg = ctx.id;          break;
          case 'before_render':  primaryArg = ctx.templateCtx; break;
          case 'after_render':   primaryArg = ctx.view;        break;
          case 'before_action':  primaryArg = ctx.ids;         break;
          case 'after_action':   primaryArg = ctx.ids;         break;
          default:               primaryArg = ctx;
        }

        const result = await Resource[event](primaryArg, ctx);

        if (result !== undefined && event === 'before_save') {
          ctx.data = result;
        }
        if (result !== undefined && event === 'before_render') {
          ctx.templateCtx = result;
        }
      } catch (err) {
        if (event.startsWith('after_')) {
          process.stderr.write(`[AdminHooks] Error in ${Resource.name}.${event}: ${err.message}\n`);
        } else {
          throw err;
        }
      }
    }

    return ctx;
  }
}

// ── Singleton global registry ─────────────────────────────────────────────────
const AdminHooks = new HookRegistry();

module.exports = { HookRegistry, HookPipeline, AdminHooks, VALID_EVENTS };
