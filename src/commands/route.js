'use strict';

const Command = require('../console/Command');

class RouteCommand extends Command {
  static description = 'Manage application routes';

  async onInit(register) {
    register
      .command(this.list)
      .description('List all registered routes');
  }

  async list() {
    if (!this.hasAppBootstrap()) {
      this.error('Not inside a Millas project.');
      throw new Error('Not inside a Millas project');
    }

    process.env.MILLAS_ROUTE_LIST = 'true';

    let route;
    try {
      const app = await this.getApp();

      route = app.route;
    } catch (err) {
      this.error(`Failed to load routes: ${err.message}`);
      throw err;
    }

    if (!route) {
      this.warn('Bootstrap did not export { route }.');
      return;
    }

    const rows = route.list();

    if (rows.length === 0) {
      this.warn('No routes registered.');
      return;
    }

    this.logger.log('');
    this.logger.log(this.style.bold('  Registered Routes\n'));

    const col = {
      verb:    8,
      path:    Math.max(6,  ...rows.map(r => r.path.length)) + 2,
      handler: Math.max(8,  ...rows.map(r => formatHandler(r).length)) + 2,
      mw:      Math.max(10, ...rows.map(r => (r.middleware || []).join(', ').length || 1)) + 2,
    };

    const header =
      '  ' +
      this.style.bold(pad('METHOD',     col.verb)) +
      this.style.bold(pad('PATH',       col.path)) +
      this.style.bold(pad('HANDLER',    col.handler)) +
      this.style.bold(pad('MIDDLEWARE', col.mw)) +
      this.style.bold('NAME');

    this.logger.log(header);
    this.logger.log(this.style.line(col.verb + col.path + col.handler + col.mw + 10, '─').padStart(col.verb + col.path + col.handler + col.mw + 12));

    for (const r of rows) {
      const mw   = (r.middleware || []).join(', ') || this.style.secondary('—');
      const name = r.name || this.style.secondary('—');
      this.logger.log(
        '  ' +
        this.style.method(r.verb)(pad(r.verb, col.verb)) +
        this.style.info(pad(r.path, col.path)) +
        this.style.light(pad(formatHandler(r), col.handler)) +
        this.style.warning(pad(mw, col.mw)) +
        this.style.secondary(name)
      );
    }

    this.logger.log(this.style.secondary(`\n  ${rows.length} route(s) total.\n`));
  }
}

function pad(str, len) { return String(str).padEnd(len); }

function formatHandler(r) {
  if (!r.handler) return '<none>';
  if (typeof r.handler === 'function' && !r.method) return r.handler.name || '<closure>';
  const name = r.handler.name || 'Controller';
  return r.method ? `${name}@${r.method}` : name;
}

module.exports = RouteCommand;
