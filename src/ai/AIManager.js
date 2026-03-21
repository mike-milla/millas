'use strict';

const {
  AIMessage, AIResponse, AIStreamEvent, Schema, Thread,
  AIError, AIStructuredOutputError,
} = require('./types');

const {
  AnthropicDriver, OpenAIDriver, GeminiDriver, OllamaDriver,
  GroqDriver, MistralDriver, XAIDriver, DeepSeekDriver, AzureDriver,
  CohereDriver, ElevenLabsDriver,
} = require('./drivers');

const {
  PendingImage, AIImageResponse,
  PendingAudio, AIAudioResponse,
  PendingTranscription, AITranscriptionResponse,
  PendingReranking, AIRerankResponse,
} = require('./media');

const { ConversationThread } = require('./conversation');
const { AIFilesAPI, AIStoresAPI } = require('./files');
const { AGENT_DEFINITIONS, BuiltinAgent } = require('./agents');
const { CostCalculator } = require('./pricing');
const { WebSearch, WebFetch, FileSearch } = require('./provider_tools');

// ─────────────────────────────────────────────────────────────────────────────
// PendingRequest — fluent builder for a single text AI call
// ─────────────────────────────────────────────────────────────────────────────

class PendingRequest {
  constructor(manager) {
    this._manager        = manager;
    this._provider       = null;
    this._model          = null;
    this._messages       = [];
    this._systemPrompt   = null;
    this._tools          = [];
    this._toolChoice     = null;
    this._schema         = null;
    this._maxTokens      = null;
    this._temperature    = undefined;
    this._topP           = undefined;
    this._stopSeqs       = [];
    this._thinking       = false;
    this._thinkingBudget = 8000;
    this._fallbacks      = [];
    this._retries        = 1;
    this._retryDelay     = 1000;
    this._cache          = false;
    this._cacheTtl       = 3600;
    this._middleware     = [];
    this._tokenBudget    = null;
    this._onToken        = null;
    this._providerOpts   = {};
  }

  // ── Provider / model ───────────────────────────────────────────────────────
  using(provider)      { this._provider = provider;       return this; }
  model(model)         { this._model    = model;           return this; }

  // ── Messages ───────────────────────────────────────────────────────────────
  system(prompt)       { this._systemPrompt = String(prompt); return this; }
  withMessage(content, role = 'user') { this._messages.push(new AIMessage(role, content)); return this; }

  async withThread(thread) {
    if (thread._systemPrompt) this._systemPrompt = thread._systemPrompt;
    const msgs = await thread.toArray();
    this._messages = msgs.map(m => new AIMessage(m.role, m.content, m));
    return this;
  }

  // ── Parameters ─────────────────────────────────────────────────────────────
  maxTokens(n)          { this._maxTokens   = n;    return this; }
  temperature(t)        { this._temperature = t;    return this; }
  topP(p)               { this._topP        = p;    return this; }
  stop(seqs)            { this._stopSeqs    = Array.isArray(seqs) ? seqs : [seqs]; return this; }
  think(budget = 8000)  { this._thinking = true; this._thinkingBudget = budget; return this; }

  /**
   * Pass provider-specific options.
   *   .providerOptions({ openai: { reasoning: { effort: 'low' } }, anthropic: { thinking: { budget_tokens: 1024 } } })
   */
  providerOptions(opts) { this._providerOpts = opts; return this; }

  // ── Tools ──────────────────────────────────────────────────────────────────
  tools(tools)         { this._tools      = Array.isArray(tools) ? tools : [tools]; return this; }
  toolChoice(choice)   { this._toolChoice = choice; return this; }

  // ── Structured output ──────────────────────────────────────────────────────
  structured(schema)   { this._schema = schema;  return this; }

  // ── Reliability ────────────────────────────────────────────────────────────
  retry(times, delay = 1000) { this._retries = times; this._retryDelay = delay; return this; }
  fallback(providers)  { this._fallbacks = Array.isArray(providers) ? providers : [providers]; return this; }
  cache(ttl = 3600)    { this._cache = true; this._cacheTtl = ttl; return this; }
  tokenBudget(n)       { this._tokenBudget = n; return this; }

  // ── Middleware ─────────────────────────────────────────────────────────────
  use(fn)              { this._middleware.push(fn); return this; }
  onToken(fn)          { this._onToken = fn;       return this; }

  // ── Execution ──────────────────────────────────────────────────────────────

  async generate(prompt) {
    if (prompt) this.withMessage(prompt);
    return this._execute();
  }

  async *stream(prompt) {
    if (prompt) this.withMessage(prompt);
    yield* this._executeStream();
  }

  /**
   * Stream with Vercel AI SDK data protocol format (for use with useChat / useCompletion).
   * Returns an async generator of encoded string chunks.
   *
   *   // Express SSE endpoint
   *   app.get('/chat', async (req, res) => {
   *     res.setHeader('Content-Type', 'text/event-stream');
   *     res.setHeader('x-vercel-ai-data-stream', 'v1');
   *     for await (const chunk of AI.usingVercelProtocol().stream(req.query.q)) {
   *       res.write(chunk);
   *     }
   *     res.end();
   *   });
   */
  usingVercelProtocol() { this._vercel = true; return this; }

  /**
   * Queue this AI call. Returns a QueuedAIRequest with .then() and .catch().
   *
   *   AI.queue('Summarize this...').then(res => console.log(res.text)).catch(err => ...);
   */
  queue(prompt) {
    if (prompt) this.withMessage(prompt);
    return new QueuedAIRequest(this);
  }

  /**
   * Agentic tool loop — auto-executes tool calls until model stops or maxIterations reached.
   */
  async agent(prompt, maxIterations = 10) {
    if (prompt) this.withMessage(prompt);
    let iterations = 0;
    while (iterations < maxIterations) {
      const response = await this._execute();
      iterations++;
      if (!response.hasToolCalls) return response;
      this._messages.push(response.toMessage());
      const toolResults = await Promise.all(
        response.toolCalls.map(async tc => {
          const tool = this._tools.find(t => t.name === tc.name);
          if (!tool) return AIMessage.tool(tc.id, tc.name, `Error: tool "${tc.name}" not found`);
          try {
            const result = await tool.handler(tc.arguments);
            return AIMessage.tool(tc.id, tc.name, typeof result === 'string' ? result : JSON.stringify(result));
          } catch (err) {
            return AIMessage.tool(tc.id, tc.name, `Error: ${err.message}`);
          }
        })
      );
      for (const tr of toolResults) this._messages.push(tr);
    }
    throw new AIError(`Agent exceeded maximum iterations (${maxIterations})`, this._provider);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _buildRequest() {
    const messages = [...this._messages];
    if (this._systemPrompt) messages.unshift(new AIMessage('system', this._systemPrompt));

    if (this._schema) {
      const schemaHint = `\n\nYou must respond with valid JSON matching this schema:\n${JSON.stringify(this._schema.toJSONSchema(), null, 2)}\n\nRespond ONLY with JSON. No explanation, no markdown fences.`;
      const last = messages[messages.length - 1];
      if (last && last.role === 'user') messages[messages.length - 1] = new AIMessage('user', last.content + schemaHint);
    }

    return {
      provider: this._provider, model: this._model,
      messages: messages.map(m => m.toJSON()),
      tools: this._tools, toolChoice: this._toolChoice, schema: this._schema,
      maxTokens: this._maxTokens, temperature: this._temperature, topP: this._topP,
      stopSequences: this._stopSeqs, thinking: this._thinking, thinkingBudget: this._thinkingBudget,
      providerOptions: this._providerOpts,
    };
  }

  _cacheKey(req) { return `ai:${req.provider}:${req.model}:${JSON.stringify(req.messages)}`; }

  async _execute() {
    const request  = this._buildRequest();
    const cacheKey = this._cache ? this._cacheKey(request) : null;

    if (cacheKey && this._manager._cache) {
      const cached = await this._manager._cache.get(cacheKey).catch(() => null);
      if (cached) return new AIResponse(cached);
    }

    const run = async (req) => {
      const driver   = this._manager._resolveDriver(req.provider || this._manager._default);
      let   response = await this._executeWithRetry(driver, req);

      if (this._tokenBudget && response.totalTokens > this._tokenBudget) {
        throw new AIError(`Token budget exceeded: ${response.totalTokens} > ${this._tokenBudget}`, req.provider);
      }

      if (this._schema && response.text) {
        let parsed;
        try {
          parsed = this._schema.validate(JSON.parse(response.text.replace(/```json|```/g, '').trim()));
        } catch (err) {
          const retryMessages = [...req.messages, new AIMessage('assistant', response.text).toJSON(),
            new AIMessage('user', `Your response was not valid JSON. Error: ${err.message}. Respond ONLY with valid JSON.`).toJSON()];
          const retry = await driver.complete({ ...req, messages: retryMessages });
          try { parsed = this._schema.validate(JSON.parse(retry.text.replace(/```json|```/g, '').trim())); } catch (e2) { throw new AIStructuredOutputError(e2.message, retry.text); }
          response = retry;
        }
        response._parsed = parsed;
        Object.defineProperty(response, 'parsed', { get: () => response._parsed });
      }
      return response;
    };

    const runWithMiddleware = [...this._middleware].reduceRight((next, mw) => (req) => mw(req, next), run);

    let response;
    try {
      response = await runWithMiddleware(request);
    } catch (err) {
      for (const fb of this._fallbacks) {
        const fbProvider = typeof fb === 'string' ? fb : fb.provider;
        const fbModel    = typeof fb === 'object' ? fb.model : null;
        try {
          const driver = this._manager._resolveDriver(fbProvider);
          response = await this._executeWithRetry(driver, { ...request, provider: fbProvider, model: fbModel || request.model });
          break;
        } catch (_) {}
      }
      if (!response) throw err;
    }

    if (cacheKey && this._manager._cache && response) {
      this._manager._cache.set(cacheKey, { text: response.text, role: response.role, model: response.model, provider: response.provider, inputTokens: response.inputTokens, outputTokens: response.outputTokens, toolCalls: response.toolCalls, finishReason: response.finishReason }, this._cacheTtl).catch(() => {});
    }

    return response;
  }

  async _executeWithRetry(driver, request) {
    let lastErr;
    for (let i = 1; i <= this._retries; i++) {
      try { return await driver.complete(request); } catch (err) { lastErr = err; if (i < this._retries) await new Promise(r => setTimeout(r, this._retryDelay * i)); }
    }
    throw lastErr;
  }

  async *_executeStream() {
    const request = this._buildRequest();
    const driver  = this._manager._resolveDriver(request.provider || this._manager._default);
    for await (const event of driver.stream(request)) {
      if (event.type === 'delta' && this._onToken) this._onToken(event.data.text);
      if (this._vercel) {
        // Vercel AI SDK data stream protocol v1
        if (event.type === 'delta')    yield `0:${JSON.stringify(event.data.text)}
`;
        if (event.type === 'complete') yield `d:${JSON.stringify({ finishReason: event.data.finishReason || 'stop', usage: { promptTokens: event.data.inputTokens, completionTokens: event.data.outputTokens } })}
`;
      } else {
        yield event;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// QueuedAIRequest — deferred AI call via the Millas Queue system
// ─────────────────────────────────────────────────────────────────────────────

class QueuedAIRequest {
  constructor(pendingRequest) {
    this._request  = pendingRequest;
    this._thenFns  = [];
    this._catchFns = [];
    // Defer to next tick so .then/.catch can be chained before execution
    setImmediate(() => this._run());
  }

  then(fn)  { this._thenFns.push(fn);  return this; }
  catch(fn) { this._catchFns.push(fn); return this; }

  async _run() {
    try {
      const response = await this._request._execute();
      for (const fn of this._thenFns) await fn(response);
    } catch (err) {
      if (this._catchFns.length) {
        for (const fn of this._catchFns) await fn(err);
      } else {
        // Surface unhandled rejections
        process.nextTick(() => { throw err; });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AIManager
// ─────────────────────────────────────────────────────────────────────────────

class AIManager {
  constructor(config = {}) {
    this._config         = config;
    this._default        = config.default || 'anthropic';
    this._audioProvider  = config.audioProvider  || null;
    this._rerankProvider = config.rerankProvider || 'cohere';
    this._drivers        = new Map();
    this._cache          = null;
    this._db             = null;
    this._storage        = null;
    this._debug          = false;
    this._defaults       = {};            // named profiles: { chat: { temperature: 0.7 } }
    this._registeredTools = new Map();    // global tool registry
    this._agentDefs      = new Map(Object.entries(AGENT_DEFINITIONS));
    this._threadCache    = new Map();     // userId -> ConversationThread (in-memory fallback)
  }

  // ── Driver resolution ──────────────────────────────────────────────────────

  _resolveDriver(name) {
    if (this._drivers.has(name)) return this._drivers.get(name);
    const cfg = (this._config.providers || {})[name] || {};
    const drivers = {
      anthropic:  () => new AnthropicDriver(cfg),
      openai:     () => new OpenAIDriver(cfg),
      gemini:     () => new GeminiDriver(cfg),
      ollama:     () => new OllamaDriver(cfg),
      groq:       () => new GroqDriver(cfg),
      mistral:    () => new MistralDriver(cfg),
      xai:        () => new XAIDriver(cfg),
      deepseek:   () => new DeepSeekDriver(cfg),
      azure:      () => new AzureDriver(cfg),
      cohere:     () => new CohereDriver(cfg),
      elevenlabs: () => new ElevenLabsDriver(cfg),
    };
    if (!drivers[name]) throw new AIError(`Unknown AI provider: "${name}". Supported: ${Object.keys(drivers).join(', ')}`, name);
    const driver = drivers[name]();
    this._drivers.set(name, driver);
    return driver;
  }

  // ── Text generation ────────────────────────────────────────────────────────

  using(provider)       { return new PendingRequest(this).using(provider); }
  model(model)          { return new PendingRequest(this).model(model); }
  system(prompt)        { return new PendingRequest(this).system(prompt); }
  temperature(t)        { return new PendingRequest(this).temperature(t); }
  maxTokens(n)          { return new PendingRequest(this).maxTokens(n); }
  tools(tools)          { return new PendingRequest(this).tools(tools); }
  think(budget)         { return new PendingRequest(this).think(budget); }
  retry(n, delay)       { return new PendingRequest(this).retry(n, delay); }
  fallback(providers)   { return new PendingRequest(this).fallback(providers); }
  cache(ttl)            { return new PendingRequest(this).cache(ttl); }
  tokenBudget(n)        { return new PendingRequest(this).tokenBudget(n); }
  structured(schema)    { return new PendingRequest(this).structured(schema); }
  use(fn)               { return new PendingRequest(this).use(fn); }
  onToken(fn)           { return new PendingRequest(this).onToken(fn); }
  providerOptions(opts) { return new PendingRequest(this).providerOptions(opts); }

  /** Simplest text call. */
  text(prompt)    { return new PendingRequest(this).generate(prompt); }
  stream(prompt)  { return new PendingRequest(this).stream(prompt); }
  agent(prompt, maxIterations) { return new PendingRequest(this).agent(prompt, maxIterations); }

  /**
   * Queue an AI call to run in the background.
   *
   *   AI.queue('Summarize this long document...')
   *     .then(res => console.log(res.text))
   *     .catch(err => console.error(err));
   */
  queue(prompt)  { return new PendingRequest(this).queue(prompt); }
  withThread(thread) { return new PendingRequest(this).withThread(thread); }

  // ── Embeddings ─────────────────────────────────────────────────────────────

  async embed(texts, model = null, provider = null) {
    const driver = this._resolveDriver(provider || this._default);
    return driver.embed(texts, model);
  }

  // ── Image generation ────────────────────────────────────────────────────────

  /**
   * Generate an image.
   *
   *   const img = await AI.image('A donut on a counter').landscape().generate();
   *   await img.store('images/donut.png');
   */
  image(prompt) {
    const p = new PendingImage(this, prompt);
    AIImageResponse._storage = this._storage;
    return p;
  }

  // ── Audio TTS ──────────────────────────────────────────────────────────────

  /**
   * Text-to-speech.
   *
   *   const audio = await AI.speak('Hello world').female().generate();
   *   await audio.store('audio/greeting.mp3');
   */
  speak(text) {
    AIAudioResponse._storage = this._storage;
    return new PendingAudio(this, text);
  }

  // ── Speech-to-text ─────────────────────────────────────────────────────────

  /**
   * Transcription from a file path, storage path, or buffer.
   *
   *   const t = await AI.transcribe.fromPath('/audio.mp3').diarize().generate();
   *   const t = await AI.transcribe.fromStorage('uploads/audio.mp3').generate();
   */
  get transcribe() {
    const manager = this;
    PendingTranscription._storage = this._storage;
    return {
      fromPath:    (path)   => new PendingTranscription(manager, { type: 'path',    value: path }),
      fromStorage: (path)   => new PendingTranscription(manager, { type: 'storage', value: path }),
      fromBuffer:  (buf, filename, mimeType) => new PendingTranscription(manager, { type: 'buffer', value: buf, filename, mimeType }),
    };
  }

  // ── Reranking ──────────────────────────────────────────────────────────────

  /**
   * Rerank documents by relevance.
   *
   *   const result = await AI.rerank(['doc1', 'doc2', 'doc3']).rerank('my query');
   *   console.log(result.first.document);
   */
  rerank(documents) {
    return new PendingReranking(this, documents);
  }

  // ── Files ────────────────────────────────────────────────────────────────────

  /**
   * Upload and manage files stored with AI providers.
   *
   *   const f = await AI.files.fromPath('/report.pdf').put();
   *   const f = await AI.files.fromStorage('uploads/doc.pdf').put();
   *   const f = await AI.files.fromUrl('https://example.com/doc.pdf').put();
   *   const f = await AI.files.fromId('file-abc').get();
   *   await AI.files.fromId('file-abc').delete();
   */
  get files() { return new AIFilesAPI(this); }

  // ── Vector stores ─────────────────────────────────────────────────────────────

  /**
   * Create and manage vector stores for RAG / file search.
   *
   *   const store = await AI.stores.create('Knowledge Base');
   *   await store.add(AI.files.fromPath('/doc.pdf'));
   *   const store = await AI.stores.get('vs_abc');
   *   await AI.stores.delete('vs_abc');
   */
  get stores() { return new AIStoresAPI(this); }

  // ── Provider-native tools ─────────────────────────────────────────────────────

  /**
   * Built-in provider tools — executed by the AI provider itself.
   *
   *   AI.tools([AI.WebSearch()]).generate('What happened today?')
   *   AI.tools([AI.WebSearch().max(5).allow(['bbc.com'])]).generate('...')
   *   AI.tools([AI.WebFetch()]).generate('Summarize https://example.com')
   *   AI.tools([AI.FileSearch({ stores: ['vs_abc'] })]).generate('...')
   */
  WebSearch(opts)    { return new WebSearch(opts); }
  WebFetch(opts)     { return new WebFetch(opts); }
  FileSearch(opts)   { return new FileSearch(opts); }

  // ── Conversation threads ────────────────────────────────────────────────────

  /**
   * In-memory thread with optional auto-summarisation.
   *
   *   const thread = AI.thread('You are helpful.');
   */
  thread(systemPrompt = null) {
    return new Thread(systemPrompt);
  }

  /**
   * DB-persisted conversation thread.
   *
   *   const thread = await AI.conversation.forUser(user.id).create();
   *   await thread.addUser('Hello');
   *   const res = await AI.withThread(thread).generate();
   *   await thread.addAssistant(res.text);
   */
  get conversation() {
    const db = this._db;
    return {
      forUser:  (userId, agent = null) => ConversationThread.forUser(userId, agent, db),
      continue: (id)                   => ConversationThread.continue(id, db),
      list:     (userId, agent, limit) => ConversationThread.list(userId, agent, limit),
    };
  }

  // ── Prompt templates ────────────────────────────────────────────────────────

  prompt(template) { const { Prompt } = require('./types'); return Prompt.make(template); }

  // ── Layer 1: Zero-config entry point ──────────────────────────────────────

  /**
   * Zero-config chat. Picks best provider, handles memory automatically.
   *
   *   await AI.chat('Hello');
   *   await AI.chat('Hello', { userId: user.id });
   *   await AI.chat('Hello', { userId: user.id, agent: 'coding' });
   *   await AI.chat('Hello', { provider: 'openai', model: 'gpt-4o' });
   */
  async chat(prompt, opts = {}) {
    const {
      userId   = null,
      agent    = null,
      provider = null,
      model    = null,
      temperature,
      stream   = false,
    } = opts;

    // Apply named profile defaults
    const profile = this._defaults[agent || 'chat'] || this._defaults['chat'] || {};

    // Resolve system prompt and temperature from agent definition if given
    const agentDef = agent ? this._agentDefs.get(agent) : null;
    const system   = agentDef?.systemPrompt || null;
    const temp     = temperature ?? agentDef?.temperature ?? profile.temperature ?? 0.7;

    let req = new PendingRequest(this);
    if (provider) req = req.using(provider);
    if (model)    req = req.model(model);
    if (system)   req = req.system(system);
    req = req.temperature(temp);

    // Auto tool injection — registered tools for the agent
    const tools = this._getRelevantTools(prompt, agentDef);
    if (tools.length) req = req.tools(tools);

    // Apply global defaults
    if (profile.maxTokens) req = req.maxTokens(profile.maxTokens);

    // Auto-memory: load or create thread if userId given
    if (userId) {
      const thread = await this._getOrCreateThread(userId, agent || 'chat');
      await thread.addUser(prompt);
      req = await req.withThread(thread);
      const res = await req.generate();
      await thread.addAssistant(res.text);
      this._attachMeta(res, { agent, toolsUsed: tools.map(t => t.name) });
      this._attachCost(res);
      if (this._debug) this._logDebug(res);
      return res;
    }

    const res = await req.generate(prompt);
    this._attachMeta(res, { agent, toolsUsed: tools.map(t => t.name) });
    this._attachCost(res);
    if (this._debug) this._logDebug(res);
    return res;
  }

  // ── Layer 2: Prebuilt agents ───────────────────────────────────────────────

  /**
   * Get a prebuilt agent by name.
   *
   *   await AI.agent('coding').ask('Fix this bug: ...');
   *   await AI.agent('writing').ask('Rewrite professionally: ...');
   *   await AI.agent('support').ask('Customer says: ...', { userId: user.id });
   *
   * Built-in agents: general, coding, writing, support, analyst, research, translator, summarizer
   */
  agent(name, overrides = {}) {
    const def = this._agentDefs.get(name);
    if (!def) {
      const available = [...this._agentDefs.keys()].join(', ');
      throw new AIError(`Unknown agent: "${name}". Available: ${available}`, null);
    }
    return new BuiltinAgent(this, def, overrides);
  }

  /**
   * Register a custom agent definition.
   *
   *   AI.registerAgent('legal', {
   *     label:       'Legal Assistant',
   *     temperature: 0.1,
   *     tools:       [],
   *     systemPrompt: 'You are a legal assistant...',
   *   });
   */
  registerAgent(name, definition) {
    this._agentDefs.set(name, definition);
    return this;
  }

  // ── Layer 3: Use-case APIs ─────────────────────────────────────────────────

  /**
   * Summarize text.
   *
   *   await AI.summarize(article);
   *   await AI.summarize(article, { length: 'short', provider: 'openai' });
   *   // length: 'short' (1-2 sentences) | 'medium' (paragraph) | 'long' (detailed)
   */
  async summarize(text, opts = {}) {
    const lengthGuide = {
      short:  'in 1-2 sentences',
      medium: 'in one concise paragraph',
      long:   'in detail, preserving all key points',
    }[opts.length || 'medium'];

    const res = await this._useCase(
      `Summarize the following text ${lengthGuide}. Return only the summary, no preamble.

${text}`,
      { temperature: 0.3, ...opts }
    );
    return res;
  }

  /**
   * Translate text to a target language.
   *
   *   await AI.translate('Hello, how are you?', 'Swahili');
   *   await AI.translate(text, 'French', { formal: true });
   */
  async translate(text, targetLanguage, opts = {}) {
    const formalityHint = opts.formal === true  ? 'Use formal register.' :
                          opts.formal === false ? 'Use informal/conversational register.' : '';
    const res = await this._useCase(
      `Translate the following text to ${targetLanguage}. ${formalityHint} Return only the translation, no explanation.

${text}`,
      { temperature: 0.2, ...opts }
    );
    return res;
  }

  /**
   * Classify text into one of the given categories.
   *
   *   await AI.classify('I love this product!', ['positive', 'negative', 'neutral']);
   *   await AI.classify(email, ['spam', 'important', 'newsletter'], { explain: true });
   */
  async classify(text, categories, opts = {}) {
    const catList = categories.map(c => `"${c}"`).join(', ');
    const explainHint = opts.explain
      ? 'Respond with JSON: { "category": "...", "confidence": 0.0-1.0, "reason": "one sentence" }'
      : `Respond with only the category name — one of: ${catList}`;

    const res = await this._useCase(
      `Classify the following text into one of these categories: ${catList}.
${explainHint}

Text:
${text}`,
      { temperature: 0.1, ...opts }
    );

    if (opts.explain) {
      try {
        res._parsed = JSON.parse(res.text.replace(/```json|```/g, '').trim());
        Object.defineProperty(res, 'parsed', { get: () => res._parsed });
      } catch {}
    }
    return res;
  }

  /**
   * Extract structured data from text using a Schema.
   *
   *   const { Schema } = require('millas/facades/AI');
   *
   *   const res = await AI.extract(invoiceText, Schema.define({
   *     vendor:   { type: 'string' },
   *     amount:   { type: 'number' },
   *     date:     { type: 'string' },
   *     currency: { type: 'string' },
   *   }));
   *
   *   res.parsed.vendor   // 'Acme Corp'
   *   res.parsed.amount   // 1250.00
   */
  async extract(text, schema, opts = {}) {
    const res = await this._useCase(text, { structured: schema, temperature: 0.1, ...opts });
    return res;
  }

  // ── Tool registry ──────────────────────────────────────────────────────────

  /**
   * Register a tool globally. Registered tools are available to all agents
   * and auto-discovered by AI.chat() based on keyword matching.
   *
   *   AI.registerTool(weatherTool);
   *   AI.registerTool(calendarTool);
   */
  registerTool(tool) {
    this._registeredTools.set(tool.name, tool);
    return this;
  }

  /**
   * Unregister a tool.
   *   AI.unregisterTool('get_weather');
   */
  unregisterTool(name) {
    this._registeredTools.delete(name);
    return this;
  }

  // ── Cost & pricing ─────────────────────────────────────────────────────────

  /**
   * Estimate cost for a prompt before sending.
   *
   *   const est = AI.estimateCost('My prompt...', 'claude-sonnet-4-20250514');
   *   console.log(est.estimated.formatted);  // '$0.0002'
   *   console.log(est.note);
   */
  estimateCost(prompt, model = null, expectedOutputTokens = 500) {
    const m = model || (this._config.providers?.[this._default])?.model || this._default;
    return CostCalculator.estimate(prompt, m, expectedOutputTokens);
  }

  // ── Debug mode ─────────────────────────────────────────────────────────────

  /**
   * Enable or disable debug logging.
   *
   *   AI.debug(true);
   *
   * Outputs for every call:
   *   [AI] Provider: anthropic | Model: claude-sonnet-4-20250514
   *   [AI] Tokens: 120 in / 340 out | Cost: $0.0063 | Latency: 820ms
   *   [AI] Fallback used: no | Tools called: [weatherTool]
   */
  debug(enabled = true) {
    this._debug = enabled;
    return this;
  }

  // ── Named defaults ─────────────────────────────────────────────────────────

  /**
   * Set default options per use case.
   *
   *   AI.defaults({
   *     chat:    { temperature: 0.7 },
   *     coding:  { temperature: 0, provider: 'anthropic' },
   *     writing: { temperature: 0.8, maxTokens: 2000 },
   *   });
   */
  defaults(profiles) {
    Object.assign(this._defaults, profiles);
    return this;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  _useCase(prompt, opts = {}) {
    let req = new PendingRequest(this);
    if (opts.provider)   req = req.using(opts.provider);
    if (opts.model)      req = req.model(opts.model);
    if (opts.temperature !== undefined) req = req.temperature(opts.temperature);
    if (opts.maxTokens)  req = req.maxTokens(opts.maxTokens);
    if (opts.structured) req = req.structured(opts.structured);
    return req.generate(prompt).then(res => {
      this._attachCost(res);
      if (this._debug) this._logDebug(res);
      return res;
    });
  }

  _getRegisteredTools() {
    return [...this._registeredTools.values()];
  }

  _getRelevantTools(prompt, agentDef = null) {
    if (!this._registeredTools.size) return [];

    // Agent-specific tools
    if (agentDef?.tools === 'all') return this._getRegisteredTools();
    if (Array.isArray(agentDef?.tools) && agentDef.tools.length) {
      return agentDef.tools.map(n => this._registeredTools.get(n)).filter(Boolean);
    }

    // Level 1 auto-discovery: keyword matching between prompt and tool description+name
    const promptLower = prompt.toLowerCase();
    return this._getRegisteredTools().filter(tool => {
      const keywords = (tool.name + ' ' + (tool.description || ''))
        .toLowerCase()
        .split(/[\s_-]+/);
      return keywords.some(kw => kw.length > 3 && promptLower.includes(kw));
    });
  }

  async _getOrCreateThread(userId, agent = 'chat') {
    const key = `${userId}:${agent}`;

    // If DB is available, use persistent threads
    if (this._db) {
      return ConversationThread.forUser(userId, agent, this._db).create();
    }

    // Fall back to in-memory thread per user+agent
    if (!this._threadCache.has(key)) {
      this._threadCache.set(key, new Thread());
    }
    return this._threadCache.get(key);
  }

  _attachCost(res) {
    if (!res || !res.model) return;
    const cost = CostCalculator.forResponse(res);
    if (cost) {
      res.cost = cost;
      Object.defineProperty(res, 'cost', { value: cost, configurable: true });
    }
  }

  _attachMeta(res, extra = {}) {
    if (!res) return;
    res.meta = {
      provider:    res.provider,
      model:       res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      totalTokens: res.totalTokens,
      finishReason: res.finishReason,
      ...extra,
    };
  }

  _logDebug(res) {
    const cost    = res.cost ? ` | Cost: ${res.cost.formatted}` : '';
    const tools   = res.meta?.toolsUsed?.length ? ` | Tools: [${res.meta.toolsUsed.join(', ')}]` : '';
    const latency = res._latency ? ` | Latency: ${res._latency}ms` : '';
    console.log(
      `\n[AI] Provider: ${res.provider} | Model: ${res.model}` +
      `\n[AI] Tokens: ${res.inputTokens} in / ${res.outputTokens} out${cost}${latency}${tools}\n`
    );
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  configure(config) {
    Object.assign(this._config, config);
    if (config.default)        this._default        = config.default;
    if (config.audioProvider)  this._audioProvider  = config.audioProvider;
    if (config.rerankProvider) this._rerankProvider = config.rerankProvider;
    this._drivers.clear();
    return this;
  }

  setCache(cache) { this._cache = cache; return this; }
  setDb(db)       { this._db    = db; ConversationThread._db = db; return this; }
  setStorage(s)   { this._storage = s; return this; }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const defaultAI = new AIManager({
  default: process.env.AI_PROVIDER || 'anthropic',
  providers: {
    anthropic:  { apiKey: process.env.ANTHROPIC_API_KEY,  model: process.env.ANTHROPIC_MODEL },
    openai:     { apiKey: process.env.OPENAI_API_KEY,     model: process.env.OPENAI_MODEL    },
    gemini:     { apiKey: process.env.GEMINI_API_KEY,     model: process.env.GEMINI_MODEL    },
    ollama:     { baseUrl: process.env.OLLAMA_BASE_URL,   model: process.env.OLLAMA_MODEL    },
    groq:       { apiKey: process.env.GROQ_API_KEY,       model: process.env.GROQ_MODEL      },
    mistral:    { apiKey: process.env.MISTRAL_API_KEY,    model: process.env.MISTRAL_MODEL   },
    xai:        { apiKey: process.env.XAI_API_KEY,        model: process.env.XAI_MODEL       },
    deepseek:   { apiKey: process.env.DEEPSEEK_API_KEY,   model: process.env.DEEPSEEK_MODEL  },
    cohere:     { apiKey: process.env.COHERE_API_KEY,     model: process.env.COHERE_MODEL    },
    elevenlabs: { apiKey: process.env.ELEVENLABS_API_KEY                                     },
  },
});

module.exports             = defaultAI;
module.exports.AIManager   = AIManager;
module.exports.PendingRequest = PendingRequest;