#!/usr/bin/env node
// fleet-trend.js
// CLI: render ASCII sparklines + summary stats for the fleet from agent_metrics.
//
// Usage:
//   node tools/fleet-trend.js                    # all agents, last 24h
//   node tools/fleet-trend.js twin-ingest        # one agent, last 24h
//   node tools/fleet-trend.js twin-ingest 6h     # one agent, last 6h
//   node tools/fleet-trend.js all 1h             # all agents, last 1h
//
// Reads from neo-brain via PostgREST (no SDK dep, just env).
// Renders memory_mb sparklines, status %, and supervisor fire counts in window.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const envPath = process.env.NEO_BRAIN_ENV_PATH
  || `${homedir()}/.openclaw/secrets/neo-brain.env`;

let env = {};
for (const candidate of [envPath, `${homedir()}/Projects/claude-tools-kit/.env`]) {
  try {
    env = {
      ...Object.fromEntries(
        readFileSync(candidate, 'utf8').split('\n')
          .filter(l => l && !l.trimStart().startsWith('#'))
          .map(l => { const i = l.indexOf('='); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; })
          .filter(Boolean)
      ),
      ...env,
    };
    if (env.NEO_BRAIN_URL) break;
  } catch {}
}
const URL = env.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL;
const KEY = env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('NEO_BRAIN_URL / NEO_BRAIN_SERVICE_ROLE_KEY missing'); process.exit(1); }

// ── args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const agentArg = args[0] && args[0] !== 'all' ? args[0] : null;
const windowArg = args[1] || args[0]?.match(/^\d+[hd]$/) ? (args[1] || args[0]) : '24h';
const win = parseWindow(windowArg);

function parseWindow(s) {
  const m = (s || '24h').match(/^(\d+)([hd])$/);
  if (!m) return 24 * 3600 * 1000;
  const n = parseInt(m[1], 10);
  return n * (m[2] === 'd' ? 86400 : 3600) * 1000;
}

// ── helpers ─────────────────────────────────────────────────────────
const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
function sparkline(values) {
  if (!values.length) return '(no data)';
  const filtered = values.filter(v => v !== null && Number.isFinite(v));
  if (!filtered.length) return '(no numeric data)';
  const min = Math.min(...filtered), max = Math.max(...filtered);
  const range = max - min || 1;
  return values.map(v => {
    if (v === null || !Number.isFinite(v)) return ' ';
    const idx = Math.min(SPARK_CHARS.length - 1, Math.floor(((v - min) / range) * SPARK_CHARS.length));
    return SPARK_CHARS[idx];
  }).join('');
}

const COL = { dim: '\x1b[2m', off: '\x1b[0m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', b: '\x1b[1m' };

function statusColor(status) {
  return status === 'ok' ? COL.g : status === 'degraded' ? COL.y : COL.r;
}

async function rest(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${path}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// ── fetch metrics ───────────────────────────────────────────────────
const cutoff = new Date(Date.now() - win).toISOString();
const filter = agentArg ? `agent_name=eq.${encodeURIComponent(agentArg)}&` : '';
const rows = await rest(`agent_metrics?${filter}select=agent_name,ts,status,meta&ts=gte.${cutoff}&order=ts.asc&limit=20000`);

if (!rows.length) {
  console.error(`No metrics in last ${windowArg}${agentArg ? ` for ${agentArg}` : ''}`);
  process.exit(0);
}

// Group by agent
const byAgent = {};
for (const r of rows) {
  if (!byAgent[r.agent_name]) byAgent[r.agent_name] = [];
  byAgent[r.agent_name].push(r);
}

// Bucket into ~50 cells across the window for sparkline
const SPARK_WIDTH = 50;
const bucketMs = win / SPARK_WIDTH;
const startMs = Date.now() - win;

function bucketize(rows, key) {
  const buckets = Array(SPARK_WIDTH).fill(null).map(() => []);
  for (const r of rows) {
    const t = new Date(r.ts).getTime();
    const idx = Math.min(SPARK_WIDTH - 1, Math.max(0, Math.floor((t - startMs) / bucketMs)));
    const v = r.meta?.[key];
    if (typeof v === 'number') buckets[idx].push(v);
  }
  return buckets.map(b => b.length ? b.reduce((a, c) => a + c, 0) / b.length : null);
}

// ── supervisor fires in window ──────────────────────────────────────
const obsRows = await rest(`memories?source=eq.supervisor&category=eq.supervisor-observation&created_at=gte.${cutoff}&select=metadata,created_at`).catch(() => []);
const liveRows = await rest(`memories?source=eq.supervisor&category=eq.supervisor&memory_type=eq.incident&created_at=gte.${cutoff}&select=metadata,created_at`).catch(() => []);
const intentRows = await rest(`agent_intents?source=eq.supervisor&created_at=gte.${cutoff}&select=source_ref,created_at`).catch(() => []);

function tierCounts(rows) {
  const c = { 1: 0, 2: 0, 3: 0 };
  for (const r of rows) {
    const t = parseInt(r.metadata?.tier, 10);
    if (c[t] !== undefined) c[t]++;
  }
  return c;
}
const obsTiers = tierCounts(obsRows);
const liveT1 = liveRows.length;
const liveT2 = intentRows.length;

// ── render ──────────────────────────────────────────────────────────
const totalSamples = rows.length;
const agentCount = Object.keys(byAgent).length;
const HR = '─'.repeat(78);
console.log();
console.log(`${COL.b}🛡️  Fleet Trend — last ${windowArg}${COL.off} ${COL.dim}(${agentCount} agents · ${totalSamples} samples · since ${new Date(startMs).toISOString().slice(11, 16)} UTC)${COL.off}`);
console.log(HR);

const colWidth = 16;
console.log(`  ${'agent'.padEnd(colWidth)}  memory_mb sparkline${' '.repeat(SPARK_WIDTH - 18)}  range       status mix`);
console.log(HR);
for (const [agent, agentRows] of Object.entries(byAgent).sort()) {
  const memSeries = bucketize(agentRows, 'memory_mb');
  const memNums = memSeries.filter(v => v !== null && Number.isFinite(v));
  const memMin = memNums.length ? Math.min(...memNums).toFixed(0) : '—';
  const memMax = memNums.length ? Math.max(...memNums).toFixed(0) : '—';
  const range = memNums.length ? `${memMin}-${memMax} MB`.padEnd(11) : '—'.padEnd(11);
  // Status mix
  const statusCounts = {};
  for (const r of agentRows) statusCounts[r.status || 'unknown'] = (statusCounts[r.status || 'unknown'] || 0) + 1;
  const total = agentRows.length;
  const mixStr = Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([s, c]) => `${statusColor(s)}${s} ${Math.round(100 * c / total)}%${COL.off}`)
    .join(' ');
  const lastStatus = agentRows[agentRows.length - 1].status;
  const dot = `${statusColor(lastStatus)}●${COL.off}`;
  console.log(`  ${dot} ${agent.padEnd(colWidth - 2)}  ${sparkline(memSeries)}  ${range}  ${mixStr}`);
}
console.log(HR);

// ── supervisor section ─────────────────────────────────────────────
console.log();
console.log(`${COL.b}🛡️  Supervisor activity — last ${windowArg}${COL.off}`);
if (obsRows.length === 0 && liveT1 + liveT2 + 0 === 0) {
  console.log(`  ${COL.dim}(no fires — clean window)${COL.off}`);
} else {
  console.log(`  ${COL.c}DRY-RUN observations${COL.off}: T1=${obsTiers[1]} T2=${obsTiers[2]} T3=${obsTiers[3]} (${obsRows.length} total)`);
  console.log(`  ${COL.g}LIVE actions${COL.off}:        T1=${liveT1} T2=${liveT2} T3=?  (T3 alerts go to WhatsApp)`);
  if (obsRows.length) {
    const byKey = {};
    for (const r of obsRows) {
      const k = `${r.metadata?.agent || '?'}/${r.metadata?.symptom || '?'}/T${r.metadata?.tier || '?'}`;
      byKey[k] = (byKey[k] || 0) + 1;
    }
    console.log();
    console.log(`  Top observation patterns:`);
    Object.entries(byKey).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([k, c]) => {
      console.log(`    ${COL.dim}·${COL.off} ${k.padEnd(40)} ${COL.dim}× ${c}${COL.off}`);
    });
  }
}
console.log();
