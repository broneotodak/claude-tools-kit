import { test } from "node:test";
import assert from "node:assert/strict";
import { embedText, toPgVectorString } from "../src/gemini.js";

// Route the mock by URL so we can exercise the local(Ollama)-first + Gemini-fallback logic.
function mockByUrl(handlers) {
  const orig = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/embed")) return handlers.ollama ? handlers.ollama() : { ok: false, status: 500 };
    return handlers.gemini ? handlers.gemini() : { ok: false, status: 500 };
  };
  return () => { global.fetch = orig; };
}
const okOllama = (vec) => () => ({ ok: true, json: async () => ({ embeddings: [vec] }) });
const okGemini = (vec) => () => ({ ok: true, json: async () => ({ embedding: { values: vec } }) });
const unit = (v) => Math.abs(Math.hypot(...v) - 1) < 1e-9;

test("empty / whitespace text → null, no call", async () => {
  const restore = mockByUrl({ ollama: okOllama([1, 2]) });
  try { assert.equal(await embedText("   ", { dims: 2 }), null); } finally { restore(); }
});

test("default provider is local: uses Ollama, truncates to dims + L2-normalises", async () => {
  delete process.env.EMBED_PROVIDER; // default 'ollama'
  const restore = mockByUrl({ ollama: okOllama([3, 4, 9, 9]) }); // 4-d raw, want dims=2
  try {
    const v = await embedText("hi", { dims: 2 });
    assert.equal(v.length, 2);
    assert.ok(unit(v));
    assert.deepEqual(v, [3 / 5, 4 / 5]); // prefix [3,4] normalised
  } finally { restore(); }
});

test("local down → falls back to Gemini online (with key)", async () => {
  const restore = mockByUrl({ ollama: () => ({ ok: false, status: 500 }), gemini: okGemini([6, 8]) });
  try {
    const v = await embedText("x", { apiKey: "k", dims: 2 });
    assert.deepEqual(v, [0.6, 0.8]);
  } finally { restore(); }
});

test("local down + no key → throws (no silent gap)", async () => {
  const restore = mockByUrl({ ollama: () => ({ ok: false, status: 500 }) });
  const before = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(() => embedText("x", { dims: 2 }), /unreachable/);
  } finally { restore(); if (before !== undefined) process.env.GEMINI_API_KEY = before; }
});

test("EMBED_PROVIDER=gemini forces online only", async () => {
  process.env.EMBED_PROVIDER = "gemini";
  let ollamaCalled = false;
  const restore = mockByUrl({ ollama: () => { ollamaCalled = true; return { ok: true, json: async () => ({ embeddings: [[1, 1]] }) }; }, gemini: okGemini([3, 4]) });
  try {
    const v = await embedText("x", { apiKey: "k", dims: 2 });
    assert.deepEqual(v, [0.6, 0.8]);
    assert.equal(ollamaCalled, false);
  } finally { restore(); delete process.env.EMBED_PROVIDER; }
});

test("long text (>2048) → pooled + unit-normalised", async () => {
  delete process.env.EMBED_PROVIDER;
  const restore = mockByUrl({ ollama: okOllama([1, 0]) }); // every chunk same
  try {
    const v = await embedText("a".repeat(5000), { dims: 2 });
    assert.equal(v.length, 2);
    assert.ok(unit(v));
  } finally { restore(); }
});

test("toPgVectorString formats / guards", () => {
  assert.equal(toPgVectorString([0.1, 0.2]), "[0.1,0.2]");
  assert.equal(toPgVectorString(null), null);
});
