'use strict';

// ─── Core column builder ──────────────────────────────────────────────────────

function applyColumn(t, name, def, tableName) {
  const col = _buildColumn(t, name, def);
  if (!col) return;

  _applyModifiers(col, def);

  // Postgres enum: stored as text + separate CHECK constraint
  if (def.type === 'enum' && def.enumValues?.length) {
    const client = t.client?.config?.client || '';
    if (client.includes('pg') || client.includes('postgres')) {
      const values         = def.enumValues.map(v => `'${v}'`).join(', ');
      const constraintName = `${tableName || 'tbl'}_${name}_check`;
      t.check(`"${name}" in (${values})`, [], constraintName);
    }
  }
}

function alterColumn(t, name, def, tableName) {
  const client = t.client?.config?.client || '';
  const isPg   = client.includes('pg') || client.includes('postgres');

  if (isPg && def.type === 'enum' && def.enumValues?.length) {
    // Postgres: ALTER COLUMN TYPE with inline CHECK is invalid.
    // Drop old CHECK constraint, add new one.
    const constraintName = `${tableName || 'tbl'}_${name}_check`;
    const values         = def.enumValues.map(v => `'${v}'`).join(', ');
    try { t.dropChecks(constraintName); } catch {}
    t.check(`"${name}" in (${values})`, [], constraintName);
    if (def.nullable) t.setNullable(name);
    else              t.dropNullable(name);
    return;
  }

  const col = _buildColumn(t, name, def, { forAlter: true });
  if (!col) return;

  _applyModifiers(col, def, { skipFK: true });
  col.alter();
}

async function attachFKConstraints(db, table, fields) {
  const fkEntries = Object.entries(fields).filter(([, def]) => def.references);
  if (fkEntries.length === 0) return;

  await db.schema.alterTable(table, (t) => {
    for (const [name, def] of fkEntries) {
      const ref = def.references;
      t.foreign(name)
       .references(ref.column)
       .inTable(ref.table)
       .onDelete(ref.onDelete || 'CASCADE');
    }
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _buildColumn(t, name, def, opts = {}) {
  switch (def.type) {
    case 'id':
      if (!opts.forAlter) t.increments(name).primary();
      return null;

    case 'string':
    case 'email':
    case 'url':
    case 'slug':
    case 'ipAddress':
      return t.string(name, def.max || 255);

    case 'text':
      return t.text(name);

    case 'integer':
      return def.unsigned ? t.integer(name).unsigned() : t.integer(name);

    case 'bigInteger':
      return def.unsigned ? t.bigInteger(name).unsigned() : t.bigInteger(name);

    case 'float':
      return t.float(name);

    case 'decimal':
      return t.decimal(name, def.precision || 8, def.scale || 2);

    case 'boolean':
      return t.boolean(name);

    case 'json':
      return t.json(name);

    case 'array': {
      const client = t.client?.config?.client || '';
      if (client.includes('pg') || client.includes('postgres')) {
        // Native Postgres ARRAY type
        const pgTypeMap = {
          text: 'text', string: 'text',
          integer: 'integer', int: 'integer',
          float: 'float', decimal: 'decimal',
          boolean: 'boolean',
          uuid: 'uuid',
        };
        const pgType = pgTypeMap[def.arrayOf || 'text'] || 'text';
        return t.specificType(name, `${pgType}[]`);
      }
      // SQLite / MySQL — fall back to JSON
      return t.json(name);
    }

    case 'date':
      return t.date(name);

    case 'timestamp':
      return t.timestamp(name, { useTz: false });

    case 'enum': {
      const client = t.client?.config?.client || '';
      if (client.includes('pg') || client.includes('postgres')) {
        // Store as text — CHECK constraint added separately in applyColumn
        return t.text(name);
      }
      return t.enu(name, def.enumValues || []);
    }

    case 'uuid':
      return t.uuid(name);

    default:
      return t.string(name);
  }
}

function _applyModifiers(col, def, opts = {}) {
  if (def.nullable) {
    col.nullable();
  } else if (def.type !== 'id') {
    col.notNullable();
  }

  if (def.unique) col.unique();

  if (def.default !== null && def.default !== undefined) {
    col.defaultTo(def.default);
  }

  if (!opts.skipFK && def.references) {
    const ref = def.references;
    col
      .references(ref.column)
      .inTable(ref.table)
      .onDelete(ref.onDelete || 'CASCADE');
  }
}

module.exports = { applyColumn, alterColumn, attachFKConstraints };
