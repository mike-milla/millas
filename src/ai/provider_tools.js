'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Provider-native tools — executed by the AI provider, not your app
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebSearch — let the model search the web in real-time.
 * Supported: Anthropic, OpenAI, Gemini
 *
 *   AI.tools([new WebSearch()]).generate('What happened in tech today?')
 *   AI.tools([new WebSearch().max(5).allow(['techcrunch.com'])]).generate('...')
 */
class WebSearch {
  constructor() {
    this._max      = null;
    this._domains  = [];
    this._location = null;
    this._isProvider = true;
    this.name        = 'web_search';
    this.description = 'Search the web for real-time information.';
  }

  /** Max number of searches the model may perform. */
  max(n)             { this._max     = n;       return this; }

  /** Restrict results to specific domains. */
  allow(domains)     { this._domains = domains; return this; }

  /** Bias results toward a location. */
  location({ city, region, country } = {}) {
    this._location = { city, region, country };
    return this;
  }

  toProviderSchema(provider) {
    if (provider === 'anthropic') {
      const tool = { type: 'web_search_20250305', name: 'web_search' };
      if (this._max)      tool.max_uses           = this._max;
      if (this._domains?.length) tool.allowed_domains = this._domains;
      return tool;
    }
    if (provider === 'openai') {
      const tool = { type: 'web_search_preview' };
      if (this._location) tool.search_context_size = 'medium';
      if (this._domains?.length) tool.user_location = this._location;
      return tool;
    }
    if (provider === 'gemini') {
      return { google_search: {} };
    }
    return null;
  }
}

/**
 * WebFetch — let the model fetch and read web pages.
 * Supported: Anthropic, Gemini
 *
 *   AI.tools([new WebFetch()]).generate('Summarize https://example.com/page')
 */
class WebFetch {
  constructor() {
    this._max     = null;
    this._domains = [];
    this._isProvider = true;
    this.name        = 'web_fetch';
    this.description = 'Fetch and read the content of web pages.';
  }

  max(n)         { this._max     = n;       return this; }
  allow(domains) { this._domains = domains; return this; }

  toProviderSchema(provider) {
    if (provider === 'anthropic') {
      const tool = { type: 'web_search_20250305', name: 'web_search' };
      if (this._max) tool.max_uses = this._max;
      if (this._domains?.length) tool.allowed_domains = this._domains;
      return tool;
    }
    if (provider === 'gemini') return { url_context: {} };
    return null;
  }
}

/**
 * FileSearch — search through files in vector stores.
 * Supported: OpenAI, Gemini
 *
 *   AI.tools([new FileSearch({ stores: ['store_abc'] })]).generate('...')
 */
class FileSearch {
  constructor({ stores = [], where = null } = {}) {
    this._stores     = stores;
    this._where      = where;
    this._isProvider = true;
    this.name        = 'file_search';
    this.description = 'Search through files in vector stores.';
  }

  toProviderSchema(provider) {
    if (provider === 'openai') {
      const tool = { type: 'file_search', vector_store_ids: this._stores };
      if (this._where) tool.filters = this._where;
      return tool;
    }
    if (provider === 'gemini') {
      return { retrieval: { vertex_ai_search: { datastore: this._stores[0] } } };
    }
    return null;
  }
}

module.exports = { WebSearch, WebFetch, FileSearch };