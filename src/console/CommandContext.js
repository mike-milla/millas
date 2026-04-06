'use strict';

/**
 * Command Context
 * Encapsulates all dependencies and configuration for CLI commands
 */
class CommandContext {
  constructor(options = {}) {
    this.program = options.program;
    this.container = options.container || null;
    this.config = options.config || {};
    this.logger = options.logger || console;
    this.cwd = options.cwd || process.cwd();
  }

  /**
   * Set the DI container (lazy loaded after app bootstrap)
   */
  setContainer(container) {
    this.container = container;
    return this;
  }

  /**
   * Set configuration
   */
  setConfig(config) {
    this.config = config;
    return this;
  }

  /**
   * Get a service from the container
   */
  resolve(serviceName) {
    if (!this.container) {
      throw new Error('Container not initialized. Cannot resolve services.');
    }
    return this.container.resolve(serviceName);
  }

  /**
   * Check if running inside a Millas project
   */
  isMillasProject() {
    const fs = require('fs');
    const path = require('path');
    
    const pkgPath = path.join(this.cwd, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return false;
    }
    
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      // Check for millas marker in package.json
      return pkg.millas === true || 
             (pkg.dependencies && 'millas' in pkg.dependencies) ||
             (pkg.devDependencies && 'millas' in pkg.devDependencies);
    } catch {
      return false;
    }
  }
}

module.exports = CommandContext;
