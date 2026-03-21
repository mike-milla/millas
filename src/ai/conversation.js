'use strict';

const { AIMessage } = require('./types');

// ─────────────────────────────────────────────────────────────────────────────
// ConversationThread — DB-persisted conversation history
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DB-persisted conversation thread.
 * Requires knex to be available via DatabaseManager.
 *
 * Tables created by the AI migration:
 *   ai_conversations        — id, user_id, agent, title, meta, created_at, updated_at
 *   ai_conversation_messages — id, conversation_id, role, content, meta, created_at
 */
class ConversationThread {
  constructor({ id = null, userId = null, agent = null, systemPrompt = null, db = null } = {}) {
    this._id           = id;
    this._userId       = userId;
    this._agent        = agent;
    this._systemPrompt = systemPrompt;
    this._messages     = [];
    this._loaded       = false;
    this._db           = db;
    this._maxMessages  = null;
    this._summaryFn    = null;
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  system(prompt)          { this._systemPrompt = prompt; return this; }
  limit(n)                { this._maxMessages = n;       return this; }
  summariseWith(fn)       { this._summaryFn = fn;        return this; }
  get id()                { return this._id; }
  get userId()            { return this._userId; }

  // ── Persistence ────────────────────────────────────────────────────────────

  /** Create a new conversation in the DB and return this thread. */
  async create(title = null) {
    const db = this._requireDb();
    const [id] = await db('ai_conversations').insert({
      user_id:    this._userId,
      agent:      this._agent,
      title:      title || (this._agent ? `${this._agent} conversation` : 'New conversation'),
      meta:       JSON.stringify({}),
      created_at: new Date(),
      updated_at: new Date(),
    });
    this._id = id;
    return this;
  }

  /** Load messages from the DB. */
  async load() {
    if (!this._id) throw new Error('Cannot load: conversation not yet created. Call create() first.');
    const db   = this._requireDb();
    const rows = await db('ai_conversation_messages').where('conversation_id', this._id).orderBy('created_at', 'asc');
    this._messages = rows.map(r => new AIMessage(r.role, this._parseContent(r.content), r.meta ? JSON.parse(r.meta) : {}));
    this._loaded   = true;
    return this;
  }

  /** Add a message and persist it to the DB. */
  async addAndSave(role, content) {
    const msg = new AIMessage(role, content);
    this._messages.push(msg);
    if (this._id) {
      const db = this._requireDb();
      await db('ai_conversation_messages').insert({
        conversation_id: this._id,
        role,
        content:         typeof content === 'string' ? content : JSON.stringify(content),
        meta:            JSON.stringify({}),
        created_at:      new Date(),
      });
      await db('ai_conversations').where('id', this._id).update({ updated_at: new Date() });
    }
    return this;
  }

  /** Add user message and persist. */
  addUser(content)      { return this.addAndSave('user',      content); }
  /** Add assistant message and persist. */
  addAssistant(content) { return this.addAndSave('assistant', content); }

  /** In-memory only — no persistence. */
  addLocal(role, content) { this._messages.push(new AIMessage(role, content)); return this; }

  /** Delete this conversation and all its messages from the DB. */
  async delete() {
    if (!this._id) return;
    const db = this._requireDb();
    await db('ai_conversation_messages').where('conversation_id', this._id).delete();
    await db('ai_conversations').where('id', this._id).delete();
    this._id = null;
  }

  // ── Memory management ──────────────────────────────────────────────────────

  async toArray() {
    let msgs = [...this._messages];
    if (this._maxMessages && msgs.length > this._maxMessages) {
      const overflow = msgs.slice(0, msgs.length - this._maxMessages);
      msgs            = msgs.slice(msgs.length - this._maxMessages);
      if (this._summaryFn) {
        const summary = await this._summaryFn(overflow);
        msgs.unshift(new AIMessage('system', `Earlier conversation summary:\n${summary}`));
      }
    }
    return msgs.map(m => m.toJSON());
  }

  get length()    { return this._messages.length; }
  get lastReply() {
    const last = [...this._messages].reverse().find(m => m.role === 'assistant');
    return last ? (typeof last.content === 'string' ? last.content : last.content?.[0]?.text || '') : null;
  }

  clear() { this._messages = []; return this; }

  // ── Static factory methods ─────────────────────────────────────────────────

  /**
   * Start a new conversation for a user.
   *   const thread = await ConversationThread.forUser(user.id, 'SalesCoach').create();
   */
  static forUser(userId, agent = null, db = null) {
    return new ConversationThread({ userId, agent, db: db || ConversationThread._db });
  }

  /**
   * Continue an existing conversation by ID.
   *   const thread = await ConversationThread.continue(conversationId, db).load();
   */
  static async continue(id, db = null) {
    const thread = new ConversationThread({ id, db: db || ConversationThread._db });
    await thread.load();
    return thread;
  }

  /**
   * List conversations for a user.
   *   const convos = await ConversationThread.forUser(userId).list();
   */
  static async list(userId, agent = null, limit = 50) {
    const db = ConversationThread._db;
    if (!db) throw new Error('Database not available.');
    let q = db('ai_conversations').where('user_id', userId).orderBy('updated_at', 'desc').limit(limit);
    if (agent) q = q.where('agent', agent);
    return q;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _requireDb() {
    const db = this._db || ConversationThread._db;
    if (!db) throw new Error('Database not available. The AI ConversationThread requires a knex instance. Make sure DatabaseServiceProvider is registered.');
    return db;
  }

  _parseContent(raw) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration — creates the AI conversation tables
// ─────────────────────────────────────────────────────────────────────────────

const AI_MIGRATIONS = {
  dependencies: [],
  operations: [],

  /**
   * Run this to create the AI conversation tables.
   * Called automatically by `millas migrate` if registered.
   */
  async up(knex) {
    const hasConversations = await knex.schema.hasTable('ai_conversations');
    if (!hasConversations) {
      await knex.schema.createTable('ai_conversations', table => {
        table.increments('id').primary();
        table.string('user_id').nullable().index();
        table.string('agent').nullable().index();
        table.string('title').nullable();
        table.text('meta').nullable();
        table.timestamps(true, true);
      });
    }

    const hasMessages = await knex.schema.hasTable('ai_conversation_messages');
    if (!hasMessages) {
      await knex.schema.createTable('ai_conversation_messages', table => {
        table.increments('id').primary();
        table.integer('conversation_id').unsigned().notNullable().references('id').inTable('ai_conversations').onDelete('CASCADE');
        table.string('role').notNullable();
        table.text('content').notNullable();
        table.text('meta').nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.index('conversation_id');
      });
    }
  },

  async down(knex) {
    await knex.schema.dropTableIfExists('ai_conversation_messages');
    await knex.schema.dropTableIfExists('ai_conversations');
  },
};

module.exports = { ConversationThread, AI_MIGRATIONS };