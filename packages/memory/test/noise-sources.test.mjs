// NOISE_SOURCES — the shared "not knowledge" source list that knowledge
// retrieval callers pass as sourceExclude. Guards the reader-side half of
// the 2026-09-15 Codex-transcript pollution fix: if a label is dropped here
// by accident, Siti's recall starts quoting chat scraps as facts again.
//
// Run: node --test --no-warnings packages/memory/test/noise-sources.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOISE_SOURCES } from '../src/index.js';

const WA = ['wa-primary', 'wa-primary-media', 'nclaw_whatsapp_conversation', 'siti-wa', 'wa-chat-importer', 'siti_group_summarizer'];
const CODEX = ['codex-transcript', 'codex-neo-mbp'];
const CC = ['claude_code_transcript'];

test('NOISE_SOURCES: exported, frozen, non-empty array of unique strings', () => {
  assert.ok(Array.isArray(NOISE_SOURCES));
  assert.ok(Object.isFrozen(NOISE_SOURCES), 'frozen so no caller mutates the shared list');
  assert.ok(NOISE_SOURCES.length >= 9);
  for (const s of NOISE_SOURCES) assert.equal(typeof s, 'string');
  assert.equal(new Set(NOISE_SOURCES).size, NOISE_SOURCES.length, 'no duplicates');
});

test('NOISE_SOURCES: contains the WhatsApp capture family', () => {
  for (const s of WA) assert.ok(NOISE_SOURCES.includes(s), `missing ${s}`);
});

test('NOISE_SOURCES: contains the Codex transcript labels (agreed + temporary)', () => {
  for (const s of CODEX) assert.ok(NOISE_SOURCES.includes(s), `missing ${s}`);
});

test('NOISE_SOURCES: contains the Claude Code transcript forward guard', () => {
  for (const s of CC) assert.ok(NOISE_SOURCES.includes(s), `missing ${s}`);
});

test('NOISE_SOURCES: never excludes the kb / curated sources', () => {
  for (const keep of ['kb', 'siti-router', 'claude_code', 'edge-cc', 'tr-home-cc']) {
    assert.ok(!NOISE_SOURCES.includes(keep), `${keep} must stay searchable`);
  }
});
