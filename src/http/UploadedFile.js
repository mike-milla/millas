'use strict';

/**
 * UploadedFile
 *
 * A rich wrapper around a raw multer file object.
 * Every uploaded file in a Millas route handler is an instance of this class —
 * developers never interact with raw multer objects.
 *
 * ── Handler usage ─────────────────────────────────────────────────────────────
 *
 *   async upload({ file, user }) {
 *     // Type checks
 *     file.isImage()           // true
 *     file.isVideo()           // false
 *     file.extension()         // 'jpg'
 *     file.mimeType            // 'image/jpeg'
 *     file.size                // 204800  (bytes)
 *     file.humanSize()         // '200 KB'
 *     file.originalName        // 'photo.jpg'
 *     file.fieldName           // 'file'
 *
 *     // Store to the default disk — returns the stored path
 *     const path = await file.store('avatars');
 *     // → 'avatars/1714000000_a3f9bc.jpg'
 *
 *     // Store with an explicit filename
 *     const path = await file.storeAs('avatars', `${user.id}.jpg`);
 *     // → 'avatars/42.jpg'
 *
 *     // Store to a specific disk
 *     const path = await file.store('avatars', { disk: 's3' });
 *     const path = await file.storeAs('avatars', 'photo.jpg', { disk: 's3' });
 *
 *     // Public URL after storing
 *     const url = file.url('avatars');   // builds URL without storing
 *
 *     // Image dimensions (requires sharp — optional)
 *     const { width, height } = await file.dimensions();
 *
 *     // Convert to base64 data URI
 *     const dataUri = file.toDataUri();
 *     // → 'data:image/jpeg;base64,/9j/4AAQ...'
 *
 *     // Raw buffer access
 *     const buffer = file.buffer;
 *
 *     return success({ path });
 *   }
 *
 * ── Multiple files ────────────────────────────────────────────────────────────
 *
 *   async upload({ files }) {
 *     // files.photos is an array of UploadedFile when maxCount > 1
 *     for (const photo of files.photos) {
 *       await photo.store('gallery');
 *     }
 *   }
 */
class UploadedFile {
  /**
   * @param {object} multerFile  Raw multer file object
   */
  constructor(multerFile) {
    if (!multerFile || typeof multerFile !== 'object') {
      throw new Error('[UploadedFile] multerFile must be a multer file object.');
    }

    /** @private */
    this._raw = multerFile;
  }

  // ── Identity ───────────────────────────────────────────────────────────────

  /** The form field name this file was uploaded under. */
  get fieldName() { return this._raw.fieldname || ''; }

  /** Original filename as given by the client (not sanitised — do not trust for storage). */
  get originalName() { return this._raw.originalname || ''; }

  /** MIME type as reported by the client. */
  get mimeType() { return this._raw.mimetype || ''; }

  /** File size in bytes. */
  get size() { return this._raw.size || 0; }

  /**
   * Raw buffer (memory storage only).
   * For disk storage, use file.path and read manually.
   */
  get buffer() { return this._raw.buffer || null; }

  /**
   * Absolute path on disk (disk storage only).
   * Null when using memory storage.
   */
  get diskPath() { return this._raw.path || null; }

  /**
   * The encoding used for the upload (e.g. '7bit').
   */
  get encoding() { return this._raw.encoding || ''; }

  // ── Type helpers ───────────────────────────────────────────────────────────

  /** Returns true if this is an image file. */
  isImage() {
    return this.mimeType.startsWith('image/');
  }

  /** Returns true if this is a video file. */
  isVideo() {
    return this.mimeType.startsWith('video/');
  }

  /** Returns true if this is an audio file. */
  isAudio() {
    return this.mimeType.startsWith('audio/');
  }

  /** Returns true if this is a PDF. */
  isPdf() {
    return this.mimeType === 'application/pdf';
  }

  /** Returns true if the MIME type matches any of the given types. */
  hasMimeType(...types) {
    const flat = types.flat();
    return flat.includes(this.mimeType);
  }

  // ── Name & extension ───────────────────────────────────────────────────────

  /**
   * File extension derived from the original filename (lowercase, no dot).
   *   file.extension()  // 'jpg'
   */
  extension() {
    const name = this.originalName;
    const idx  = name.lastIndexOf('.');
    return idx !== -1 ? name.slice(idx + 1).toLowerCase() : '';
  }

  /**
   * Original filename without the extension.
   *   file.basename()  // 'photo'
   */
  basename() {
    const name = this.originalName;
    const idx  = name.lastIndexOf('.');
    return idx !== -1 ? name.slice(0, idx) : name;
  }

  // ── Size formatting ────────────────────────────────────────────────────────

  /**
   * Human-readable file size string.
   *   file.humanSize()  // '1.2 MB'
   *
   * @param {number} [decimals=1]
   */
  humanSize(decimals = 1) {
    const bytes = this.size;
    if (bytes === 0) return '0 B';
    const k     = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i     = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  /**
   * Store the file under a directory, using an auto-generated filename.
   * Returns the stored relative path.
   *
   *   const path = await file.store('avatars');
   *   // → 'avatars/1714000000_a3f9bc.jpg'
   *
   *   const path = await file.store('photos', { disk: 's3' });
   *
   * @param {string}  directory
   * @param {object}  [options]
   * @param {string}  [options.disk]           storage disk name (default disk used if omitted)
   * @param {string}  [options.contentType]    override MIME type header
   * @param {string}  [options.acl]            S3 ACL override
   * @returns {Promise<string>}  stored path
   */
  async store(directory, options = {}) {
    const Storage = require('../storage/Storage');
    const disk    = options.disk ? Storage.disk(options.disk) : Storage;
    return disk.putFile(directory, this._raw, options);
  }

  /**
   * Store the file under a directory with an explicit filename.
   * Returns the stored relative path.
   *
   *   const path = await file.storeAs('avatars', `${user.id}.jpg`);
   *   // → 'avatars/42.jpg'
   *
   *   const path = await file.storeAs('avatars', 'photo.jpg', { disk: 's3' });
   *
   * @param {string}  directory
   * @param {string}  filename    filename including extension
   * @param {object}  [options]
   * @param {string}  [options.disk]
   * @param {string}  [options.contentType]
   * @param {string}  [options.acl]
   * @returns {Promise<string>}  stored path
   */
  async storeAs(directory, filename, options = {}) {
    const Storage = require('../storage/Storage');
    const disk    = options.disk ? Storage.disk(options.disk) : Storage;
    return disk.putFile(directory, this._raw, { ...options, name: filename.replace(/\.[^.]+$/, '') });
  }

  /**
   * Build the public URL for a path without storing.
   * Useful when you want to compute the URL in advance.
   *
   *   const url = file.url('avatars/alice.jpg');
   *
   * @param {string}  path
   * @param {string}  [disk]
   */
  url(path, disk) {
    const Storage = require('../storage/Storage');
    return disk ? Storage.disk(disk).url(path) : Storage.url(path);
  }

  // ── Content ────────────────────────────────────────────────────────────────

  /**
   * Convert the file buffer to a base64-encoded data URI.
   * Memory storage only — throws if buffer is unavailable.
   *
   *   file.toDataUri()
   *   // → 'data:image/jpeg;base64,/9j/4AAQ...'
   */
  toDataUri() {
    const buf = this._requireBuffer('toDataUri');
    return `data:${this.mimeType};base64,${buf.toString('base64')}`;
  }

  /**
   * Convert the file buffer to a raw base64 string.
   * Memory storage only.
   *
   *   file.toBase64()
   *   // → '/9j/4AAQ...'
   */
  toBase64() {
    return this._requireBuffer('toBase64').toString('base64');
  }

  /**
   * Read the raw content of the file as a Buffer.
   * Works for both memory and disk storage.
   *
   * @returns {Promise<Buffer>}
   */
  async read() {
    if (this.buffer) return this.buffer;
    if (this.diskPath) {
      return require('fs-extra').readFile(this.diskPath);
    }
    throw new Error('[UploadedFile] No buffer or disk path available.');
  }

  // ── Image helpers ──────────────────────────────────────────────────────────

  /**
   * Get the pixel dimensions of an image file.
   * Requires sharp (optional peer dependency).
   *
   *   const { width, height } = await file.dimensions();
   *
   * @returns {Promise<{ width: number, height: number }>}
   */
  async dimensions() {
    if (!this.isImage()) {
      throw new Error('[UploadedFile] dimensions() is only available for image files.');
    }
    let sharp;
    try {
      sharp = require('sharp');
    } catch {
      throw new Error(
        '[UploadedFile] dimensions() requires sharp.\n' +
        'Run: npm install sharp'
      );
    }
    const buf  = await this.read();
    const meta = await sharp(buf).metadata();
    return { width: meta.width, height: meta.height };
  }

  /**
   * Get full sharp metadata for an image (width, height, format, space, channels, etc.)
   * Requires sharp.
   *
   *   const meta = await file.metadata();
   *   // → { width: 1920, height: 1080, format: 'jpeg', space: 'srgb', ... }
   *
   * @returns {Promise<object>}
   */
  async metadata() {
    let sharp;
    try {
      sharp = require('sharp');
    } catch {
      throw new Error(
        '[UploadedFile] metadata() requires sharp.\n' +
        'Run: npm install sharp'
      );
    }
    const buf = await this.read();
    return sharp(buf).metadata();
  }

  // ── Serialisation ──────────────────────────────────────────────────────────

  /**
   * Plain object representation — safe to log or include in responses.
   * Does NOT include the buffer.
   */
  toJSON() {
    return {
      fieldName:    this.fieldName,
      originalName: this.originalName,
      mimeType:     this.mimeType,
      size:         this.size,
      humanSize:    this.humanSize(),
      extension:    this.extension(),
    };
  }

  /** @override */
  toString() {
    return `[UploadedFile: ${this.originalName} (${this.humanSize()})]`;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _requireBuffer(method) {
    if (!this.buffer) {
      throw new Error(
        `[UploadedFile] ${method}() requires memory storage. ` +
        'The file was stored to disk — use file.read() instead.'
      );
    }
    return this.buffer;
  }

  // ── Static factory ─────────────────────────────────────────────────────────

  /**
   * Wrap a raw multer file object (or an array of them) in UploadedFile.
   * Already-wrapped instances are returned unchanged.
   *
   * @param {object|object[]} raw
   * @returns {UploadedFile|UploadedFile[]}
   */
  static wrap(raw) {
    if (!raw) return null;
    if (raw instanceof UploadedFile) return raw;
    if (Array.isArray(raw)) return raw.map(UploadedFile.wrap);
    return new UploadedFile(raw);
  }

  /**
   * Wrap the req.file / req.files payload produced by multer into
   * UploadedFile instances. Returns { file, files } ready to be
   * assigned to the RequestContext.
   *
   * @param {object} expressReq  Raw Express request after multer has run
   * @returns {{ file: UploadedFile|null, files: object }}
   */
  static wrapRequest(expressReq) {
    // Single file upload (multer .single())
    const file = expressReq.file ? new UploadedFile(expressReq.file) : null;

    // Multi-file upload
    let files = {};
    if (expressReq.files) {
      if (Array.isArray(expressReq.files)) {
        // multer .any() → flat array, group by fieldname
        for (const f of expressReq.files) {
          const wrapped = new UploadedFile(f);
          if (!files[f.fieldname]) {
            files[f.fieldname] = wrapped;
          } else if (Array.isArray(files[f.fieldname])) {
            files[f.fieldname].push(wrapped);
          } else {
            files[f.fieldname] = [files[f.fieldname], wrapped];
          }
        }
      } else {
        // multer .fields() → { fieldname: [multerFile, ...] }
        for (const [fieldname, arr] of Object.entries(expressReq.files)) {
          const wrapped = arr.map(f => new UploadedFile(f));
          files[fieldname] = wrapped.length === 1 ? wrapped[0] : wrapped;
        }
      }
    }

    return { file, files };
  }
}

module.exports = UploadedFile;
