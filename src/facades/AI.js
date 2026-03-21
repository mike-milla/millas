'use strict';

const { createFacade } = require('./Facade');

// ── Service & types re-exported for application use ───────────────────────────
const AIService           = require('../ai/AIManager');
const { AIManager, PendingRequest } = require('../ai/AIManager');
const {
  AIMessage, AIResponse, AIStreamEvent,
  Tool, ToolBuilder, Thread, Prompt, Schema,
  AIError, AIRateLimitError, AIStructuredOutputError, AIProviderError,
} = require('../ai/types');
const {
  PendingImage, AIImageResponse,
  PendingAudio, AIAudioResponse,
  PendingTranscription, AITranscriptionResponse,
  PendingReranking, AIRerankResponse,
} = require('../ai/media');
const { ConversationThread, AI_MIGRATIONS } = require('../ai/conversation');
const { AIFile, PendingFile, AIFilesAPI, AIVectorStore, AIStoresAPI } = require('../ai/files');
const { WebSearch, WebFetch, FileSearch } = require('../ai/provider_tools');

/**
 * AI facade — multi-provider LLM client for Millas.
 *
 * Resolved from the DI container as 'ai'.
 * Auto-configured from config/ai.js or environment variables.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SUPPORTED PROVIDERS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Provider    | Text | Image | TTS | STT | Embed | Rerank
 *   ────────────┼──────┼───────┼─────┼─────┼───────┼───────
 *   anthropic   |  ✓   |       |     |     |       |
 *   openai      |  ✓   |   ✓   |  ✓  |  ✓  |   ✓   |
 *   gemini      |  ✓   |   ✓   |     |     |   ✓   |
 *   groq        |  ✓   |       |     |  ✓  |       |
 *   mistral     |  ✓   |       |     |  ✓  |   ✓   |
 *   xai         |  ✓   |   ✓   |     |     |       |
 *   deepseek    |  ✓   |       |     |     |       |
 *   azure       |  ✓   |       |  ✓  |  ✓  |   ✓   |
 *   cohere      |  ✓   |       |     |     |   ✓   |   ✓
 *   ollama      |  ✓   |       |     |     |   ✓   |
 *   elevenlabs  |      |       |  ✓  |  ✓  |       |
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIGURATION (config/ai.js)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   module.exports = {
 *     default: 'anthropic',
 *     audioProvider:  'elevenlabs',   // default provider for TTS/STT
 *     rerankProvider: 'cohere',       // default provider for reranking
 *     providers: {
 *       anthropic:  { apiKey: process.env.ANTHROPIC_API_KEY,  model: 'claude-sonnet-4-20250514' },
 *       openai:     { apiKey: process.env.OPENAI_API_KEY,     model: 'gpt-4o', embeddingModel: 'text-embedding-3-small' },
 *       gemini:     { apiKey: process.env.GEMINI_API_KEY,     model: 'gemini-2.0-flash' },
 *       groq:       { apiKey: process.env.GROQ_API_KEY,       model: 'llama-3.1-70b-versatile' },
 *       mistral:    { apiKey: process.env.MISTRAL_API_KEY,    model: 'mistral-large-latest' },
 *       xai:        { apiKey: process.env.XAI_API_KEY,        model: 'grok-2' },
 *       deepseek:   { apiKey: process.env.DEEPSEEK_API_KEY,   model: 'deepseek-chat' },
 *       cohere:     { apiKey: process.env.COHERE_API_KEY },
 *       elevenlabs: { apiKey: process.env.ELEVENLABS_API_KEY },
 *       ollama:     { baseUrl: 'http://localhost:11434',       model: 'llama3.2' },
 *       azure:      { apiKey: process.env.AZURE_OPENAI_KEY, endpoint: process.env.AZURE_OPENAI_ENDPOINT, deployment: 'gpt-4o', apiVersion: '2024-02-01' },
 *     },
 *   };
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEXT GENERATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // Simplest call
 *   const res = await AI.text('What is the capital of Kenya?');
 *   console.log(res.text);           // 'Nairobi'
 *   console.log(res.totalTokens);    // 42
 *
 *   // Full builder
 *   const res = await AI
 *     .using('openai')
 *     .model('gpt-4o')
 *     .system('You are concise.')
 *     .temperature(0.7)
 *     .maxTokens(500)
 *     .retry(3, 1000)
 *     .fallback(['anthropic', { provider: 'gemini', model: 'gemini-2.0-flash' }])
 *     .cache(600)
 *     .tokenBudget(10000)
 *     .generate('Explain recursion in one paragraph.');
 *
 *   // Extended thinking (Anthropic claude-3-7+)
 *   const res = await AI
 *     .using('anthropic')
 *     .think(16000)
 *     .generate('Prove there are infinitely many primes.');
 *
 *   console.log(res.thinking);  // internal reasoning chain
 *   console.log(res.text);      // final answer
 *
 *   // Per-provider options
 *   await AI.providerOptions({
 *     openai:    { reasoning: { effort: 'low' }, frequency_penalty: 0.5 },
 *     anthropic: { thinking: { budget_tokens: 1024 } },
 *   }).generate('...');
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STREAMING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // Event-based
 *   for await (const event of AI.stream('Tell me a story')) {
 *     if (event.type === 'delta')    process.stdout.write(event.data.text);
 *     if (event.type === 'thinking') console.log('[thinking]', event.data.text);
 *     if (event.type === 'tool_call') console.log('Tool called:', event.data.name);
 *     if (event.type === 'complete') console.log('Tokens:', event.data.totalTokens);
 *   }
 *
 *   // Token callback shorthand
 *   const res = await AI
 *     .onToken(chunk => expressRes.write(chunk))
 *     .generate('Write a poem about Kenya');
 *
 *   // SSE endpoint
 *   app.get('/chat', async (req, res) => {
 *     res.setHeader('Content-Type', 'text/event-stream');
 *     for await (const event of AI.stream(req.query.q)) {
 *       if (event.type === 'delta')
 *         res.write('data: ' + JSON.stringify({ text: event.data.text }) + '\n\n');
 *       if (event.type === 'complete')
 *         res.write('data: [DONE]\n\n');
 *     }
 *     res.end();
 *   });
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STRUCTURED OUTPUT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const res = await AI
 *     .structured(Schema.define({
 *       sentiment:  { type: 'string', enum: ['positive', 'negative', 'neutral'] },
 *       confidence: { type: 'number', min: 0, max: 1 },
 *       summary:    { type: 'string' },
 *       keywords:   { type: 'array'  },
 *     }))
 *     .generate('Analyse: "Great product, fast shipping!"');
 *
 *   res.parsed.sentiment;    // 'positive'
 *   res.parsed.confidence;   // 0.97
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TOOL CALLING & AGENTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const weatherTool = Tool.define('get_weather')
 *     .description('Get real-time weather for a city')
 *     .parameters({
 *       type: 'object',
 *       properties: {
 *         city:  { type: 'string' },
 *         units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
 *       },
 *       required: ['city'],
 *     })
 *     .handle(async ({ city, units = 'celsius' }) => WeatherAPI.get(city, units))
 *     .build();
 *
 *   // Agentic loop — tool calls handled automatically
 *   const res = await AI
 *     .tools([weatherTool, calendarTool])
 *     .agent('Book a meeting for a sunny day in Nairobi next week');
 *
 *   // Provider-native tools (executed by the AI provider, not your app)
 *   await AI.tools([new WebSearch().max(5)]).generate('What happened in AI today?');
 *   await AI.tools([new WebFetch().allow(['docs.example.com'])]).generate('Summarise https://...');
 *   await AI.tools([new FileSearch({ stores: ['vs_abc'] })]).generate('Find docs about...');
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONVERSATIONS (DB-persisted)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // Start a new conversation
 *   const thread = await AI.conversation.forUser(user.id, 'SalesCoach').create('Q3 Review');
 *   await thread.addUser('Analyse this transcript...');
 *   const res = await AI.withThread(thread).generate();
 *   await thread.addAssistant(res.text);
 *
 *   const conversationId = thread.id;  // store for later
 *
 *   // Continue an existing conversation
 *   const thread = await AI.conversation.continue(conversationId);
 *   await thread.addUser('Tell me more about that.');
 *   const res = await AI.withThread(thread).generate();
 *
 *   // List a user's conversations
 *   const history = await ConversationThread.list(user.id, 'SalesCoach', 20);
 *
 *   // In-memory thread (no DB)
 *   const thread = AI.thread('You are helpful.').limit(20).summariseWith(async (old) => {
 *     return (await AI.text('Summarise: ' + old.map(m=>m.content).join('\n'))).text;
 *   });
 *   thread.addUser('Hello!');
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMAGE GENERATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const img = await AI.image('A donut on a counter')
 *     .landscape()           // or .portrait() or .square()
 *     .quality('high')       // 'high' | 'standard' | 'low'
 *     .using('openai')
 *     .generate();
 *
 *   await img.store('images/donut.png');
 *   const buffer = img.buffer;  // raw Buffer
 *
 *   // With reference images
 *   const img = await AI.image('Update this to an impressionist style')
 *     .attachments([AI.files.fromStorage('photo.jpg')])
 *     .generate();
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUDIO — TEXT TO SPEECH
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const audio = await AI.speak('Welcome to Millas!')
 *     .female()                          // or .male() or .voice('voice-id')
 *     .instructions('Speak like a news anchor')
 *     .using('elevenlabs')
 *     .generate();
 *
 *   await audio.store('audio/welcome.mp3');
 *   const buffer = audio.buffer;
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUDIO — SPEECH TO TEXT (TRANSCRIPTION)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // From file path
 *   const t = await AI.transcribe.fromPath('/recordings/call.mp3')
 *     .diarize()              // include who said what
 *     .language('en')
 *     .generate();
 *
 *   console.log(t.text);     // full transcript
 *   console.log(t.speakers); // per-speaker segments
 *
 *   // From storage
 *   const t = await AI.transcribe.fromStorage('uploads/meeting.mp3').generate();
 *
 *   // From buffer
 *   const t = await AI.transcribe.fromBuffer(audioBuffer, 'audio.mp3').generate();
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EMBEDDINGS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // Single text
 *   const [vector] = await AI.using('openai').embed('Napa Valley has great wine.');
 *
 *   // Batch
 *   const vectors = await AI.embed(['text one', 'text two'], null, 'openai');
 *
 *   // Local (Ollama)
 *   const [vector] = await AI.using('ollama').embed('Hello world');
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RERANKING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const result = await AI
 *     .rerank(['Django is a Python framework.', 'Laravel is PHP.', 'React is JS.'])
 *     .limit(2)
 *     .using('cohere')
 *     .rerank('PHP frameworks');
 *
 *   result.first.document;  // 'Laravel is PHP.'
 *   result.first.score;     // 0.95
 *   for (const r of result) console.log(r.score, r.document);
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FILE STORAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // Upload a file to the provider
 *   const file = await AI.files.fromPath('/reports/q3.pdf').put();
 *   const file = await AI.files.fromStorage('uploads/report.pdf').put();
 *   const file = await AI.files.fromUrl('https://example.com/doc.pdf').put();
 *
 *   console.log(file.id);   // 'file-abc123'
 *
 *   // Use a stored file in a prompt
 *   const res = await AI
 *     .withMessage([
 *       { type: 'text',     text: 'Summarise this document.' },
 *       { type: 'file_ref', fileId: file.id },
 *     ])
 *     .generate();
 *
 *   // Retrieve or delete
 *   const meta = await AI.files.fromId('file-abc').get();
 *   await AI.files.fromId('file-abc').delete();
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VECTOR STORES (RAG)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // Create a store
 *   const store = await AI.stores.create('Knowledge Base');
 *
 *   // Add files
 *   await store.add(AI.files.fromPath('/docs/manual.pdf'));
 *   await store.add('file-abc123', { author: 'Alice', year: 2025 });
 *
 *   // Use it in a prompt with FileSearch tool
 *   await AI
 *     .tools([new FileSearch({ stores: [store.id] })])
 *     .generate('Find docs about authentication');
 *
 *   // Remove a file
 *   await store.remove('file-abc123', { deleteFile: true });
 *
 *   // Retrieve or delete the store
 *   const store = await AI.stores.get('vs_abc123');
 *   await AI.stores.delete('vs_abc123');
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MIDDLEWARE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const logUsage = async (req, next) => {
 *     const start = Date.now();
 *     const res   = await next(req);
 *     Log.info(`AI [${req.provider}] ${Date.now()-start}ms — ${res.totalTokens} tokens`);
 *     return res;
 *   };
 *
 *   await AI.use(logUsage).generate('...');
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROMPT TEMPLATES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const prompt = AI.prompt('Translate "{{text}}" to {{language}}.')
 *     .with({ text: 'Hello', language: 'Swahili' });
 *
 *   await AI.text(prompt.toString());
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TESTING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   AI.swap({
 *     text:   async () => new AIResponse({ text: 'Mocked', provider: 'mock', model: 'mock' }),
 *     stream: async function*() { yield AIStreamEvent.delta('Mocked'); },
 *   });
 *   AI.restore();
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @see src/ai/AIManager.js
 * @see src/ai/drivers.js
 * @see src/ai/types.js
 * @see src/ai/media.js
 * @see src/ai/conversation.js
 * @see src/ai/files.js
 * @see src/ai/provider_tools.js
 */
class AI extends createFacade('ai') {}

module.exports = {
  AI,
  // Manager
  AIManager,
  PendingRequest,
  // Core types
  AIMessage,
  AIResponse,
  AIStreamEvent,
  // Tool system
  Tool,
  ToolBuilder,
  // Provider-native tools
  WebSearch,
  WebFetch,
  FileSearch,
  // Memory
  Thread,
  ConversationThread,
  AI_MIGRATIONS,
  // Templating & schema
  Prompt,
  Schema,
  // Media
  PendingImage,  AIImageResponse,
  PendingAudio,  AIAudioResponse,
  PendingTranscription, AITranscriptionResponse,
  PendingReranking,     AIRerankResponse,
  // Files & vector stores
  AIFile,
  PendingFile,
  AIFilesAPI,
  AIVectorStore,
  AIStoresAPI,
  // Errors
  AIError,
  AIRateLimitError,
  AIStructuredOutputError,
  AIProviderError,
};