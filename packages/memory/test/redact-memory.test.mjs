// Tests for NeoBrain.redactMemory + the _extractCredentialMatches helper.
//
// Run: node --test --no-warnings packages/memory/test/redact-memory.test.mjs
//
// The pure-function tests for _extractCredentialMatches run without any env.
// The integration test requires NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY +
// GEMINI_API_KEY; it inserts a fixture memory, redacts it, asserts, then
// archives the fixture (no orphan rows left behind).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NeoBrain, _extractCredentialMatches } from '../src/index.js';

// ── Pure-function tests · _extractCredentialMatches ──────────────────

test('extract: empty / non-string input returns empty set', () => {
  assert.equal(_extractCredentialMatches('').size, 0);
  assert.equal(_extractCredentialMatches(null).size, 0);
  assert.equal(_extractCredentialMatches(undefined).size, 0);
});

test('extract: sk-ant-api03 key is captured', () => {
  const s = _extractCredentialMatches('key: sk-ant-api03-' + 'a'.repeat(40));
  assert.equal(s.size, 1);
  const v = [...s][0];
  assert.ok(v.startsWith('sk-ant-api03-'));
});

test('extract: github_pat new-style is captured', () => {
  const s = _extractCredentialMatches('token: github_pat_' + '1'.repeat(40));
  assert.equal(s.size, 1);
});

test('extract: JWT-shaped (3 dot-separated base64 segs) is captured', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const s = _extractCredentialMatches(jwt);
  assert.equal(s.size, 1);
});

test('extract: vault pointer is NOT flagged as a credential', () => {
  const pointer = '→ vault: service=anthropic, type=api_key_legacy_2025_06';
  assert.equal(_extractCredentialMatches(pointer).size, 0);
});

test('extract: regex documentation is NOT flagged', () => {
  // The regex pattern literal — contains the prefix but not 20+ matching chars
  const docs = 'Pattern: /sk-ant-api03-[A-Za-z0-9_-]+/g';
  assert.equal(_extractCredentialMatches(docs).size, 0);
});

test('extract: multiple distinct secrets are all captured', () => {
  const txt = [
    'sk-ant-api03-' + 'a'.repeat(40),
    'sk-ant-api03-' + 'b'.repeat(40),
    'eyJ' + 'a'.repeat(20) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(20),
  ].join(' ');
  const s = _extractCredentialMatches(txt);
  assert.equal(s.size, 3);
});

// ── Integration test · NeoBrain.redactMemory ─────────────────────────

const haveEnv = process.env.NEO_BRAIN_URL && process.env.NEO_BRAIN_SERVICE_ROLE_KEY && process.env.GEMINI_API_KEY;

test('integration: redactMemory removes secret, re-embeds, logs, refuses bad redaction', { skip: !haveEnv }, async (t) => {
  const brain = new NeoBrain({ agent: 'redact-memory-test' });

  // 1. Insert a fixture memory containing a fake "sk-ant-api03" key
  const FAKE_KEY = 'sk-ant-api03-TESTFIXTURE' + 'x'.repeat(40);
  const FIXTURE_CONTENT = `Fixture for redactMemory test. Should never reach production retrieval. Embedded fake key: ${FAKE_KEY}.`;
  const inserted = await brain.save(FIXTURE_CONTENT, {
    category: '__test_redact__',
    type: 'fixture',
    importance: 7,
    visibility: 'private',
  });
  t.diagnostic(`fixture memory inserted: ${inserted.id}`);

  // 2. Negative case — newContent still contains the old secret. Must refuse.
  await assert.rejects(
    brain.redactMemory(inserted.id, {
      newContent: `Attempted redaction that still leaks ${FAKE_KEY}`,
      newImportance: 3,
      reason: 'negative-test',
    }),
    /SAFETY|still present verbatim/,
    'expected redactMemory to refuse when old secret is still in newContent',
  );

  // 3. Positive case — newContent removes the secret, replaced with vault pointer
  const NEW_CONTENT = 'Fixture for redactMemory test. Fake key moved to → vault: service=test, type=fixture_key. (Redacted.)';
  const updated = await brain.redactMemory(inserted.id, {
    newContent: NEW_CONTENT,
    newImportance: 3,
    newVisibility: 'private',
    reason: 'positive-test',
  });

  // 4. Assertions
  assert.equal(updated.id, inserted.id, 'id unchanged');
  assert.equal(updated.content, NEW_CONTENT, 'content rewritten');
  assert.equal(updated.importance, 3, 'importance updated');
  assert.equal(updated.visibility, 'private', 'visibility set');
  assert.ok(updated.embedding, 'embedding present');
  assert.ok(!updated.content.includes(FAKE_KEY), 'fake key gone from content');

  // 5. Verify memory_writes_log row exists with action=redact
  // (use the supabase client embedded in the SDK instance — minor leak of
  // internal but acceptable for assertion in a test)
  const { data: logRows } = await brain.sb
    .from('memory_writes_log')
    .select('action, written_by, payload_preview')
    .eq('memory_id', inserted.id)
    .eq('action', 'redact');
  assert.ok(logRows && logRows.length >= 1, 'redact log row exists');
  assert.equal(logRows[0].written_by, 'redact-memory-test');

  // 6. Cleanup — archive the fixture so it doesn't pollute production
  await brain.archive(inserted.id);
});
