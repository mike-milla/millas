# Millas ORM, Migrations & File Uploads

> Internal documentation covering all features implemented/fixed in this session.
> Use this as the source of truth when updating the public docs.

---

## Table of Contents

1. [Models](#1-models)
2. [Field Types](#2-field-types)
3. [Relations](#3-relations)
4. [Indexes & Unique Constraints](#4-indexes--unique-constraints)
5. [Type Casting](#5-type-casting)
6. [Migrations](#6-migrations)
7. [File Uploads](#7-file-uploads)
8. [Storage](#8-storage)

---

## 1. Models

### Basic model

```js
const { Model, fields } = require('millas/core/db');

class Post extends Model {
  static table = 'posts';

  static fields = {
    title:      fields.string({ max: 255 }),
    body:       fields.text(),
    published:  fields.boolean({ default: false }),
    created_at: fields.timestamp(),
    updated_at: fields.timestamp(),
  };
}
```

### Auto id

You do **not** need to declare `fields.id()`. If no primary key is declared, Millas automatically injects one — exactly like Django.

```js
// These two are identical:

class Post extends Model {
  static fields = { title: fields.string() };
}

class Post extends Model {
  static fields = { id: fields.id(), title: fields.string() };
}
```

### Custom primary key

```js
class Post extends Model {
  static primaryKey = 'uuid';
  static fields = {
    uuid:  fields.uuid(),
    title: fields.string(),
  };
}
```

### Soft deletes

```js
class Post extends Model {
  static softDeletes = true;
  static fields = { ... };
}

await post.delete();           // sets deleted_at, row stays in DB
await post.restore();          // clears deleted_at
Post.withTrashed().get();      // includes deleted rows
Post.onlyTrashed().get();      // only deleted rows
await post.forceDelete();      // permanently removes the row
```

### Hidden fields

Fields listed in `static hidden` are excluded from `toJSON()` and API responses.

```js
class User extends Model {
  static hidden = ['password', 'remember_token', 'two_factor_secret'];
}
```

### Abstract base models

```js
class TimestampedModel extends Model {
  static abstract = true;
  static fields = {
    created_at: fields.timestamp(),
    updated_at: fields.timestamp(),
  };
}

class Post extends TimestampedModel {
  static table = 'posts';
  static fields = {
    title: fields.string(),
    // created_at and updated_at are inherited automatically
  };
}
```

### Model registration

All models **must** be exported from `app/models/index.js`. This is the single source of truth for migrations, relations, and the admin panel.

```js
// app/models/index.js
const { User } = require('./core');
const { Post } = require('./content');

module.exports = { User, Post };
```

---

## 2. Field Types

### All available fields

| Field | DB type | Notes |
|---|---|---|
| `fields.id()` | `INT UNSIGNED AUTO_INCREMENT` | Auto-injected if omitted |
| `fields.string({ max })` | `VARCHAR(255)` | Default max: 255 |
| `fields.text()` | `TEXT` | |
| `fields.integer()` | `INT` | |
| `fields.bigInteger()` | `BIGINT` | |
| `fields.float()` | `FLOAT` | |
| `fields.decimal(precision, scale)` | `DECIMAL(8,2)` | Default: 8,2 |
| `fields.boolean()` | `BOOLEAN` | Cast to `true`/`false` on read |
| `fields.json()` | `JSON` | Auto `JSON.parse` on read, `JSON.stringify` on write |
| `fields.date()` | `DATE` | Cast to `Date` on read |
| `fields.timestamp()` | `TIMESTAMP` | Cast to `Date` on read |
| `fields.enum(values)` | `ENUM(...)` | |
| `fields.uuid()` | `UUID` | |
| `fields.email()` | `VARCHAR(254)` | RFC 5321 max length |
| `fields.url()` | `VARCHAR(2048)` | |
| `fields.slug()` | `VARCHAR(255)` | |
| `fields.ipAddress()` | `VARCHAR(45)` | Supports IPv6 |

### Common options

All fields accept these options:

```js
fields.string({
  max:      100,       // max length (string types)
  nullable: true,      // allow NULL
  unique:   true,      // unique constraint
  default:  'active',  // default value
  unsigned: true,      // unsigned (integer types)
})
```

### JSON fields

JSON is automatically serialized/deserialized — no manual `JSON.parse` needed:

```js
class Post extends Model {
  static fields = {
    tags:     fields.json({ nullable: true }),
    metadata: fields.json({ default: '{}' }),
  };
}

const post = await Post.find(1);
console.log(post.tags);   // already an array/object, not a string

await Post.create({ tags: ['news', 'tech'] });  // auto JSON.stringify
await post.update({ tags: ['news'] });           // auto JSON.stringify
// post.tags is still ['news'] after update — not a string
```

---

## 3. Relations

### ForeignKey (BelongsTo)

```js
class Post extends Model {
  static table = 'posts';
  static fields = {
    // Field named 'author' → DB column 'author_id', accessor post.author()
    author: fields.ForeignKey('User', {
      onDelete:    'CASCADE',   // CASCADE | SET NULL | RESTRICT (default: CASCADE)
      nullable:    false,
      relatedName: 'posts',     // reverse: user.posts()
    }),
  };
}

// Eager load
const post = await Post.with('author').find(1);
post.author.name;

// Lazy load
const post  = await Post.find(1);
const author = await post.author();
```

### OneToOne

```js
class Profile extends Model {
  static fields = {
    user: fields.OneToOne('User', { relatedName: 'profile' }),
    bio:  fields.text(),
  };
}
```

### ManyToMany

```js
class Post extends Model {
  static fields = {
    tags: fields.ManyToMany('Tag', {
      through:     'post_tags',   // optional custom pivot table
      relatedName: 'posts',
    }),
  };
}

await post.tags.attach(tagId);
await post.tags.detach(tagId);
await post.tags.sync([1, 2, 3]);
```

### String model references

When using a string model name like `'User'`, Millas resolves it from `app/models/index.js`. The model **must** be exported there.

```js
// Works — User is exported from app/models/index.js
fields.ForeignKey('User', { ... })

// Also works — direct lazy class reference
const User = require('../core/User');
fields.ForeignKey(() => User, { ... })
```

### Eager loading

```js
Post.with('author').get()
Post.with('author', 'tags').get()
Post.with({ author: q => q.where('active', true) }).get()  // constrained
Post.withCount('comments').get()   // adds .comments_count to each instance
Post.withSum('orders', 'amount').get()  // adds .orders_sum_amount
```

---

## 4. Indexes & Unique Constraints

### Declaring indexes

```js
class MarketplacePost extends Model {
  static table = 'marketplace_posts';

  static fields = {
    user:      fields.ForeignKey('User', { ... }),
    category:  fields.string({ max: 100 }),
    location:  fields.string({ max: 255 }),
    is_active: fields.boolean({ default: true }),
    created_at: fields.timestamp(),
  };

  static indexes = [
    { fields: ['category'] },                                           // simple
    { fields: ['created_at', 'is_active'] },                           // composite
    { fields: ['created_at', 'is_active'], name: 'active_posts_idx' }, // named
    { fields: ['location'], unique: true },                             // unique index
  ];

  static uniqueTogether = [
    ['user_id', 'category'],   // composite unique constraint
  ];
}
```

### How it works

- `makemigrations` detects changes to `static indexes` and `static uniqueTogether`
- Generates `AddIndex`, `RemoveIndex`, or `AlterUniqueTogether` operations automatically
- `migrate` applies them via knex `t.index()` / `t.unique()`
- `migrate:rollback` drops them cleanly

### Generated migration example

```js
migrations.AddIndex({
  modelName: 'marketplace_posts',
  index: { fields: ['created_at', 'is_active'], name: 'active_posts_idx' },
}),

migrations.AlterUniqueTogether({
  modelName: 'marketplace_posts',
  newUnique: [['user_id', 'category']],
  oldUnique: [],
}),
```

> Single-field `unique: true` on a field definition still works as before.
> `static indexes` is for composite or named indexes.

---

## 5. Type Casting

Millas automatically casts values when reading from and writing to the database.

### On read

| Field type | Cast applied |
|---|---|
| `boolean` | `Boolean(val)` — SQLite stores 0/1 |
| `integer` / `bigInteger` | `parseInt` |
| `float` / `decimal` | `parseFloat` |
| `json` | `JSON.parse(val)` |
| `date` / `timestamp` | `new Date(val)` |
| `string` / `email` / `url` / `slug` / `ipAddress` | `String(val)` |

### On write

| Field type | Serialized as |
|---|---|
| `json` | `JSON.stringify(val)` |
| `boolean` | `1` / `0` (SQLite/MySQL compatible) |
| `date` / `timestamp` | `.toISOString()` if a `Date` object is passed |

### Instance integrity after update

After `post.update({ tags: ['a', 'b'] })`, the in-memory instance keeps the JS array — not the serialized string. Serialization only happens for the DB write.

---

## 6. Migrations

### Commands

```bash
millas makemigrations    # detect model changes, generate migration files
millas migrate           # apply pending migrations
millas migrate:rollback  # roll back last batch
millas migrate:fresh     # drop all tables and re-migrate
millas migrate:status    # show applied/pending migrations
millas migrate:reset     # roll back all migrations
millas migrate:refresh   # reset + migrate
```

### Non-nullable field without default

When adding a non-nullable field to an existing table, `makemigrations` prompts:

```
It is impossible to add a non-nullable field 'phone' to the
'users' table without specifying a default. This is because the
database needs something to populate existing rows.

Please select a fix:
 1) Provide a one-off default now (used only for existing rows)
 2) Quit and make 'phone' nullable in your model (recommended)
 3) Quit and add a permanent default to your model
```

One-off defaults support literals and callables:

```
Enter default for 'phone': ''                  # empty string literal
Enter default for 'uuid': crypto.randomUUID    # called once per row at migrate time
Enter default for 'joined_at': Date.now        # called once per row at migrate time
```

### Rename detection

When a field is removed and another of the same type is added on the same table, `makemigrations` asks:

```
Was users.phone_number renamed to users.mobile? (a CharField) [y/N]
```

- `y` → single `RenameField` op — no data loss
- `n` → `RemoveField` + `AddField` — data in the old column is lost

### Destructive type change warning

Changing a field type in a way that could lose data prints a warning during `makemigrations`:

```
⚠  Warning: changing 'posts.views' from string to integer may cause
   data loss. Existing data cannot be automatically converted.
```

Safe changes within the same family do **not** warn:
- `string` ↔ `text` ↔ `email` ↔ `url` ↔ `slug` ↔ `ipAddress`
- `integer` ↔ `bigInteger` ↔ `float` ↔ `decimal`

### Non-interactive mode (CI)

```bash
millas makemigrations --noinput
```

Throws with a clear error if any dangerous ops are detected instead of prompting.

### Migration file format

```js
// Generated by Millas 1.0.0 on 2026-03-26 10:00
const { migrations, fields } = require('millas/core/db');

module.exports = class Migration {
  static dependencies = [
    ['system', '0001_users'],
  ];

  static initial = true;

  static operations = [
    migrations.CreateModel({
      name: 'posts',
      fields: [
        ['id',         fields.id()],
        ['title',      fields.string({ max: 255 })],
        ['author_id',  fields.ForeignKey('users', { onDelete: 'CASCADE' })],
        ['created_at', fields.timestamp({ nullable: true })],
      ],
    }),
  ];
};
```

---

## 7. File Uploads

### Requirements

```bash
npm install multer   # required
npm install sharp    # optional — for image dimensions/metadata
```

### Route setup

Millas auto-injects multer when a route has `encoding: 'multipart'` or a `file()` validator in its shape. No manual multer setup needed.

```js
const { file } = require('millas/core/validation');

Route.post('/media/upload', MediaController, 'upload')
  .shape({
    encoding: 'multipart',
    in: {
      file: file().required().maxSize('50mb'),
    },
  });
```

Or use the `upload` middleware alias:

```js
Route.post('/upload',  ['auth', 'upload'],          MediaController, 'upload');   // any field
Route.post('/avatar',  ['auth', 'upload:avatar'],   UserController,  'avatar');   // named field
Route.post('/photos',  ['auth', 'upload:photos,5'], GalleryController, 'store');  // up to 5 files
```

### Controller — single file

```js
async upload({ file, user }) {
  if (!file) return badRequest('No file uploaded');

  // Type checks
  file.isImage()                              // true/false
  file.isVideo()                              // true/false
  file.isAudio()                              // true/false
  file.isPdf()                                // true/false
  file.hasMimeType('image/jpeg', 'image/png') // true/false

  // Metadata
  file.mimeType      // 'image/jpeg'
  file.size          // bytes
  file.humanSize()   // '1.2 MB'
  file.extension()   // 'jpg'
  file.originalName  // 'photo.jpg'
  file.fieldName     // 'file'

  // Store — returns stored relative path
  const path = await file.store('avatars');
  // → 'avatars/1714000000_a3f9bc.jpg'

  // Store with explicit filename
  const path = await file.storeAs('avatars', `${user.id}.jpg`);

  // Store to specific disk
  const path = await file.store('avatars', { disk: 'public' });

  // Public URL
  const url = Storage.url(path);   // '/storage/avatars/...'

  // Image dimensions (requires sharp)
  const { width, height } = await file.dimensions();

  // Raw buffer
  const buffer = await file.read();

  // Base64 data URI
  const dataUri = file.toDataUri();

  return success({ path, url });
}
```

### Controller — multiple files

```js
async upload({ files }) {
  // files is keyed by field name
  for (const photo of files.photos) {
    await photo.store('gallery');
  }
}
```

### Image processing with sharp

```js
async upload({ file, user }) {
  const buffer = await file.read();

  const variants = [
    { name: 'blur',     width: 32,   blur: 20, quality: 20 },
    { name: 'small',    width: 320,             quality: 80 },
    { name: 'original', width: null,            quality: 90 },
  ];

  const urls = {};
  await Promise.all(variants.map(async (v) => {
    let pipeline = sharp(buffer);
    if (v.width) pipeline = pipeline.resize(v.width, null, { withoutEnlargement: true });
    if (v.blur)  pipeline = pipeline.blur(v.blur);
    pipeline = pipeline.jpeg({ quality: v.quality });

    const buf  = await pipeline.toBuffer();
    const key  = `media/${mediaId}/${v.name}.jpg`;
    await Storage.put(key, buf);
    urls[v.name] = Storage.url(key);
  }));
}
```

---

## 8. Storage

### Zero config

`StorageServiceProvider` is auto-registered on every boot. No setup needed.

```js
const Storage = require('millas/facades/Storage');

await Storage.put('avatars/alice.jpg', buffer);
const buffer = await Storage.get('avatars/alice.jpg');
const exists = await Storage.exists('avatars/alice.jpg');
await Storage.delete('avatars/alice.jpg');
const url    = Storage.url('avatars/alice.jpg');  // '/storage/avatars/alice.jpg'
```

### Static file serving

Uploaded files are served automatically at their `baseUrl`. No `storage:link` or manual Express setup needed.

Default disks:
- `local`  → saves to `storage/uploads/`, served at `/storage/*`
- `public` → saves to `public/storage/`, served at `/storage/*`

### Multiple disks

```js
await Storage.disk('public').put('images/logo.png', buffer);
const url = Storage.disk('public').url('images/logo.png');
```

### Custom config (`config/storage.js`)

```js
module.exports = {
  default: 'local',
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
```

### Storing uploads

```js
// From UploadedFile instance (recommended — use inside controllers)
const path = await file.store('avatars');
const path = await file.storeAs('avatars', `${user.id}.jpg`);

// From raw multer file object
const path = await Storage.putFile('avatars', req.file);

// From base64 data URI
const path = await Storage.putDataUri('avatars', 'data:image/png;base64,...');
```

### Full API

```js
Storage.put(path, content)                    // write file
Storage.get(path)                             // read as Buffer
Storage.getString(path)                       // read as UTF-8 string
Storage.exists(path)                          // boolean
Storage.delete(path)                          // delete file
Storage.deleteDirectory(dir)                  // delete directory recursively
Storage.copy(from, to)                        // copy file
Storage.move(from, to)                        // move/rename file
Storage.files(dir)                            // list files in directory
Storage.allFiles(dir)                         // list files recursively
Storage.directories(dir)                      // list subdirectories
Storage.makeDirectory(dir)                    // create directory
Storage.metadata(path)                        // { path, size, mimeType, lastModified }
Storage.url(path)                             // public URL
Storage.path(path)                            // absolute filesystem path
Storage.stream(path, res)                     // stream to Express response
Storage.stream(path, res, { download: true }) // force download
```
