'use strict';

const { spawn, execSync } = require('child_process');

// ── ProcessResult ─────────────────────────────────────────────────────────────

class ProcessResult {
  constructor({ exitCode, stdout, stderr, command }) {
    this._exitCode = exitCode;
    this._stdout   = stdout   || '';
    this._stderr   = stderr   || '';
    this._command  = command  || '';
  }

  /** Raw stdout string. */
  output()      { return this._stdout; }

  /** Raw stderr string. */
  errorOutput() { return this._stderr; }

  /** Exit code. */
  exitCode()    { return this._exitCode; }

  /** True if exit code is 0. */
  get successful() { return this._exitCode === 0; }

  /** True if exit code is not 0. */
  get failed()     { return this._exitCode !== 0; }

  /** Throw ProcessFailedException if the process failed. */
  throw() {
    if (this.failed) throw new ProcessFailedException(this);
    return this;
  }

  /** Alias for throw(). */
  throwIfFailed() { return this.throw(); }

  toString() { return this._stdout; }
}

// ── ProcessFailedException ────────────────────────────────────────────────────

class ProcessFailedException extends Error {
  constructor(result) {
    super(
      `Process "${result._command}" failed with exit code ${result._exitCode}.\n` +
      (result._stderr ? `STDERR: ${result._stderr.trim()}` : '')
    );
    this.name   = 'ProcessFailedException';
    this.result = result;
  }
}

// ── PendingProcess ────────────────────────────────────────────────────────────

class PendingProcess {
  constructor() {
    this._cwd         = process.cwd();
    this._env         = null;
    this._timeout     = 0;
    this._input       = null;
    this._quietly     = false;
    this._shell       = false;
    this._throwOnFail = false;
    this._onOutput    = null;
    this._onError     = null;
  }

  // ── Builder ────────────────────────────────────────────────────────────────

  /**
   * Set working directory.
   *   Process.path('/var/www').run('ls -la')
   */
  path(dir) { this._cwd = dir; return this; }

  /**
   * Set environment variables, merged with parent env by default.
   * Pass inherit=false to use only the provided vars.
   *   Process.env({ NODE_ENV: 'production' }).run('node server.js')
   */
  env(vars, inherit = true) {
    this._env = inherit ? { ...process.env, ...vars } : vars;
    return this;
  }

  /**
   * Timeout in seconds. Kills the process if exceeded.
   *   Process.timeout(30).run('npm install')
   */
  timeout(seconds) { this._timeout = seconds * 1000; return this; }

  /**
   * Pipe data to stdin.
   *   Process.input('hello').run('cat')
   */
  input(data) { this._input = data; return this; }

  /**
   * Suppress stdout/stderr passthrough to parent process.
   * Output is still captured on ProcessResult.
   */
  quietly() { this._quietly = true; return this; }

  /**
   * Run through /bin/sh — enables pipes, &&, ||, globs.
   *   Process.shell().run('ls | grep .js && echo done')
   */
  shell() { this._shell = true; return this; }

  /**
   * Throw ProcessFailedException automatically on non-zero exit.
   *   await Process.throwOnFailure().run('npm test')
   */
  throwOnFailure() { this._throwOnFail = true; return this; }

  /**
   * Register a line-by-line callback for stdout.
   * Called for each newline-delimited line as the process runs.
   * Can be combined with .run() — no need to use .pipe().
   *
   *   await Process
   *     .onOutput(line => console.log('[OUT]', line))
   *     .onError(line  => console.error('[ERR]', line))
   *     .run('npm test');
   */
  onOutput(fn) { this._onOutput = fn; return this; }

  /**
   * Register a line-by-line callback for stderr.
   *   .onError(line => logger.error(line))
   */
  onError(fn) { this._onError = fn; return this; }

  // ── Execution ──────────────────────────────────────────────────────────────

  /**
   * Run asynchronously. Returns Promise<ProcessResult>.
   *
   *   const result = await Process.run('node --version');
   *   const result = await Process.path('/app').timeout(60).quietly().run('npm ci');
   */
  run(command) {
    return new Promise((resolve, reject) => {
      const { cmd, args } = this._parse(command);
      const child = spawn(cmd, args, {
        cwd:   this._cwd,
        env:   this._env || process.env,
        shell: this._shell,
        ...(this._timeout ? { timeout: this._timeout } : {}),
      });

      let stdout = '';
      let stderr = '';

      if (this._input !== null) {
        child.stdin.write(String(this._input));
        child.stdin.end();
      }

      let _outBuf = '';
      let _errBuf = '';

      const _flushLines = (buf, cb) => {
        const lines = buf.split('\n');
        buf = lines.pop();
        lines.forEach(line => cb && cb(line));
        return buf;
      };

      child.stdout.on('data', chunk => {
        stdout += chunk;
        if (!this._quietly) process.stdout.write(chunk);
        if (this._onOutput) _outBuf = _flushLines(_outBuf + chunk, this._onOutput);
      });
      child.stderr.on('data', chunk => {
        stderr += chunk;
        if (!this._quietly) process.stderr.write(chunk);
        if (this._onError) _errBuf = _flushLines(_errBuf + chunk, this._onError);
      });

      child.on('error', reject);
      child.on('close', code => {
        if (_outBuf && this._onOutput) this._onOutput(_outBuf);
        if (_errBuf && this._onError)  this._onError(_errBuf);
        const result = new ProcessResult({ exitCode: code ?? 1, stdout, stderr, command });
        if (this._throwOnFail && result.failed) return reject(new ProcessFailedException(result));
        resolve(result);
      });
    });
  }

  /**
   * Stream output line-by-line in real-time via callbacks.
   * Returns Promise<ProcessResult>.
   *
   *   await Process.pipe('npm install', {
   *     stdout: line => console.log('[out]', line),
   *     stderr: line => console.error('[err]', line),
   *   });
   */
  pipe(command, { stdout: onOut, stderr: onErr } = {}) {
    return new Promise((resolve, reject) => {
      const { cmd, args } = this._parse(command);
      const child = spawn(cmd, args, {
        cwd:   this._cwd,
        env:   this._env || process.env,
        shell: this._shell,
      });

      let outBuf = '', errBuf = '', fullOut = '', fullErr = '';

      const flush = (buf, cb) => {
        const lines = buf.split('\n');
        const rem   = lines.pop();
        lines.forEach(l => cb && cb(l));
        return rem;
      };

      child.stdout.on('data', chunk => {
        fullOut += chunk; outBuf += chunk;
        outBuf = flush(outBuf, onOut);
        if (!this._quietly) process.stdout.write(chunk);
      });
      child.stderr.on('data', chunk => {
        fullErr += chunk; errBuf += chunk;
        errBuf = flush(errBuf, onErr);
        if (!this._quietly) process.stderr.write(chunk);
      });

      child.on('error', reject);
      child.on('close', code => {
        if (outBuf) onOut && onOut(outBuf);
        if (errBuf) onErr && onErr(errBuf);
        const result = new ProcessResult({ exitCode: code ?? 1, stdout: fullOut, stderr: fullErr, command });
        if (this._throwOnFail && result.failed) return reject(new ProcessFailedException(result));
        resolve(result);
      });
    });
  }

  /**
   * Run synchronously (blocking). Returns ProcessResult directly.
   *
   *   const result = Process.quietly().runSync('node --version');
   */
  runSync(command) {
    try {
      const out = execSync(command, {
        cwd:     this._cwd,
        env:     this._env || process.env,
        timeout: this._timeout || undefined,
        input:   this._input   !== null ? String(this._input) : undefined,
        stdio:   'pipe',
      });
      const result = new ProcessResult({ exitCode: 0, stdout: out.toString(), stderr: '', command });
      if (!this._quietly) process.stdout.write(out);
      return result;
    } catch (err) {
      const result = new ProcessResult({
        exitCode: err.status ?? 1,
        stdout:   err.stdout?.toString() || '',
        stderr:   err.stderr?.toString() || err.message || '',
        command,
      });
      if (this._throwOnFail) throw new ProcessFailedException(result);
      return result;
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _parse(command) {
    if (this._shell) return { cmd: command, args: [] };
    const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    const cmd   = parts[0];
    const args  = parts.slice(1).map(a => a.replace(/^["']|["']$/g, ''));
    return { cmd, args };
  }
}

// ── ProcessPool ───────────────────────────────────────────────────────────────

class ProcessPool {
  async start(callback) {
    const factory = new PendingProcess();
    const tasks   = callback(factory) || [];
    return Promise.all(tasks);
  }
}

// ── ProcessManager ────────────────────────────────────────────────────────────

class ProcessManager {
  // Shorthand — execute immediately
  run(command)                 { return new PendingProcess().run(command); }
  runSync(command)             { return new PendingProcess().runSync(command); }
  pipe(command, handlers)      { return new PendingProcess().pipe(command, handlers); }
  onOutput(fn)                 { return new PendingProcess().onOutput(fn); }
  onError(fn)                  { return new PendingProcess().onError(fn); }

  // Builder starters — return PendingProcess for chaining
  path(dir)                    { return new PendingProcess().path(dir); }
  env(vars, inherit)           { return new PendingProcess().env(vars, inherit); }
  timeout(seconds)             { return new PendingProcess().timeout(seconds); }
  input(data)                  { return new PendingProcess().input(data); }
  quietly()                    { return new PendingProcess().quietly(); }
  shell()                      { return new PendingProcess().shell(); }
  throwOnFailure()             { return new PendingProcess().throwOnFailure(); }

  /**
   * Run multiple processes concurrently.
   *
   *   const [lint, test, build] = await Process.pool(pool => [
   *     pool.quietly().run('npm run lint'),
   *     pool.quietly().run('npm test'),
   *     pool.quietly().run('npm run build'),
   *   ]);
   */
  pool(callback) { return new ProcessPool().start(callback); }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const defaultProcess = new ProcessManager();

module.exports                        = defaultProcess;
module.exports.ProcessManager         = ProcessManager;
module.exports.PendingProcess         = PendingProcess;
module.exports.ProcessResult          = ProcessResult;
module.exports.ProcessPool            = ProcessPool;
module.exports.ProcessFailedException = ProcessFailedException;