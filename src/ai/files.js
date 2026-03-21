'use strict';

const { AIError, AIProviderError } = require('./types');

// ─────────────────────────────────────────────────────────────────────────────
// AIFile — a file stored with an AI provider
// ─────────────────────────────────────────────────────────────────────────────

class AIFile {
  constructor({ id, filename, mimeType, size, provider, createdAt }) {
    this.id         = id;
    this.filename   = filename;
    this.mimeType   = mimeType;
    this.size       = size;
    this.provider   = provider;
    this.createdAt  = createdAt;
  }

  mimeType() { return this.mimeType; }
}

// ─────────────────────────────────────────────────────────────────────────────
// PendingFile — fluent builder for uploading a file to a provider
// ─────────────────────────────────────────────────────────────────────────────

class PendingFile {
  constructor(manager, source) {
    this._manager  = manager;
    this._source   = source;   // { type: 'path'|'storage'|'url'|'buffer'|'id', value, mimeType, filename }
    this._provider = null;
    this._purpose  = 'assistants';
  }

  using(provider)  { this._provider = provider;  return this; }
  purpose(p)       { this._purpose  = p;          return this; }

  /**
   * Upload the file to the provider.
   * Returns AIFile with the stored file's ID.
   *
   *   const f = await AI.files.fromPath('/report.pdf').put();
   *   console.log(f.id); // 'file-abc123'
   */
  async put(provider = null) {
    const prov   = provider || this._provider || this._manager._default;
    const driver = this._manager._resolveDriver(prov);
    if (typeof driver.uploadFile !== 'function') {
      throw new AIProviderError(prov, `Provider "${prov}" does not support file storage.`);
    }

    const fs   = require('fs');
    const path = require('path');
    const { resolveStoragePath } = require('../http/SafeFilePath');
    let   buf, filename, mimeType;

    if (this._source.type === 'path') {
      // Guard: resolve within storage root to prevent path traversal.
      // If the path is already absolute and within an allowed directory,
      // resolveStoragePath returns it unchanged. If it escapes, it throws.
      const safePath = resolveStoragePath(
        this._source.value,
        require('../http/SafeFilePath').SafeFilePath.getStorageRoot()
      );
      buf      = fs.readFileSync(safePath);
      filename = this._source.filename || path.basename(safePath);
      mimeType = this._source.mimeType || _mimeFromExt(path.extname(filename));
    } else if (this._source.type === 'storage') {
      const storage = this._manager._storage;
      if (!storage) throw new Error('Storage service not available.');
      buf      = await storage.get(this._source.value);
      filename = this._source.filename || path.basename(this._source.value);
      mimeType = this._source.mimeType || _mimeFromExt(path.extname(filename));
    } else if (this._source.type === 'url') {
      const res = await fetch(this._source.value);
      buf       = Buffer.from(await res.arrayBuffer());
      filename  = this._source.filename || path.basename(new URL(this._source.value).pathname) || 'file';
      mimeType  = res.headers.get('content-type') || 'application/octet-stream';
    } else if (this._source.type === 'buffer') {
      buf      = this._source.value;
      filename = this._source.filename || 'file';
      mimeType = this._source.mimeType || 'application/octet-stream';
    } else if (this._source.type === 'id') {
      // Already stored — return a stub
      return new AIFile({ id: this._source.value, filename: null, mimeType: null, size: null, provider: prov });
    }

    const result = await driver.uploadFile({ buf, filename, mimeType, purpose: this._purpose });
    return new AIFile({ ...result, provider: prov });
  }

  /**
   * Retrieve metadata for a previously stored file.
   *
   *   const f = await AI.files.fromId('file-abc').get();
   */
  async get(provider = null) {
    if (this._source.type !== 'id') throw new Error('get() is only available on fromId().');
    const prov   = provider || this._provider || this._manager._default;
    const driver = this._manager._resolveDriver(prov);
    if (typeof driver.getFile !== 'function') throw new AIProviderError(prov, `Provider "${prov}" does not support file retrieval.`);
    const result = await driver.getFile(this._source.value);
    return new AIFile({ ...result, provider: prov });
  }

  /**
   * Delete a previously stored file.
   *
   *   await AI.files.fromId('file-abc').delete();
   */
  async delete(provider = null) {
    if (this._source.type !== 'id') throw new Error('delete() is only available on fromId().');
    const prov   = provider || this._provider || this._manager._default;
    const driver = this._manager._resolveDriver(prov);
    if (typeof driver.deleteFile !== 'function') throw new AIProviderError(prov, `Provider "${prov}" does not support file deletion.`);
    return driver.deleteFile(this._source.value);
  }

  /** Use this file as an attachment in an agent prompt. */
  toAttachment() { return { type: 'file', source: this._source }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// AIFilesAPI — the AI.files namespace
// ─────────────────────────────────────────────────────────────────────────────

class AIFilesAPI {
  constructor(manager) { this._manager = manager; }

  fromPath(path, opts = {})     { return new PendingFile(this._manager, { type: 'path',    value: path, ...opts }); }
  fromStorage(path, opts = {})  { return new PendingFile(this._manager, { type: 'storage', value: path, ...opts }); }
  fromUrl(url, opts = {})       { return new PendingFile(this._manager, { type: 'url',     value: url,  ...opts }); }
  fromBuffer(buf, filename, mimeType) { return new PendingFile(this._manager, { type: 'buffer', value: buf, filename, mimeType }); }
  fromId(id)                    { return new PendingFile(this._manager, { type: 'id',      value: id   }); }
}

// ─────────────────────────────────────────────────────────────────────────────
// AIVectorStore — a vector store (collection of indexed files for RAG)
// ─────────────────────────────────────────────────────────────────────────────

class AIVectorStore {
  constructor({ id, name, provider, fileCounts = {}, ready = false, meta = {} }) {
    this.id         = id;
    this.name       = name;
    this.provider   = provider;
    this.fileCounts = fileCounts;
    this.ready      = ready;
    this.meta       = meta;
  }

  /**
   * Add a file to this vector store.
   * Accepts a file ID string, a PendingFile, or any uploadable source.
   *
   *   await store.add('file-abc123');
   *   await store.add(AI.files.fromPath('/doc.pdf'));
   *   await store.add(AI.files.fromStorage('manual.pdf'));
   */
  async add(fileOrId, metadata = {}) {
    const driver = this._driver;
    let   fileId;

    if (typeof fileOrId === 'string') {
      fileId = fileOrId;
    } else if (fileOrId instanceof PendingFile) {
      // Upload first then add
      const uploaded = await fileOrId.using(this.provider).put();
      fileId = uploaded.id;
    } else {
      throw new Error('store.add() expects a file ID string or PendingFile.');
    }

    return driver.addFileToStore(this.id, fileId, metadata);
  }

  /**
   * Remove a file from this vector store.
   *
   *   await store.remove('file-abc123');
   *   await store.remove('file-abc123', { deleteFile: true }); // also deletes from provider storage
   */
  async remove(fileId, { deleteFile = false } = {}) {
    const driver = this._driver;
    await driver.removeFileFromStore(this.id, fileId);
    if (deleteFile) await driver.deleteFile(fileId);
  }

  /** Delete this entire vector store. */
  async delete() {
    return this._driver.deleteStore(this.id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AIStoresAPI — the AI.stores namespace
// ─────────────────────────────────────────────────────────────────────────────

class AIStoresAPI {
  constructor(manager) { this._manager = manager; }

  /**
   * Create a new vector store.
   *
   *   const store = await AI.stores.create('Knowledge Base');
   *   const store = await AI.stores.create('Docs', { description: '...', expiresIn: 86400 * 30 });
   */
  async create(name, opts = {}, provider = null) {
    const prov   = provider || this._manager._default;
    const driver = this._manager._resolveDriver(prov);
    if (typeof driver.createStore !== 'function') throw new AIProviderError(prov, `Provider "${prov}" does not support vector stores.`);
    const result = await driver.createStore({ name, ...opts });
    const store  = new AIVectorStore({ ...result, provider: prov });
    store._driver = driver;
    return store;
  }

  /**
   * Retrieve an existing vector store by ID.
   *
   *   const store = await AI.stores.get('vs_abc123');
   */
  async get(id, provider = null) {
    const prov   = provider || this._manager._default;
    const driver = this._manager._resolveDriver(prov);
    if (typeof driver.getStore !== 'function') throw new AIProviderError(prov, `Provider "${prov}" does not support vector stores.`);
    const result = await driver.getStore(id);
    const store  = new AIVectorStore({ ...result, provider: prov });
    store._driver = driver;
    return store;
  }

  /**
   * Delete a vector store by ID.
   *
   *   await AI.stores.delete('vs_abc123');
   */
  async delete(id, provider = null) {
    const prov   = provider || this._manager._default;
    const driver = this._manager._resolveDriver(prov);
    if (typeof driver.deleteStore !== 'function') throw new AIProviderError(prov, `Provider "${prov}" does not support vector stores.`);
    return driver.deleteStore(id);
  }
}

function _mimeFromExt(ext) {
  const map = { '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.mp4': 'audio/mp4', '.wav': 'audio/wav' };
  return map[(ext || '').toLowerCase()] || 'application/octet-stream';
}

module.exports = { AIFile, PendingFile, AIFilesAPI, AIVectorStore, AIStoresAPI };