'use strict';

const { createFacade }                = require('./Facade');
const ProcessService                  = require('../process/Process');
const { ProcessManager, PendingProcess,
        ProcessResult, ProcessPool,
        ProcessFailedException }      = require('../process/Process');

/**
 * Process facade — Laravel-style process runner.
 *
 * Resolved from the DI container as 'process'.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUICK START
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const { Process } = require('millas/facades/Process');
 *
 *   // Run a command and get a ProcessResult
 *   const result = await Process.run('node --version');
 *   console.log(result.output());    // 'v20.1.0\n'
 *   console.log(result.successful);  // true
 *   console.log(result.exitCode());  // 0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUILDER — chain options before running
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const result = await Process
 *     .path('/var/www/app')      // working directory
 *     .timeout(120)              // kill after 120 seconds
 *     .env({ NODE_ENV: 'ci' })   // merge into parent env
 *     .quietly()                 // suppress passthrough to console
 *     .throwOnFailure()          // throw if exit code != 0
 *     .run('npm ci');
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SHELL MODE — pipes, &&, ||, globs
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const result = await Process.shell().run('cat package.json | grep version');
 *   const result = await Process.shell().run('npm run build && npm test');
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STDIN INPUT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const result = await Process.input('hello world').run('cat');
 *   console.log(result.output()); // 'hello world'
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STREAMING OUTPUT — line-by-line callbacks
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   await Process.pipe('npm install', {
 *     stdout: line => io.emit('deploy:log', line),
 *     stderr: line => io.emit('deploy:err', line),
 *   });
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SYNCHRONOUS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const result = Process.quietly().runSync('git rev-parse HEAD');
 *   const sha    = result.output().trim();
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ERROR HANDLING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // Manual check
 *   const result = await Process.quietly().run('npm test');
 *   if (result.failed) {
 *     console.error(result.errorOutput());
 *   }
 *
 *   // Throw on failure
 *   const result = await Process.quietly().run('npm test');
 *   result.throw();   // throws ProcessFailedException if failed
 *
 *   // Auto-throw
 *   try {
 *     await Process.throwOnFailure().run('npm test');
 *   } catch (err) {
 *     console.log(err.result.errorOutput()); // ProcessFailedException
 *   }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONCURRENT POOL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const [lint, test, build] = await Process.pool(pool => [
 *     pool.quietly().run('npm run lint'),
 *     pool.quietly().run('npm test'),
 *     pool.quietly().run('npm run build'),
 *   ]);
 *
 *   if (lint.failed)  console.error('Lint failed:', lint.errorOutput());
 *   if (test.failed)  console.error('Tests failed:', test.errorOutput());
 *   if (build.failed) console.error('Build failed:', build.errorOutput());
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROCESSRESULT API
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   result.output()        // stdout as string
 *   result.errorOutput()   // stderr as string
 *   result.exitCode()      // number
 *   result.successful      // true if exitCode === 0
 *   result.failed          // true if exitCode !== 0
 *   result.throw()         // throws ProcessFailedException if failed
 *   result.throwIfFailed() // alias
 *   String(result)         // same as result.output()
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENVIRONMENT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // Merge extra vars into parent env (default)
 *   Process.env({ DEBUG: '1', PORT: '4000' }).run('node server.js')
 *
 *   // Use ONLY these vars — don't inherit parent env
 *   Process.env({ PATH: '/usr/bin' }, false).run('node server.js')
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TESTING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Process.swap({
 *     run: async () => new ProcessResult({ exitCode: 0, stdout: 'mocked', stderr: '' }),
 *   });
 *
 *   // ... run test ...
 *
 *   Process.restore();
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @see src/process/Process.js
 */
class Process extends createFacade('process') {}

module.exports = { Process, ProcessManager, PendingProcess, ProcessResult, ProcessPool, ProcessFailedException };