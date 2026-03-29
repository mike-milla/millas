'use strict';

/**
 * EventEmitter — Millas event bus.
 */
class EventEmitter {
  constructor() {
    this._listeners = new Map();
    this._wildcards = [];
    this._queue     = null;
  }

  listen(event, listeners) {
    const name = this._name(event);
    if (!this._listeners.has(name)) this._listeners.set(name, []);
    const list = Array.isArray(listeners) ? listeners : [listeners];
    for (const l of list) this._listeners.get(name).push({ handler: l, once: false });
    return this;
  }

  on(event, fn)    { return this.listen(event, fn); }

  once(event, fn) {
    const name = this._name(event);
    if (!this._listeners.has(name)) this._listeners.set(name, []);
    this._listeners.get(name).push({ handler: fn, once: true });
    return this;
  }

  off(event, fn) {
    const name = this._name(event);
    if (!this._listeners.has(name)) return this;
    this._listeners.set(name, this._listeners.get(name).filter(l => l.handler !== fn));
    return this;
  }

  onWildcard(pattern, fn) {
    const rx = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    this._wildcards.push({ rx, handler: fn });
    return this;
  }

  async emit(event, data = {}) {
    let ev = event;
    if (typeof event === 'string') {
      const Ev = require('./Event');
      ev = Object.assign(new Ev(), { _name: event, ...data });
    }
    const name    = ev._name || ev.constructor?.name || String(event);
    const entries = [...(this._listeners.get(name) || [])];
    const remove  = [];

    for (const entry of entries) {
      if (ev.stopped) break;
      await this._invoke(entry.handler, ev);
      if (entry.once) remove.push(entry);
    }
    if (remove.length) {
      this._listeners.set(name, (this._listeners.get(name) || []).filter(l => !remove.includes(l)));
    }

    for (const { rx, handler } of this._wildcards) {
      if (ev.stopped) break;
      if (rx.test(name)) await this._invoke(handler, ev);
    }
    return ev;
  }

  emitAsync(event, data = {}) {
    Promise.resolve(this.emit(event, data)).catch(err =>
      console.error('[EventEmitter] Unhandled error:', err.message)
    );
  }

  hasListeners(event) { return (this._listeners.get(this._name(event)) || []).length > 0; }
  getListeners(event) { return (this._listeners.get(this._name(event)) || []).map(l => l.handler); }
  removeAll(event)    { this._listeners.delete(this._name(event)); return this; }
  flush()             { this._listeners.clear(); this._wildcards = []; return this; }
  setQueue(queue)     { this._queue = queue; }

  async _invoke(handler, event) {
    // Listener class (has handle() on prototype)
    if (typeof handler === 'function' && typeof handler.prototype?.handle === 'function') {
      // Resolve static inject dependencies from the container
      let inst;
      if (handler.inject && Array.isArray(handler.inject) && handler.inject.length) {
        const Facade = require('../facades/Facade');
        const container = Facade._container;
        const deps = handler.inject.map(key => {
          try { return container ? container.make(key) : undefined; } catch { return undefined; }
        });
        inst = new handler(...deps);
      } else {
        inst = new handler();
      }
      if (handler.queue && this._queue) {
        const Job = require('../queue/Job');
        const q   = this._queue;
        class LJob extends Job {
          async handle()      { await inst.handle(event); }
          async failed(e)     { if (typeof inst.failed === 'function') await inst.failed(event, e); }
        }
        LJob.queue = handler.queueName || 'default';
        await q.push(new LJob());
        return;
      }
      try   { await inst.handle(event); }
      catch (e) {
        if (typeof inst.failed === 'function') await inst.failed(event, e);
        else throw e;
      }
      return;
    }
    // Instantiated listener object
    if (handler && typeof handler === 'object' && typeof handler.handle === 'function') {
      await handler.handle(event); return;
    }
    // Raw function
    if (typeof handler === 'function') { await handler(event); return; }
    throw new Error('Invalid listener: ' + handler);
  }

  _name(e) {
    if (typeof e === 'string')   return e;
    if (typeof e === 'function') return e.name;
    return e?._name || e?.constructor?.name || String(e);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
const _inst = new EventEmitter();

// Standalone emit function — IMPORTANT: does NOT use module.exports.emit
// to avoid the circular reference where module.exports === _inst so
// _inst.emit gets overwritten by the wrapper.
async function emit(event, data) {
  // Call the class method bound to _inst, bypassing any property overwrites
  return EventEmitter.prototype.emit.call(_inst, event, data);
}

// Export a plain wrapper object (NOT the singleton itself) to prevent
// module.exports.emit from writing back onto _inst.
module.exports = {
  // Proxy all EventEmitter instance methods to _inst
  listen:      (...a) => _inst.listen(...a),
  on:          (...a) => _inst.on(...a),
  once:        (...a) => _inst.once(...a),
  off:         (...a) => _inst.off(...a),
  onWildcard:  (...a) => _inst.onWildcard(...a),
  emit:        (...a) => EventEmitter.prototype.emit.call(_inst, ...a),
  emitAsync:   (...a) => _inst.emitAsync(...a),
  hasListeners:(...a) => _inst.hasListeners(...a),
  getListeners:(...a) => _inst.getListeners(...a),
  removeAll:   (...a) => _inst.removeAll(...a),
  flush:       ()     => _inst.flush(),
  setQueue:    (q)    => _inst.setQueue(q),
  // Named exports
  EventEmitter,
  emit,
  // Expose singleton for advanced use
  _instance: _inst,
};
