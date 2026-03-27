# Millas ORM, Migrations & File Uploads

> Internal documentation covering all features implemented/fixed in this session.
> Use this as the source of truth when updating the public docs.

---

## Table of Contents

1. [Models](#1-models)
2. [Field Types](#2-field-types)
3. [Querying](#3-querying)
4. [F Expressions](#4-f-expressions)
5. [Relations](#5-relations)
6. [Indexes & Unique Constraints](#6-indexes--unique-constraints)
7. [Type Casting](#7-type-casting)
8. [Bulk Operations](#8-bulk-operations)
9. [Migrations](#9-migrations)
10. [Database Drivers](#10-database-drivers)
11. [File Uploads](#11-file-uploads)
12. [Storage](#12-storage)

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

### Auto timestamps

`created_at` and `updated_at` are only injected if they are declared in `static fields`. If your model doesn't have them, they are never added — no "no such column" errors.

```js
// No timestamps — nothing injected
class AdminSetting extends Model {
  static fields = { key: fields.string(), value: fields.text() };
}

// Has timestamps — injected on create/update
class Post extends Model {
  static fields = {
    title:      fields.string(),
    created_at: fields.timestamp(),
    updated_at: fields.timestamp(),
  };
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
}

await post.delete();           // sets deleted_at, row stays in DB
await post.restore();          // clears deleted_at
Post.withTrashed().get();      // includes deleted rows
Post.onlyTrashed().get();      // only deleted rows
await post.forceDelete();      // permanently removes the row
```

### Hidden fields

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
    // created_at and updated_at inherited automatically
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

```js
fields.string({
  max:      100,
  nullable: true,
  unique:   true,
  default:  'active',
  unsigned: true,
})
```

---

## 3. Querying

### Basic CRUD

```js
// Create
const post = await Post.create({ title: 'Hello' });

// Find by PK
const post = await Post.find(1);           // null if not found
const post = await Post.findOrFail(1);     // throws 404 if not found

// Find by field
const user = await User.findBy('email', 'alice@example.com');

// Get exactly one — throws if 0 or >1 results (Django's .get())
const user = await User.get({ email: 'alice@example.com' });

// All
const posts = await Post.all();

// Update instance
await post.update({ title: 'New Title' });
await post.save();   // saves only dirty fields

// Delete
await post.delete();
```

### Filtering

```js
Post.where('published', true).get()
Post.where('views__gte', 100).get()
Post.where('title__icontains', 'hello').get()
Post.filter('status', 'active').get()       // alias for where()
Post.exclude('status', 'banned').get()      // whereNot()
```

### Django-style lookups

| Lookup | SQL |
|---|---|
| `field__exact` | `= value` |
| `field__not` | `!= value` |
| `field__gt` / `__gte` / `__lt` / `__lte` | `>` / `>=` / `<` / `<=` |
| `field__in` | `IN (...)` |
| `field__notin` | `NOT IN (...)` |
| `field__between` | `BETWEEN [a, b]` |
| `field__isnull` | `IS NULL` / `IS NOT NULL` |
| `field__contains` | `LIKE %val%` |
| `field__icontains` | Case-insensitive contains (dialect-aware) |
| `field__startswith` / `__endswith` | `LIKE val%` / `LIKE %val` |
| `field__istartswith` / `__iendswith` | Case-insensitive (dialect-aware) |
| `field__regex` | Regex match (PG: `~`, MySQL: `REGEXP`) |
| `field__iregex` | Case-insensitive regex |
| `field__year` / `__month` / `__day` | Date part extraction |
| `field__hour` / `__minute` / `__second` | Time part extraction |
| `field__date` / `__time` | Date/time cast |
| `field__week` / `__week_day` / `__quarter` | Week/quarter extraction |

> All case-insensitive lookups are dialect-aware: `ILIKE` on PostgreSQL, `LOWER() LIKE` on SQLite/MySQL.

### Chaining

```js
Post
  .where('published', true)
  .where('views__gte', 100)
  .orderBy('created_at', 'desc')
  .limit(10)
  .offset(20)
  .get()
```

### get() — raises on 0 or multiple results

```js
// Matches Django's Model.objects.get()
const user = await User.get({ email: 'alice@example.com' });
// throws 404 if not found
// throws Error if more than one found
```

### first() / last() / none()

```js
await Post.orderBy('created_at').first()   // first row or null
await Post.orderBy('created_at').last()    // last row or null
await Post.none().get()                    // always []
```

### Aggregates

```js
await Post.count()
await Post.where('published', true).count()

const { total, avg } = await Order.aggregate({
  total: Sum('amount'),
  avg:   Avg('amount'),
});
```

### Pagination

```js
const { data, total, page, perPage, lastPage } = await Post
  .where('published', true)
  .orderBy('created_at', 'desc')
  .paginate(1, 20);
```

### values() / valuesList() / pluck()

```js
await Post.values('id', 'title').get()       // [{ id, title }, ...]
await Post.valuesList('title').get()         // ['Title 1', 'Title 2', ...]
await Post.where('published', true).pluck('id')  // [1, 2, 3]
```

### inBulk() — dict of pk → instance

```js
// Matches Django's QuerySet.in_bulk()
const map = await Post.inBulk([1, 2, 3]);
map[1].title;

// All rows as dict
const all = await Post.inBulk();

// By a different field
const byEmail = await User.inBulk(['a@b.com', 'c@d.com'], 'email');
```

### selectForUpdate() — row locking

```js
// Matches Django's QuerySet.select_for_update()
// PostgreSQL and MySQL only — silently skipped on SQLite

await Post.transaction(async (trx) => {
  const post = await Post.where('id', 1).selectForUpdate().first();
  await post.update({ stock: F('stock').subtract(1) });
});

// Options
Post.where('id', 1).selectForUpdate({ noWait: true })
Post.where('id', 1).selectForUpdate({ skipLocked: true })
```

### explain() — query plan

```js
const plan = await Post.where('published', true).explain();
```

### using() — specific DB connection

```js
await Post.using('replica').where('published', true).get();
```

### Raw queries

```js
Post.whereRaw('YEAR(created_at) = ?', [2024]).get()
Post.selectRaw('COUNT(*) as total').get()
Post.raw('SELECT * FROM posts WHERE views > ?', [100])
```

### Q objects — complex boolean logic

```js
const { Q } = require('millas/core/db');

// OR
User.filter(Q({ role: 'admin' }).or({ role: 'moderator' })).get()

// AND + OR nested
Post.filter(
  Q({ published: true }).and(
    Q({ views__gte: 100 }).or({ featured: true })
  )
).get()

// NOT
User.filter(Q({ status: 'banned' }).not()).get()
```

### increment() / decrement()

```js
await post.increment('views_count');       // +1
await post.increment('views_count', 5);    // +5
await post.decrement('stock', 1);          // -1
```

---

## 4. F Expressions

`F()` lets you reference column values in queries without fetching them first — enabling atomic operations and column comparisons.

```js
const { F } = require('millas/core/db');
```

### Atomic updates — no race conditions

```js
// Atomic increment
await Post.where('id', 1).update({ views: F('views').add(1) });

// Arithmetic
await Product.where('id', 1).update({
  price: F('price').multiply(1.1),   // 10% increase
  stock: F('stock').subtract(qty),   // reduce stock
});
```

### Column arithmetic

```js
F('price').add(10)
F('price').subtract(5)
F('price').multiply(1.2)
F('price').divide(2)
```

### Ordering by expression

```js
await Post.orderByRaw('views + likes DESC').get()
```

---

## 5. Relations

### ForeignKey (BelongsTo) — forward

```js
class Post extends Model {
  static fields = {
    author: fields.ForeignKey('User', {
      onDelete:    'CASCADE',
      nullable:    false,
      relatedName: 'posts',   // enables user.posts eager load
    }),
  };
}
```

### Reverse relations — automatic (like Django)

When `relatedName` is set on a `ForeignKey`, the reverse relation is **automatically wired** on the target model. No `static relations` block needed.

```js
// UnitCategory declares:
//   property: fields.ForeignKey('Property', { relatedName: 'unit_categories' })

// This works automatically on Property — no extra code needed:
const property = await Property.with('unit_categories').find(1);
property.unit_categories;  // array of UnitCategory instances
```

Use `'+'` as `relatedName` to suppress the reverse relation (same as Django).

### OneToOne

```js
class Profile extends Model {
  static fields = {
    user: fields.OneToOne('User', { relatedName: 'profile' }),
  };
}
// user.profile works automatically
```

### ManyToMany

```js
class Post extends Model {
  static fields = {
    tags: fields.ManyToMany('Tag', { through: 'post_tags', relatedName: 'posts' }),
  };
}

await post.tags.attach(tagId);
await post.tags.detach(tagId);
await post.tags.sync([1, 2, 3]);
```

### Eager loading

```js
Post.with('author').get()
Post.with('author', 'tags').get()
Post.with({ author: q => q.where('active', true) }).get()  // constrained
Post.with('author').find(1)          // chained with find()
Post.with('author').findOrFail(1)    // chained with findOrFail()
Post.withCount('comments').get()     // adds .comments_count
Post.withSum('orders', 'amount').get() // adds .orders_sum_amount
```

### Lazy loading

```js
const post   = await Post.find(1);
const author = await post.author();         // BelongsTo
const tags   = await post.tags();           // ManyToMany
const units  = await property.unit_categories(); // HasMany (auto-wired)
```

---

## 6. Indexes & Unique Constraints

```js
class MarketplacePost extends Model {
  static indexes = [
    { fields: ['category'] },
    { fields: ['created_at', 'is_active'], name: 'active_posts_idx' },
    { fields: ['location'], unique: true },
    { fields: ['-created_at'] },   // descending index
  ];

  static uniqueTogether = [
    ['user_id', 'category'],
  ];
}
```

- `makemigrations` detects changes and generates `AddIndex` / `RemoveIndex` / `RenameIndex` / `AlterUniqueTogether`
- Renaming an index (same fields, different name) generates `RenameIndex` — no data loss
- `migrate` applies them, `migrate:rollback` drops them

---

## 7. Type Casting

### On read

| Type | Cast |
|---|---|
| `boolean` | `Boolean(val)` |
| `integer` / `bigInteger` | `parseInt` |
| `float` / `decimal` | `parseFloat` |
| `json` | `JSON.parse(val)` |
| `date` / `timestamp` | `new Date(val)` |
| `string` / `email` / `url` / `slug` / `ipAddress` | `String(val)` |

### On write

| Type | Serialized as |
|---|---|
| `json` | `JSON.stringify(val)` |
| `boolean` | `1` / `0` |
| `date` / `timestamp` | `.toISOString()` if `Date` object |

---

## 8. Bulk Operations

### bulkCreate()

```js
// Basic
await UnitCategory.bulkCreate([
  { property_id: 1, unit_type: '2 Bedroom', rent_amount: 15000 },
  { property_id: 1, unit_type: 'Bedsitter', rent_amount: 8000 },
]);

// Ignore duplicates (INSERT OR IGNORE)
await Post.bulkCreate(rows, { ignoreConflicts: true });

// Upsert — update on conflict
await User.bulkCreate(rows, {
  updateConflicts: true,
  uniqueFields:    ['email'],
  updateFields:    ['name', 'updated_at'],
});
```

### bulkUpdate()

```js
await Post.bulkUpdate([
  { id: 1, title: 'One', published: true },
  { id: 2, title: 'Two', published: false },
], 'id');
```

### bulkDelete()

```js
await Post.bulkDelete([1, 2, 3]);
```

### insert() — raw, no hooks

```js
// Low-level, no beforeCreate hooks, no return of instances
await Post.insert([
  { title: 'One', created_at: new Date() },
  { title: 'Two', created_at: new Date() },
]);
```

---

## 9. Migrations

### Commands

```bash
millas makemigrations          # detect changes, generate files
millas makemigrations --noinput  # CI mode — throws on dangerous ops
millas migrate                 # apply pending
millas migrate --fake app:0001_initial  # mark as applied without running
millas migrate:rollback        # roll back last batch
millas migrate:rollback --steps 3
millas migrate:fresh           # drop all + re-migrate
millas migrate:status          # show applied/pending
millas migrate:reset           # roll back all
millas migrate:refresh         # reset + migrate
millas migrate:plan            # preview what would run
```

### Non-nullable field without default

```
It is impossible to add a non-nullable field 'phone' to the 'users' table.

 1) Provide a one-off default now (used only for existing rows)
 2) Quit and make 'phone' nullable in your model (recommended)
 3) Quit and add a permanent default to your model
```

One-off defaults:
```
Enter default for 'uuid': crypto.randomUUID    # per-row callable
Enter default for 'joined_at': Date.now        # per-row callable
Enter default for 'status': 'active'           # literal
```

### Rename detection

```
Was users.phone_number renamed to users.mobile? (a CharField) [y/N]
```

### Destructive type change warning

```
⚠  Warning: changing 'posts.views' from string to integer may cause data loss.
```

Safe families (no warning):
- `string` ↔ `text` ↔ `email` ↔ `url` ↔ `slug` ↔ `ipAddress`
- `integer` ↔ `bigInteger` ↔ `float` ↔ `decimal`

---

## 10. Database Drivers

### Switching databases

Change `.env` and restart:

```bash
DB_CONNECTION=postgres   # or sqlite, mysql
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=mydb
DB_USERNAME=user
DB_PASSWORD=pass
```

Install the driver:

```bash
npm install pg       # PostgreSQL
npm install mysql2   # MySQL
# SQLite is built-in via better-sqlite3
```

### Driver differences handled automatically

| Feature | SQLite | MySQL | PostgreSQL |
|---|---|---|---|
| `icontains` | `LOWER() LIKE` | `LOWER() LIKE` | `ILIKE` |
| `insert()` return | `[lastId]` | `[{ insertId }]` | `.returning(pk)` |
| `bulkCreate()` return | re-fetch by ID range | re-fetch by ID range | `RETURNING *` |
| `selectForUpdate()` | silently skipped | supported | supported |
| `regex` lookup | warn + fallback | `REGEXP` | `~` |

---

## 11. File Uploads

### Requirements

```bash
npm install multer   # required
npm install sharp    # optional — image dimensions/metadata
```

### Route setup

```js
const { file } = require('millas/core/validation');

Route.post('/upload', MediaController, 'upload')
  .shape({
    encoding: 'multipart',
    in: { file: file().required().maxSize('50mb') },
  });

// Or middleware alias
Route.post('/upload',  ['auth', 'upload'],          MediaController, 'upload');
Route.post('/avatar',  ['auth', 'upload:avatar'],   UserController,  'avatar');
Route.post('/photos',  ['auth', 'upload:photos,5'], GalleryController, 'store');
```

### Controller

```js
async upload({ file, user }) {
  if (!file) return badRequest('No file uploaded');

  file.isImage()                              // true/false
  file.isVideo()                              // true/false
  file.hasMimeType('image/jpeg', 'image/png') // true/false
  file.mimeType      // 'image/jpeg'
  file.size          // bytes
  file.humanSize()   // '1.2 MB'
  file.extension()   // 'jpg'
  file.originalName  // 'photo.jpg'

  const path = await file.store('avatars');
  const path = await file.storeAs('avatars', `${user.id}.jpg`);
  const path = await file.store('avatars', { disk: 'public' });
  const url  = Storage.url(path);

  const { width, height } = await file.dimensions();  // requires sharp
  const buffer  = await file.read();
  const dataUri = file.toDataUri();
}
```

---

## 12. Storage

### Zero config — auto-registered on every boot

```js
const Storage = require('millas/facades/Storage');

await Storage.put('avatars/alice.jpg', buffer);
const buffer = await Storage.get('avatars/alice.jpg');
const exists = await Storage.exists('avatars/alice.jpg');
await Storage.delete('avatars/alice.jpg');
const url = Storage.url('avatars/alice.jpg');  // '/storage/avatars/alice.jpg'
```

### Static file serving — automatic

Files are served at their `baseUrl` with no setup needed:
- `local`  → `storage/uploads/` → `/storage/*`
- `public` → `public/storage/`  → `/storage/*`

### Multiple disks

```js
await Storage.disk('public').put('images/logo.png', buffer);
```

### Full API

```js
Storage.put(path, content)
Storage.get(path)                    // Buffer
Storage.getString(path)              // UTF-8 string
Storage.exists(path)                 // boolean
Storage.delete(path)
Storage.deleteDirectory(dir)
Storage.copy(from, to)
Storage.move(from, to)
Storage.files(dir)                   // list files
Storage.allFiles(dir)                // recursive
Storage.directories(dir)
Storage.makeDirectory(dir)
Storage.metadata(path)               // { path, size, mimeType, lastModified }
Storage.url(path)                    // public URL
Storage.path(path)                   // absolute filesystem path
Storage.stream(path, res)
Storage.stream(path, res, { download: true })
```
