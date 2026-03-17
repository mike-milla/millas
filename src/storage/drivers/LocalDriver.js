'use strict';

const fs   = require('fs-extra');
const path = require('path');

/**
 * LocalDriver
 *
 * Stores files on the local filesystem.
 * Default driver — zero config required.
 *
 * STORAGE_DRIVER=local
 */
class LocalDriver {
  constructor(config = {}) {
    this._root    = config.root    || path.join(process.cwd(), 'storage/uploads');
    this._baseUrl = config.baseUrl || '/storage';
    fs.ensureDirSync(this._root);
  }

  /**
   * Write a file. Returns the stored path.
   * @param {string}          filePath — relative path inside storage
   * @param {Buffer|string}   content
   * @param {object}          options
   */
  async put(filePath, content, options = {}) {
    const dest = this._abs(filePath);
    await fs.ensureDir(path.dirname(dest));
    await fs.writeFile(dest, content, options.encoding || null);
    return filePath;
  }

  /**
   * Read a file. Returns a Buffer.
   */
  async get(filePath) {
    const abs = this._abs(filePath);
    if (!(await fs.pathExists(abs))) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFile(abs);
  }

  /**
   * Read a file as a UTF-8 string.
   */
  async getString(filePath) {
    const buf = await this.get(filePath);
    return buf.toString('utf8');
  }

  /**
   * Check if a file exists.
   */
  async exists(filePath) {
    return fs.pathExists(this._abs(filePath));
  }

  /**
   * Delete a file.
   */
  async delete(filePath) {
    const abs = this._abs(filePath);
    if (await fs.pathExists(abs)) {
      await fs.remove(abs);
      return true;
    }
    return false;
  }

  /**
   * Delete a directory and all its contents.
   */
  async deleteDirectory(dirPath) {
    await fs.remove(this._abs(dirPath));
    return true;
  }

  /**
   * Copy a file within storage.
   */
  async copy(from, to) {
    await fs.ensureDir(path.dirname(this._abs(to)));
    await fs.copy(this._abs(from), this._abs(to));
    return to;
  }

  /**
   * Move a file within storage.
   */
  async move(from, to) {
    await fs.ensureDir(path.dirname(this._abs(to)));
    await fs.move(this._abs(from), this._abs(to), { overwrite: true });
    return to;
  }

  /**
   * List all files in a directory.
   */
  async files(dirPath = '') {
    const abs = this._abs(dirPath);
    if (!(await fs.pathExists(abs))) return [];
    const entries = await fs.readdir(abs, { withFileTypes: true });
    return entries
      .filter(e => e.isFile())
      .map(e => path.join(dirPath, e.name).replace(/\\/g, '/'));
  }

  /**
   * List all files recursively.
   */
  async allFiles(dirPath = '') {
    const abs = this._abs(dirPath);
    if (!(await fs.pathExists(abs))) return [];
    return this._walk(abs, dirPath);
  }

  /**
   * List all directories.
   */
  async directories(dirPath = '') {
    const abs = this._abs(dirPath);
    if (!(await fs.pathExists(abs))) return [];
    const entries = await fs.readdir(abs, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => path.join(dirPath, e.name).replace(/\\/g, '/'));
  }

  /**
   * Create a directory.
   */
  async makeDirectory(dirPath) {
    await fs.ensureDir(this._abs(dirPath));
    return true;
  }

  /**
   * Get file metadata.
   */
  async metadata(filePath) {
    const abs  = this._abs(filePath);
    const stat = await fs.stat(abs);
    return {
      path:     filePath,
      size:     stat.size,
      mimeType: this._mime(filePath),
      lastModified: stat.mtime,
    };
  }

  /**
   * Get the public URL for a file.
   */
  url(filePath) {
    return `${this._baseUrl}/${filePath}`.replace(/\/+/g, '/');
  }

  /**
   * Get the absolute filesystem path.
   */
  path(filePath) {
    return this._abs(filePath);
  }

  /**
   * Stream a file to an Express response.
   */
  stream(filePath, res, options = {}) {
    const abs = this._abs(filePath);
    if (options.download) {
      res.download(abs, path.basename(filePath));
    } else {
      res.sendFile(abs);
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _abs(filePath) {
    return path.join(this._root, filePath || '');
  }

  async _walk(absDir, relDir) {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    const files   = [];
    for (const e of entries) {
      const relPath = path.join(relDir, e.name).replace(/\\/g, '/');
      if (e.isDirectory()) {
        files.push(...await this._walk(path.join(absDir, e.name), relPath));
      } else {
        files.push(relPath);
      }
    }
    return files;
  }

  _mime(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif',  '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf', '.txt': 'text/plain',
      '.html': 'text/html',      '.css': 'text/css',
      '.js':   'application/javascript',
      '.json': 'application/json',
      '.zip':  'application/zip',
      '.mp4':  'video/mp4',      '.mp3': 'audio/mpeg',
    };
    return types[ext] || 'application/octet-stream';
  }
}

module.exports = LocalDriver;
