import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _extractCredentialMatches } from '../../packages/memory/src/client.js';
import { capture, chunks, drain, enqueuePointer, hash, jobs, readJson, recall, redact, status, visibleMessage, writeJson, writeNewJson } from './core.mjs';

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-memory-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, 'ctk');
  fs.mkdirSync(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions', 'rollout.jsonl');
  const input = { session_id: 'test-session', transcript_path: file, cwd: '/workspace/example' };
  const records = [{ type: 'session_meta', payload: { id: input.session_id } }];
  const write = () => fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  const options = { codexHome: home, clean: s => redact(s, _extractCredentialMatches), agent: 'codex-unit-test' };
  return { home, root, file, input, records, write, options };
}
const message = (role, text, extra = {}) => ({ timestamp: '2026-09-13T00:00:00Z', type: 'response_item',
  payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }], ...extra } });

test('capture includes full visible chat, excludes tools, reasoning, injected context and compaction replay', async t => {
  const s = setup(t);
  s.records.push(message('user', 'Owner request'), message('assistant', 'Working', { phase: 'commentary' }),
    message('assistant', 'Verified result', { phase: 'final_answer' }),
    message('developer', 'Secret instructions'), message('user', '<environment_context>system facts</environment_context>'),
    { type: 'response_item', payload: { type: 'reasoning', summary: ['private'] } },
    { type: 'response_item', payload: { type: 'function_call_output', output: 'tool output' } },
    { type: 'compacted', payload: { replacement_history: [message('user', 'duplicated')] } });
  s.write();
  const result = await capture(s.root, s.input, s.options);
  assert.equal(result.messages, 3);
  assert.equal(jobs(s.root).length, 3);
  assert.ok(jobs(s.root).every(x => !/Secret|duplicated|private|tool output/.test(x.job.content)));
  await capture(s.root, s.input, s.options);
  assert.equal(jobs(s.root).length, 3);
});

test('appending to an active transcript captures just new messages and preserves Unicode', async t => {
  const s = setup(t), text = 'Hai 🛥️ '.repeat(900);
  s.records.push(message('user', text)); s.write();
  await capture(s.root, s.input, s.options);
  const parts = jobs(s.root).map(x => x.job).sort((a, b) => a.opts.sourceRef.part - b.opts.sourceRef.part);
  assert.equal(parts.map(x => x.content.split('\n').slice(2).join('\n')).join(''), text);
  s.records.push(message('assistant', 'new final', { phase: 'final_answer' })); s.write();
  await capture(s.root, s.input, s.options);
  assert.equal(jobs(s.root).length, parts.length + 1);
  assert.equal(chunks('😀'.repeat(1500)).join(''), '😀'.repeat(1500));
});

test('partial JSON append never advances checkpoint or drops the message on retry', async t => {
  const s = setup(t); s.records.push(message('user', 'hello')); s.write();
  await capture(s.root, s.input, s.options);
  const before = readJson(path.join(s.root, 'sessions', 'test-session.json'));
  fs.appendFileSync(s.file, '{"type":');
  await assert.rejects(capture(s.root, s.input, s.options), /incomplete/);
  assert.deepEqual(readJson(path.join(s.root, 'sessions', 'test-session.json')), before);
  s.records.push(message('assistant', 'recovered')); s.write();
  await capture(s.root, s.input, s.options);
  assert.equal(jobs(s.root).length, 2);
});

test('rejects outside paths, symlink escapes, wrong session ids and missing metadata', async t => {
  const s = setup(t); s.write();
  await assert.rejects(capture(s.root, { ...s.input, session_id: 'different' }, s.options), /mismatch/);
  const outside = path.join(s.home, 'outside.jsonl'); fs.copyFileSync(s.file, outside);
  const link = path.join(s.home, 'sessions', 'link.jsonl'); fs.symlinkSync(outside, link);
  await assert.rejects(capture(s.root, { ...s.input, transcript_path: link }, s.options), /not allowed/);
  fs.writeFileSync(s.file, JSON.stringify(message('user', 'missing meta')) + '\n');
  await assert.rejects(capture(s.root, s.input, s.options), /missing session metadata/);
  assert.throws(() => enqueuePointer(s.root, { ...s.input, session_id: '../escape' }), /invalid/);
});

test('credentials are redacted before entering the outbox, not just before network transmission', async t => {
  const s = setup(t);
  const fake = ['ghp', '_', 'A'.repeat(36)].join('');
  s.records.push(message('user', 'Here is ' + fake + '\npassword = local-test-secret\nhttps://example.test/?token=sample-long-value'));
  s.write(); await capture(s.root, s.input, s.options);
  const contents = jobs(s.root).map(x => x.job.content).join('');
  assert.ok(!contents.includes(fake)); assert.ok(!contents.includes('local-test-secret')); assert.ok(!contents.includes('sample-long-value'));
  assert.ok(contents.includes('[REDACTED]'));
});

test('write-once queue cannot overwrite a saved receipt during concurrent capture', t => {
  const s = setup(t), file = path.join(s.root, 'outbox', 'one.json');
  writeNewJson(file, { status: 'saved', id: 'verified' });
  writeNewJson(file, { status: 'pending', content: 'stale capture' });
  assert.deepEqual(readJson(file), { status: 'saved', id: 'verified' });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('failed or unverified save stays queued with backoff; retry verifies and removes payload', async t => {
  const s = setup(t); s.records.push(message('user', 'retain me')); s.write();
  await capture(s.root, s.input, s.options);
  await drain(s.root, async () => ({ id: 'unverified' }), { now: () => 100000 });
  const failed = jobs(s.root)[0].job;
  assert.equal(failed.status, 'pending'); assert.equal(failed.nextAttempt, 130000);
  assert.ok(failed.content.includes('retain me'));
  let calls = 0;
  await drain(s.root, async () => { calls++; }, { now: () => 100001 });
  assert.equal(calls, 0);
  await drain(s.root, async () => ({ id: 'ok', verified: true, embedded: true }), { now: () => 130001 });
  assert.equal(status(s.root).pending, 0);
  assert.equal(jobs(s.root)[0].job.content, undefined);
});

test('lost response and process restart keep the same remote idempotency key', async t => {
  const s = setup(t); s.records.push(message('user', 'one write')); s.write();
  await capture(s.root, s.input, s.options);
  const keys = new Set();
  await drain(s.root, async job => { keys.add(job.key); throw new Error('response lost'); });
  await drain(s.root, async job => { keys.add(job.key); return { id: 'same', embedded: true, verified: true }; }, { force: true });
  assert.equal(keys.size, 1); assert.equal(status(s.root).saved, 1);
});

test('semantic null/empty/failure falls back to SDK handoffs, not fabricated recall', async () => {
  for (const search of [async () => [], async () => { throw new Error('embedding unavailable'); }]) {
    const result = await recall({ search, listMemories: async () => [{ id: 'handoff', content: 'verified milestone' }] }, 'task', s => s);
    assert.match(result.mode, /fallback/); assert.match(result.text, /verified milestone/);
  }
  const result = await recall({ search: async () => [], listMemories: async () => { throw new Error('offline'); } }, 'task', s => s);
  assert.equal(result.mode, 'unavailable');
});

test('shutdown enqueues a pointer only, without needing credentials or loading a transcript', t => {
  const s = setup(t); enqueuePointer(s.root, s.input);
  assert.equal(jobs(s.root).length, 0);
  assert.equal(readJson(path.join(s.root, 'requests', 'test-session.json')).transcript_path, s.file);
});

test('historical model provenance comes from its turn, never the current capture hook', async t => {
  const s = setup(t);
  s.records.push(message('user', 'unknown model'),
    { type: 'turn_context', payload: { model: 'model-before-switch', cwd: '/workspace/original' } },
    message('assistant', 'first model'));
  s.write();
  await capture(s.root, { ...s.input, model: 'current-model' }, s.options);
  const first = jobs(s.root).map(x => x.job).find(j => j.content.includes('unknown model'));
  assert.equal(first.opts.metadata.model, null);
  s.records.push(message('user', 'same old turn context')); s.write();
  await capture(s.root, { ...s.input, model: 'current-model' }, s.options);
  const latest = jobs(s.root).map(x => x.job).find(j => j.content.includes('same old turn context'));
  assert.equal(latest.opts.metadata.model, 'model-before-switch');
  assert.equal(latest.opts.metadata.session_directory, 'original');
});
