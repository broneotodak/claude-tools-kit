#!/usr/bin/env node
// Compute delta between two extraction manifests and save a memory to neo-brain.
//
// Usage:
//   node weekly-summary.mjs <current-manifest.json> [previous-manifest.json]
//
// If previous is omitted, looks for the most-recent prior manifest under
// ~/datasets/neo-corpus/ (excluding current).

import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { NeoBrain } from '../../packages/memory/src/client.js';

function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function findPriorManifest(currentPath) {
  const root = join(homedir(), 'datasets', 'neo-corpus');
  const dirs = readdirSync(root).filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  const currentDir = currentPath.split('/').slice(-2, -1)[0];
  const prior = dirs.filter(d => d < currentDir).pop();
  if (!prior) return null;
  return join(root, prior, 'manifest.json');
}

function delta(prev, curr) {
  const d = {
    rows_prev: prev?.totals?.rows_read ?? 0,
    rows_curr: curr.totals.rows_read,
    rows_added: curr.totals.rows_read - (prev?.totals?.rows_read ?? 0),
    new_sources: [],
    source_growth: {},
    extracted_prev: prev?.extracted_at ?? null,
    extracted_curr: curr.extracted_at
  };
  const prevDist = prev?.distributions?.source ?? {};
  const currDist = curr.distributions?.source ?? {};
  for (const s of Object.keys(currDist)) {
    if (!(s in prevDist)) d.new_sources.push(s);
    const diff = currDist[s] - (prevDist[s] ?? 0);
    if (diff !== 0) d.source_growth[s] = diff;
  }
  return d;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: weekly-summary.mjs <current-manifest> [previous-manifest]');
    process.exit(2);
  }
  const currentPath = args[0];
  const priorPath = args[1] || findPriorManifest(currentPath);

  const curr = readManifest(currentPath);
  const prev = priorPath ? readManifest(priorPath) : null;
  const d = delta(prev, curr);

  const summary =
    `Weekly dataset extraction — ${curr.extracted_at.slice(0, 10)}.\n\n` +
    `Rows: ${d.rows_prev} → ${d.rows_curr} (${d.rows_added >= 0 ? '+' : ''}${d.rows_added}).\n` +
    `Slices: ${Object.keys(curr.slices).length}.\n` +
    (d.new_sources.length ? `New sources this run: ${d.new_sources.join(', ')}.\n` : '') +
    `Top growth (Δ rows by source): ` +
    Object.entries(d.source_growth)
      .filter(([, n]) => n !== 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 8)
      .map(([k, n]) => `${k}=${n >= 0 ? '+' : ''}${n}`)
      .join(', ') +
    `.\n\nManifest: ${currentPath}\nPrior: ${priorPath || '(none — first run)'}`;

  console.log(summary);

  // Save memory (best-effort; don't fail the cron if neo-brain is briefly unreachable)
  try {
    const nb = new NeoBrain({
      url: process.env.NEO_BRAIN_URL,
      serviceRoleKey: process.env.NEO_BRAIN_SERVICE_ROLE_KEY,
      geminiApiKey: process.env.GEMINI_API_KEY,
      agent: 'dataset-pipeline-cron'
    });
    const r = await nb.save(summary, {
      category: 'phase6-personal-corpus',
      type: 'scheduled_extraction',
      importance: 4,
      visibility: 'internal',
      metadata: {
        rows_prev: d.rows_prev,
        rows_curr: d.rows_curr,
        rows_added: d.rows_added,
        new_sources: d.new_sources,
        manifest_path: currentPath,
        prior_manifest_path: priorPath
      }
    });
    console.log('\nMemory saved:', r.id);
  } catch (e) {
    console.error('\n[warn] memory save failed:', e.message);
    // Exit 0 anyway — extraction itself succeeded
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
