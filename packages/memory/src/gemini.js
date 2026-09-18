// Embedding for the CTK memory SDK (@todak/memory).
//
// 2026-09-18: neo-brain migrated to a LOCAL embedding model (qwen3-embedding:4b,
// truncated to 768) served by Ollama on EdgeXpert. This SDK is used by Claude Code
// sessions and agents across machines, so it now:
//   1. tries the LOCAL model first (default EdgeXpert over the tailnet), then
//   2. falls back to Google Gemini online if the local model is unreachable.
// Every vector is truncated to `dims` (768) and L2-normalised, so whatever produced
// it stays comparable (cosine) with the rest of the migrated brain.
//
// Config (env, all overridable):
//   EMBED_PROVIDER      'ollama' (default, local-first) | 'gemini' (force online)
//   EMBED_OLLAMA_URL    default http://100.90.58.53:11434  (EdgeXpert tailnet)
//   EMBED_OLLAMA_MODEL  default qwen3-embedding:4b
//   EMBED_DIM           default 768 (matches the neo-brain vector(768) column)
//   GEMINI_API_KEY      used for the online fallback (and when provider=gemini)
const DEFAULT_MODEL = "gemini-embedding-001";
const DEFAULT_DIMS = Number(process.env.EMBED_DIM || 768);
const MAX_CHARS = 2048;
const BACKOFF_MS = [400, 1200, 3000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const provider = () => (process.env.EMBED_PROVIDER || "ollama").toLowerCase();
const ollamaUrl = () => (process.env.EMBED_OLLAMA_URL || "http://100.90.58.53:11434").replace(/\/$/, "") + "/api/embed";
const ollamaModel = () => process.env.EMBED_OLLAMA_MODEL || "qwen3-embedding:4b";

function finalize(vec, dims) {
  const w = vec.length > dims ? vec.slice(0, dims) : vec;
  let n = 0; for (const x of w) n += x * x; n = Math.sqrt(n) || 1;
  return w.map((x) => x / n);
}

// Local Ollama. Few retries so an unreachable host falls back to Gemini quickly.
async function ollamaChunk(chunk, dims, timeoutMs) {
  for (let attempt = 0; attempt <= 1; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[0]);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(ollamaUrl(), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: ollamaModel(), input: chunk, keep_alive: "30m" }),
        signal: ctrl.signal,
      });
      if (r.ok) {
        const d = await r.json();
        const v = (Array.isArray(d?.embeddings) && d.embeddings[0]) || d?.embedding;
        if (v && v.length) return finalize(v, dims);
      } else if (r.status >= 400 && r.status < 500 && r.status !== 429) {
        return null; // model missing / bad request — fall back
      }
    } catch { /* connection refused / timeout → fall back */ } finally { clearTimeout(t); }
  }
  return null;
}

async function geminiChunk(chunk, { apiKey, model, dims, timeoutMs }) {
  if (!apiKey) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
  let lastErr = null;
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text: chunk }] }, outputDimensionality: dims }),
        signal: ctrl.signal,
      });
      if (r.ok) { const vals = (await r.json())?.embedding?.values; if (vals) return finalize(vals, dims); lastErr = "no values"; continue; }
      if (r.status !== 429 && r.status >= 400 && r.status < 500) throw new Error(`gemini embed ${r.status}: ${(await r.text()).slice(0, 160)}`);
      lastErr = `http ${r.status}`;
    } catch (e) { if (e.message?.startsWith("gemini embed 4")) throw e; lastErr = e.message; } finally { clearTimeout(t); }
  }
  throw new Error(`gemini embed failed after retries: ${lastErr}`);
}

async function embedChunk(chunk, opts) {
  if (provider() === "ollama") {
    const v = await ollamaChunk(chunk, opts.dims, opts.timeoutMs);
    if (v) return v;
    if (opts.apiKey) return geminiChunk(chunk, opts); // online fallback
    throw new Error("embed unavailable: local Ollama unreachable and no GEMINI_API_KEY for fallback");
  }
  return geminiChunk(chunk, opts);
}

export async function embedText(text, {
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_EMBED_MODEL || DEFAULT_MODEL,
  dims = DEFAULT_DIMS,
  timeoutMs = 15000,
} = {}) {
  if (!text?.trim()) return null;
  if (provider() !== "ollama" && !apiKey) throw new Error("GEMINI_API_KEY not set");
  const opts = { apiKey, model, dims, timeoutMs };

  if (text.length <= MAX_CHARS) return embedChunk(text, opts);

  const embeddings = [];
  for (let i = 0; i < text.length; i += MAX_CHARS) {
    const e = await embedChunk(text.slice(i, i + MAX_CHARS), opts);
    if (!e) return null;
    embeddings.push(e);
  }
  const pooled = embeddings[0].map((_, i) => embeddings.reduce((s, e) => s + e[i], 0) / embeddings.length);
  const norm = Math.sqrt(pooled.reduce((s, v) => s + v * v, 0));
  return norm ? pooled.map((v) => v / norm) : pooled;
}

export function toPgVectorString(values) {
  if (!values || !Array.isArray(values)) return null;
  return `[${values.join(",")}]`;
}
