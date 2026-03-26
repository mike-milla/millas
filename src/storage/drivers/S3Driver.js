'use strict';

/**
 * S3Driver
 *
 * AWS S3 (and S3-compatible) storage driver for Millas.
 * Implements the same interface as LocalDriver so Storage.put/get/url/etc.
 * work identically in production — no application code changes needed.
 *
 * ── Installation ──────────────────────────────────────────────────────────────
 *
 *   npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 *
 * ── Configuration (config/storage.js) ────────────────────────────────────────
 *
 *   module.exports = {
 *     default: process.env.STORAGE_DRIVER || 'local',
 *     disks: {
 *       local: {
 *         driver:  'local',
 *         root:    'storage/uploads',
 *         baseUrl: '/storage',
 *       },
 *       s3: {
 *         driver:    's3',
 *         bucket:    process.env.AWS_BUCKET,
 *         region:    process.env.AWS_REGION    || 'us-east-1',
 *         accessKey: process.env.AWS_ACCESS_KEY_ID,
 *         secretKey: process.env.AWS_SECRET_ACCESS_KEY,
 *         endpoint:  process.env.AWS_ENDPOINT  || null,  // for S3-compatible (R2, MinIO, etc.)
 *         baseUrl:   process.env.AWS_BASE_URL   || null,  // custom CDN / public URL prefix
 *         acl:       process.env.AWS_ACL        || 'private',  // 'private' | 'public-read'
 *       },
 *     },
 *   };
 *
 * ── Usage ──────────────────────────────────────────────────────────────────────
 *
 *   // Set STORAGE_DRIVER=s3 in .env — everything else is identical:
 *   await Storage.put('avatars/alice.jpg', buffer);
 *   const url = Storage.url('avatars/alice.jpg');
 *   const buf = await Storage.get('avatars/alice.jpg');
 *
 *   // Explicit disk selection:
 *   await Storage.disk('s3').put('reports/q3.pdf', pdfBuffer);
 *
 *   // Signed URLs (time-limited private access):
 *   const signedUrl = await Storage.disk('s3').signedUrl('private/doc.pdf', { expiresIn: 3600 });
 *
 * ── S3-compatible services ────────────────────────────────────────────────────
 *
 *   Cloudflare R2:   endpoint: 'https://<account>.r2.cloudflarestorage.com'
 *   MinIO:           endpoint: 'http://localhost:9000'
 *   DigitalOcean:    endpoint: 'https://<region>.digitaloceanspaces.com'
 *   Backblaze B2:    endpoint: 'https://s3.<region>.backblazeb2.com'
 */
class S3Driver {
  /**
   * @param {object} config
   * @param {string}  config.bucket     S3 bucket name
   * @param {string}  [config.region]   AWS region (default: us-east-1)
   * @param {string}  [config.accessKey] AWS_ACCESS_KEY_ID
   * @param {string}  [config.secretKey] AWS_SECRET_ACCESS_KEY
   * @param {string}  [config.endpoint] Custom endpoint for S3-compatible services
   * @param {string}  [config.baseUrl]  Public URL prefix (CDN / public bucket)
   * @param {string}  [config.acl]      Default ACL ('private' | 'public-read')
   * @param {string}  [config.prefix]   Optional key prefix for all stored files
   */
  constructor(config = {}) {
    if (!config.bucket) {
      throw new Error('[S3Driver] config.bucket is required.');
    }

    this._bucket   = config.bucket;
    this._region   = config.region    || 'us-east-1';
    this._baseUrl  = config.baseUrl   || null;
    this._acl      = config.acl       || 'private';
    this._prefix   = config.prefix    ? config.prefix.replace(/\/$/, '') + '/' : '';
    this._endpoint = config.endpoint  || null;

    // Credentials — fall back to env vars / IAM role if not provided
    this._credentials = config.accessKey && config.secretKey
      ? { accessKeyId: config.accessKey, secretAccessKey: config.secretKey }
      : undefined;

    this._client  = null; // lazy
    this._signer  = null; // lazy
  }

  // ─── Core Operations ───────────────────────────────────────────────────────

  /**
   * Upload a file to S3. Returns the stored path (relative, no prefix).
   *
   * @param {string}         filePath  relative path (e.g. 'avatars/alice.jpg')
   * @param {Buffer|string}  content
   * @param {object}         [options]
   * @param {string}         [options.acl]         override default ACL
   * @param {string}         [options.contentType] explicit MIME type
   * @param {object}         [options.metadata]    extra S3 metadata
   */
  async put(filePath, content, options = {}) {
    const { PutObjectCommand } = this._sdk();
    const key = this._key(filePath);

    const params = {
      Bucket:      this._bucket,
      Key:         key,
      Body:        typeof content === 'string' ? Buffer.from(content) : content,
      ContentType: options.contentType || this._mime(filePath),
    };

    if (options.acl || this._acl !== 'private') {
      params.ACL = options.acl || this._acl;
    }

    if (options.metadata) {
      params.Metadata = options.metadata;
    }

    await this._client.send(new PutObjectCommand(params));
    return filePath;
  }

  /**
   * Download a file from S3. Returns a Buffer.
   */
  async get(filePath) {
    const { GetObjectCommand } = this._sdk();
    const response = await this._client.send(new GetObjectCommand({
      Bucket: this._bucket,
      Key:    this._key(filePath),
    }));
    return _streamToBuffer(response.Body);
  }

  /**
   * Read a file as a UTF-8 string.
   */
  async getString(filePath) {
    const buf = await this.get(filePath);
    return buf.toString('utf8');
  }

  /**
   * Check if a file exists in S3.
   */
  async exists(filePath) {
    const { HeadObjectCommand } = this._sdk();
    try {
      await this._client.send(new HeadObjectCommand({
        Bucket: this._bucket,
        Key:    this._key(filePath),
      }));
      return true;
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  }

  /**
   * Delete a single file from S3.
   */
  async delete(filePath) {
    const { DeleteObjectCommand } = this._sdk();
    await this._client.send(new DeleteObjectCommand({
      Bucket: this._bucket,
      Key:    this._key(filePath),
    }));
    return true;
  }

  /**
   * Delete all objects under a directory prefix.
   */
  async deleteDirectory(dirPath) {
    const keys = await this._listKeys(dirPath);
    if (!keys.length) return true;

    const { DeleteObjectsCommand } = this._sdk();
    // S3 DeleteObjects accepts up to 1000 keys per request
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000).map(Key => ({ Key }));
      await this._client.send(new DeleteObjectsCommand({
        Bucket: this._bucket,
        Delete: { Objects: batch, Quiet: true },
      }));
    }
    return true;
  }

  /**
   * Copy a file within S3.
   */
  async copy(from, to) {
    const { CopyObjectCommand } = this._sdk();
    await this._client.send(new CopyObjectCommand({
      Bucket:     this._bucket,
      CopySource: `${this._bucket}/${this._key(from)}`,
      Key:        this._key(to),
    }));
    return to;
  }

  /**
   * Move a file within S3 (copy then delete).
   */
  async move(from, to) {
    await this.copy(from, to);
    await this.delete(from);
    return to;
  }

  /**
   * List files directly under a directory prefix (non-recursive).
   */
  async files(dirPath = '') {
    const { ListObjectsV2Command } = this._sdk();
    const prefix    = this._key(dirPath ? dirPath.replace(/\/$/, '') + '/' : '');
    const response  = await this._client.send(new ListObjectsV2Command({
      Bucket:    this._bucket,
      Prefix:    prefix,
      Delimiter: '/',
    }));

    return (response.Contents || [])
      .map(obj => this._stripPrefix(obj.Key))
      .filter(Boolean);
  }

  /**
   * List all files under a directory prefix (recursive).
   */
  async allFiles(dirPath = '') {
    const keys = await this._listKeys(dirPath);
    return keys.map(k => this._stripPrefix(k)).filter(Boolean);
  }

  /**
   * List all directory "folders" directly under a prefix.
   */
  async directories(dirPath = '') {
    const { ListObjectsV2Command } = this._sdk();
    const prefix   = this._key(dirPath ? dirPath.replace(/\/$/, '') + '/' : '');
    const response = await this._client.send(new ListObjectsV2Command({
      Bucket:    this._bucket,
      Prefix:    prefix,
      Delimiter: '/',
    }));

    return (response.CommonPrefixes || [])
      .map(p => this._stripPrefix(p.Prefix).replace(/\/$/, ''))
      .filter(Boolean);
  }

  /**
   * No-op for S3 — directories are virtual. Kept for interface parity.
   */
  async makeDirectory(_dirPath) {
    return true;
  }

  /**
   * Get file metadata from S3 (HeadObject).
   */
  async metadata(filePath) {
    const { HeadObjectCommand } = this._sdk();
    const response = await this._client.send(new HeadObjectCommand({
      Bucket: this._bucket,
      Key:    this._key(filePath),
    }));
    return {
      path:         filePath,
      size:         response.ContentLength,
      mimeType:     response.ContentType,
      lastModified: response.LastModified,
      etag:         response.ETag,
      metadata:     response.Metadata || {},
    };
  }

  /**
   * Get the public URL for a file.
   *
   * If config.baseUrl is set (e.g. a CDN), uses that.
   * Otherwise constructs the standard S3 URL.
   */
  url(filePath) {
    if (this._baseUrl) {
      return `${this._baseUrl.replace(/\/$/, '')}/${filePath}`.replace(/([^:]\/)\/+/g, '$1');
    }
    const key = this._key(filePath);
    if (this._endpoint) {
      return `${this._endpoint.replace(/\/$/, '')}/${this._bucket}/${key}`;
    }
    return `https://${this._bucket}.s3.${this._region}.amazonaws.com/${key}`;
  }

  /**
   * Get the S3 key path (not a local filesystem path).
   * Included for interface parity — returns the S3 key.
   */
  path(filePath) {
    return this._key(filePath);
  }

  /**
   * Generate a pre-signed URL for temporary private access.
   *
   * @param {string} filePath
   * @param {object} [options]
   * @param {number} [options.expiresIn=3600]  seconds until expiry
   * @param {string} [options.disposition]     Content-Disposition header value
   */
  async signedUrl(filePath, options = {}) {
    const { GetObjectCommand } = this._sdk();
    const { getSignedUrl } = this._presigner();

    const commandParams = {
      Bucket: this._bucket,
      Key:    this._key(filePath),
    };
    if (options.disposition) {
      commandParams.ResponseContentDisposition = options.disposition;
    }

    return getSignedUrl(
      this._client,
      new GetObjectCommand(commandParams),
      { expiresIn: options.expiresIn || 3600 }
    );
  }

  /**
   * Stream a file to an Express response.
   * Falls back to buffering if streaming is not supported by the SDK version.
   */
  async stream(filePath, res, options = {}) {
    const { GetObjectCommand } = this._sdk();
    const response = await this._client.send(new GetObjectCommand({
      Bucket: this._bucket,
      Key:    this._key(filePath),
    }));

    if (options.download) {
      res.setHeader('Content-Disposition', `attachment; filename="${require('path').basename(filePath)}"`);
    }

    if (response.ContentType) res.setHeader('Content-Type', response.ContentType);
    if (response.ContentLength) res.setHeader('Content-Length', response.ContentLength);

    if (typeof response.Body?.pipe === 'function') {
      response.Body.pipe(res);
    } else {
      const buf = await _streamToBuffer(response.Body);
      res.end(buf);
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  /**
   * Build and cache the S3Client. Lazy so the SDK is only imported
   * if S3Driver is actually used.
   */
  _sdk() {
    if (this._client) return require('@aws-sdk/client-s3');

    let S3Client, sdkModule;
    try {
      sdkModule = require('@aws-sdk/client-s3');
      S3Client  = sdkModule.S3Client;
    } catch {
      throw new Error(
        '[S3Driver] @aws-sdk/client-s3 is not installed.\n' +
        'Run:  npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner'
      );
    }

    const clientConfig = { region: this._region };
    if (this._credentials)  clientConfig.credentials = this._credentials;
    if (this._endpoint)     clientConfig.endpoint     = this._endpoint;
    // Required for path-style URLs on S3-compatible services (MinIO, R2, etc.)
    if (this._endpoint)     clientConfig.forcePathStyle = true;

    this._client = new S3Client(clientConfig);
    return sdkModule;
  }

  _presigner() {
    try {
      return require('@aws-sdk/s3-request-presigner');
    } catch {
      throw new Error(
        '[S3Driver] @aws-sdk/s3-request-presigner is not installed.\n' +
        'Run:  npm install @aws-sdk/s3-request-presigner'
      );
    }
  }

  /** Prepend the configured key prefix. */
  _key(filePath) {
    return `${this._prefix}${filePath}`.replace(/^\//, '');
  }

  /** Strip the configured prefix from a raw S3 key. */
  _stripPrefix(key) {
    return this._prefix ? key.replace(new RegExp(`^${_escapeRegex(this._prefix)}`), '') : key;
  }

  /** List all S3 keys (paginated) under a directory prefix. */
  async _listKeys(dirPath = '') {
    const { ListObjectsV2Command } = this._sdk();
    const prefix  = this._key(dirPath ? dirPath.replace(/\/$/, '') + '/' : '');
    const keys    = [];
    let   token;

    do {
      const params = { Bucket: this._bucket, Prefix: prefix };
      if (token) params.ContinuationToken = token;

      const response = await this._client.send(new ListObjectsV2Command(params));
      (response.Contents || []).forEach(obj => keys.push(obj.Key));
      token = response.IsTruncated ? response.NextContinuationToken : null;
    } while (token);

    return keys;
  }

  _mime(filePath) {
    const ext = require('path').extname(filePath).toLowerCase();
    const types = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif',  '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf', '.txt': 'text/plain',
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.json': 'application/json', '.zip': 'application/zip',
      '.mp4': 'video/mp4', '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
      '.doc':  'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls':  'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    return types[ext] || 'application/octet-stream';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) return stream;
  if (typeof stream?.transformToByteArray === 'function') {
    // AWS SDK v3 streaming body
    const arr = await stream.transformToByteArray();
    return Buffer.from(arr);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function _escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = S3Driver;
