import { test } from "node:test";
import assert from "node:assert/strict";
import { embedText, toPgVectorString } from "../src/gemini.js";

// Mock the Gemini endpoint. `perCall` yields the value each successive call
// returns (a vector, or null to simulate a failed chunk).
function mockFetch(perCall) {
  let i = 0, calls = 0;
  global.fetch = async () => {
    calls++;
    const v = typeof perCall === "function" ? perCall(i++) : perCall;
    return { ok: true, json: async () => ({ embedding: { values: v } }) };
  };
  return () => calls;
}

test("empty / whitespace text → null, no API call", async () => {
  const calls = mockFetch([1, 0]);
  assert.equal(await embedText("   ", { apiKey: "x", dims: 2 }), null);
  assert.equal(calls(), 0);
});

test("short text → exactly one call, raw (unnormalized) vector unchanged", async () => {
  const calls = mockFetch([3, 4]); // deliberately non-unit; must pass through as-is
  const out = await embedText("hi", { apiKey: "x", dims: 2 });
  assert.equal(calls(), 1);
  assert.deepEqual(out, [3, 4]);
});

test("long text (>2048) → one call per chunk, mean-pooled + unit-normalized", async () => {
  const calls = mockFetch([3, 4]);            // each chunk returns [3,4], norm 5
  const long = "a".repeat(2048 * 3 + 7);      // 4 chunks
  const out = await embedText(long, { apiKey: "x", dims: 2 });
  assert.equal(calls(), 4, "one API call per chunk");
  assert.equal(out.length, 2, "same dimensionality");
  assert.ok(Math.abs(out[0] - 0.6) < 1e-9 && Math.abs(out[1] - 0.8) < 1e-9, "mean then normalized");
  assert.ok(Math.abs(Math.hypot(...out) - 1) < 1e-9, "unit length");
});

test("a failed chunk → returns null (no silent partial embedding)", async () => {
  const calls = mockFetch((i) => (i === 1 ? null : [1, 0])); // 2nd chunk fails
  const long = "a".repeat(2048 * 2 + 1);      // 3 chunks
  assert.equal(await embedText(long, { apiKey: "x", dims: 2 }), null);
  assert.ok(calls() >= 2, "stopped at the failed chunk");
});

test("toPgVectorString formats / guards", () => {
  assert.equal(toPgVectorString([1, 2, 3]), "[1,2,3]");
  assert.equal(toPgVectorString(null), null);
});
