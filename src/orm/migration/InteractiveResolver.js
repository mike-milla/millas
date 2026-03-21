'use strict';

const readline = require('readline');
const { DefaultValueParser } = require('./DefaultValueParser');

/**
 * InteractiveResolver
 *
 * During makemigrations, when a new non-nullable field without a default
 * is being added to an existing table, this resolver prompts the developer.
 *
 * Options:
 *   1) Provide a one-off default value or expression
 *      — Supports literals (42, 'hello', true) and callables (Date.now,
 *        crypto.randomUUID, () => ...)
 *      — Stored in migration file as code, NOT evaluated at makemigrations time
 *      — Applied at migrate time: callable = per row, literal = single UPDATE
 *
 *   2) Make the field nullable temporarily
 *      — Safest option, can be tightened later with a follow-up migration
 *
 *   3) Abort
 *      — Developer must fix their model first, then re-run makemigrations
 *
 * In non-interactive mode (CI / --noinput):
 *   Throws with a clear message naming the field and showing all three fixes.
 */
class InteractiveResolver {
  constructor(options = {}) {
    this._nonInteractive = options.nonInteractive || !process.stdin.isTTY;
    this._parser         = new DefaultValueParser();
  }

  /**
   * Resolve a single dangerous AddField op interactively.
   *
   * @param {object} op — { type: 'AddField', table, column, field, _needsDefault: true }
   * @returns {object}  — resolved op
   * @throws  {Error}   — on abort
   */
  async resolve(op) {
    const { table, column, field } = op;

    if (this._nonInteractive) {
      throw new Error(
        `\nField "${table}.${column}" is non-nullable with no default.\n` +
        `\nIn non-interactive mode, resolve this before running makemigrations:\n` +
        `  Option A: Add a default to your model:\n` +
        `            ${column}: fields.${field.type || 'string'}({ default: 'some_value' })\n` +
        `  Option B: Make the field nullable:\n` +
        `            ${column}: fields.${field.type || 'string'}({ nullable: true })\n` +
        `  Option C: Run makemigrations interactively to provide a one-off default.\n`
      );
    }

    this._print('');
    this._print(`  It is impossible to add a non-nullable field '${column}' to the`);
    this._print(`  '${table}' table without specifying a default. This is because the`);
    this._print(`  database needs something to populate existing rows.`);
    this._print('');
    this._print(`  Please select a fix:`);
    this._print(`   1) Provide a one-off default now (used only for existing rows)`);
    this._print(`   2) Quit and make '${column}' nullable in your model (recommended)`);
    this._print(`   3) Quit and add a permanent default to your model`);
    this._print('');

    const choice = await this._prompt('  Select an option: ');
    const trimmed = choice.trim();

    if (trimmed === '2') {
      this._print('');
      this._print(`  Quitting. Add nullable=true to '${column}' in your model:`);
      this._print(`    ${column}: fields.${field.type || 'string'}({ nullable: true })`);
      this._print('');
      throw new Error(
        `Aborted. Make '${column}' nullable in your model, then re-run makemigrations.`
      );
    }

    if (trimmed === '3') {
      this._print('');
      this._print(`  Quitting. Add a default to '${column}' in your model:`);
      this._print(`    ${column}: fields.${field.type || 'string'}({ default: 'your_value' })`);
      this._print('');
      throw new Error(
        `Aborted. Add a default to '${column}' in your model, then re-run makemigrations.`
      );
    }

    if (trimmed === '1') {
      return this._promptForDefault(op);
    }

    // Unrecognised — re-ask
    this._print(`  Invalid choice "${trimmed}". Please enter 1, 2, or 3.`);
    return this.resolve(op);
  }

  /**
   * Resolve all dangerous ops in a list.
   */
  async resolveAll(ops) {
    const resolved = [];
    for (const op of ops) {
      if (op._needsDefault) {
        resolved.push(await this.resolve(op));
      } else {
        resolved.push(op);
      }
    }
    return resolved;
  }

  // ─── Default value prompt ─────────────────────────────────────────────────

  async _promptForDefault(op) {
    const { table, column, field } = op;

    this._print('');
    this._print(`  Please enter the default value for '${column}' (${field.type}).`);
    this._print(`  This will ONLY be used to populate existing rows — it will not`);
    this._print(`  be added to your model definition.`);
    this._print('');
    this._print(`  You can enter:`);
    this._print(`    A literal value:   42  |  'hello'  |  true  |  null`);
    this._print(`    A callable:        Date.now  |  crypto.randomUUID  |  () => new Date().toISOString()`);
    this._print(`    (Callables are called once per row at migrate time)`);
    this._print('');

    const raw = await this._prompt(`  Enter default for '${column}': `);
    const trimmed = raw.trim();

    if (!trimmed) {
      this._print(`  No value entered. Please try again.`);
      return this._promptForDefault(op);
    }

    let parsed;
    try {
      parsed = this._parser.parse(trimmed, field.type);
    } catch (err) {
      this._print('');
      this._print(`  ✗  ${err.message}`);
      this._print('');
      return this._promptForDefault(op);
    }

    // ── Confirm with the developer ────────────────────────────────────────
    this._print('');
    if (parsed.kind === 'callable') {
      this._print(`  ✔  Callable: ${parsed.expression}`);
      this._print(`     Each existing row will get its own value when migrate runs.`);
    } else {
      this._print(`  ✔  Literal: ${parsed.expression}`);
      this._print(`     All existing rows will be set to this value.`);
    }
    this._print('');

    const confirm = await this._prompt(`  Use this? [Y/n]: `);
    if (confirm.trim().toLowerCase() === 'n') {
      return this._promptForDefault(op);
    }

    return {
      ...op,
      oneOffDefault: parsed,   // { kind, value?, expression }
      _needsDefault: false,
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  _print(msg) {
    process.stdout.write(msg + '\n');
  }

  _prompt(question) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
      });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}

module.exports = InteractiveResolver;
