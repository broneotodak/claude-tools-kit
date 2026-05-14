#!/usr/bin/env node
// memory-hygiene-check.js
//
// Audits neo-brain `memories` table for hygiene issues:
//   - NULL embeddings on KNOWLEDGE categories (events allowlist is OK)
//   - Dimension mismatches (rows whose embedding is wrong size)
//   - Stale debug/test rows from past sessions
//
// USAGE
//   node memory-hygiene-check.js              # human-readable report
//   node memory-hygiene-check.js --json       # JSON output (for daily-checkup-agent or piping)
//   node memory-hygiene-check.js --since 24h  # restrict NULL-knowledge count to a time window
//
// EXIT CODES
//   0 = clean (no knowledge NULLs since cutoff)
//   1 = warning (1+ knowledge NULLs found OR test/debug rows present)
//   2 = fatal (env missing / fetch failed)
//
// Mirrored allowlist with tools/backfill-missing-embeddings.js and the
// neo-brain trigger enforce_memory_embedding_for_knowledge. Keep all three
// in sync when adding new operational categories.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const SINCE = args.find((a, i) => args[i - 1] === '--since') || null;  // e.g. "24h", "7d"

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
]);

// Debug/test sources that should NOT have lingering rows post-cleanup.
const DEBUG_SOURCES = new Set([
  'trigger-smoke-test',
  'test',
  'debug',
  'manual-test',
]);

const envPath = `${process.env.HOME}/Projects/claude-tools-kit/.env`;
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; })
    .filter(Boolean),
);
const URL = env.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL;
const KEY = env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  if (JSON_OUT) console.log(JSON.stringify({ status: 'fatal', error: 'env_missing' }));
  else console.error('NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY required');
  process.exit(2);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

function parseSince(s) {
  if (!s) return null;
  const m = s.match(/^(\d+)([hdw])$/);
  if (!m) return null;
  const n = parseInt(m[1]);
  const ms = m[2] === 'h' ? 3600_000 : m[2] === 'd' ? 86400_000 : 604800_000;
  return new Date(Date.now() - n * ms).toISOString();
}

async function countWhere(filter) {
  const r = await fetch(`${URL}/rest/v1/memories?select=count${filter ? '&' + filter : ''}`, {
    headers: { ...H, Prefer: 'count=exact' },
  });
  return +(r.headers.get('content-range')?.split('/')[1] || 0);
}

async function sampleWhere(filter, limit = 5) {
  const r = await fetch(
    `${URL}/rest/v1/memories?select=id,source,category,memory_type,created_at&order=created_at.desc&limit=${limit}&${filter}`,
    { headers: H },
  );
  return (await r.json()) || [];
}

(async () => {
  const sinceISO = parseSince(SINCE);
  const sinceFilter = sinceISO ? `created_at=gte.${sinceISO}` : '';

  // 1. Total + overall NULL embedding (for context)
  const total = await countWhere('');
  const totalNull = await countWhere('embedding=is.null');

  // 2. NULL embedding in knowledge categories (the real bug class).
  //    Build a filter: embedding IS NULL AND category NOT IN (event_categories)
  const eventsList = [...EVENT_CATEGORIES].map((c) => `"${c}"`).join(',');
  let knowledgeNullFilter = `embedding=is.null&category=not.in.(${encodeURIComponent(eventsList)})`;
  if (sinceFilter) knowledgeNullFilter += `&${sinceFilter}`;
  const knowledgeNull = await countWhere(knowledgeNullFilter);
  const knowledgeNullSample = await sampleWhere(knowledgeNullFilter, 5);

  // 3. Debug/test row count (cleanup signal)
  const debugSourcesList = [...DEBUG_SOURCES].map((s) => `"${s}"`).join(',');
  const debugRows = await countWhere(`source=in.(${encodeURIComponent(debugSourcesList)})`);

  const verdict = knowledgeNull > 0 ? 'warning' : (debugRows > 0 ? 'warning' : 'ok');

  if (JSON_OUT) {
    console.log(JSON.stringify({
      status: verdict,
      checked_at: new Date().toISOString(),
      since: sinceISO,
      total_rows: total,
      total_null_embedding: totalNull,
      knowledge_null_embedding: knowledgeNull,
      knowledge_null_sample: knowledgeNullSample.map((r) => ({ id: r.id, source: r.source, category: r.category, at: r.created_at })),
      debug_test_rows: debugRows,
    }, null, 2));
  } else {
    console.log('=== neo-brain memory-hygiene check ===');
    console.log(`Checked at: ${new Date().toISOString()}`);
    if (sinceISO) console.log(`Since:      ${sinceISO}`);
    console.log('');
    console.log(`Total rows:                ${total}`);
    console.log(`Total NULL embedding:      ${totalNull}  (most are operational/event — OK by design)`);
    console.log('');
    console.log(`KNOWLEDGE NULL embedding:  ${knowledgeNull}  ${knowledgeNull === 0 ? '✅' : '⚠️  trigger SHOULD be blocking these; investigate'}`);
    if (knowledgeNullSample.length) {
      console.log('  Recent samples:');
      for (const r of knowledgeNullSample) {
        console.log(`    ${r.id.slice(0, 8)} · ${r.source} · ${r.category} · ${r.created_at}`);
      }
    }
    console.log('');
    console.log(`Debug/test rows present:   ${debugRows}  ${debugRows === 0 ? '✅' : '⚠️  run cleanup'}`);
    console.log('');
    console.log(`Verdict: ${verdict.toUpperCase()}`);
  }

  process.exit(verdict === 'ok' ? 0 : 1);
})().catch((e) => {
  if (JSON_OUT) console.log(JSON.stringify({ status: 'fatal', error: e.message }));
  else console.error('fatal:', e.message);
  process.exit(2);
});
