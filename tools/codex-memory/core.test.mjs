import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _extractCredentialMatches } from '../../packages/memory/src/client.js';
import { NOISE_SOURCES } from '../../packages/memory/src/index.js';
import { capture, chunks, drain, enqueuePointer, enforcePendingPolicy, hash, jobs, latestHandoff, readJson, recall, redact, RECALL_EXCLUSIONS, status, visibleMessage, writeJson, writeNewJson } from './core.mjs';

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
const message = (role, text, extra = {}) => ({ timestamp: new Date().toISOString(), type: 'response_item',
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
  const s = setup(t), text = 'Hai 🛥️ '.repeat(400);
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

test('semantic failure/no match does not inject unrelated global handoffs', async () => {
  for (const search of [async () => [], async () => { throw new Error('embedding unavailable'); }]) {
    const result = await recall({ search, listMemories: async () => { assert.fail('no global fallback'); } }, 'task', s => s);
    assert.equal(result.mode, 'unavailable');
  }
  const result = await recall({ search: async () => [], listMemories: async () => { throw new Error('offline'); } }, 'task', s => s);
  assert.equal(result.mode, 'unavailable');
});

test('transcripts use their own source while keeping the machine writer and stable keys', async t => {
  const s = setup(t); s.records.push(message('user', 'hello')); s.write();
  await capture(s.root, s.input, s.options);
  const j = jobs(s.root)[0].job;
  assert.equal(j.agent, 'codex-unit-test');
  assert.equal(j.opts.source, 'codex-transcript');
  assert.equal(j.opts.metadata.writer_agent, j.agent);
  assert.equal(j.opts.category, 'reference_codex_transcript');
});

test('a long session uploads at most 32 chunks, four per message, with local-only status and replay safety', async t => {
  const s = setup(t);
  s.records.push(message('user', 'x'.repeat(12000)));
  for (let i = 0; i < 100; i++) s.records.push(message('assistant', 'message ' + i));
  s.write(); await capture(s.root, s.input, s.options);
  const all = jobs(s.root).map(x => x.job);
  assert.equal(all.filter(j => j.status === 'pending').length, 32);
  assert.equal(all.filter(j => j.status === 'pending' && j.opts.metadata.role === 'user').length, 4);
  assert.ok(status(s.root).localOnly > 0);
  assert.ok(all.filter(j => j.status === 'local-only').every(j => !j.content));
  await capture(s.root, s.input, s.options);
  assert.equal(jobs(s.root).length, all.length);
  let writes = 0;
  await drain(s.root, async () => { writes++; return { id: 'ok', verified: true, embedded: true }; });
  assert.equal(writes, 32);
  s.records.push(message('user', 'after previous sync')); s.write(); await capture(s.root, s.input, s.options);
  assert.equal(status(s.root).pending, 0);
  assert.equal(status(s.root).saved, 32);
});

test('legacy pending transcripts are relabelled, expired payloads removed, and handoffs untouched', t => {
  const s = setup(t), now = Date.now();
  const make = (key, when, category = 'reference_codex_transcript') => ({ key, session: 'test-session', agent: 'codex-unit-test',
    status: 'pending', content: 'private text', opts: { category, sourceRef: { part: 0, occurred_at: new Date(when).toISOString() }, metadata: { kind: category === 'session_handoff' ? 'handoff' : 'conversation' } } });
  writeJson(path.join(s.root, 'outbox', 'fresh.json'), make('codex-chat-v1:fresh', now));
  writeJson(path.join(s.root, 'outbox', 'old.json'), make('codex-chat-v1:old', now - 15 * 86400000));
  const handoff = make('codex-handoff-v1:old', now - 30 * 86400000, 'session_handoff');
  writeJson(path.join(s.root, 'outbox', 'handoff.json'), handoff);
  enforcePendingPolicy(s.root, now);
  assert.equal(readJson(path.join(s.root, 'outbox', 'fresh.json')).opts.source, 'codex-transcript');
  assert.equal(readJson(path.join(s.root, 'outbox', 'old.json')).content, undefined);
  assert.deepEqual(readJson(path.join(s.root, 'outbox', 'handoff.json')), handoff);
});

test('notes-only transition saves handoffs without uploading or changing the old transcript queue', async t => {
  const s = setup(t); s.records.push(message('user', 'old queued chat')); s.write();
  await capture(s.root, s.input, s.options);
  const chat = jobs(s.root)[0], before = fs.readFileSync(chat.file, 'utf8');
  writeJson(path.join(s.root, 'outbox', 'handoff.json'), { key: 'codex-handoff-v1:test', session: 'test-session', agent: 'codex-unit-test',
    content: 'curated handoff', status: 'pending', opts: { category: 'session_handoff' } });
  const written = [];
  await drain(s.root, async job => { written.push(job.content); return { id: 'note', verified: true, embedded: true }; }, { force: true, handoffOnly: true });
  assert.deepEqual(written, ['curated handoff']); assert.equal(fs.readFileSync(chat.file, 'utf8'), before);
  assert.equal(status(s.root).pending, 1); assert.equal(status(s.root).saved, 1);
});

test('credential labels, OAuth values, bearer tokens and dotenv contents never enter chunks', async t => {
  const s = setup(t), values = ['unit-service-role-value', 'unit-oauth-refresh-value', 'unit-client-secret-value', 'unit-bearer-credential', 'unit-environment-host'];
  const raw = '"SUPABASE_SERVICE_ROLE_KEY": "' + values[0] + '"\n'
    + 'refreshToken: "' + values[1] + '"\nclient-secret=' + values[2] + '\nAuthorization: Bearer ' + values[3]
    + '\n```dotenv\nHOST=' + values[4] + '\n```\n.env.local contents:\n```\nANY_SETTING=private-setting\n```';
  s.records.push(message('user', raw)); s.write(); await capture(s.root, s.input, s.options);
  const captured = jobs(s.root).map(x => x.job.content || '').join('\n');
  for (const value of [...values, 'private-setting']) assert.ok(!captured.includes(value));
  assert.match(captured, /REDACTED/);
});

test('semantic recall excludes all agreed capture sources and filters legacy transcript category', async () => {
  let opts;
  const r = await recall({ search: async (_, o) => { opts = o; return [
    { content: 'raw legacy chat', category: 'reference_codex_transcript', source: 'codex-neo-mbp' },
    { content: 'curated note', source: 'kb' }, { content: 'WA', source: 'wa-primary' },
    { content: 'Claude raw text', source: 'claude_code_transcript' }, { content: 'twin raw text', source: 'twin-ingest' },
  ]; } }, 'question', x => x);
  assert.deepEqual(opts.sourceExclude, [...RECALL_EXCLUSIONS]);
  for (const source of NOISE_SOURCES) assert.ok(opts.sourceExclude.includes(source));
  assert.match(r.text, /curated note/); assert.doesNotMatch(r.text, /raw legacy|WA|raw text/);
});

test('temporary broad writer exclusion cannot hide a scoped curated handoff', () => {
  const result = latestHandoff([{ id: 'curated', source: 'codex-neo-mbp', category: 'session_handoff',
    content: 'Verified handoff', source_ref: { part: 0 }, metadata: { handoff_id: 'group', parts: 1 }, created_at: '2026-09-15' },
    { id: 'raw', source: 'codex-transcript', category: 'reference_codex_transcript', content: 'raw text', created_at: '2026-09-16' }], x => x);
  assert.deepEqual(result.ids, ['curated']); assert.equal(result.complete, true);
});

test('handoff parts are grouped and ordered without mixing older notes or clipping each part', () => {
  const row = (part, group, at, text) => ({ id: group + part, created_at: at, source_ref: { session_id: 's', part },
    metadata: { handoff_id: group, handoff_at: at, parts: 2 }, content: text });
  const result = latestHandoff([row(1, 'new', '2026-09-15', 'second'), row(0, 'old', '2026-09-14', 'wrong'),
    row(0, 'new', '2026-09-15', 'first'.repeat(300))], x => x);
  assert.equal(result.complete, true); assert.deepEqual(result.ids, ['new0', 'new1']);
  assert.equal(result.excerpt, 'first'.repeat(300) + '\n\nsecond');
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
