#!/usr/bin/env node
// backfill-missing-embeddings.js
//
// One-shot helper: finds memories rows that should be semantically searchable
// (knowledge categories) but have NULL embedding, generates embeddings via
// Gemini, and writes them back. Operational/event rows are intentionally
// skipped — they're queried deterministically by metadata, not vector search.
//
// USAGE
//   node backfill-missing-embeddings.js                # dry-run (count + sample, no writes)
//   node backfill-missing-embeddings.js --apply        # write embeddings
//   node backfill-missing-embeddings.js --limit 50     # cap rows per run (default unlimited)
//   node backfill-missing-embeddings.js --category X   # restrict to one category
//
// Root cause this addresses: fleet agents (supervisor, planner-agent, verifier-
// agent, etc.) write memories via direct PostgREST POSTs and skip the embedding
// step that @todak/memory's nb.save() performs. Categories listed in
// EVENT_CATEGORIES are intentional skips; everything else is a real gap.
//
// Followed up by an architectural fix in a separate session — agents writing
// knowledge should go through the SDK (or a saveKnowledgeMemory helper in
// @naca/core), not raw PostgREST.

import { readFileSync } from 'node:fs';
import { embedText } from '@todak/memory';
// toPgVectorString isn't re-exported from the index; trivial inline equivalent.
const toPgVectorString = (values) => (Array.isArray(values) ? `[${values.join(',')}]` : null);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIMIT = args.find((a, i) => args[i - 1] === '--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;
const CATEGORY = args.find((a, i) => args[i - 1] === '--category');

// Categories whose rows are operational/event logs — NOT meant for semantic search.
// These should keep NULL embeddings; backfilling them would waste Gemini quota.
const EVENT_CATEGORIES = new Set([
  'naca_monitor_snapshot',
  'kg_populator_state',
  'pr-stuck-reminder',
  'pr-decision-recorded',
  'digest_queue',
  'daily_checkup_run',
  'supervisor-observation',
  'vps_git_drift',
  'fleet-node-discovered',
  'wa-primary-media',
  'agent_heartbeat',
  'cycle_state',
]);

// env
const envPath = `${process.env.HOME}/Projects/claude-tools-kit/.env`;
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; })
    .filter(Boolean),
);
const URL = env.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL;
const KEY = env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
if (!URL || !KEY) { console.error('NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY required'); process.exit(1); }
if (!GEMINI_API_KEY) { console.error('GEMINI_API_KEY required for embeddings'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function fetchKnowledgeNullRows() {
  // Pull all NULL-embedding rows. PostgREST caps at ~1000 per query; we paginate.
  const all = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    let q = `embedding=is.null&select=id,category,content,source,created_at&limit=${PAGE}&offset=${offset}`;
    if (CATEGORY) q += `&category=eq.${encodeURIComponent(CATEGORY)}`;
    const r = await fetch(`${URL}/rest/v1/memories?${q}`, { headers: H });
    if (!r.ok) throw new Error(`fetch failed: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  // Filter out event categories — they should stay NULL by design
  return all.filter(r => !EVENT_CATEGORIES.has(r.category));
}

async function patchEmbedding(id, embStr) {
  const r = await fetch(`${URL}/rest/v1/memories?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ embedding: embStr }),
  });
  if (!r.ok) throw new Error(`PATCH ${id} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

(async () => {
  console.log(`backfill-missing-embeddings (${APPLY ? 'APPLY' : 'DRY-RUN'}${CATEGORY ? ` category=${CATEGORY}` : ''}${LIMIT ? ` limit=${LIMIT}` : ''})`);

  const candidates = await fetchKnowledgeNullRows();
  console.log(`Found ${candidates.length} knowledge-category rows with NULL embedding`);

  // Group by category for visibility
  const byCat = {};
  for (const r of candidates) byCat[r.category || '(null)'] = (byCat[r.category || '(null)'] || 0) + 1;
  console.log('Breakdown by category:');
  for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(30)} ${n}`);
  }

  if (!APPLY) {
    console.log('\n(dry-run · pass --apply to write embeddings)');
    return;
  }

  const work = LIMIT ? candidates.slice(0, LIMIT) : candidates;
  console.log(`\nEmbedding ${work.length} rows...`);

  let ok = 0, skipped = 0, failed = 0;
  for (const row of work) {
    try {
      if (!row.content || !row.content.trim()) { skipped++; continue; }
      const emb = await embedText(row.content, { apiKey: GEMINI_API_KEY });
      if (!emb) { skipped++; continue; }
      await patchEmbedding(row.id, toPgVectorString(emb));
      ok++;
      if (ok % 25 === 0) console.log(`  ... ${ok}/${work.length}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${row.id.slice(0, 8)} (${row.category}): ${e.message.slice(0, 100)}`);
      if (failed >= 10) { console.error('Too many failures, aborting.'); break; }
    }
    // Gentle throttle to avoid Gemini rate limits
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\nDone · embedded=${ok} skipped=${skipped} failed=${failed}`);
})().catch(e => { console.error('fatal:', e.message); process.exit(1); });
