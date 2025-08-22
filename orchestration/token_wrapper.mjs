#!/usr/bin/env node

/**
 * Token Telemetry Wrapper
 * Optional telemetry for LLM calls with cost estimation
 */

// Model pricing (per 1K tokens)
const PRICING = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'default': { input: 0.01, output: 0.03 }
};

/**
 * Estimate cost based on token counts
 */
function estimateCost(tokensIn, tokensOut, model = 'default') {
  const pricing = PRICING[model] || PRICING.default;
  const inputCost = (tokensIn / 1000) * pricing.input;
  const outputCost = (tokensOut / 1000) * pricing.output;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    model
  };
}

/**
 * Wrap a function that calls an LLM to capture metrics
 * @param {string} label - Label for this LLM call
 * @param {Function} fn - Async function that calls the LLM
 * @returns {object} - Result with token metrics
 */
export async function withLLMMetrics(label, fn) {
  // Disable the global stdout hijack in parallel phases to avoid races
  // Also disable entirely when CTK_LLM_WRAP is not enabled
  if (process.env.CTK_LLM_WRAP !== '1' || process.env.CTK_PARALLEL_PHASE === '1') {
    const result = await fn();
    return { result, tokensIn: 0, tokensOut: 0, costEst: 0 };
  }
  
  const startTime = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;
  let model = 'default';
  
  try {
    // Hook into stdout to capture metrics if tool prints them
    const originalWrite = process.stdout.write;
    const capturedLines = [];
    
    process.stdout.write = function(chunk, encoding, callback) {
      const str = chunk.toString();
      capturedLines.push(str);
      
      // Try to parse JSON metrics from output
      try {
        const lines = str.split('\n');
        for (const line of lines) {
          if (line.includes('llm_tokens_in') || line.includes('llm_tokens_out')) {
            const json = JSON.parse(line);
            if (json.llm_tokens_in) tokensIn += json.llm_tokens_in;
            if (json.llm_tokens_out) tokensOut += json.llm_tokens_out;
            if (json.llm_model) model = json.llm_model;
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
      
      return originalWrite.call(this, chunk, encoding, callback);
    };
    
    // Execute the wrapped function
    const result = await fn();
    
    // Restore stdout
    process.stdout.write = originalWrite;
    
    // Calculate cost estimate
    const cost = estimateCost(tokensIn, tokensOut, model);
    
    // Log telemetry (counters only, no content)
    if (tokensIn > 0 || tokensOut > 0) {
      console.log(`[LLM:${label}] Tokens: ${tokensIn} in, ${tokensOut} out | Cost: $${cost.totalCost.toFixed(4)} | ${Date.now() - startTime}ms`);
    }
    
    return {
      result,
      tokensIn,
      tokensOut,
      costEst: cost.totalCost
    };
    
  } catch (error) {
    // Ensure stdout is restored on error
    if (process.stdout.write !== originalWrite) {
      process.stdout.write = originalWrite;
    }
    throw error;
  }
}

/**
 * Parse stdio for LLM metrics pattern
 * @param {string} output - Tool stdout/stderr
 * @returns {object} - Extracted metrics or zeros
 */
export function parseStdioMetrics(output) {
  let tokensIn = 0;
  let tokensOut = 0;
  let model = 'default';
  
  if (!output) return { tokensIn, tokensOut, costEst: 0 };
  
  // Look for JSON lines with metrics
  const lines = output.split('\n');
  for (const line of lines) {
    try {
      // Common patterns:
      // {"llm_tokens_in":150,"llm_tokens_out":75,"llm_model":"gpt-4"}
      // {"metrics":{"tokens":{"input":100,"output":50}}}
      
      if (line.includes('llm_tokens') || line.includes('tokens')) {
        const json = JSON.parse(line);
        
        // Direct format
        if (json.llm_tokens_in) tokensIn += json.llm_tokens_in;
        if (json.llm_tokens_out) tokensOut += json.llm_tokens_out;
        if (json.llm_model) model = json.llm_model;
        
        // Nested format
        if (json.metrics?.tokens) {
          if (json.metrics.tokens.input) tokensIn += json.metrics.tokens.input;
          if (json.metrics.tokens.output) tokensOut += json.metrics.tokens.output;
        }
      }
    } catch (e) {
      // Not JSON or parse error, skip
    }
  }
  
  const cost = estimateCost(tokensIn, tokensOut, model);
  
  return {
    tokensIn,
    tokensOut,
    costEst: cost.totalCost
  };
}

/**
 * Initialize token tracking for a session
 */
export function initTokenTracking() {
  global.CTK_TOKEN_TOTALS = {
    tokensIn: 0,
    tokensOut: 0,
    totalCost: 0,
    callCount: 0
  };
}

/**
 * Get session token totals
 */
export function getTokenTotals() {
  return global.CTK_TOKEN_TOTALS || {
    tokensIn: 0,
    tokensOut: 0,
    totalCost: 0,
    callCount: 0
  };
}

/**
 * Update session totals
 */
export function updateTokenTotals(tokensIn, tokensOut, cost) {
  if (!global.CTK_TOKEN_TOTALS) {
    initTokenTracking();
  }
  
  global.CTK_TOKEN_TOTALS.tokensIn += tokensIn;
  global.CTK_TOKEN_TOTALS.tokensOut += tokensOut;
  global.CTK_TOKEN_TOTALS.totalCost += cost;
  global.CTK_TOKEN_TOTALS.callCount++;
}

export default {
  withLLMMetrics,
  parseStdioMetrics,
  estimateCost,
  initTokenTracking,
  getTokenTotals,
  updateTokenTotals
};