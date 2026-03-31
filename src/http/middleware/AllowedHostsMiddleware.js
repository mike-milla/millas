'use strict';

/**
 * AllowedHostsMiddleware
 *
 * Django-style ALLOWED_HOSTS protection.
 * Validates the Host header against a whitelist to prevent Host header attacks.
 *
 * Usage in config/app.js:
 *   module.exports = {
 *     allowedHosts: ['example.com', 'www.example.com', 'localhost', '127.0.0.1'],
 *     // or use wildcard:
 *     allowedHosts: ['*.example.com', 'localhost'],
 *   };
 *
 * Default behavior:
 *   - Development (APP_ENV=development): allows localhost, 127.0.0.1, and any host
 *   - Production: requires explicit allowedHosts configuration
 */
class AllowedHostsMiddleware {
  constructor(config = {}) {
    this._allowedHosts = config.allowedHosts;
    this._env = config.env || 'production';
    
    // In development, allow localhost and 127.0.0.1 by default
    if (this._allowedHosts === undefined) {
      this._allowedHosts = this._env === 'development' 
        ? ['localhost', '127.0.0.1', '[::1]']
        : [];
    }
  }

  /**
   * Check if a host is allowed
   */
  _isAllowed(host) {
    if (!host) return false;
    
    // Remove port from host
    const hostname = host.split(':')[0];
    
    // Check exact match
    if (this._allowedHosts.includes(hostname)) {
      return true;
    }
    
    // Check wildcard match (*.example.com)
    for (const allowed of this._allowedHosts) {
      if (allowed.startsWith('*.')) {
        const domain = allowed.slice(2);
        if (hostname.endsWith('.' + domain) || hostname === domain) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Express middleware
   */
  middleware() {
    return (req, res, next) => {
      const host = req.get('host');
      
      if (!this._isAllowed(host)) {
        const hostname = host.split(':')[0];
        const message = `Invalid HTTP_HOST header: "${host}". You may need to add "${hostname}" to allowedHosts.`;
        
        const error = new Error(message);
        error.status = 400;
        error.statusCode = 400;
        error.code = 'EINVALIDHOST';
        error._forceDebug = true;
        error._hostDetails = {
          receivedHost: host,
          allowedHosts: this._allowedHosts,
          environment: this._env,
          suggestion: `Add "${hostname}" to the allowedHosts array in config/app.js`
        };
        return next(error);
      }
      
      next();
    };
  }

  /**
   * Static factory
   */
  static from(config) {
    return new AllowedHostsMiddleware(config || {});
  }
}

module.exports = AllowedHostsMiddleware;
