'use strict';

const ServiceProvider = require('./ServiceProvider');
const Cache           = require('../cache/Cache');
const Storage         = require('../storage/Storage');

/**
 * CacheServiceProvider
 *
 * Configures the Cache facade with config/cache.js settings.
 */
class CacheServiceProvider extends ServiceProvider {
  register(container) {
    container.instance('Cache', Cache);
    container.alias('cache', 'Cache');
  }

  async boot() {
    let cacheConfig;
    try {
      cacheConfig = require(process.cwd() + '/config/cache');
    } catch {
      cacheConfig = {
        default: process.env.CACHE_DRIVER || 'memory',
        prefix:  process.env.CACHE_PREFIX  || '',
        drivers: {
          memory: {},
          file:   { path: 'storage/cache' },
          null:   {},
        },
      };
    }
    Cache.configure(cacheConfig);
  }
}

/**
 * StorageServiceProvider
 *
 * Configures the Storage facade with config/storage.js settings.
 */
class StorageServiceProvider extends ServiceProvider {
  register(container) {
    container.instance('Storage', Storage);
    container.alias('storage', 'Storage');
  }

  async boot() {
    let storageConfig;
    try {
      storageConfig = require(process.cwd() + '/config/storage');
    } catch {
      storageConfig = {
        default: process.env.STORAGE_DRIVER || 'local',
        disks: {
          local: {
            driver:  'local',
            root:    'storage/uploads',
            baseUrl: '/storage',
          },
          public: {
            driver:  'local',
            root:    'public/storage',
            baseUrl: '/storage',
          },
        },
      };
    }
    Storage.configure(storageConfig);
  }
}

module.exports = { CacheServiceProvider, StorageServiceProvider };