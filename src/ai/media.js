'use strict';

const { AIProviderError } = require('./types');

// ─────────────────────────────────────────────────────────────────────────────
// AIImageResponse
// ─────────────────────────────────────────────────────────────────────────────

class AIImageResponse {
  constructor({ images, urls = [], provider, model, prompt }) {
    this._images   = images || [];   // array of Buffers (when b64 returned)
    this._urls     = urls   || [];   // array of URLs (when url returned)
    this.provider  = provider;
    this.model     = model;
    this.prompt    = prompt;
  }

  /** First image buffer (null if provider returned URLs instead). */
  get buffer() { return this._images[0] || null; }

  /** All image buffers. */
  get buffers() { return this._images; }

  /** First image URL (null if provider returned buffers instead). */
  get url() { return this._urls[0] || null; }

  /** All image URLs. */
  get urls() { return this._urls; }

  /** Store first image to a path using Millas Storage or write to local filesystem. */
  async store(filePath, disk = null) {
    if (!this.buffer) throw new Error('No image buffer available — provider returned a URL. Use img.url instead.');
    const storage = AIImageResponse._storage;
    if (storage) {
      const d = disk ? storage.disk(disk) : storage;
      await d.put(filePath, this.buffer);
      return filePath;
    }
    // Fallback — write directly to filesystem
    const fs   = require('fs');
    const path = require('path');
    const dir  = path.dirname(filePath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, this.buffer);
    return filePath;
  }

  /** Store with auto-generated extension. */
  async storeAs(name, disk = null) {
    const filePath = name.includes('.') ? name : `${name}.png`;
    return this.store(filePath, disk);
  }

  toString() {
    if (this._urls[0])    return this._urls[0];
    if (this._images[0])  return `[AIImageResponse: ${this._images.length} image(s) from ${this.provider}]`;
    return '[AIImageResponse: empty]';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PendingImage
// ─────────────────────────────────────────────────────────────────────────────

class PendingImage {
  constructor(manager, prompt) {
    this._manager  = manager;
    this._prompt   = prompt;
    this._provider = null;
    this._model    = null;
    this._size     = null;
    this._quality  = 'standard';
    this._n        = 1;
    this._aspect   = '1:1';
    this._attachments = [];
    this._queued   = false;
    this._thenFns  = [];
  }

  /** Select a specific provider. */
  using(provider)    { this._provider = provider;  return this; }
  model(model)       { this._model    = model;     return this; }
  quality(q)         { this._quality  = q;         return this; }
  count(n)           { this._n        = n;         return this; }

  /** 1:1 square aspect ratio (default). */
  square()     { this._aspect = '1:1';   this._size = '1024x1024'; return this; }
  /** 16:9 landscape. */
  landscape()  { this._aspect = '16:9';  this._size = '1792x1024'; return this; }
  /** 9:16 portrait. */
  portrait()   { this._aspect = '9:16';  this._size = '1024x1792'; return this; }

  /** Attach reference images. */
  attachments(files) { this._attachments = files; return this; }

  /** Queue the generation. Returns a QueuedResponse. */
  queue() { this._queued = true; return this; }

  then(fn) { this._thenFns.push(fn); return this; }

  async generate() {
    const provider = this._provider || this._manager._default;
    const driver   = this._manager._resolveDriver(provider);
    const result   = await driver.image({
      prompt:      this._prompt,
      model:       this._model,
      size:        this._size,
      quality:     this._quality,
      n:           this._n,
      aspectRatio: this._aspect,
      attachments: this._attachments,
    });
    const response = new AIImageResponse({ ...result, prompt: this._prompt });
    for (const fn of this._thenFns) await fn(response);
    return response;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AIAudioResponse
// ─────────────────────────────────────────────────────────────────────────────

class AIAudioResponse {
  constructor({ audio, format, provider }) {
    this._audio  = audio;    // Buffer
    this.format  = format;
    this.provider = provider;
  }

  get buffer() { return this._audio; }

  async store(filePath, disk = null) {
    const storage = AIAudioResponse._storage;
    if (!storage) throw new Error('Storage service not available.');
    const d = disk ? storage.disk(disk) : storage;
    await d.put(filePath, this._audio);
    return filePath;
  }

  async storeAs(name, disk = null) {
    const path = name.includes('.') ? name : `${name}.${this.format || 'mp3'}`;
    return this.store(path, disk);
  }

  toString() { return `[AIAudioResponse: ${this._audio.length} bytes, ${this.format}]`; }
}

// ─────────────────────────────────────────────────────────────────────────────
// PendingAudio (TTS)
// ─────────────────────────────────────────────────────────────────────────────

class PendingAudio {
  constructor(manager, text) {
    this._manager  = manager;
    this._text     = text;
    this._provider = null;
    this._model    = null;
    this._voice    = null;
    this._instructions = null;
  }

  using(provider)        { this._provider      = provider;      return this; }
  model(model)           { this._model         = model;         return this; }
  voice(v)               { this._voice         = v;             return this; }
  male()                 { this._voice         = 'onyx';        return this; }
  female()               { this._voice         = 'nova';        return this; }
  instructions(text)     { this._instructions  = text;          return this; }

  async generate() {
    const provider = this._provider || this._manager._audioProvider || this._manager._default;
    const driver   = this._manager._resolveDriver(provider);
    const result   = await driver.tts({ text: this._text, model: this._model, voice: this._voice, instructions: this._instructions });
    return new AIAudioResponse(result);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AITranscriptionResponse
// ─────────────────────────────────────────────────────────────────────────────

class AITranscriptionResponse {
  constructor({ text, words = [], speakers = [], provider }) {
    this.text      = text;
    this.words     = words;      // [{ word, start, end, speaker }]
    this.speakers  = speakers;   // [{ speaker, segments }]
    this.provider  = provider;
  }

  toString() { return this.text; }
}

// ─────────────────────────────────────────────────────────────────────────────
// PendingTranscription (STT)
// ─────────────────────────────────────────────────────────────────────────────

class PendingTranscription {
  constructor(manager, source) {
    this._manager  = manager;
    this._source   = source;     // { type: 'path'|'storage'|'buffer', value }
    this._provider = null;
    this._model    = null;
    this._language = null;
    this._prompt   = null;
    this._diarize  = false;
  }

  using(provider)    { this._provider = provider;  return this; }
  model(model)       { this._model    = model;      return this; }
  language(lang)     { this._language = lang;       return this; }
  prompt(p)          { this._prompt   = p;          return this; }
  /** Include speaker diarization (who said what). */
  diarize()          { this._diarize  = true;       return this; }

  async generate() {
    const fs     = require('fs');
    const path   = require('path');
    let   audio, filename, mimeType;

    if (this._source.type === 'path') {
      audio    = fs.readFileSync(this._source.value);
      filename = path.basename(this._source.value);
      mimeType = _mimeFromExt(path.extname(filename));
    } else if (this._source.type === 'storage') {
      const storage = PendingTranscription._storage;
      if (!storage) throw new Error('Storage not available.');
      audio    = await storage.get(this._source.value);
      filename = path.basename(this._source.value);
      mimeType = _mimeFromExt(path.extname(filename));
    } else if (this._source.type === 'buffer') {
      audio    = this._source.value;
      filename = this._source.filename || 'audio.mp3';
      mimeType = this._source.mimeType || 'audio/mpeg';
    }

    const provider = this._provider || this._manager._audioProvider || 'openai';
    const driver   = this._manager._resolveDriver(provider);
    const result   = await driver.transcribe({ audio, filename, mimeType, model: this._model, language: this._language, prompt: this._prompt, diarize: this._diarize });
    return new AITranscriptionResponse(result);
  }
}

function _mimeFromExt(ext) {
  const map = { '.mp3': 'audio/mpeg', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };
  return map[ext.toLowerCase()] || 'audio/mpeg';
}

// ─────────────────────────────────────────────────────────────────────────────
// AIRerankResponse
// ─────────────────────────────────────────────────────────────────────────────

class AIRerankResponse {
  constructor(results) {
    this._results = results;  // [{ index, score, document }] sorted by score desc
  }

  /** Top result. */
  get first() { return this._results[0]; }

  /** All results. */
  get all()   { return this._results; }

  /** Get result at position n (0-indexed). */
  at(n)       { return this._results[n]; }

  [Symbol.iterator]() { return this._results[Symbol.iterator](); }
}

// ─────────────────────────────────────────────────────────────────────────────
// PendingReranking
// ─────────────────────────────────────────────────────────────────────────────

class PendingReranking {
  constructor(manager, documents) {
    this._manager   = manager;
    this._documents = documents;
    this._provider  = null;
    this._model     = null;
    this._limit     = null;
  }

  using(provider)   { this._provider = provider;  return this; }
  model(model)      { this._model    = model;      return this; }
  limit(n)          { this._limit    = n;          return this; }

  async rerank(query) {
    const provider = this._provider || this._manager._rerankProvider || 'cohere';
    const driver   = this._manager._resolveDriver(provider);
    const results  = await driver.rerank({ query, documents: this._documents, model: this._model, limit: this._limit });
    return new AIRerankResponse(results.sort((a, b) => b.score - a.score));
  }
}

module.exports = {
  PendingImage, AIImageResponse,
  PendingAudio, AIAudioResponse,
  PendingTranscription, AITranscriptionResponse,
  PendingReranking, AIRerankResponse,
};