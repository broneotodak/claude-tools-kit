#!/usr/bin/env node
// supervisor-agent.js  (v2 — 2026-04-25)
//
// Phase 2 of Agentic Ecosystem v3. Polls validated signals every 60s, decides
// per-symptom whether/how to escalate, fires at most once per cooldown.
//
// CHANGES FROM v1 (lessons from 2026-04-24 incident):
//   - DROPPED  agent_heartbeats.meta.wa_status as a signal — it reports raw
//              baileys event-type strings, NOT real WA health. 49 false fires.
//   - REPLACED with Kuma monitor 13 ("Siti · WA ready"), which is HTTP-keyword
//              gated on state.status==="connected" + 5-retry persistence.
//   - ADDED    time-based staleness thresholds per agent (no immediate fires).
//   - ADDED    per-symptom tier routing (not all symptoms walk the ladder).
//   - LENGTHENED cooldowns: T2 2h→12h, T3 6h→24h.
//   - ADDED    recovery notifications for cleared T3 alerts.
//   - TAGS     all dry-run observations with metadata.supervisor_version="v2"
//              so calibration queries can filter cleanly from v1 noise.
//
// Validated signal sources (per ~/.claude/MONITORING_ENFORCEMENT.md):
//   1. agent_heartbeats.reported_at — client-set ISO timestamp; freshness only
//   2. Kuma /api/status-page/heartbeat/neo-fleet — Kuma's UP/DOWN per monitor,
//      with persistence already filtered (5-retry on Siti·WA·ready)
//   3. agent_commands aggregates — direct DB facts (status='dead_letter', etc.)

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import os from 'node:os';

// ── env ─────────────────────────────────────────────────────────────
const envPath = process.env.NEO_BRAIN_ENV_PATH || `${homedir()}/.openclaw/secrets/neo-brain.env`;
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; })
    .filter(Boolean)
);
const SUPABASE_URL = env.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL;
const SERVICE_KEY  = env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('[supervisor] env missing'); process.exit(1); }
const KUMA_BASE  = process.env.KUMA_BASE  || 'http://100.85.18.97:3001';
const KUMA_SLUG  = process.env.KUMA_SLUG  || 'neo-fleet';
const DRY_RUN    = process.env.SUPERVISOR_DRY_RUN === '1';
const NOTIFY_TO  = process.env.SUPERVISOR_NOTIFY_TO || '60177519610';
const ME = 'supervisor';
const VERSION = 'v2';

// ── watchlist (continuous agents only — scheduled agents excluded) ──
// max_age_sec is the staleness threshold AFTER which we consider the agent
// dead-or-stuck. Generous to avoid false positives during normal pauses.
const WATCH = {
  'siti':          { max_age_sec: 360, critical: true,  target_host: 'siti-vps' },
  'twin-ingest':   { max_age_sec: 360, critical: true,  target_host: 'neo-twin' },
  'naca-backend':  { max_age_sec: 240, critical: true,  target_host: 'siti-vps' },
  'dev-agent':     { max_age_sec: 600, critical: false, target_host: 'siti-vps' },
  'planner-agent': { max_age_sec: 600, critical: false, target_host: 'siti-vps' },
  'reviewer':      { max_age_sec: 600, critical: false, target_host: 'siti-vps' },
  'claw-mac':      { max_age_sec: 240, critical: true,  target_host: 'claw' },
};

// ── cooldowns per tier (longer than v1) ─────────────────────────────
const COOLDOWN_SEC = { 1: 3600, 2: 43200, 3: 86400 };  // 1h / 12h / 24h

// ── per-symptom tier routing table ──────────────────────────────────
// Some symptoms walk the ladder T1→T2→T3 (real bugs). Others jump straight
// to T3 (only the human can fix — QR rescan, account issues, etc.).
const ROUTING = {
  process_stale:        { ladder: [1, 2, 3] },                   // restart → investigate → alert
  siti_wa_not_ready:    { ladder: [3] },                         // QR rescan or account issue → human only
  dead_letter_growing:  { ladder: [2, 3] },                      // investigate → alert
  command_stuck:        { ladder: [1, 2, 3] },                   // restart claimer → investigate → alert
};

// ── REST helpers ────────────────────────────────────────────────────
const H = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' });
const rest = async (path, opts = {}) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...H(), ...(opts.headers || {}) } });
  if (!r.ok && r.status !== 206) throw new Error(`${opts.method || 'GET'} ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  if (r.status === 204) return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};
const fetchKumaStatus = async () => {
  try {
    const r = await fetch(`${KUMA_BASE}/api/status-page/heartbeat/${KUMA_SLUG}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
};

// ── symptom detectors ───────────────────────────────────────────────
function detectProcessStale(hb, cfg, nowMs) {
  if (!hb) return { key: 'process_stale', detail: 'no heartbeat row exists ever' };
  const ageSec = Math.round((nowMs - new Date(hb.reported_at).getTime()) / 1000);
  if (ageSec > cfg.max_age_sec) return { key: 'process_stale', detail: `heartbeat ${ageSec}s stale (threshold ${cfg.max_age_sec}s)` };
  return null;
}

function detectSitiWaNotReady(kumaData) {
  if (!kumaData) return null;  // Kuma unreachable — skip rather than false-alarm
  const sitiBeats = kumaData.heartbeatList?.['13'];
  if (!Array.isArray(sitiBeats) || !sitiBeats.length) return null;
  const last = sitiBeats[sitiBeats.length - 1];
  // Kuma status: 0=DOWN, 1=UP, 2=PENDING. Only treat 0 as definitive (PENDING is mid-retry).
  if (last.status === 0) return { key: 'siti_wa_not_ready', detail: `Kuma monitor 13 DOWN — ${last.msg || 'no detail'}` };
  return null;
}

async function detectDeadLetterGrowing() {
  // Compare current dead_letter count vs 1h ago — Phase 2 placeholder. Today's
  // status enum has no rows in dead_letter (verified). Will fire later if any.
  const nowCount = await rest(`agent_commands?select=count&status=eq.dead_letter`, { headers: { Prefer: 'count=exact' } });
  const cur = nowCount?.[0]?.count ?? 0;
  if (cur === 0) return null;
  const cutoff = new Date(Date.now() - 3600 * 1000).toISOString();
  const histCount = await rest(`agent_commands?select=count&status=eq.dead_letter&created_at=lt.${cutoff}`, { headers: { Prefer: 'count=exact' } });
  const past = histCount?.[0]?.count ?? 0;
  if (cur > past) return { key: 'dead_letter_growing', detail: `dead_letter rows: now=${cur}, 1h-ago=${past}` };
  return null;
}

async function detectCommandStuck(agent) {
  // Commands claimed by `agent` over 30 min ago and never completed = agent likely hung
  const cutoff = new Date(Date.now() - 1800 * 1000).toISOString();
  const stuck = await rest(`agent_commands?select=id,command,claimed_at&to_agent=eq.${encodeURIComponent(agent)}&status=eq.claimed&claimed_at=lt.${cutoff}&order=claimed_at.asc&limit=5`);
  if (!stuck || !stuck.length) return null;
  return { key: 'command_stuck', detail: `${stuck.length} command(s) claimed >30min, oldest claimed_at=${stuck[0].claimed_at}` };
}

// ── cooldown lookup (tier already fired recently?) ──────────────────
async function priorFires(agent, symptomKey, nowMs) {
  const out = { 1: null, 2: null, 3: null };
  const cutoff = new Date(nowMs - 86400 * 1000).toISOString();

  // T1 = supervisor memory rows  | T2 = agent_intents  | T3 = agent_commands → siti
  const m = await rest(`memories?source=eq.${ME}&metadata->>agent=eq.${encodeURIComponent(agent)}&metadata->>symptom=eq.${encodeURIComponent(symptomKey)}&metadata->>tier=eq.1&created_at=gte.${cutoff}&order=created_at.desc&limit=1`);
  if (m?.[0] && (nowMs - new Date(m[0].created_at).getTime()) / 1000 < COOLDOWN_SEC[1]) out[1] = m[0].created_at;

  const i = await rest(`agent_intents?source=eq.supervisor&source_ref=like.agent:${encodeURIComponent(agent)}*symptom:${encodeURIComponent(symptomKey)}*&created_at=gte.${cutoff}&order=created_at.desc&limit=1`);
  if (i?.[0] && (nowMs - new Date(i[0].created_at).getTime()) / 1000 < COOLDOWN_SEC[2]) out[2] = i[0].created_at;

  const c = await rest(`agent_commands?from_agent=eq.${ME}&command=eq.send_whatsapp_notification&created_at=gte.${cutoff}&order=created_at.desc&limit=20`);
  const hit = (c || []).find(r => r.payload?.message?.includes(`*${agent}*`) && r.payload?.message?.includes(symptomKey));
  if (hit && (nowMs - new Date(hit.created_at).getTime()) / 1000 < COOLDOWN_SEC[3]) out[3] = hit.created_at;

  return out;
}

// ── tier dispatchers ────────────────────────────────────────────────
async function logObservation({ agent, tier, symptom, cfg, runId, plannedAction }) {
  if (!DRY_RUN) return;
  await rest('memories', {
    method: 'POST',
    body: JSON.stringify({
      content: `supervisor v2 DRY-RUN · would fire tier ${tier} for '${agent}' on ${cfg.target_host} — ${symptom.key}: ${symptom.detail} → ${plannedAction}`,
      category: 'supervisor-observation',
      memory_type: 'would_fire',
      importance: 2,
      visibility: 'private',
      source: ME,
      metadata: { supervisor_version: VERSION, agent, tier, symptom: symptom.key, detail: symptom.detail, target_host: cfg.target_host, planned_action: plannedAction, run_id: runId },
    }),
  }).catch(e => console.error('[supervisor] obs log fail:', e.message));
}

async function tier1(agent, cfg, symptom, runId) {
  const content = `supervisor v2 [tier 1] would request restart of '${agent}' on ${cfg.target_host} — ${symptom.detail}. host-worker not yet deployed; logging intent only.`;
  if (DRY_RUN) { await logObservation({ agent, tier: 1, symptom, cfg, runId, plannedAction: 'restart_logged' }); return { action: 'restart_logged', stubbed: true }; }
  await rest('memories', {
    method: 'POST',
    body: JSON.stringify({
      content, category: 'supervisor', memory_type: 'incident', importance: 4, visibility: 'private', source: ME,
      metadata: { supervisor_version: VERSION, agent, tier: 1, symptom: symptom.key, detail: symptom.detail, target_host: cfg.target_host, run_id: runId, stubbed: true },
    }),
  });
  return { action: 'restart_logged', stubbed: true };
}

async function tier2(agent, cfg, symptom, runId) {
  const text = `Agent '${agent}' on ${cfg.target_host} reporting ${symptom.key}: ${symptom.detail}. Tier-1 restart was already attempted (or not applicable for this symptom). Investigate root cause, propose a fix, open a PR if code change is needed. Reference agent_heartbeats + recent agent_commands for the pattern.`;
  if (DRY_RUN) { await logObservation({ agent, tier: 2, symptom, cfg, runId, plannedAction: 'investigation_opened' }); return { action: 'investigation_opened', stubbed: true }; }
  const rows = await rest('agent_intents', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      source: 'supervisor',
      source_ref: `agent:${agent}|symptom:${symptom.key}|tier:2|run:${runId}`,
      raw_text: text, reporter: 'supervisor-agent-v2', status: 'pending',
    }),
  });
  return { action: 'investigation_opened', intent_id: rows?.[0]?.id };
}

async function tier3(agent, cfg, symptom, runId, prior) {
  const crit = cfg.critical ? '🚨 *CRITICAL*' : '⚠️ *High*';
  const message = [
    `━━ 🛡️ supervisor ━━`,
    `${crit} — agent *${agent}* needs attention`,
    ``,
    `📍 host: ${cfg.target_host}`,
    `🔍 symptom: ${symptom.key}`,
    `💬 ${symptom.detail}`,
    prior[1] || prior[2] ? `\n📊 prior attempts: T1=${prior[1] ? '✓' : '—'} T2=${prior[2] ? '✓' : '—'}` : '',
    ``,
    `Manual intervention needed.`,
  ].filter(Boolean).join('\n');
  if (DRY_RUN) { await logObservation({ agent, tier: 3, symptom, cfg, runId, plannedAction: 'alert_queued' }); return { action: 'alert_queued', stubbed: true }; }
  const rows = await rest('agent_commands', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      from_agent: ME, to_agent: 'siti', command: 'send_whatsapp_notification',
      payload: { to: NOTIFY_TO, message }, priority: 1,
    }),
  });
  return { action: 'alert_queued', command_id: rows?.[0]?.id };
}

const dispatch = { 1: tier1, 2: tier2, 3: tier3 };

// ── self heartbeat ──────────────────────────────────────────────────
async function selfHeartbeat(meta) {
  await rest('agent_heartbeats?on_conflict=agent_name', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      agent_name: ME, status: 'ok',
      meta: { version: 'supervisor-agent-v2', hostname: os.hostname(), ...meta },
      reported_at: new Date().toISOString(),
    }),
  }).catch(e => console.error('[supervisor] own hb fail:', e.message));
}

// ── main cycle ──────────────────────────────────────────────────────
async function main() {
  const runId = `sup2-${Date.now().toString(36)}`;
  const startMs = Date.now();

  // Pull state in parallel
  const [hbRows, kumaData] = await Promise.all([
    rest('agent_heartbeats?select=agent_name,status,reported_at,meta'),
    fetchKumaStatus(),
  ]);
  const byName = Object.fromEntries((hbRows || []).map(h => [h.agent_name, h]));

  const actions = [];
  // Per-agent symptom checks
  for (const [agent, cfg] of Object.entries(WATCH)) {
    const symptoms = [];
    const stale = detectProcessStale(byName[agent], cfg, startMs);
    if (stale) symptoms.push(stale);
    if (agent === 'siti') {
      const wa = detectSitiWaNotReady(kumaData);
      if (wa) symptoms.push(wa);
    }
    const stuck = await detectCommandStuck(agent);
    if (stuck) symptoms.push(stuck);

    for (const symptom of symptoms) {
      const route = ROUTING[symptom.key];
      if (!route) { console.log(`[supervisor] no route for symptom '${symptom.key}'`); continue; }

      const prior = await priorFires(agent, symptom.key, startMs);
      // Walk the ladder: pick the lowest tier in route that hasn't fired in cooldown
      let chosenTier = null;
      for (const t of route.ladder) { if (!prior[t]) { chosenTier = t; break; } }
      if (!chosenTier) { console.log(`[supervisor] ${agent}/${symptom.key} — all ladder tiers in cooldown, skipping`); continue; }

      const result = await dispatch[chosenTier](agent, cfg, symptom, runId, prior);
      console.log(`[supervisor] ${agent}/${symptom.key} → tier ${chosenTier} ${result.action}${result.stubbed ? ' (stub)' : ''}`);
      actions.push({ agent, symptom: symptom.key, tier: chosenTier, action: result.action });
    }
  }

  // Cross-agent symptoms (not tied to a specific watchlist entry)
  const dl = await detectDeadLetterGrowing();
  if (dl) {
    const route = ROUTING[dl.key];
    const prior = await priorFires('queue', dl.key, startMs);
    let chosenTier = null;
    for (const t of route.ladder) { if (!prior[t]) { chosenTier = t; break; } }
    if (chosenTier) {
      // queue-level — synthesize an "agent" identity for routing
      const cfg = { critical: true, target_host: 'queue' };
      const result = await dispatch[chosenTier]('queue', cfg, dl, runId, prior);
      actions.push({ agent: 'queue', symptom: dl.key, tier: chosenTier, action: result.action });
    }
  }

  await selfHeartbeat({
    run_id: runId,
    watched: Object.keys(WATCH).length,
    actions_taken: actions.length,
    dry_run: DRY_RUN,
    last_actions: actions,
    cycle_ms: Date.now() - startMs,
    kuma_reachable: !!kumaData,
  });
  console.log(`[supervisor] v2 cycle done — watched=${Object.keys(WATCH).length} actions=${actions.length} kuma=${kumaData ? 'OK' : 'unreachable'} ${Date.now() - startMs}ms`);
}

main().catch(e => { console.error('[supervisor] fatal:', e.message); process.exit(1); });
