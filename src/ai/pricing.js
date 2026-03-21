'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Token pricing per model — USD per 1M tokens
// Updated: 2025. Check provider pricing pages for latest rates.
// ─────────────────────────────────────────────────────────────────────────────

const PRICING = {
  // ── Anthropic ───────────────────────────────────────────────────────────────
  'claude-opus-4-5':                    { input: 15.00,  output: 75.00  },
  'claude-sonnet-4-20250514':           { input: 3.00,   output: 15.00  },
  'claude-sonnet-4-5':                  { input: 3.00,   output: 15.00  },
  'claude-haiku-4-5-20251001':          { input: 0.80,   output: 4.00   },
  'claude-3-7-sonnet-20250219':         { input: 3.00,   output: 15.00  },
  'claude-3-5-sonnet-20241022':         { input: 3.00,   output: 15.00  },
  'claude-3-5-haiku-20241022':          { input: 0.80,   output: 4.00   },
  'claude-3-opus-20240229':             { input: 15.00,  output: 75.00  },

  // ── OpenAI ──────────────────────────────────────────────────────────────────
  'gpt-4o':                             { input: 2.50,   output: 10.00  },
  'gpt-4o-mini':                        { input: 0.15,   output: 0.60   },
  'gpt-4-turbo':                        { input: 10.00,  output: 30.00  },
  'gpt-4':                              { input: 30.00,  output: 60.00  },
  'gpt-3.5-turbo':                      { input: 0.50,   output: 1.50   },
  'o1':                                 { input: 15.00,  output: 60.00  },
  'o1-mini':                            { input: 3.00,   output: 12.00  },
  'o3-mini':                            { input: 1.10,   output: 4.40   },

  // ── Gemini ──────────────────────────────────────────────────────────────────
  'gemini-2.5-pro':                     { input: 1.25,   output: 10.00  },
  'gemini-2.5-flash':                   { input: 0.15,   output: 0.60   },
  'gemini-2.0-flash':                   { input: 0.10,   output: 0.40   },
  'gemini-2.0-flash-lite':              { input: 0.075,  output: 0.30   },
  'gemini-1.5-pro':                     { input: 1.25,   output: 5.00   },
  'gemini-1.5-flash':                   { input: 0.075,  output: 0.30   },

  // ── Groq ────────────────────────────────────────────────────────────────────
  'llama-3.3-70b-versatile':            { input: 0.59,   output: 0.79   },
  'llama-3.1-70b-versatile':            { input: 0.59,   output: 0.79   },
  'llama-3.1-8b-instant':               { input: 0.05,   output: 0.08   },
  'mixtral-8x7b-32768':                 { input: 0.24,   output: 0.24   },

  // ── Mistral ──────────────────────────────────────────────────────────────────
  'mistral-large-latest':               { input: 2.00,   output: 6.00   },
  'mistral-small-latest':               { input: 0.20,   output: 0.60   },
  'open-mistral-7b':                    { input: 0.25,   output: 0.25   },

  // ── DeepSeek ─────────────────────────────────────────────────────────────────
  'deepseek-chat':                      { input: 0.27,   output: 1.10   },
  'deepseek-reasoner':                  { input: 0.55,   output: 2.19   },

  // ── xAI ─────────────────────────────────────────────────────────────────────
  'grok-2':                             { input: 2.00,   output: 10.00  },
  'grok-2-mini':                        { input: 0.20,   output: 1.00   },
};

// ─────────────────────────────────────────────────────────────────────────────
// CostCalculator
// ─────────────────────────────────────────────────────────────────────────────

class CostCalculator {
  /**
   * Calculate cost for a completed response.
   *
   *   const cost = CostCalculator.forResponse(response);
   *   cost.input   // 0.0003
   *   cost.output  // 0.0015
   *   cost.total   // 0.0018
   *   cost.currency // 'USD'
   *   cost.formatted // '$0.0018'
   *
   * @param {AIResponse} response
   * @returns {{ input, output, total, currency, formatted } | null}
   */
  static forResponse(response) {
    return CostCalculator.calculate(
      response.model,
      response.inputTokens,
      response.outputTokens
    );
  }

  /**
   * Calculate cost given model and token counts.
   *
   * @param {string} model
   * @param {number} inputTokens
   * @param {number} outputTokens
   * @returns {{ input, output, total, currency, formatted } | null}
   */
  static calculate(model, inputTokens, outputTokens) {
    const pricing = CostCalculator._lookup(model);
    if (!pricing) return null;

    const input  = (inputTokens  / 1_000_000) * pricing.input;
    const output = (outputTokens / 1_000_000) * pricing.output;
    const total  = input + output;

    return {
      input:     parseFloat(input.toFixed(6)),
      output:    parseFloat(output.toFixed(6)),
      total:     parseFloat(total.toFixed(6)),
      currency:  'USD',
      formatted: `$${total.toFixed(4)}`,
    };
  }

  /**
   * Estimate cost for a prompt before sending it.
   * Uses a rough character-to-token ratio (1 token ≈ 4 chars).
   *
   *   const est = AI.estimateCost('My long prompt here...', 'claude-sonnet-4-20250514');
   *   est.estimated      // { input: 0.00003, output: 0.00015, total: 0.00018 }
   *   est.note           // 'Estimate only. Output tokens unknown.'
   *
   * @param {string}  prompt
   * @param {string}  model
   * @param {number}  [expectedOutputTokens=500]
   */
  static estimate(prompt, model, expectedOutputTokens = 500) {
    const inputTokens = Math.ceil(prompt.length / 4);
    const cost        = CostCalculator.calculate(model, inputTokens, expectedOutputTokens);
    if (!cost) return { estimated: null, note: `No pricing data for model: ${model}` };
    return {
      estimated:       cost,
      inputTokens,
      outputTokens:    expectedOutputTokens,
      note:            'Estimate only. Output tokens are approximate.',
    };
  }

  static _lookup(model) {
    if (!model) return null;
    // Exact match
    if (PRICING[model]) return PRICING[model];
    // Prefix match — handles versioned model strings like 'claude-3-5-sonnet-20241022-v2'
    for (const key of Object.keys(PRICING)) {
      if (model.startsWith(key) || key.startsWith(model.split('-').slice(0, 4).join('-'))) {
        return PRICING[key];
      }
    }
    return null;
  }

  /** Check if pricing data exists for a model. */
  static hasPricing(model) { return !!CostCalculator._lookup(model); }

  /** List all models with known pricing. */
  static supportedModels() { return Object.keys(PRICING); }
}

module.exports = { PRICING, CostCalculator };