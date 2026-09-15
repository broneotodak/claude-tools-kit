import path from 'node:path';
import { listOwnedTranscripts, planTranscriptMaintenance, relabelTranscript, archiveTranscript, TRANSCRIPT_SOURCE } from '../../packages/memory/src/continuity.js';
import { readJson, writeJson, withLocalLock } from './core.mjs';

// A persisted in-flight operation repairs a lost update/audit response on the
// next invocation, including rows already archived or relabelled remotely.
export async function maintainTranscripts(root, brain, { apply = false, relabel = true, deadline = Date.now() + 40000,
  now = Date.now, sdk = { listOwnedTranscripts, planTranscriptMaintenance, relabelTranscript, archiveTranscript } } = {}) {
  const inventory = async () => {
    const rows = await sdk.listOwnedTranscripts(brain);
    return { rows, plan: sdk.planTranscriptMaintenance(rows, now()) };
  };
  if (!apply) {
    const { plan } = await inventory();
    return { dryRun: true, total: plan.total, relabel: plan.relabel.length, archive: plan.archive.length, activeAfter: plan.activeAfter };
  }
  const result = await withLocalLock(path.join(root, 'maintenance.lock'), async () => {
    const journal = path.join(root, 'maintenance-operation.json');
    const perform = async operation => {
      writeJson(journal, operation);
      const result = operation.action === 'relabel' ? await sdk.relabelTranscript(brain, operation.id)
        : await sdk.archiveTranscript(brain, operation.id);
      if (!result?.verified) throw new Error('transcript operation unverified');
      writeJson(journal, null);
      return result;
    };
    const previous = readJson(journal, null);
    if (previous) {
      if (!['relabel', 'archive'].includes(previous.action) || typeof previous.id !== 'string') throw new Error('invalid maintenance journal');
      await perform(previous);
    }
    const { rows, plan } = await inventory(), toArchive = new Set(plan.archive);
    const operations = rows.flatMap(row => [
      ...(relabel && row.source !== TRANSCRIPT_SOURCE ? [{ action: 'relabel', id: row.id }] : []),
      ...(toArchive.has(row.id) && (relabel || row.source === TRANSCRIPT_SOURCE) ? [{ action: 'archive', id: row.id }] : []),
    ]);
    let relabelled = 0, archived = 0, index = 0;
    for (; index < operations.length && now() < deadline - 3000; index++) {
      const operation = operations[index], result = await perform(operation);
      if (result.changed) { if (operation.action === 'relabel') relabelled++; else archived++; }
    }
    return { ok: index === operations.length, relabelled, archived, remaining: operations.length - index,
      legacyRemaining: plan.relabel.length - relabelled };
  });
  return result.busy ? { ok: false, busy: true, pending: true } : result;
}
