'use strict';

const {
  AIResponse, AIMessage, AIStreamEvent,
  AIError, AIRateLimitError, AIProviderError,
} = require('./types');

// ─────────────────────────────────────────────────────────────────────────────
// Base driver
// ─────────────────────────────────────────────────────────────────────────────

class BaseDriver {
  constructor(config) { this.config = config; }

  _headers(extra = {}) {
    return { 'Content-Type': 'application/json', ...extra };
  }

  async _post(url, body, headers = {}) {
    const res = await fetch(url, {
      method:  'POST',
      headers: { ...this._headers(), ...headers },
      body:    JSON.stringify(body),
    });
    if (res.status === 429) {
      throw new AIRateLimitError(this.name, res.headers.get('retry-after') ? Number(res.headers.get('retry-after')) : null);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AIProviderError(this.name, `HTTP ${res.status}: ${text}`, res.status);
    }
    return res.json();
  }

  async _postRaw(url, body, headers = {}) {
    const res = await fetch(url, {
      method:  'POST',
      headers: { ...this._headers(), ...headers },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AIProviderError(this.name, `HTTP ${res.status}: ${text}`, res.status);
    }
    return res;
  }

  async _postForm(url, formData, headers = {}) {
    const res = await fetch(url, {
      method:  'POST',
      headers,
      body:    formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AIProviderError(this.name, `HTTP ${res.status}: ${text}`, res.status);
    }
    return res.json();
  }

  async _postForm(url, form, headers = {}) {
    const res = await fetch(url, { method: 'POST', headers, body: form });
    if (res.status === 429) { const ra = res.headers.get('retry-after'); throw new AIRateLimitError(this.name, ra ? Number(ra) : null); }
    if (!res.ok) { const text = await res.text().catch(() => ''); throw new AIProviderError(this.name, `HTTP ${res.status}: ${text}`, res.status); }
    return res.json();
  }

  async _postRaw(url, body, headers = {}) {
    const res = await fetch(url, { method: 'POST', headers: { ...this._headers(), ...headers }, body: JSON.stringify(body) });
    if (!res.ok) { const text = await res.text().catch(() => ''); throw new AIProviderError(this.name, `HTTP ${res.status}: ${text}`, res.status); }
    return res;
  }

  async _delete(url, headers = {}) {
    const res = await fetch(url, { method: 'DELETE', headers: { ...this._headers(), ...headers } });
    if (!res.ok && res.status !== 404) { const text = await res.text().catch(() => ''); throw new AIProviderError(this.name, `HTTP ${res.status}: ${text}`, res.status); }
    return res.status !== 404 ? res.json().catch(() => ({})) : {};
  }

  async _get(url, headers = {}) {
    const res = await fetch(url, { method: 'GET', headers: { ...this._headers(), ...headers } });
    if (!res.ok) { const text = await res.text().catch(() => ''); throw new AIProviderError(this.name, `HTTP ${res.status}: ${text}`, res.status); }
    return res.json();
  }

  async *_stream(url, body, headers = {}) {
    const res = await fetch(url, {
      method:  'POST',
      headers: { ...this._headers(), ...headers },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AIProviderError(this.name, `HTTP ${res.status}: ${text}`, res.status);
    }
    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) yield line;
    }
    if (buf) yield buf;
  }

  async complete(_req)    { throw new Error(`${this.constructor.name} must implement complete()`); }
  async *stream(_req)     { throw new Error(`${this.constructor.name} must implement stream()`); }
  async embed(_texts)     { throw new Error(`${this.constructor.name} does not support embeddings`); }
  async image(_req)       { throw new Error(`${this.constructor.name} does not support image generation`); }
  async tts(_req)         { throw new Error(`${this.constructor.name} does not support text-to-speech`); }
  async transcribe(_req)  { throw new Error(`${this.constructor.name} does not support transcription`); }
  async rerank(_req)      { throw new Error(`${this.constructor.name} does not support reranking`); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic
// ─────────────────────────────────────────────────────────────────────────────

class AnthropicDriver extends BaseDriver {
  get name() { return 'anthropic'; }

  _apiKey() {
    const key = this.config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new AIError('Anthropic API key not set. Use ANTHROPIC_API_KEY.', 'anthropic');
    return key;
  }

  _baseUrl() { return this.config.url || 'https://api.anthropic.com'; }

  _authHeaders() {
    return {
      'x-api-key':         this._apiKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'interleaved-thinking-2025-05-14',
    };
  }

  _buildBody(request) {
    const body = {
      model:      request.model || this.config.model || 'claude-sonnet-4-20250514',
      max_tokens: request.maxTokens || this.config.maxTokens || 4096,
      messages:   request.messages.filter(m => m.role !== 'system'),
    };
    const system = request.messages.find(m => m.role === 'system');
    if (system) body.system = system.content;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined)        body.top_p       = request.topP;
    if (request.stopSequences?.length)     body.stop_sequences = request.stopSequences;
    if (request.tools?.length) {
      body.tools = request.tools.map(t => t.toProviderSchema());
      if (request.toolChoice) body.tool_choice = request.toolChoice === 'auto' ? { type: 'auto' } : { type: 'tool', name: request.toolChoice };
    }
    if (request.thinking) {
      body.thinking = { type: 'enabled', budget_tokens: request.thinkingBudget || 8000 };
    }
    if (request.providerOptions?.anthropic) Object.assign(body, request.providerOptions.anthropic);
    return body;
  }

  async complete(request) {
    const body = this._buildBody(request);
    const data = await this._post(`${this._baseUrl()}/v1/messages`, body, this._authHeaders());
    const textBlock     = data.content?.find(b => b.type === 'text');
    const thinkingBlock = data.content?.find(b => b.type === 'thinking');
    const toolBlocks    = data.content?.filter(b => b.type === 'tool_use') || [];
    return new AIResponse({
      text: textBlock?.text || '', thinking: thinkingBlock?.thinking || null,
      model: data.model, provider: 'anthropic',
      inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0,
      toolCalls: toolBlocks.map(b => ({ id: b.id, name: b.name, arguments: b.input })),
      finishReason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason, raw: data,
    });
  }

  async *stream(request) {
    const body = { ...this._buildBody(request), stream: true };
    let text = '', thinking = '', inputTokens = 0, outputTokens = 0;
    let model = body.model, toolCalls = [], currentTool = null, currentToolInput = '';
    for await (const line of this._stream(`${this._baseUrl()}/v1/messages`, body, this._authHeaders())) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') break;
      let evt; try { evt = JSON.parse(raw); } catch { continue; }
      if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') { currentTool = { id: evt.content_block.id, name: evt.content_block.name }; currentToolInput = ''; }
      if (evt.type === 'content_block_delta') {
        if (evt.delta?.type === 'text_delta')        { text += evt.delta.text; yield AIStreamEvent.delta(evt.delta.text); }
        if (evt.delta?.type === 'thinking_delta')    { thinking += evt.delta.thinking; yield AIStreamEvent.thinking(evt.delta.thinking); }
        if (evt.delta?.type === 'input_json_delta')  { currentToolInput += evt.delta.partial_json; }
      }
      if (evt.type === 'content_block_stop' && currentTool) {
        let args = {}; try { args = JSON.parse(currentToolInput); } catch {}
        const tc = { ...currentTool, arguments: args }; toolCalls.push(tc); yield AIStreamEvent.toolCall(tc); currentTool = null; currentToolInput = '';
      }
      if (evt.type === 'message_delta')  outputTokens = evt.usage?.output_tokens || outputTokens;
      if (evt.type === 'message_start')  { inputTokens = evt.message?.usage?.input_tokens || 0; model = evt.message?.model || model; }
    }
    yield AIStreamEvent.complete(new AIResponse({ text, thinking, model, provider: 'anthropic', inputTokens, outputTokens, toolCalls, finishReason: 'stop' }));
  }

  async embed() { throw new AIProviderError('anthropic', 'Anthropic does not provide an embeddings API.'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI
// ─────────────────────────────────────────────────────────────────────────────

class OpenAIDriver extends BaseDriver {
  get name() { return 'openai'; }

  _apiKey() {
    const key = this.config.apiKey || process.env.OPENAI_API_KEY;
    if (!key) throw new AIError('OpenAI API key not set. Use OPENAI_API_KEY.', 'openai');
    return key;
  }

  _authHeaders() {
    const h = { Authorization: `Bearer ${this._apiKey()}` };
    if (this.config.organization) h['OpenAI-Organization'] = this.config.organization;
    return h;
  }

  _baseUrl() { return this.config.url || this.config.baseUrl || 'https://api.openai.com/v1'; }

  _buildBody(request) {
    const body = {
      model:    request.model || this.config.model || 'gpt-4o',
      messages: request.messages,
    };
    if (request.maxTokens)                 body.max_tokens   = request.maxTokens;
    if (request.temperature !== undefined) body.temperature  = request.temperature;
    if (request.topP !== undefined)        body.top_p        = request.topP;
    if (request.stopSequences?.length)     body.stop         = request.stopSequences;
    if (request.schema) {
      body.response_format = { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: request.schema.toJSONSchema() } };
    }
    if (request.tools?.length) {
      body.tools = request.tools.map(t => t.toOpenAISchema());
      if (request.toolChoice) body.tool_choice = request.toolChoice;
    }
    if (request.providerOptions?.openai) Object.assign(body, request.providerOptions.openai);
    return body;
  }

  async complete(request) {
    const body = this._buildBody(request);
    const data = await this._post(`${this._baseUrl()}/chat/completions`, body, this._authHeaders());
    const choice = data.choices?.[0]; const message = choice?.message; const tcs = message?.tool_calls || [];
    return new AIResponse({
      text: message?.content || '', model: data.model, provider: 'openai',
      inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0,
      toolCalls: tcs.map(tc => ({ id: tc.id, name: tc.function.name, arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })() })),
      finishReason: choice?.finish_reason === 'stop' ? 'stop' : choice?.finish_reason === 'length' ? 'length' : choice?.finish_reason, raw: data,
    });
  }

  async *stream(request) {
    const body = { ...this._buildBody(request), stream: true, stream_options: { include_usage: true } };
    let text = '', inputTokens = 0, outputTokens = 0, model = body.model, toolCalls = [], tcAccum = {};
    for await (const line of this._stream(`${this._baseUrl()}/chat/completions`, body, this._authHeaders())) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim(); if (raw === '[DONE]') break;
      let evt; try { evt = JSON.parse(raw); } catch { continue; }
      model = evt.model || model;
      if (evt.usage) { inputTokens = evt.usage.prompt_tokens || inputTokens; outputTokens = evt.usage.completion_tokens || outputTokens; }
      const delta = evt.choices?.[0]?.delta; if (!delta) continue;
      if (delta.content) { text += delta.content; yield AIStreamEvent.delta(delta.content); }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index; if (!tcAccum[idx]) tcAccum[idx] = { id: '', name: '', args: '' };
          if (tc.id) tcAccum[idx].id = tc.id; if (tc.function?.name) tcAccum[idx].name = tc.function.name; if (tc.function?.arguments) tcAccum[idx].args += tc.function.arguments;
        }
      }
      if (evt.choices?.[0]?.finish_reason === 'tool_calls') {
        toolCalls = Object.values(tcAccum).map(t => { let args = {}; try { args = JSON.parse(t.args); } catch {} const tc = { id: t.id, name: t.name, arguments: args }; return tc; });
        for (const tc of toolCalls) yield AIStreamEvent.toolCall(tc);
      }
    }
    yield AIStreamEvent.complete(new AIResponse({ text, model, provider: 'openai', inputTokens, outputTokens, toolCalls, finishReason: 'stop' }));
  }

  async embed(texts, model = null) {
    const body = { model: model || this.config.embeddingModel || 'text-embedding-3-small', input: Array.isArray(texts) ? texts : [texts] };
    const data = await this._post(`${this._baseUrl()}/embeddings`, body, this._authHeaders());
    return data.data.map(d => d.embedding);
  }

  async image(request) {
    const model = request.model || this.config.imageModel || 'dall-e-3';
    // gpt-image-1 uses 'url' format; dall-e-3 supports b64_json
    const useUrl = model.startsWith('gpt-image');
    const body = {
      model,
      prompt:  request.prompt,
      n:       request.n || 1,
      size:    request.size || '1024x1024',
      quality: request.quality || 'standard',
      ...(useUrl ? {} : { response_format: 'b64_json' }),
    };
    const data = await this._post(`${this._baseUrl()}/images/generations`, body, this._authHeaders());
    if (useUrl || data.data[0]?.url) {
      return { images: [], urls: data.data.map(d => d.url), provider: 'openai', model };
    }
    return { images: data.data.map(d => Buffer.from(d.b64_json, 'base64')), urls: [], provider: 'openai', model };
  }

  async tts(request) {
    const body = {
      model:  request.model || 'tts-1',
      input:  request.text,
      voice:  request.voice || 'alloy',
      ...(request.instructions ? { instructions: request.instructions } : {}),
      response_format: 'mp3',
    };
    const res  = await this._postRaw(`${this._baseUrl()}/audio/speech`, body, this._authHeaders());
    const buf  = Buffer.from(await res.arrayBuffer());
    return { audio: buf, format: 'mp3', provider: 'openai' };
  }

  async transcribe(request) {
    const form = new FormData();
    form.append('model',    request.model || 'whisper-1');
    form.append('file',     new Blob([request.audio], { type: request.mimeType || 'audio/mpeg' }), request.filename || 'audio.mp3');
    if (request.language) form.append('language', request.language);
    if (request.prompt)   form.append('prompt',   request.prompt);
    const data = await this._postForm(`${this._baseUrl()}/audio/transcriptions`, form, this._authHeaders());
    return { text: data.text, provider: 'openai' };
  }

  // ── File storage ────────────────────────────────────────────────────────────

  async uploadFile({ buf, filename, mimeType, purpose = 'assistants' }) {
    const form = new FormData();
    form.append('purpose', purpose);
    form.append('file', new Blob([buf], { type: mimeType }), filename);
    const data = await this._postForm(`${this._baseUrl()}/files`, form, this._authHeaders());
    return { id: data.id, filename: data.filename, size: data.bytes, createdAt: new Date(data.created_at * 1000) };
  }

  async getFile(fileId) {
    const data = await this._get(`${this._baseUrl()}/files/${fileId}`, this._authHeaders());
    return { id: data.id, filename: data.filename, size: data.bytes, createdAt: new Date(data.created_at * 1000) };
  }

  async deleteFile(fileId) {
    return this._delete(`${this._baseUrl()}/files/${fileId}`, this._authHeaders());
  }

  // ── Vector stores ────────────────────────────────────────────────────────────

  async createStore({ name, description = null, expiresIn = null }) {
    const body = { name };
    if (description) body.metadata      = { description };
    if (expiresIn)   body.expires_after = { anchor: 'last_active_at', days: Math.ceil(expiresIn / 86400) };
    const data = await this._post(`${this._baseUrl()}/vector_stores`, body, this._authHeaders());
    return { id: data.id, name: data.name, fileCounts: data.file_counts, ready: data.status === 'completed' };
  }

  async getStore(id) {
    const data = await this._get(`${this._baseUrl()}/vector_stores/${id}`, this._authHeaders());
    return { id: data.id, name: data.name, fileCounts: data.file_counts, ready: data.status === 'completed' };
  }

  async deleteStore(id) {
    return this._delete(`${this._baseUrl()}/vector_stores/${id}`, this._authHeaders());
  }

  async addFileToStore(storeId, fileId, metadata = {}) {
    const body = { file_id: fileId };
    if (Object.keys(metadata).length) body.attributes = metadata;
    const data = await this._post(`${this._baseUrl()}/vector_stores/${storeId}/files`, body, this._authHeaders());
    return { id: data.id, fileId: data.file_id, status: data.status };
  }

  async removeFileFromStore(storeId, fileId) {
    return this._delete(`${this._baseUrl()}/vector_stores/${storeId}/files/${fileId}`, this._authHeaders());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini
// ─────────────────────────────────────────────────────────────────────────────

class GeminiDriver extends BaseDriver {
  get name() { return 'gemini'; }

  _apiKey() {
    const key = this.config.apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new AIError('Gemini API key not set. Use GEMINI_API_KEY.', 'gemini');
    return key;
  }

  _url(model, method, stream = false) {
    const base = this.config.url || 'https://generativelanguage.googleapis.com/v1beta';
    const action = stream ? `${method}?alt=sse&key=${this._apiKey()}` : `${method}?key=${this._apiKey()}`;
    return `${base}/models/${model}:${action}`;
  }

  _buildBody(request) {
    const contents = request.messages.filter(m => m.role !== 'system').map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
    }));
    const body = { contents };
    const system = request.messages.find(m => m.role === 'system');
    if (system) body.systemInstruction = { parts: [{ text: system.content }] };
    const gc = {};
    if (request.maxTokens)               gc.maxOutputTokens = request.maxTokens;
    if (request.temperature !== undefined) gc.temperature   = request.temperature;
    if (request.topP !== undefined)       gc.topP           = request.topP;
    if (Object.keys(gc).length) body.generationConfig = gc;
    if (request.tools?.length) body.tools = [{ functionDeclarations: request.tools.map(t => ({ name: t.name, description: t.description, parameters: t.schema })) }];
    return body;
  }

  async complete(request) {
    const model = request.model || this.config.model || 'gemini-2.0-flash';
    const data  = await this._post(this._url(model, 'generateContent'), this._buildBody(request));
    const candidate = data.candidates?.[0]; const parts = candidate?.content?.parts || [];
    const text    = parts.filter(p => p.text).map(p => p.text).join('');
    const fnCalls = parts.filter(p => p.functionCall);
    return new AIResponse({
      text, model, provider: 'gemini',
      inputTokens: data.usageMetadata?.promptTokenCount || 0, outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      toolCalls: fnCalls.map(p => ({ id: `gemini_${Date.now()}`, name: p.functionCall.name, arguments: p.functionCall.args || {} })),
      finishReason: candidate?.finishReason === 'STOP' ? 'stop' : candidate?.finishReason, raw: data,
    });
  }

  async *stream(request) {
    const model = request.model || this.config.model || 'gemini-2.0-flash';
    let text = '', inputTokens = 0, outputTokens = 0, toolCalls = [];
    for await (const line of this._stream(this._url(model, 'streamGenerateContent', true), this._buildBody(request))) {
      if (!line.startsWith('data: ')) continue;
      let evt; try { evt = JSON.parse(line.slice(6)); } catch { continue; }
      for (const part of evt.candidates?.[0]?.content?.parts || []) {
        if (part.text) { text += part.text; yield AIStreamEvent.delta(part.text); }
        if (part.functionCall) { const tc = { id: `gemini_${Date.now()}`, name: part.functionCall.name, arguments: part.functionCall.args || {} }; toolCalls.push(tc); yield AIStreamEvent.toolCall(tc); }
      }
      if (evt.usageMetadata) { inputTokens = evt.usageMetadata.promptTokenCount || inputTokens; outputTokens = evt.usageMetadata.candidatesTokenCount || outputTokens; }
    }
    yield AIStreamEvent.complete(new AIResponse({ text, model, provider: 'gemini', inputTokens, outputTokens, toolCalls, finishReason: 'stop' }));
  }

  async embed(texts, model = null) {
    const m = model || this.config.embeddingModel || 'text-embedding-004'; const items = Array.isArray(texts) ? texts : [texts];
    return Promise.all(items.map(async text => {
      const data = await this._post(this._url(m, 'embedContent'), { model: m, content: { parts: [{ text }] } });
      return data.embedding.values;
    }));
  }

  async image(request) {
    // Use gemini-2.0-flash-preview-image-generation via the standard Developer API
    // (works with a regular Gemini API key from Google AI Studio)
    const model = request.model || this.config.imageModel || 'gemini-2.5-flash-image';

    const body = {
      contents: [{ parts: [{ text: request.prompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(request.n ? { candidateCount: request.n } : {}),
      },
    };

    const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this._apiKey()}`;
    const data = await this._post(url, body);

    const images = [];
    const urls   = [];

    for (const candidate of data.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData?.data) {
          images.push(Buffer.from(part.inlineData.data, 'base64'));
        }
        if (part.fileData?.fileUri) {
          urls.push(part.fileData.fileUri);
        }
      }
    }

    if (!images.length && !urls.length) {
      const errMsg = data.candidates?.[0]?.finishReason || JSON.stringify(data).slice(0, 200);
      throw new AIProviderError('gemini', `Image generation returned no images. Reason: ${errMsg}`);
    }

    return { images, urls, provider: 'gemini', model };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama (local models)
// ─────────────────────────────────────────────────────────────────────────────

class OllamaDriver extends BaseDriver {
  get name() { return 'ollama'; }
  _baseUrl() { return (this.config.baseUrl || this.config.url || 'http://localhost:11434') + '/api'; }

  async complete(request) {
    const body = { model: request.model || this.config.model || 'llama3.2', messages: request.messages, stream: false,
      options: { ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.topP !== undefined ? { top_p: request.topP } : {}), ...(request.maxTokens ? { num_predict: request.maxTokens } : {}) } };
    const data = await this._post(`${this._baseUrl()}/chat`, body);
    return new AIResponse({ text: data.message?.content || '', model: data.model, provider: 'ollama', inputTokens: data.prompt_eval_count || 0, outputTokens: data.eval_count || 0, finishReason: data.done ? 'stop' : 'unknown', raw: data });
  }

  async *stream(request) {
    const body = { model: request.model || this.config.model || 'llama3.2', messages: request.messages, stream: true };
    let text = '', inputTokens = 0, outputTokens = 0;
    for await (const line of this._stream(`${this._baseUrl()}/chat`, body)) {
      if (!line.trim()) continue; let evt; try { evt = JSON.parse(line); } catch { continue; }
      if (evt.message?.content) { text += evt.message.content; yield AIStreamEvent.delta(evt.message.content); }
      if (evt.done) { inputTokens = evt.prompt_eval_count || 0; outputTokens = evt.eval_count || 0; }
    }
    yield AIStreamEvent.complete(new AIResponse({ text, model: body.model, provider: 'ollama', inputTokens, outputTokens, finishReason: 'stop' }));
  }

  async embed(texts, model = null) {
    const m = model || this.config.embeddingModel || 'nomic-embed-text'; const items = Array.isArray(texts) ? texts : [texts];
    return Promise.all(items.map(async text => { const data = await this._post(`${this._baseUrl()}/embed`, { model: m, input: text }); return data.embeddings?.[0] || data.embedding || []; }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Groq (OpenAI-compatible, ultra-fast inference)
// ─────────────────────────────────────────────────────────────────────────────

class GroqDriver extends OpenAIDriver {
  get name() { return 'groq'; }
  _apiKey() { const key = this.config.apiKey || process.env.GROQ_API_KEY; if (!key) throw new AIError('Groq API key not set. Use GROQ_API_KEY.', 'groq'); return key; }
  _baseUrl() { return this.config.url || 'https://api.groq.com/openai/v1'; }
  _buildBody(request) { const body = super._buildBody(request); body.model = request.model || this.config.model || 'llama-3.3-70b-versatile'; return body; }
  async image()       { throw new AIProviderError('groq', 'Groq does not support image generation.'); }
  async tts()         { throw new AIProviderError('groq', 'Groq does not support TTS.'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mistral
// ─────────────────────────────────────────────────────────────────────────────

class MistralDriver extends OpenAIDriver {
  get name() { return 'mistral'; }
  _apiKey() { const key = this.config.apiKey || process.env.MISTRAL_API_KEY; if (!key) throw new AIError('Mistral API key not set. Use MISTRAL_API_KEY.', 'mistral'); return key; }
  _baseUrl() { return this.config.url || 'https://api.mistral.ai/v1'; }
  _buildBody(request) { const body = super._buildBody(request); body.model = request.model || this.config.model || 'mistral-large-latest'; return body; }

  async embed(texts, model = null) {
    const body = { model: model || this.config.embeddingModel || 'mistral-embed', input: Array.isArray(texts) ? texts : [texts], encoding_format: 'float' };
    const data = await this._post(`${this._baseUrl()}/embeddings`, body, this._authHeaders());
    return data.data.map(d => d.embedding);
  }

  async transcribe(request) {
    const form = new FormData();
    form.append('model', request.model || 'mistral-stt');
    form.append('file',  new Blob([request.audio], { type: request.mimeType || 'audio/mpeg' }), request.filename || 'audio.mp3');
    const data = await this._postForm(`${this._baseUrl()}/audio/transcriptions`, form, this._authHeaders());
    return { text: data.text, provider: 'mistral' };
  }

  async image() { throw new AIProviderError('mistral', 'Mistral does not support image generation.'); }
  async tts()   { throw new AIProviderError('mistral', 'Mistral does not support TTS.'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// xAI (Grok)
// ─────────────────────────────────────────────────────────────────────────────

class XAIDriver extends OpenAIDriver {
  get name() { return 'xai'; }
  _apiKey() { const key = this.config.apiKey || process.env.XAI_API_KEY; if (!key) throw new AIError('xAI API key not set. Use XAI_API_KEY.', 'xai'); return key; }
  _baseUrl() { return this.config.url || 'https://api.x.ai/v1'; }
  _buildBody(request) { const body = super._buildBody(request); body.model = request.model || this.config.model || 'grok-3'; return body; }

  async image(request) {
    const body = { model: request.model || this.config.imageModel || 'aurora', prompt: request.prompt, n: request.n || 1, response_format: 'b64_json' };
    const data = await this._post(`${this._baseUrl()}/images/generations`, body, this._authHeaders());
    return { images: data.data.map(d => Buffer.from(d.b64_json, 'base64')), provider: 'xai', model: body.model };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DeepSeek
// ─────────────────────────────────────────────────────────────────────────────

class DeepSeekDriver extends OpenAIDriver {
  get name() { return 'deepseek'; }
  _apiKey() { const key = this.config.apiKey || process.env.DEEPSEEK_API_KEY; if (!key) throw new AIError('DeepSeek API key not set. Use DEEPSEEK_API_KEY.', 'deepseek'); return key; }
  _baseUrl() { return this.config.url || 'https://api.deepseek.com/v1'; }
  _buildBody(request) { const body = super._buildBody(request); body.model = request.model || this.config.model || 'deepseek-chat'; return body; }
  async image() { throw new AIProviderError('deepseek', 'DeepSeek does not support image generation.'); }
  async tts()   { throw new AIProviderError('deepseek', 'DeepSeek does not support TTS.'); }
  async embed() { throw new AIProviderError('deepseek', 'DeepSeek does not support embeddings.'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Azure OpenAI
// ─────────────────────────────────────────────────────────────────────────────

class AzureDriver extends BaseDriver {
  get name() { return 'azure'; }

  _apiKey() { const key = this.config.apiKey || process.env.AZURE_OPENAI_API_KEY; if (!key) throw new AIError('Azure OpenAI API key not set. Use AZURE_OPENAI_API_KEY.', 'azure'); return key; }
  _baseUrl() {
    const endpoint   = this.config.endpoint || process.env.AZURE_OPENAI_ENDPOINT;
    const deployment = this.config.deployment || process.env.AZURE_OPENAI_DEPLOYMENT;
    const version    = this.config.apiVersion || '2024-02-01';
    if (!endpoint || !deployment) throw new AIError('Azure requires config.endpoint and config.deployment.', 'azure');
    return `${endpoint}/openai/deployments/${deployment}`;
  }
  _authHeaders() { return { 'api-key': this._apiKey() }; }

  async complete(request) {
    const body = {
      messages:    request.messages,
      max_tokens:  request.maxTokens,
      temperature: request.temperature,
      top_p:       request.topP,
    };
    const version = this.config.apiVersion || '2024-02-01';
    const data = await this._post(`${this._baseUrl()}/chat/completions?api-version=${version}`, body, this._authHeaders());
    const choice = data.choices?.[0];
    return new AIResponse({ text: choice?.message?.content || '', model: this.config.deployment, provider: 'azure', inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0, finishReason: choice?.finish_reason, raw: data });
  }

  async *stream(request) {
    const version = this.config.apiVersion || '2024-02-01';
    const body = { messages: request.messages, stream: true, max_tokens: request.maxTokens, temperature: request.temperature };
    let text = '';
    for await (const line of this._stream(`${this._baseUrl()}/chat/completions?api-version=${version}`, body, this._authHeaders())) {
      if (!line.startsWith('data: ')) continue; const raw = line.slice(6).trim(); if (raw === '[DONE]') break;
      let evt; try { evt = JSON.parse(raw); } catch { continue; }
      const content = evt.choices?.[0]?.delta?.content; if (content) { text += content; yield AIStreamEvent.delta(content); }
    }
    yield AIStreamEvent.complete(new AIResponse({ text, model: this.config.deployment, provider: 'azure', finishReason: 'stop' }));
  }

  async embed(texts, model = null) {
    const version = this.config.apiVersion || '2024-02-01';
    const body = { input: Array.isArray(texts) ? texts : [texts] };
    const deploymentEmbed = model || this.config.embeddingDeployment || this.config.deployment;
    const endpoint = this.config.endpoint || process.env.AZURE_OPENAI_ENDPOINT;
    const data = await this._post(`${endpoint}/openai/deployments/${deploymentEmbed}/embeddings?api-version=${version}`, body, this._authHeaders());
    return data.data.map(d => d.embedding);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cohere (embeddings + reranking)
// ─────────────────────────────────────────────────────────────────────────────

class CohereDriver extends BaseDriver {
  get name() { return 'cohere'; }
  _apiKey() { const key = this.config.apiKey || process.env.COHERE_API_KEY; if (!key) throw new AIError('Cohere API key not set. Use COHERE_API_KEY.', 'cohere'); return key; }
  _baseUrl() { return this.config.url || 'https://api.cohere.com/v2'; }
  _authHeaders() { return { Authorization: `Bearer ${this._apiKey()}` }; }

  async complete(request) {
    const body = {
      model:    request.model || this.config.model || 'command-r-plus-08-2024',
      messages: request.messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user', content: m.content })),
      max_tokens: request.maxTokens, temperature: request.temperature,
    };
    const data = await this._post(`${this._baseUrl()}/chat`, body, this._authHeaders());
    return new AIResponse({ text: data.message?.content?.[0]?.text || '', model: data.model, provider: 'cohere', inputTokens: data.usage?.tokens?.input_tokens || 0, outputTokens: data.usage?.tokens?.output_tokens || 0, finishReason: 'stop', raw: data });
  }

  async *stream(request) {
    const body = { model: request.model || this.config.model || 'command-r-plus-08-2024', messages: request.messages.map(m => ({ role: m.role, content: m.content })), stream: true };
    let text = '';
    for await (const line of this._stream(`${this._baseUrl()}/chat`, body, this._authHeaders())) {
      if (!line.startsWith('data: ')) continue; let evt; try { evt = JSON.parse(line.slice(6)); } catch { continue; }
      if (evt.type === 'content-delta') { const t = evt.delta?.message?.content?.text || ''; text += t; if (t) yield AIStreamEvent.delta(t); }
    }
    yield AIStreamEvent.complete(new AIResponse({ text, provider: 'cohere', finishReason: 'stop' }));
  }

  async embed(texts, model = null) {
    const body = { model: model || this.config.embeddingModel || 'embed-v4.0', texts: Array.isArray(texts) ? texts : [texts], input_type: 'search_document', embedding_types: ['float'] };
    const data = await this._post(`${this._baseUrl()}/embed`, body, this._authHeaders());
    return data.embeddings?.float || [];
  }

  async rerank(request) {
    const body = { model: request.model || this.config.rerankModel || 'rerank-v3.5', query: request.query, documents: request.documents, top_n: request.limit || request.documents.length };
    const data = await this._post(`${this._baseUrl()}/rerank`, body, this._authHeaders());
    return data.results.map(r => ({ index: r.index, score: r.relevance_score, document: request.documents[r.index] }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ElevenLabs (TTS + STT)
// ─────────────────────────────────────────────────────────────────────────────

class ElevenLabsDriver extends BaseDriver {
  get name() { return 'elevenlabs'; }
  _apiKey() { const key = this.config.apiKey || process.env.ELEVENLABS_API_KEY; if (!key) throw new AIError('ElevenLabs API key not set. Use ELEVENLABS_API_KEY.', 'elevenlabs'); return key; }
  _baseUrl() { return this.config.url || 'https://api.elevenlabs.io/v1'; }
  _authHeaders() { return { 'xi-api-key': this._apiKey() }; }

  async tts(request) {
    const voiceId = request.voice || this.config.defaultVoice || '21m00Tcm4TlvDq8ikWAM'; // Rachel
    const body = {
      text:           request.text,
      model_id:       request.model || this.config.model || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    };
    const res = await this._postRaw(`${this._baseUrl()}/text-to-speech/${voiceId}`, body, this._authHeaders());
    const buf = Buffer.from(await res.arrayBuffer());
    return { audio: buf, format: 'mp3', provider: 'elevenlabs' };
  }

  async transcribe(request) {
    const form = new FormData();
    form.append('model_id', request.model || 'scribe_v1');
    form.append('file', new Blob([request.audio], { type: request.mimeType || 'audio/mpeg' }), request.filename || 'audio.mp3');
    if (request.diarize) form.append('diarize', 'true');
    const data = await this._postForm(`${this._baseUrl()}/speech-to-text`, form, this._authHeaders());
    return { text: data.text, words: data.words || [], speakers: data.speakers || [], provider: 'elevenlabs' };
  }

  async complete() { throw new AIProviderError('elevenlabs', 'ElevenLabs is an audio provider — use tts() and transcribe() instead.'); }
  async embed()    { throw new AIProviderError('elevenlabs', 'ElevenLabs does not support embeddings.'); }
}

module.exports = {
  BaseDriver,
  AnthropicDriver, OpenAIDriver, GeminiDriver, OllamaDriver,
  GroqDriver, MistralDriver, XAIDriver, DeepSeekDriver, AzureDriver,
  CohereDriver, ElevenLabsDriver,
};