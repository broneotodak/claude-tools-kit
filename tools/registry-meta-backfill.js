#!/usr/bin/env node
// registry-meta-backfill.js
//
// Normalises agent_registry.meta and project_registry.metadata to the canonical
// shape defined in naca/docs/spec/agent-registry-schema-v1.md.
//
// PURELY ADDITIVE: only writes keys that are missing on a row. Existing keys
// (including non-canonical ones) are preserved untouched. Re-running is safe.
//
// USAGE
//   node registry-meta-backfill.js               # dry-run (prints diffs, no writes)
//   node registry-meta-backfill.js --apply       # write changes
//   node registry-meta-backfill.js --agent siti  # restrict to one agent (dry-run)
//
// Read by no other module. One-shot migration helper; safe to delete after the
// registry-driven core arc lands.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SINGLE = args.find((a, i) => args[i - 1] === '--agent');

// ── env ─────────────────────────────────────────────────────────────
const envPath = `${process.env.HOME}/.openclaw/secrets/neo-brain.env`;
let env = {};
try {
  env = Object.fromEntries(
    readFileSync(envPath, 'utf8').split('\n')
      .filter(l => l && !l.trimStart().startsWith('#'))
      .map(l => { const i = l.indexOf('='); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; })
      .filter(Boolean),
  );
} catch { /* fall through to process.env */ }
const URL = env.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL;
const KEY = env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY required'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// ── canonical source values (paste from current hardcoded modules) ──
// Source: claude-tools-kit/tools/supervisor-agent.js WATCH dict, ~line 51
const SUPERVISOR_WATCH = {
  'siti':          { monitor_threshold_sec: 360, is_critical: true },
  'twin-ingest':   { monitor_threshold_sec: 360, is_critical: true },
  'naca-backend':  { monitor_threshold_sec: 240, is_critical: true },
  'dev-agent':     { monitor_threshold_sec: 600, is_critical: false },
  'planner-agent': { monitor_threshold_sec: 600, is_critical: false },
  'reviewer':      { monitor_threshold_sec: 600, is_critical: false },
  'claw-mac':      { monitor_threshold_sec: 240, is_critical: true },
};

// Source: siti-v2/src/interface/outbound-bridge.js AGENT_LABELS, ~line 70
// (Read from disk so we don't double-edit when the source changes.)
function loadOutboundConstants() {
  try {
    const src = readFileSync(`${process.env.HOME}/Projects/siti-v2/src/interface/outbound-bridge.js`, 'utf8');
    const labels = {};
    const labelMatch = src.match(/AGENT_LABELS\s*=\s*\{([\s\S]*?)\};/);
    if (labelMatch) {
      for (const m of labelMatch[1].matchAll(/'([\w-]+)':\s*'([^']+)'/g)) {
        labels[m[1]] = m[2];
      }
    }
    const digest = new Set();
    const digestMatch = src.match(/DIGEST_FROM_AGENTS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    if (digestMatch) {
      for (const m of digestMatch[1].matchAll(/'([\w-]+)'/g)) digest.add(m[1]);
    }
    return { labels, digest };
  } catch { return { labels: {}, digest: new Set() }; }
}
const OUTBOUND = loadOutboundConstants();

// Source: naca-app/backend/server.js GitHub mention list, ~line 1555
const GITHUB_MENTIONABLE = new Set(['dev-agent', 'planner-agent', 'reviewer-agent', 'reviewer', 'siti']);

// Core services planner-agent expects to find when loading registry.
const CORE_SERVICES = new Set(['dev-agent', 'siti', 'reviewer', 'planner-agent']);

// Kuma monitor ids. Source: supervisor-agent.js line 109 (`heartbeatList?.['13']`).
const KUMA_MONITOR_IDS = { 'siti': 13 };

// ── host + runtime inference from existing meta clues ───────────────
function inferHostAndRuntime(name, meta) {
  const out = {};
  const m = meta || {};

  // runtime
  if (m.runtime) out.runtime = m.runtime;
  else if (m.pm2_label || m.pm2_process_name) out.runtime = 'pm2';
  else if (m.launchd_label || m.launchd) out.runtime = 'launchd';
  else if (m.container_name) out.runtime = 'docker';
  else if (m.firmware) out.runtime = 'n/a';                  // ESP32 etc
  else if (m.hardware && /Pi /.test(m.hardware)) out.runtime = 'n/a';

  // host
  const pathHint = m.path || m.host_path || m.vps_path || m.docker_compose_path || m.source_path || '';
  if (m.tailnet_ip === '100.126.89.7') out.host = 'tr-home';
  else if (m.tailnet_ip === '100.93.211.9') out.host = 'slave-mbp';
  else if (m.tailnet_ip === '100.114.3.1') out.host = 'naca-pi';
  else if (m.tailnet_ip === '100.95.222.11') out.host = 'neo-mbp';
  else if (m.firmware === 'light_ai') out.host = 'xiaozhi-dog';
  else if (pathHint.startsWith('/volume1/') || /\bnas\b/i.test(pathHint)) out.host = 'nas-ugreen';
  else if (pathHint.startsWith('/Users/zieel/')) out.host = 'claw';
  else if (pathHint.startsWith('/Users/broneotodak/')) out.host = 'neo-mbp';
  else if (pathHint.startsWith('/home/openclaw/')) out.host = 'siti-vps';
  else if (m.launchd_label?.startsWith('ai.openclaw.')) out.host = 'claw';
  else if (m.launchd_label?.startsWith('com.openclaw.')) out.host = m.tailnet_name === 'macbook-pro-2' ? 'neo-mbp' : 'claw';
  // explicit name-based fallback for agents whose registry rows are sparse
  else if (name === 'tr-home') out.host = 'tr-home';
  else if (name === 'neo-mbp') out.host = 'neo-mbp';
  else if (name === 'naca-pi') out.host = 'naca-pi';
  else if (name === 'nas-ugreen') out.host = 'nas-ugreen';
  else if (name === 'claw-mac') out.host = 'claw';
  else if (name === 'siti-ingest' || name === 'siti-router' || name === 'naca-backend' || name === 'siti' || name === 'naca-monitor') out.host = 'siti-vps';
  else if (['dev-agent', 'planner-agent', 'reviewer'].includes(name)) out.host = 'tr-home';      // Phase 8 move
  else if (['timekeeper', 'toolsmith', 'verifier-agent', 'poster-agent', 'daily-checkup'].includes(name)) out.host = 'nas-ugreen';
  else if (name === 'supervisor' || name === 'twin-autoreply' || name === 'plaud-pipeline' || name === 'pr-decision-dispatcher' || name === 'backup-sync') out.host = 'claw';
  else if (name === 'browser-agent' || name === 'publisher-agent') out.host = 'slave-mbp';
  else if (name === 'twin-ingest' || name === 'neo-twin') out.host = 'neo-twin';
  else if (name === 'xiaozhi-dog') out.host = 'xiaozhi-dog';

  return out;
}

// ── per-row backfill computation ────────────────────────────────────
function backfillAgentMeta(row) {
  const name = row.agent_name;
  const current = row.meta || {};
  const additions = {};

  const { host, runtime } = inferHostAndRuntime(name, current);
  if (!current.host && host) additions.host = host;
  if (!current.runtime && runtime) additions.runtime = runtime;

  // Monitor / heartbeat
  const sup = SUPERVISOR_WATCH[name];
  if (sup) {
    if (current.monitor_threshold_sec == null) additions.monitor_threshold_sec = sup.monitor_threshold_sec;
    if (current.is_critical == null) additions.is_critical = sup.is_critical;
  }
  if (KUMA_MONITOR_IDS[name] != null && current.kuma_monitor_id == null) {
    additions.kuma_monitor_id = KUMA_MONITOR_IDS[name];
  }

  // Display / outbound
  if (OUTBOUND.labels[name] && !current.outbound_label) additions.outbound_label = OUTBOUND.labels[name];
  if (OUTBOUND.digest.has(name) && current.digest_queue == null) additions.digest_queue = true;

  // Routing / integration
  if (GITHUB_MENTIONABLE.has(name) && current.github_mentionable == null) additions.github_mentionable = true;
  if (CORE_SERVICES.has(name) && current.is_core_service == null) additions.is_core_service = true;

  return additions;
}

function backfillProjectMetadata(row) {
  const additions = {};
  const meta = row.metadata || {};
  // Deprecated sentinel "NO_DEPLOY" → use deploy_url=null + metadata.skip_verify=true.
  // This script doesn't touch deploy_url; only marks rows where verifier-agent
  // currently treats them as skip. The actual deploy_url normalisation happens
  // in the verifier-agent migration PR.
  if (row.deploy_url === 'NO_DEPLOY' && meta.skip_verify == null) {
    additions.skip_verify = true;
  }
  return additions;
}

// ── main ────────────────────────────────────────────────────────────
async function getJson(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function patchMeta(table, idCol, idVal, mergedMeta, metaCol = 'meta') {
  const url = `${URL}/rest/v1/${table}?${idCol}=eq.${encodeURIComponent(idVal)}`;
  const body = { [metaCol]: mergedMeta };
  const r = await fetch(url, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${table}/${idVal} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

(async () => {
  console.log(`registry-meta-backfill (${APPLY ? 'APPLY' : 'DRY-RUN'}${SINGLE ? ` agent=${SINGLE}` : ''})`);
  console.log(`outbound labels loaded: ${Object.keys(OUTBOUND.labels).length}, digest set size: ${OUTBOUND.digest.size}`);
  console.log('---');

  // agent_registry
  const agents = await getJson('agent_registry?select=agent_name,meta,status');
  let touchedAgents = 0;
  for (const row of agents) {
    if (SINGLE && row.agent_name !== SINGLE) continue;
    if (row.status === 'archived') continue;
    const adds = backfillAgentMeta(row);
    if (Object.keys(adds).length === 0) continue;
    touchedAgents++;
    console.log(`[agent] ${row.agent_name}`);
    for (const [k, v] of Object.entries(adds)) console.log(`    + ${k} = ${JSON.stringify(v)}`);
    if (APPLY) {
      const merged = { ...(row.meta || {}), ...adds };
      await patchMeta('agent_registry', 'agent_name', row.agent_name, merged, 'meta');
    }
  }

  console.log('---');

  // project_registry
  const projects = await getJson('project_registry?select=project,metadata,deploy_url,active');
  let touchedProjects = 0;
  for (const row of projects) {
    if (row.active === false) continue;
    const adds = backfillProjectMetadata(row);
    if (Object.keys(adds).length === 0) continue;
    touchedProjects++;
    console.log(`[project] ${row.project}`);
    for (const [k, v] of Object.entries(adds)) console.log(`    + ${k} = ${JSON.stringify(v)}`);
    if (APPLY) {
      const merged = { ...(row.metadata || {}), ...adds };
      await patchMeta('project_registry', 'project', row.project, merged, 'metadata');
    }
  }

  console.log('---');
  console.log(`${APPLY ? 'wrote' : 'would write'} ${touchedAgents} agent row(s), ${touchedProjects} project row(s)`);
})().catch(e => { console.error('fatal:', e.message); process.exit(1); });
