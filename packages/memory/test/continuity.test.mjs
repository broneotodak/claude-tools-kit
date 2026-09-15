import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listOwnedTranscripts, planTranscriptMaintenance, relabelTranscript, archiveTranscript, listScopedHandoffs } from '../src/continuity.js';
import { recall } from '../../../tools/codex-memory/core.mjs';

const agent = 'codex-unit-test', now = Date.parse('2026-09-15T12:00:00Z');
function row(id, extra = {}) {
  return { id, source: agent, category: 'reference_codex_transcript', visibility: 'private', archived: false,
    created_at: new Date(now).toISOString(), source_ref: { session_id: 'session-a', occurred_at: new Date(now).toISOString(), part: 0 },
    metadata: { tool: 'codex-memory', kind: 'conversation' }, content: 'original content', embedding: '[0.1,0.2]', ...extra };
}
function fixture(initial) {
  const rows = initial.map(x => structuredClone(x)), logs = [], calls = [], failures = { audit: false, lostUpdate: false, archive: false };
  const get = (r, k) => k.includes('->>') ? r[k.split('->>')[0]]?.[k.split('->>')[1]] : r[k];
  const brain = { agent, sb: { from(table) {
    const filters = [], sort = []; let patch, insert, single = false, start = 0, end = Infinity;
    const q = {
      select() { return q; }, eq(k, v) { filters.push([k, v]); return q; },
      order(k, o = {}) { sort.push([k, o.ascending !== false]); return q; },
      range(a, b) { start = a; end = b + 1; return q; }, limit(n) { end = n; return q; },
      maybeSingle() { single = true; return q; }, update(p) { patch = p; return q; }, insert(p) { insert = p; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        calls.push({ table, filters: structuredClone(filters), patch });
        if (table === 'memory_writes_log' && failures.audit) return { error: { code: 'offline' } };
        const all = table === 'memories' ? rows : logs;
        if (insert) { all.push(structuredClone(insert)); return { data: null }; }
        let found = all.filter(r => filters.every(([k, v]) => get(r, k) === v));
        if (patch) {
          found.forEach(r => Object.assign(r, structuredClone(patch)));
          if (failures.lostUpdate) { failures.lostUpdate = false; throw new Error('lost response'); }
        }
        for (const [k, ascending] of sort.reverse()) found.sort((a, b) => String(get(a, k)).localeCompare(String(get(b, k))) * (ascending ? 1 : -1));
        found = found.slice(start, end);
        return { data: structuredClone(single ? found[0] || null : found), error: null };
      }).then(resolve, reject); },
    }; return q;
  } }, async archive(id) {
    if (failures.archive) throw new Error('archive unavailable');
    rows.find(x => x.id === id).archived = true;
  } };
  return { brain, rows, logs, calls, failures };
}

test('relabel changes only source and provenance, verifies audit, and is idempotent', async () => {
  const s = fixture([row('one')]), before = structuredClone(s.rows[0]);
  const first = await relabelTranscript(s.brain, 'one');
  assert.equal(first.changed, true);
  assert.equal(s.rows[0].source, 'codex-transcript');
  for (const k of ['content', 'embedding', 'created_at', 'source_ref', 'visibility', 'archived']) assert.deepEqual(s.rows[0][k], before[k]);
  assert.equal(s.rows[0].metadata.writer_agent, agent);
  const next = await relabelTranscript(s.brain, 'one');
  assert.equal(next.changed, false); assert.equal(s.logs.length, 1);
});

test('handoffs, change notes, other writers and public rows cannot be relabelled or archived', async () => {
  for (const extra of [{ category: 'session_handoff' }, { category: 'shared_infra_change' },
    { source: 'other-agent' }, { visibility: 'public' }, { metadata: { kind: 'conversation' } }]) {
    const s = fixture([row('one', extra)]), before = structuredClone(s.rows);
    await assert.rejects(relabelTranscript(s.brain, 'one'), /non-owned/);
    await assert.rejects(archiveTranscript(s.brain, 'one'));
    assert.deepEqual(s.rows, before);
  }
});

test('a lost update response or failed audit is repairable without a second row', async () => {
  const s = fixture([row('one')]); s.failures.lostUpdate = true;
  await assert.rejects(relabelTranscript(s.brain, 'one'), /lost response/);
  s.failures.audit = true;
  await assert.rejects(relabelTranscript(s.brain, 'one'), /audit/);
  s.failures.audit = false;
  assert.equal((await relabelTranscript(s.brain, 'one')).verified, true);
  assert.equal(s.rows.length, 1); assert.equal(s.logs.length, 1);
});

test('retention is based on event age, caps active rows per session, and leaves other sessions alone', () => {
  const rows = Array.from({ length: 40 }, (_, i) => row('id-' + String(i).padStart(3, '0')));
  rows.push(row('old', { source_ref: { session_id: 'old-session', occurred_at: '2026-08-01' } }),
    row('other-session', { source_ref: { session_id: 'different' } }), row('already-archived', { archived: true }));
  const plan = planTranscriptMaintenance(rows, now);
  assert.equal(plan.relabel.length, 43); assert.equal(plan.archive.length, 9); assert.equal(plan.activeAfter, 33);
  assert.ok(plan.archive.includes('old')); assert.ok(!plan.archive.includes('other-session'));
  assert.ok(!plan.archive.includes('already-archived'));
});

test('inventory paginates beyond 200 rows and scopes the shared transcript source by writer', async () => {
  const s = fixture(Array.from({ length: 450 }, (_, i) => row('id-' + String(i).padStart(3, '0'))));
  s.rows.push(row('other', { source: 'codex-transcript', metadata: { tool: 'codex-memory', kind: 'conversation', writer_agent: 'codex-other' } }));
  assert.equal((await listOwnedTranscripts(s.brain)).length, 450);
});

test('archive requires relabel, verifies persisted state, and does not delete content', async () => {
  const s = fixture([row('one')]);
  await assert.rejects(archiveTranscript(s.brain, 'one'), /relabel/);
  await relabelTranscript(s.brain, 'one');
  s.failures.archive = true; await assert.rejects(archiveTranscript(s.brain, 'one'));
  s.failures.archive = false;
  assert.equal((await archiveTranscript(s.brain, 'one')).verified, true);
  assert.equal(s.rows[0].archived, true); assert.equal(s.rows[0].content, 'original content');
  assert.equal((await archiveTranscript(s.brain, 'one')).changed, false);
});

test('current worktree handoff wins over newer unrelated project/worktree and bypasses embedding failure', async () => {
  const handoff = (id, repo, worktree, at) => row(id, { category: 'session_handoff', created_at: at,
    metadata: { repo, worktree, handoff_id: id, parts: 1 }, content: 'handoff ' + id });
  const s = fixture([handoff('wanted', 'project-a', '/trees/a', '2026-09-14'),
    handoff('other-tree', 'project-a', '/trees/b', '2026-09-15'), handoff('unrelated', 'project-b', '/trees/b', '2026-09-16')]);
  const scope = { repo: 'project-a', worktree: '/trees/a', session: 'session-a' };
  s.brain.search = async () => assert.fail('handoff must not depend on embeddings');
  const result = await recall(s.brain, 'task', x => x, scope);
  assert.equal(result.mode, 'project handoff'); assert.match(result.text, /wanted/); assert.doesNotMatch(result.text, /other-tree|unrelated/);
  assert.deepEqual(await listScopedHandoffs(s.brain, { repo: 'missing' }), []);
});
