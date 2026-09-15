import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { maintainTranscripts } from './maintenance.mjs';
import { planTranscriptMaintenance } from '../../packages/memory/src/continuity.js';
import { readJson } from './core.mjs';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-maintenance-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = [{ id: 'one', source: 'codex-unit', created_at: '2026-01-01', archived: false, source_ref: { session_id: 'a' } }];
  const calls = [], failures = { relabel: false, archive: false };
  const sdk = { listOwnedTranscripts: async () => structuredClone(rows), planTranscriptMaintenance,
    relabelTranscript: async (_, id) => {
      calls.push('relabel:' + id); const row = rows.find(r => r.id === id), changed = row.source !== 'codex-transcript';
      row.source = 'codex-transcript';
      if (failures.relabel) { failures.relabel = false; throw new Error('audit interrupted'); }
      return { verified: true, changed };
    },
    archiveTranscript: async (_, id) => {
      calls.push('archive:' + id); const row = rows.find(r => r.id === id), changed = !row.archived;
      row.archived = true;
      if (failures.archive) { failures.archive = false; throw new Error('audit interrupted'); }
      return { verified: true, changed };
    },
  };
  return { root, rows, calls, failures, sdk, options: { apply: true, sdk, now: () => Date.parse('2026-09-15'), deadline: Date.parse('2026-09-16') } };
}

test('migration defaults to a read-only plan, including no local journal writes', async t => {
  const s = setup(t);
  const result = await maintainTranscripts(s.root, {}, { sdk: s.sdk });
  assert.equal(result.dryRun, true); assert.equal(result.relabel, 1); assert.deepEqual(s.calls, []);
  assert.deepEqual(fs.readdirSync(s.root), []);
});

test('lost relabel response is repaired before resuming archival; journal and lock clear', async t => {
  const s = setup(t); s.failures.relabel = true;
  await assert.rejects(maintainTranscripts(s.root, {}, s.options));
  assert.deepEqual(readJson(path.join(s.root, 'maintenance-operation.json')), { action: 'relabel', id: 'one' });
  assert.equal(fs.existsSync(path.join(s.root, 'maintenance.lock')), false);
  const result = await maintainTranscripts(s.root, {}, s.options);
  assert.equal(result.ok, true); assert.equal(result.legacyRemaining, 0);
  assert.deepEqual(s.calls, ['relabel:one', 'relabel:one', 'archive:one']);
  assert.equal(readJson(path.join(s.root, 'maintenance-operation.json')), null);
});

test('an already-archived row still gets its interrupted audit repaired on the next sync', async t => {
  const s = setup(t); s.failures.archive = true;
  await assert.rejects(maintainTranscripts(s.root, {}, s.options));
  assert.equal(s.rows[0].archived, true);
  await maintainTranscripts(s.root, {}, { ...s.options, relabel: false });
  assert.deepEqual(s.calls, ['relabel:one', 'archive:one', 'archive:one']);
  assert.equal(readJson(path.join(s.root, 'maintenance-operation.json')), null);
});

test('automatic retention leaves legacy sources alone until explicit migration', async t => {
  const s = setup(t);
  const result = await maintainTranscripts(s.root, {}, { ...s.options, relabel: false });
  assert.equal(result.legacyRemaining, 1); assert.deepEqual(s.calls, []);
  s.rows[0].source = 'codex-transcript';
  await maintainTranscripts(s.root, {}, { ...s.options, relabel: false });
  assert.deepEqual(s.calls, ['archive:one']);
});

test('bounded maintenance reports unfinished operations and resumes without redoing completed rows', async t => {
  const s = setup(t), start = Date.parse('2026-09-15'); let ticks = 0;
  const result = await maintainTranscripts(s.root, {}, { ...s.options, deadline: start + 5000, now: () => start + ticks++ * 1000 });
  assert.equal(result.ok, false); assert.equal(result.remaining, 1);
  await maintainTranscripts(s.root, {}, s.options);
  assert.deepEqual(s.calls, ['relabel:one', 'archive:one']);
});
