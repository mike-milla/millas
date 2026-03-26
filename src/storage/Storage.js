'use strict';

const path = require('path');
const os   = require('os');

/**
 * Storage
 *
 * The primary file storage facade.
 *
 * Usage:
 *   const { Storage } = require('millas/src');
 *
 *   // Write a file
 *   await Storage.put('avatars/alice.jpg', buffer);
 *
 *   // Read a file
 *   const buffer = await Storage.get('avatars/alice.jpg');
 *
 *   // Check existence
 *   const ok = await Storage.exists('avatars/alice.jpg');
 *
 *   // Delete
 *   await Storage.delete('avatars/alice.jpg');
 *
 *   // URL
 *   const url = Storage.url('avatars/alice.jpg');  // /storage/avatars/alice.jpg
 *
 *   // Use a different disk
 *   await Storage.disk('public').put('images/logo.png', buffer);
 */
class Storage {
  constructor() {
    this._disks  = new Map();  // name → driver instance
    this._config = null;
    this._default = 'local';
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  configure(config) {
    this._config  = config;
    this._default = config.default || 'local';
    this._disks.clear();
  }

  // ─── Disk selector ─────────────────────────────────────────────────────────

  /**
   * Select a named disk.
   * Storage.disk('public').put(...)
   */
  disk(name) {
    return new DiskProxy(this._getDisk(name));
  }

  // ─── Default disk proxy methods ────────────────────────────────────────────

  async put(filePath, content, options = {})   { return this._getDisk().put(filePath, content, options); }
  async get(filePath)                          { return this._getDisk().get(filePath); }
  async getString(filePath)                    { return this._getDisk().getString(filePath); }
  async exists(filePath)                       { return this._getDisk().exists(filePath); }
  async delete(filePath)                       { return this._getDisk().delete(filePath); }
  async deleteDirectory(dirPath)               { return this._getDisk().deleteDirectory(dirPath); }
  async copy(from, to)                         { return this._getDisk().copy(from, to); }
  async move(from, to)                         { return this._getDisk().move(from, to); }
  async files(dirPath)                         { return this._getDisk().files(dirPath); }
  async allFiles(dirPath)                      { return this._getDisk().allFiles(dirPath); }
  async directories(dirPath)                   { return this._getDisk().directories(dirPath); }
  async makeDirectory(dirPath)                 { return this._getDisk().makeDirectory(dirPath); }
  async metadata(filePath)                     { return this._getDisk().metadata(filePath); }
  url(filePath)                                { return this._getDisk().url(filePath); }
  path(filePath)                               { return this._getDisk().path(filePath); }
  stream(filePath, res, options)               { return this._getDisk().stream(filePath, res, options); }

  /**
   * Store an uploaded file from a Multer/Busboy req.file object.
   *
   * const path = await Storage.putFile('avatars', req.file);
   */
  async putFile(directory, file, options = {}) {
    const ext      = path.extname(file.originalname || file.filename || '');
    const filename = options.name
      ? `${options.name}${ext}`
      : `${this._uniqueId()}${ext}`;
    const filePath = `${directory}/${filename}`.replace(/\/+/g, '/');

    const content = file.buffer || file.path
      ? (file.buffer || await require('fs-extra').readFile(file.path))
      : Buffer.from('');

    await this._getDisk().put(filePath, content);
    return filePath;
  }

  /**
   * Store a base64-encoded data URI.
   *
   * const path = await Storage.putDataUri('avatars', 'data:image/png;base64,...');
   */
  async putDataUri(directory, dataUri, filename) {
    const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URI');

    const mimeType = match[1];
    const buffer   = Buffer.from(match[2], 'base64');
    const ext      = mimeType.split('/')[1] || 'bin';
    const name     = filename || `${this._uniqueId()}.${ext}`;
    const filePath = `${directory}/${name}`.replace(/\/+/g, '/');

    await this._getDisk().put(filePath, buffer);
    return filePath;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _getDisk(name) {
    const diskName = name || this._default;

    if (this._disks.has(diskName)) return this._disks.get(diskName);

    const driver = this._buildDriver(diskName);
    this._disks.set(diskName, driver);
    return driver;
  }

  _buildDriver(name) {
    const diskConf  = this._config?.disks?.[name] || {};
    const driverName = diskConf.driver || name || 'local';

    switch (driverName) {
      case 's3': {
        const S3Driver = require('./drivers/S3Driver');
        return new S3Driver(diskConf);
      }
      case 'local':
      default: {
        const LocalDriver = require('./drivers/LocalDriver');
        return new LocalDriver(diskConf);
      }
    }
  }

  _uniqueId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

// ── DiskProxy ─────────────────────────────────────────────────────────────────

class DiskProxy {
  constructor(driver) { this._d = driver; }
  async put(f, c, o)    { return this._d.put(f, c, o); }
  async get(f)          { return this._d.get(f); }
  async getString(f)    { return this._d.getString(f); }
  async exists(f)       { return this._d.exists(f); }
  async delete(f)       { return this._d.delete(f); }
  async deleteDirectory(d){ return this._d.deleteDirectory(d); }
  async copy(f, t)      { return this._d.copy(f, t); }
  async move(f, t)      { return this._d.move(f, t); }
  async files(d)        { return this._d.files(d); }
  async allFiles(d)     { return this._d.allFiles(d); }
  async directories(d)  { return this._d.directories(d); }
  async makeDirectory(d){ return this._d.makeDirectory(d); }
  async metadata(f)     { return this._d.metadata(f); }
  url(f)                { return this._d.url(f); }
  path(f)               { return this._d.path(f); }
  stream(f, r, o)       { return this._d.stream(f, r, o); }
}

// Singleton
const storage = new Storage();
module.exports = storage;
module.exports.Storage = Storage;
