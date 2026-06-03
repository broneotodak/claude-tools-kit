#!/usr/bin/env node
// prune-operational-memories.js — retention prune for OPERATIONAL memory rows.
//
// THE PROBLEM (found 2026-06-03): the `memories` table is 21% NULL-embedding
// (1,972 of 9,314). That is NOT the knowledge-write bug (the DB trigger guards
// those) — it's OPERATIONAL telemetry/state in the EVENT_CATEGORIES allowlist
// (kg_populator_state, vps_git_drift, supervisor, …). Those rows are
// *intentionally* unembedded (queried by metadata, not vector) — the gap is
// that NOTHING prunes them, so they grow forever (~75/day). naca_monitor solved
// this for its own table with pruneOldSnapshots; this does it for the
// allowlisted operational rows that live in `memories`.
//
// SAFETY:
//   - Only ever touches rows whose category is in EVENT_CATEGORIES (the SAME
//     allowlist the hygiene check / backfill / DB trigger use — imported from
//     lib/neo-brain.js, no 4th copy) AND embedding IS NULL. Knowledge rows and
//     anything embedded are never touched.
//   - Per-category guard: if a category's NEWEST row is already older than the
//     cutoff (it went quiet), the category is SKIPPED entirely — we never delete
//     the last-known state/cursor of a paused writer. Active writers (daily) keep
//     all rows newer than the cutoff, well beyond the supervisor's 7-day dedup
//     window and any drift-compare window.
//
// USAGE
//   node tools/prune-operational-memories.js                 # dry-run, 30d
//   node tools/prune-operational-memories.js --days 14       # dry-run, 14d
//   node tools/prune-operational-memories.js --days 30 --apply
//
// DRY-RUN by default (read-only). --apply performs the DELETEs.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const { EVENT_CATEGORIES } = createRequire(import.meta.url)('./lib/neo-brain.js');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RETENTION_DAYS = parseInt(args.find((a, i) => args[i - 1] === '--days') || '30', 10);

const envPath = `${homedir()}/Projects/claude-tools-kit/.env`;
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter((l) => l && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; })
    .filter(Boolean),
);
const URL = (env.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL || '').replace(/\/$/, '');
const KEY = env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('FATAL: NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY required'); process.exit(1); }

const H = (extra = {}) => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...extra });

// exact row count for a filter via Content-Range (count=exact, no body pulled)
async function countWhere(filter) {
  const r = await fetch(`${URL}/rest/v1/memories?${filter}&select=id`, {
    headers: H({ Prefer: 'count=exact', Range: '0-0' }),
  });
  if (!r.ok && r.status !== 206) throw new Error(`count ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const cr = r.headers.get('content-range') || '*/0';   // e.g. "0-0/788"
  return parseInt(cr.split('/')[1] || '0', 10);
}
async function newest(category) {
  const r = await fetch(`${URL}/rest/v1/memories?category=eq.${encodeURIComponent(category)}&select=created_at&order=created_at.desc&limit=1`, { headers: H() });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0]?.created_at || null;
}
async function del(filter) {
  const r = await fetch(`${URL}/rest/v1/memories?${filter}`, { method: 'DELETE', headers: H({ Prefer: 'count=exact' }) });
  if (!r.ok && r.status !== 204 && r.status !== 206) throw new Error(`DELETE ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const cr = r.headers.get('content-range') || '*/0';
  return parseInt(cr.split('/')[1] || '0', 10);
}

async function main() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400 * 1000).toISOString();
  console.log(`prune-operational-memories (${APPLY ? 'APPLY' : 'DRY-RUN'}) · retention=${RETENTION_DAYS}d · cutoff=${cutoff.slice(0, 10)}`);
  console.log(`allowlist: ${[...EVENT_CATEGORIES].length} operational categories (from lib/neo-brain.js)\n`);

  let grandPrunable = 0, grandDeleted = 0;
  const cats = [...EVENT_CATEGORIES].sort();
  for (const cat of cats) {
    const catEnc = encodeURIComponent(cat);
    const total = await countWhere(`category=eq.${catEnc}`);
    if (total === 0) continue;
    // only unembedded + older than cutoff are prunable
    const oldNull = await countWhere(`category=eq.${catEnc}&embedding=is.null&created_at=lt.${cutoff}`);
    const latest = await newest(cat);
    const quiet = latest && latest < cutoff;       // newest row already past cutoff → paused writer
    const keep = total - oldNull;

    if (oldNull === 0) { console.log(`  ${cat}: ${total} rows · nothing older than cutoff · skip`); continue; }
    if (quiet) { console.log(`  ${cat}: ${total} rows · QUIET (newest ${latest.slice(0, 10)} < cutoff) · SKIP to preserve last state`); continue; }

    grandPrunable += oldNull;
    if (APPLY) {
      const n = await del(`category=eq.${catEnc}&embedding=is.null&created_at=lt.${cutoff}`);
      grandDeleted += n;
      console.log(`  ${cat}: deleted ${n} (kept ${keep} newer than cutoff)`);
    } else {
      console.log(`  ${cat}: would delete ${oldNull} (keep ${keep} newer than cutoff)`);
    }
  }

  console.log(`\n${APPLY ? `✓ deleted ${grandDeleted}` : `would delete ${grandPrunable}`} operational rows older than ${RETENTION_DAYS}d.`);
  if (!APPLY) console.log('Re-run with --apply to perform the prune.');
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
