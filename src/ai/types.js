'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// AIMessage — a single message in a conversation
// ─────────────────────────────────────────────────────────────────────────────

class AIMessage {
  /**
   * @param {'user'|'assistant'|'system'|'tool'} role
   * @param {string|Array}  content  — string or array of content parts
   * @param {object}        [meta]   — tool_call_id, name, usage, etc.
   */
  constructor(role, content, meta = {}) {
    this.role    = role;
    this.content = content;
    this.meta    = meta;
  }

  static user(content)       { return new AIMessage('user',      content); }
  static assistant(content)  { return new AIMessage('assistant', content); }
  static system(content)     { return new AIMessage('system',    content); }
  static tool(id, name, content) {
    return new AIMessage('tool', content, { tool_call_id: id, name });
  }

  toJSON() {
    const base = { role: this.role, content: this.content };
    if (this.meta.tool_call_id) {
      base.tool_call_id = this.meta.tool_call_id;
      base.name         = this.meta.name;
    }
    return base;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AIResponse — structured result from any provider
// ─────────────────────────────────────────────────────────────────────────────

class AIResponse {
  constructor({
    text, role = 'assistant', model, provider,
    inputTokens = 0, outputTokens = 0,
    toolCalls = [], finishReason = 'stop',
    raw = null,
  }) {
    this.text         = text || '';
    this.role         = role;
    this.model        = model;
    this.provider     = provider;
    this.inputTokens  = inputTokens;
    this.outputTokens = outputTokens;
    this.totalTokens  = inputTokens + outputTokens;
    this.toolCalls    = toolCalls;   // [{ id, name, arguments }]
    this.finishReason = finishReason;
    this.raw          = raw;         // original provider response
  }

  /** True when the model wants to call tools. */
  get hasToolCalls()    { return this.toolCalls.length > 0; }

  /** True when the model stopped naturally. */
  get isComplete()      { return this.finishReason === 'stop'; }

  /** True when the model hit a token limit. */
  get isTokenLimited()  { return this.finishReason === 'length'; }

  /** Cast to the assistant AIMessage to append to a thread. */
  toMessage() {
    const content = this.hasToolCalls
      ? [{ type: 'text', text: this.text }, ...this.toolCalls.map(tc => ({
          type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments,
        }))]
      : this.text;
    return new AIMessage('assistant', content);
  }

  toString() { return this.text; }
}

// ─────────────────────────────────────────────────────────────────────────────
// AIStreamEvent — typed events emitted during streaming
// ─────────────────────────────────────────────────────────────────────────────

class AIStreamEvent {
  constructor(type, data) { this.type = type; this.data = data; }

  static delta(text)        { return new AIStreamEvent('delta',    { text }); }
  static thinking(text)     { return new AIStreamEvent('thinking', { text }); }
  static toolCall(tc)       { return new AIStreamEvent('tool_call', tc); }
  static complete(response) { return new AIStreamEvent('complete',  response); }
  static error(err)         { return new AIStreamEvent('error',    { error: err }); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool — define a callable tool the model can invoke
// ─────────────────────────────────────────────────────────────────────────────

class Tool {
  /**
   * @param {string}   name
   * @param {string}   description
   * @param {object}   schema      — JSON Schema object for parameters
   * @param {function} handler     — async (args) => result
   */
  constructor(name, description, schema, handler) {
    this.name        = name;
    this.description = description;
    this.schema      = schema;
    this.handler     = handler;
  }

  /**
   * Fluent factory:
   *
   *   Tool.define('get_weather')
   *     .description('Get the weather for a city')
   *     .parameters({
   *       type: 'object',
   *       properties: {
   *         city:  { type: 'string', description: 'City name' },
   *         units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
   *       },
   *       required: ['city'],
   *     })
   *     .handle(async ({ city, units }) => {
   *       return await WeatherService.get(city, units);
   *     })
   */
  static define(name) { return new ToolBuilder(name); }

  toProviderSchema() {
    return { name: this.name, description: this.description, input_schema: this.schema };
  }

  toOpenAISchema() {
    return {
      type: 'function',
      function: { name: this.name, description: this.description, parameters: this.schema },
    };
  }
}

class ToolBuilder {
  constructor(name) {
    this._name = name;
    this._description = '';
    this._schema = { type: 'object', properties: {}, required: [] };
    this._handler = null;
  }
  description(d)  { this._description = d; return this; }
  parameters(s)   { this._schema = s;      return this; }
  handle(fn)      { this._handler = fn;    return this; }
  build() {
    return new Tool(this._name, this._description, this._schema, this._handler);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Thread — conversation memory manager
// ─────────────────────────────────────────────────────────────────────────────

class Thread {
  constructor(systemPrompt = null) {
    this._messages    = [];
    this._systemPrompt = systemPrompt;
    this._maxMessages  = null;    // null = unlimited
    this._summaryFn    = null;    // async (messages) => summaryString
  }

  /** Set a new or updated system prompt. */
  system(prompt) { this._systemPrompt = prompt; return this; }

  /** Limit history to the last N messages (sliding window). */
  limit(n) { this._maxMessages = n; return this; }

  /**
   * Provide a summarisation function. When the thread exceeds limit(),
   * older messages are collapsed into a summary instead of dropped.
   *
   *   thread.summariseWith(async (msgs) => {
   *     const res = await AI.text(`Summarise this: ${msgs.map(m=>m.content).join('\n')}`);
   *     return res.text;
   *   });
   */
  summariseWith(fn) { this._summaryFn = fn; return this; }

  add(message) {
    this._messages.push(message);
    return this;
  }

  addUser(content)      { return this.add(AIMessage.user(content)); }
  addAssistant(content) { return this.add(AIMessage.assistant(content)); }

  /** Messages formatted for the provider, respecting limit. */
  async toArray() {
    let msgs = [...this._messages];

    if (this._maxMessages && msgs.length > this._maxMessages) {
      const overflow = msgs.slice(0, msgs.length - this._maxMessages);
      msgs            = msgs.slice(msgs.length - this._maxMessages);

      if (this._summaryFn) {
        const summary = await this._summaryFn(overflow);
        msgs.unshift(AIMessage.system(`Earlier conversation summary: ${summary}`));
      }
    }

    return msgs.map(m => m.toJSON());
  }

  get length() { return this._messages.length; }

  clear() { this._messages = []; return this; }

  /** Last assistant message text. */
  get lastReply() {
    const last = [...this._messages].reverse().find(m => m.role === 'assistant');
    return last ? (typeof last.content === 'string' ? last.content : last.content?.[0]?.text || '') : null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt — template with variable substitution
// ─────────────────────────────────────────────────────────────────────────────

class Prompt {
  /**
   * @param {string} template  — use {{variable}} syntax
   *
   *   Prompt.make('Summarise this in {{language}}: {{text}}')
   *     .with({ language: 'French', text: article })
   *     .toString()
   */
  constructor(template) {
    this._template = template;
    this._vars     = {};
  }

  static make(template) { return new Prompt(template); }

  with(vars) { Object.assign(this._vars, vars); return this; }

  toString() {
    return this._template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
      Object.prototype.hasOwnProperty.call(this._vars, k) ? String(this._vars[k]) : `{{${k}}}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema — structured output enforcement
// ─────────────────────────────────────────────────────────────────────────────

class Schema {
  /**
   * Define expected output structure. The AI manager will:
   *   1. Inject the schema into the prompt
   *   2. Parse and validate the response JSON
   *   3. Retry once if parsing fails
   *
   *   Schema.define({
   *     name:       { type: 'string' },
   *     confidence: { type: 'number', min: 0, max: 1 },
   *     tags:       { type: 'array'  },
   *   })
   */
  constructor(shape) {
    this._shape = shape;
  }

  static define(shape) { return new Schema(shape); }

  /** JSON Schema representation passed to the provider. */
  toJSONSchema() {
    const props    = {};
    const required = [];
    for (const [key, def] of Object.entries(this._shape)) {
      props[key] = { type: def.type, description: def.description || '' };
      if (def.enum)  props[key].enum = def.enum;
      if (def.items) props[key].items = def.items;
      if (def.required !== false) required.push(key);
    }
    return { type: 'object', properties: props, required };
  }

  /** Validate and cast a parsed object against the shape. */
  validate(obj) {
    const result = {};
    const errors = [];
    for (const [key, def] of Object.entries(this._shape)) {
      const val = obj[key];
      if (val === undefined || val === null) {
        if (def.required !== false) errors.push(`Missing field: ${key}`);
        result[key] = def.default ?? null;
        continue;
      }
      if (def.type === 'number') {
        const n = Number(val);
        if (isNaN(n)) { errors.push(`${key}: expected number`); continue; }
        if (def.min !== undefined && n < def.min) errors.push(`${key}: below min ${def.min}`);
        if (def.max !== undefined && n > def.max) errors.push(`${key}: above max ${def.max}`);
        result[key] = n;
      } else {
        result[key] = val;
      }
    }
    if (errors.length) throw new AIStructuredOutputError(errors.join('; '), obj);
    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error types
// ─────────────────────────────────────────────────────────────────────────────

class AIError extends Error {
  constructor(message, provider, cause = null) {
    super(message);
    this.name     = 'AIError';
    this.provider = provider;
    this.cause    = cause;
  }
}

class AIRateLimitError extends AIError {
  constructor(provider, retryAfter = null) {
    super(`Rate limit exceeded on provider "${provider}"`, provider);
    this.name       = 'AIRateLimitError';
    this.retryAfter = retryAfter;
  }
}

class AIStructuredOutputError extends Error {
  constructor(message, raw) {
    super(`Structured output validation failed: ${message}`);
    this.name = 'AIStructuredOutputError';
    this.raw  = raw;
  }
}

class AIProviderError extends AIError {
  constructor(provider, message, statusCode = null) {
    super(message, provider);
    this.name       = 'AIProviderError';
    this.statusCode = statusCode;
  }
}

module.exports = {
  AIMessage, AIResponse, AIStreamEvent,
  Tool, ToolBuilder,
  Thread, Prompt, Schema,
  AIError, AIRateLimitError, AIStructuredOutputError, AIProviderError,
};