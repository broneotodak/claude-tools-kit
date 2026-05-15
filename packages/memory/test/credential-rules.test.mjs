// Tests for the comprehensive credential registry (credential-rules.json)
// and the _extractCredentialMatches* functions that consume it.
//
// Run: node --test --no-warnings packages/memory/test/credential-rules.test.mjs
//
// No env required — all pure-function tests.
//
// Every credential-shaped fixture below is synthetic-by-construction
// (string concat — no literal secret in source), so this file is scanned
// by the pre-commit hook like any other and passes naturally.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  _extractCredentialMatches,
  _extractCredentialMatchesDetailed,
} from '../src/index.js';

const ruleset = JSON.parse(
  readFileSync(new URL('../src/credential-rules.json', import.meta.url), 'utf8'),
);

// ── Structural integrity ─────────────────────────────────────────────

test('ruleset: _meta is present and pinned to a gitleaks version', () => {
  assert.ok(ruleset._meta, '_meta block present');
  assert.match(ruleset._meta.gitleaks_version, /^v\d+\.\d+\.\d+$/);
  assert.ok(ruleset._meta.policy.includes('prefix-anchored'));
});

test('ruleset: rule_count matches the actual rules array length', () => {
  assert.equal(ruleset._meta.rule_count, ruleset.rules.length);
  assert.ok(ruleset.rules.length > 100, 'comprehensive — well over 100 rules');
});

test('ruleset: every rule has id/regex/flags/secretGroup and a compilable regex', () => {
  for (const r of ruleset.rules) {
    assert.equal(typeof r.id, 'string', `rule id is a string`);
    assert.ok(r.id.length, `rule id non-empty`);
    assert.equal(typeof r.regex, 'string', `${r.id}: regex is a string`);
    assert.ok(r.flags.includes('g'), `${r.id}: flags include g`);
    assert.equal(typeof r.secretGroup, 'number', `${r.id}: secretGroup is a number`);
    assert.doesNotThrow(() => new RegExp(r.regex, r.flags), `${r.id}: regex compiles`);
  }
});

test('ruleset: rule ids are unique', () => {
  const ids = ruleset.rules.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate rule ids');
});

test('ruleset: the 23 CTK custom rules are all present', () => {
  const custom = ruleset.rules.filter((r) => r.source === 'ctk-custom');
  assert.equal(custom.length, 23, '23 ctk-custom rules retained');
  // the two registry-expansion-event #2 additions specifically
  assert.ok(custom.some((r) => r.id === 'ctk-supabase-access-token'), 'sbp_ rule present');
  assert.ok(custom.some((r) => r.id === 'ctk-supabase-secret-key'), 'sb_secret_ rule present');
});

// ── False-positive guard — the core safety property ─────────────────
// An auto-redaction tool MUST NOT flag benign strings. These are the same
// probes the regen script uses to drop too-loose rules; asserting them here
// guards against a future rule (custom or regenerated) reintroducing noise.

const BENIGN = [
  ['40-hex git SHA',  'commit d0392a8f1c2b3e4a5d6c7b8a9e0f1a2b3c4d5e6f landed'],
  ['short git SHA',   'see d0392a8 for details'],
  ['UUID v4',         'memory id 550e8400-e29b-41d4-a716-446655440000'],
  ['32-hex blob',     'hash ' + '0123456789abcdef'.repeat(2)],
  ['64-hex blob',     'digest ' + '0123456789abcdef'.repeat(4)],
  ['base64-ish blob', 'data YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5'],
  ['long random alnum', 'ref aB3xY7zQ9wE2rT5uI8oP1aS4dF6gH0jK3lZ9xC2vB5nM8qW1eR4'],
  ['plain prose',     'the quick brown fox jumps over the lazy dog 12345'],
  ['a URL',           'https://example.com/path/to/resource?query=value123'],
  ['a file path',     '/Users/broneotodak/Projects/claude-tools-kit/src/index.js'],
];

for (const [label, text] of BENIGN) {
  test(`FP guard: benign "${label}" produces zero matches`, () => {
    const hits = [..._extractCredentialMatches(text)];
    assert.equal(hits.length, 0, `unexpected match(es): ${JSON.stringify(hits)}`);
  });
}

// ── CTK custom rules — positive + negative ──────────────────────────

test('detects: Supabase management token (sbp_ + 40 hex)', () => {
  assert.equal(_extractCredentialMatches('--access-token sbp_' + '0123456789abcdef0123456789abcdef01234567').size, 1);
  // Negative — wrong length
  assert.equal(_extractCredentialMatches('sbp_' + 'a'.repeat(10)).size, 0);
});

test('detects: Supabase secret key (sb_secret_)', () => {
  assert.equal(_extractCredentialMatches('key sb_secret_' + 'a'.repeat(30)).size, 1);
  assert.equal(_extractCredentialMatches('sb_secret_short').size, 0);
});

test('detects: Anthropic key (sk-ant-api03-)', () => {
  assert.equal(_extractCredentialMatches('sk-ant-api03-' + 'a'.repeat(40)).size, 1);
});

test('detects: Google OAuth client secret (GOCSPX-)', () => {
  assert.equal(_extractCredentialMatches('GOCSPX-' + 'a'.repeat(28)).size, 1);
});

test('detects: Twilio account SID (AC + 32 hex)', () => {
  assert.equal(_extractCredentialMatches('AC' + '0123456789abcdef'.repeat(2)).size, 1);
});

test('detects: JWT-shaped value', () => {
  const jwt = ['eyJ' + 'h'.repeat(34), 'eyJ' + 'p'.repeat(40), 's'.repeat(43)].join('.');
  assert.equal(_extractCredentialMatches(jwt).size, 1);
});

// ── Representative gitleaks rules — well-known shapes ────────────────

test('detects: GitHub PAT (ghp_ + 36)', () => {
  assert.equal(_extractCredentialMatches('token ghp_' + 'a'.repeat(36)).size, 1);
});

test('detects: AWS access key id (AKIA + 16)', () => {
  assert.equal(_extractCredentialMatches('AKIA' + 'ABCDEFGHIJKLMNOP').size, 1);
});

test('detects: Google API key (AIza + 35)', () => {
  assert.equal(_extractCredentialMatches('AIza' + 'a'.repeat(35)).size, 1);
});

// ── behaviour ───────────────────────────────────────────────────────

test('extract: empty / non-string input returns empty set', () => {
  assert.equal(_extractCredentialMatches('').size, 0);
  assert.equal(_extractCredentialMatches(null).size, 0);
  assert.equal(_extractCredentialMatches(undefined).size, 0);
});

test('extract: same secret twice in text dedupes to one Set entry', () => {
  const key = 'sk-ant-api03-' + 'a'.repeat(40);
  assert.equal(_extractCredentialMatches(`${key} and again ${key}`).size, 1);
});

test('extract: multiple distinct secrets all captured', () => {
  const txt = [
    'ghp_' + 'a'.repeat(36),
    'GOCSPX-' + 'b'.repeat(28),
    'sbp_' + '0123456789abcdef0123456789abcdef01234567',
  ].join(' \n ');
  assert.equal(_extractCredentialMatches(txt).size, 3);
});

test('detailed: returns {value, ruleId} per match', () => {
  const d = _extractCredentialMatchesDetailed('key sk-ant-api03-' + 'z'.repeat(40));
  assert.equal(d.length, 1);
  assert.equal(typeof d[0].value, 'string');
  assert.equal(typeof d[0].ruleId, 'string');
  assert.ok(d[0].value.startsWith('sk-ant-api03-'));
});

test('detailed: empty input returns empty array', () => {
  assert.deepEqual(_extractCredentialMatchesDetailed(''), []);
  assert.deepEqual(_extractCredentialMatchesDetailed(null), []);
});
