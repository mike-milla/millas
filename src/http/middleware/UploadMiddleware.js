'use strict';

/**
 * UploadMiddleware
 *
 * Built-in multipart/form-data handler for Millas.
 * Zero config required — just declare file() fields in your shape or
 * pass options to the constructor and the framework takes care of the rest.
 *
 * Powered by multer under the hood (lazy-required, so it only needs to be
 * installed if you actually handle uploads — multer is listed as an optional
 * peer dependency).
 *
 * ── Usage patterns ───────────────────────────────────────────────────────────
 *
 *   1. No shape, no config — just add 'upload' to middleware:
 *
 *      Route.post('/media/upload', ['auth', 'upload'], MediaController, 'upload');
 *
 *      async upload({ file, files, user }) {
 *        // file  — first uploaded file (any field name), UploadedFile instance
 *        // files — all files keyed by field name
 *        const path = await file.store('media');
 *      }
 *
 *   2. Parameterized alias — configure field/count inline:
 *
 *      'upload'           → any field, 50 MB limit  (default)
 *      'upload:avatar'    → single field named 'avatar'
 *      'upload:photos,5'  → field 'photos', up to 5 files
 *
 *      Route.post('/avatar', ['auth', 'upload:avatar'], UserController, 'updateAvatar');
 *
 *   3. With a shape — Router auto-injects UploadMiddleware, zero manual config:
 *
 *   async upload({ body, file, user }) {
 *     // file is a multer file object: { buffer, mimetype, size, originalname }
 *     // body has the rest of the form fields
 *   }
 *
 * ── Manual usage ──────────────────────────────────────────────────────────────
 *
 *   const { UploadMiddleware } = require('millas/core/http');
 *
 *   // Single named field
 *   Route.post('/avatar', ['auth', new UploadMiddleware({ field: 'avatar' })], UserController, 'updateAvatar');
 *
 *   // Multiple named fields
 *   Route.post('/listing', ['auth', new UploadMiddleware({ fields: [{ name: 'photo', maxCount: 5 }] })], ListingController, 'store');
 *
 *   // Any field name (multer .any())
 *   Route.post('/upload', [new UploadMiddleware({ any: true })], UploadController, 'store');
 *
 * ── Options ───────────────────────────────────────────────────────────────────
 *
 *   {
 *     field:    string           // single field name (default: 'file')
 *     fields:   [{name, maxCount}]  // multiple named fields
 *     any:      boolean          // accept any field name
 *     maxSize:  number|string    // max file size bytes or '10mb' (default: 50mb)
 *     storage:  'memory'|'disk'  // multer storage (default: 'memory')
 *     dest:     string           // disk storage destination (only when storage: 'disk')
 *     filter:   Function         // custom multer fileFilter(req, file, cb)
 *   }
 *
 * ── Handler context ───────────────────────────────────────────────────────────
 *
 *   After this middleware runs, RequestContext exposes:
 *
 *     ctx.file   — single uploaded file (multer file object)
 *     ctx.files  — multiple uploaded files (object or array)
 *     ctx.body   — non-file form fields (strings)
 *
 *   Multer file object shape:
 *     {
 *       fieldname:    'file',
 *       originalname: 'photo.jpg',
 *       mimetype:     'image/jpeg',
 *       size:         204800,
 *       buffer:       <Buffer ...>    // memory storage only
 *       path:         '/tmp/...'      // disk storage only
 *     }
 */
class UploadMiddleware {
  /**
   * @param {object} options
   * @param {string}              [options.field='file']   single field name
   * @param {Array<{name,maxCount}>} [options.fields]      multiple named fields
   * @param {boolean}             [options.any=false]      accept any field
   * @param {number|string}       [options.maxSize]        max file size
   * @param {'memory'|'disk'}     [options.storage='memory']
   * @param {string}              [options.dest]           disk dest (storage:'disk')
   * @param {Function}            [options.filter]         multer fileFilter
   */
  constructor(options = {}) {
    this._options = {
      field:          options.field   || 'file',
      _explicitField: !!options.field,          // true only when caller set field explicitly
      fields:         options.fields  || null,
      any:            options.any     || false,
      maxSize:        options.maxSize !== undefined ? _parseSize(options.maxSize) : 50 * 1024 * 1024,
      storage:        options.storage || 'memory',
      dest:           options.dest    || null,
      filter:         options.filter  || null,
    };
    this._multerInstance = null;
  }

  // ── Millas Middleware protocol ─────────────────────────────────────────────

  /**
   * Build and cache the multer middleware on first request, then delegate.
   * Runs as a standard Millas middleware — ctx + next.
   *
   * Because multer is Express middleware internally, we reach into ctx.req.raw
   * to get the underlying Express req/res and call multer directly.
   *
   * Skips gracefully when the request is not multipart/form-data so that
   * non-upload requests to the same route (or misconfigured clients) get a
   * clear 400 rather than a multer internal error.
   */
  async handle(ctx, next) {
    const expressReq  = ctx.req.raw;
    const contentType = expressReq.headers?.['content-type'] || '';

    // Skip multer entirely for non-multipart requests.
    // ctx.file / ctx.files stay null/{} — the handler or shape validation
    // will surface a missing-required-field error if needed.
    if (!contentType.includes('multipart/form-data')) {
      return next();
    }

    const multerMw = this._getMulterMiddleware();

    await new Promise((resolve, reject) => {
      // multer needs a real Express res object; we synthesize a minimal one
      // that satisfies multer's internal usage (it only calls res.end /
      // statusCode on hard errors, which we convert to thrown exceptions).
      const fakeRes = _buildFakeRes(reject);
      multerMw(expressReq, fakeRes, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Wrap raw multer file objects in UploadedFile instances so handlers
    // receive rich, manipulable file objects instead of plain multer blobs.
    const UploadedFile = require('../UploadedFile');
    const { file, files } = UploadedFile.wrapRequest(expressReq);

    // Sync into RequestContext (which was constructed before multer ran).
    ctx.file  = file;
    ctx.files = files;

    // Also mirror back onto the raw express req so Router._buildShapeMiddleware
    // can pick them up when it merges file inputs for validation.
    expressReq._millaFile  = file;
    expressReq._millaFiles = files;

    // Also update ctx.body with any non-file multipart fields multer parsed.
    // req.body is mutated in-place by multer, but ctx.body was built at
    // RequestContext construction time. Reassign so the handler sees the fields.
    if (expressReq.body && typeof expressReq.body === 'object') {
      // Merge multer-parsed text fields into the existing ctx.body object
      // without breaking the .validate() / .only() / .except() helpers
      // that _buildBody attached as non-enumerable properties.
      Object.assign(ctx.body, expressReq.body);
    }

    return next();
  }

  // ── Static factory helpers ──────────────────────────────────────────────────

  /**
   * Build an UploadMiddleware from parameterized alias string parts.
   * Called by MiddlewareRegistry when the alias includes parameters.
   *
   *   'upload'              → any field, 50 MB limit  (default)
   *   'upload:avatar'       → single field named 'avatar'
   *   'upload:photos,5'     → field 'photos', up to 5 files
   *   'upload:*'            → any field (explicit)
   *
   * @param {string[]} params  Parts after the colon, split by comma
   * @returns {UploadMiddleware}
   */
  static fromParams(params) {
    if (!params || !params.length || params[0] === '*') {
      return new UploadMiddleware({ any: true });
    }
    const field    = params[0];
    const maxCount = params[1] ? parseInt(params[1], 10) : 1;
    if (maxCount > 1) {
      return new UploadMiddleware({ fields: [{ name: field, maxCount }] });
    }
    return new UploadMiddleware({ field });
  }

  /**
   * Build an UploadMiddleware from a shape definition.
   * Called internally by the Router when auto-injecting.
   *
   * @param {import('../Shape').ShapeDefinition} shape
   * @returns {UploadMiddleware}
   */
  static fromShape(shape) {
    const opts = { storage: 'memory' };

    // Collect file field names from the shape's "in" validators
    const fileFields = _fileFieldsFromShape(shape);

    if (fileFields.length === 1) {
      opts.field = fileFields[0].name;
    } else if (fileFields.length > 1) {
      opts.fields = fileFields; // [{name, maxCount}]
    }

    // Honour explicit maxSize from first file validator found
    const firstFileValidator = _firstFileValidator(shape);
    if (firstFileValidator?._maxSizeBytes) {
      opts.maxSize = firstFileValidator._maxSizeBytes;
    }

    // Build a combined mimeType filter from all file validators
    const allMimes = _allMimeTypes(shape);
    if (allMimes.length) {
      opts.filter = (req, file, cb) => {
        cb(null, allMimes.includes(file.mimetype));
      };
    }

    return new UploadMiddleware(opts);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _getMulterMiddleware() {
    if (this._multerInstance) return this._multerInstance;

    let multer;
    try {
      multer = require('multer');
    } catch {
      throw new Error(
        '[Millas UploadMiddleware] multer is not installed.\n' +
        'Run:  npm install multer\n' +
        'multer is required for multipart/file upload support.'
      );
    }

    const { field, fields, any, maxSize, storage, dest, filter } = this._options;

    // Storage engine
    const storageEngine = storage === 'disk' && dest
      ? multer.diskStorage({ destination: dest, filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`) })
      : multer.memoryStorage();

    const multerConfig = { storage: storageEngine, limits: { fileSize: maxSize } };
    if (filter) multerConfig.fileFilter = filter;

    const upload = multer(multerConfig);

    // Pick the right multer handler based on options.
    // When used without a shape (e.g. just 'upload' alias), default to .any()
    // so the handler receives whatever field the client sends, regardless of name.
    if (any || (!fields && this._options.field === 'file' && !this._options._explicitField)) {
      this._multerInstance = upload.any();
    } else if (fields) {
      this._multerInstance = upload.fields(fields);
    } else {
      this._multerInstance = upload.single(field);
    }

    return this._multerInstance;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a human-readable size string to bytes.
 * '5mb' → 5242880, '500kb' → 512000, 1024 → 1024
 */
function _parseSize(size) {
  if (typeof size === 'number') return size;
  const s = String(size).trim().toLowerCase();
  const n = parseFloat(s);
  if (s.endsWith('gb')) return n * 1024 * 1024 * 1024;
  if (s.endsWith('mb')) return n * 1024 * 1024;
  if (s.endsWith('kb')) return n * 1024;
  return n;
}

/**
 * Scan a shape's "in" schema for FileValidator instances.
 * Returns [{name, maxCount: 1}] for each file field found.
 */
function _fileFieldsFromShape(shape) {
  if (!shape?.in) return [];
  const fields = [];
  for (const [name, validator] of Object.entries(shape.in)) {
    if (validator?._type === 'file') {
      fields.push({ name, maxCount: 1 });
    }
  }
  return fields;
}

function _firstFileValidator(shape) {
  if (!shape?.in) return null;
  for (const validator of Object.values(shape.in)) {
    if (validator?._type === 'file') return validator;
  }
  return null;
}

function _allMimeTypes(shape) {
  if (!shape?.in) return [];
  const mimes = [];
  for (const validator of Object.values(shape.in)) {
    if (validator?._type === 'file' && Array.isArray(validator._mimeTypes)) {
      mimes.push(...validator._mimeTypes);
    }
  }
  return [...new Set(mimes)];
}

/**
 * Build a minimal fake Express response object for multer.
 * Multer only interacts with res in error cases — we map those to rejections.
 */
function _buildFakeRes(reject) {
  return {
    statusCode: 200,
    end: (msg) => reject(new Error(msg || 'Upload error')),
    setHeader: () => {},
    getHeader: () => null,
  };
}

module.exports = UploadMiddleware;
