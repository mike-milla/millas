'use strict';

const chalk = require('chalk');
const path  = require('path');
const fs    = require('fs-extra');

module.exports = function (program) {
  program
    .command('route:list')
    .description('List all registered routes')
    .action(async () => {
      const bootstrapPath = path.resolve(process.cwd(), 'bootstrap/app.js');

      if (!fs.existsSync(bootstrapPath)) {
        console.error(chalk.red('\n  ✖ Not inside a Millas project.\n'));
        process.exit(1);
      }

      process.env.MILLAS_ROUTE_LIST = 'true';

      let route;
      try {
        const bootstrap = require(bootstrapPath);
        route = bootstrap.route;
      } catch (err) {
        console.error(chalk.red(`\n  ✖ Failed to load routes: ${err.message}\n`));
        process.exit(1);
      }

      if (!route) {
        console.log(chalk.yellow('\n  ⚠  Bootstrap did not export { route }.\n'));
        process.exit(0);
      }

      const rows = route.list();

      if (rows.length === 0) {
        console.log(chalk.yellow('\n  No routes registered.\n'));
        return;
      }

      console.log();
      console.log(chalk.bold('  Registered Routes\n'));

      const col = {
        verb:    8,
        path:    Math.max(6,  ...rows.map(r => r.path.length)) + 2,
        handler: Math.max(8,  ...rows.map(r => formatHandler(r).length)) + 2,
        mw:      Math.max(10, ...rows.map(r => (r.middleware || []).join(', ').length || 1)) + 2,
      };

      const header =
        '  ' +
        chalk.bold(pad('METHOD',     col.verb)) +
        chalk.bold(pad('PATH',       col.path)) +
        chalk.bold(pad('HANDLER',    col.handler)) +
        chalk.bold(pad('MIDDLEWARE', col.mw)) +
        chalk.bold('NAME');

      console.log(header);
      console.log(chalk.gray('  ' + '─'.repeat(col.verb + col.path + col.handler + col.mw + 10)));

      for (const r of rows) {
        const mw   = (r.middleware || []).join(', ') || chalk.gray('—');
        const name = r.name || chalk.gray('—');
        console.log(
          '  ' +
          verbChalk(r.verb)(pad(r.verb, col.verb)) +
          chalk.cyan(pad(r.path, col.path)) +
          chalk.white(pad(formatHandler(r), col.handler)) +
          chalk.yellow(pad(mw, col.mw)) +
          chalk.gray(name)
        );
      }

      console.log(chalk.gray(`\n  ${rows.length} route(s) total.\n`));
      process.exit(0);
    });
};

function pad(str, len) { return String(str).padEnd(len); }

function formatHandler(r) {
  if (!r.handler) return '<none>';
  if (typeof r.handler === 'function' && !r.method) return r.handler.name || '<closure>';
  const name = r.handler.name || 'Controller';
  return r.method ? `${name}@${r.method}` : name;
}

function verbChalk(verb) {
  return { GET: chalk.green, POST: chalk.blue, PUT: chalk.yellow,
           PATCH: chalk.magenta, DELETE: chalk.red }[verb] || chalk.white;
}
