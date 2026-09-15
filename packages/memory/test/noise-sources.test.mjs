import test from "node:test";
import assert from "node:assert/strict";
import { NOISE_SOURCES } from "../src/index.js";
test("NOISE_SOURCES lists WhatsApp captures and Codex transcript labels", () => {
  for (const s of ["wa-primary", "siti-wa", "codex-transcript", "codex-neo-mbp"]) assert.ok(NOISE_SOURCES.includes(s), s);
  assert.ok(Object.isFrozen(NOISE_SOURCES));
  for (const s of ["claude_code", "kb", "night-shift"]) assert.ok(!NOISE_SOURCES.includes(s), s);
});
