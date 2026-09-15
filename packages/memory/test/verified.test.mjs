import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveVerifiedMemory, verifiedMemoryId } from '../src/verified.js';

function fakeBrain() {
  const rows = new Map(), audits = [], failures = { responseLost: false, audit: false };
  const brain = { agent: 'codex-verified-unit', geminiApiKey: 'unit-fixture',
    sb: { from(table) {
      const filters = []; let insert;
      const query = {
        select() { return query; }, eq(k, v) { filters.push([k, v]); return query; },
        limit() { return query; }, maybeSingle() { return query; },
        insert(value) { insert = value; return query; },
        then(resolve, reject) {
          const run = async () => {
            if (insert) {
              if (table === 'memory_writes_log') {
                if (failures.audit) return { error: { code: 'offline' } };
                audits.push(insert); return { error: null };
              }
              if (rows.has(insert.id)) return { error: { code: '23505' } };
              rows.set(insert.id, { ...insert, created_at: '2026-09-13' });
              if (failures.responseLost) { failures.responseLost = false; throw new Error('response lost'); }
              return { error: null };
            }
            const all = table === 'memories' ? [...rows.values()] : audits;
            const result = all.filter(r => filters.every(([k, v]) => r[k] === v));
            return { data: table === 'memories' ? result[0] || null : result, error: null };
          };
          return run().then(resolve, reject);
        },
      }; return query;
    } },
  };
  return { brain, rows, audits, failures };
}
const opts = { key: 'message-1', category: 'session_handoff' };
function embedding(t, value = Array(768).fill(0.1)) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ embedding: { values: value } }) });
  t.after(() => { globalThis.fetch = original; });
}
test('same event key is deterministic and distinct across agents', () => {
  assert.equal(verifiedMemoryId('a', '1'), verifiedMemoryId('a', '1'));
  assert.notEqual(verifiedMemoryId('a', '1'), verifiedMemoryId('b', '1'));
});
test('save verifies row, non-null vector, private visibility and audit; retry makes one row', async t => {
  embedding(t); const s = fakeBrain();
  const a = await saveVerifiedMemory(s.brain, 'verified work', opts);
  const b = await saveVerifiedMemory(s.brain, 'verified work', opts);
  assert.deepEqual(a, b); assert.equal(a.embedded, true); assert.equal(a.verified, true);
  assert.equal(s.rows.size, 1); assert.equal(s.audits.length, 1);
});
test('null or malformed embedding never inserts a row', async t => {
  embedding(t, null); const s = fakeBrain();
  await assert.rejects(saveVerifiedMemory(s.brain, 'pending', opts), /embedding unavailable/);
  assert.equal(s.rows.size, 0);
});
test('lost insert response retries without duplicate memory and repairs missing audit', async t => {
  embedding(t); const s = fakeBrain(); s.failures.responseLost = true;
  await assert.rejects(saveVerifiedMemory(s.brain, 'keep', opts));
  const result = await saveVerifiedMemory(s.brain, 'keep', opts);
  assert.equal(s.rows.size, 1); assert.equal(s.audits.length, 1); assert.equal(result.verified, true);
});
test('an audit failure is not acknowledged; a later retry repairs it', async t => {
  embedding(t); const s = fakeBrain(); s.failures.audit = true;
  await assert.rejects(saveVerifiedMemory(s.brain, 'keep', opts), /audit/);
  s.failures.audit = false;
  await saveVerifiedMemory(s.brain, 'keep', opts);
  assert.equal(s.rows.size, 1); assert.equal(s.audits.length, 1);
});
test('a reused key with different content fails rather than silently accepting another message', async t => {
  embedding(t); const s = fakeBrain();
  await saveVerifiedMemory(s.brain, 'original', opts);
  await assert.rejects(saveVerifiedMemory(s.brain, 'different', opts), /verification/);
  assert.equal(s.rows.size, 1);
});
test('source separation preserves deterministic writer IDs and machine audit provenance', async t => {
  embedding(t); const s = fakeBrain();
  const result = await saveVerifiedMemory(s.brain, 'historical quotation', { ...opts, source: 'codex-transcript', category: 'reference_codex_transcript' });
  assert.equal(result.id, verifiedMemoryId(s.brain.agent, opts.key));
  assert.equal(s.rows.get(result.id).source, 'codex-transcript');
  assert.equal(s.audits[0].written_by, s.brain.agent);
  await assert.rejects(saveVerifiedMemory(s.brain, 'historical quotation', opts), /verification/);
});
