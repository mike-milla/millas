'use strict';

const path = require('path');
const fs = require('fs');

/**
 * AppCommand - Base class for commands that need app bootstrapping
 * 
 * Provides app context loading for commands that need access to:
 * - Routes
 * - Models
 * - Services
 * - Configuration
 */
class AppCommand {

  /**
   *
   * @param context
   */
  constructor(context) {
    this.context = context;
    this.program = context.program;
    this.container = context.container;
    this.logger = context.logger;
    this.cwd = context.cwd;
    this._app = null;
    this._appBootstrapped = false;
  }

  /**
   * Get the app bootstrap path
   * Override this to customize the bootstrap location
   */
  getAppBootstrapPath() {
    return path.resolve(this.cwd, 'bootstrap/app.js');
  }

  /**
   * Check if app bootstrap exists
   */
  hasAppBootstrap() {
    return fs.existsSync(this.getAppBootstrapPath());
  }

  /**
   * Bootstrap the application
   * Override this method to customize bootstrapping behavior
   * 
   * @returns {Object} The bootstrapped app
   */
  async #appBoot() {
    if (this._appBootstrapped) {
      return this._app;
    }

    const bootstrapPath = this.getAppBootstrapPath();

    if (!fs.existsSync(bootstrapPath)) {
      throw new Error('Not inside a Millas project. bootstrap/app.js not found.');
    }

    try {
      this._app = await require(bootstrapPath);
      this._appBootstrapped = true;
      return this._app;
    } catch (err) {
      throw new Error(`Failed to bootstrap app: ${err.message}`);
    }
  }

  /**
   * Get the bootstrapped app (lazy loads if needed)
   * @returns Application
   */
  async getApp() {
    if (!this._appBootstrapped) {
      await this.#appBoot();
    }
    return this._app;
  }

  /**
   * Get a specific export from the bootstrapped app
   * 
   * @param {string} key - The export key (e.g., 'route', 'app', 'db')
   * @returns {*} The exported value
   */
  async getAppExport(key) {
    const app = await this.getApp();
    return app[key];
  }

  /**
   * Require app bootstrap (throws if not found)
   * Use this in commands that MUST have an app context
   */
  async requireApp() {
    if (!this.hasAppBootstrap()) {
      throw new Error('This command requires a Millas project. Run inside a project directory.');
    }
    return await this.getApp();
  }
}

module.exports = AppCommand;
