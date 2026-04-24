#!/usr/bin/env node
// supervisor-agent.js
// Phase 2 of Agentic Ecosystem v3 — the "traffic cop" of the fleet.
//
// Runs on CLAW every 60s via launchd. Reads agent_heartbeats from neo-brain,
// detects issues, dispatches the right agent to respond via the tiered
// escalation ladder:
//
//   Tier 1 — QUICK FIX      : transient issue, request a restart
//                             (stubbed today; host-worker lands in v2)
//   Tier 2 — INVESTIGATE    : open an agent_intents row so planner-agent can
//                             decompose → dev-agent investigates → PR flow
//   Tier 3 — ALERT HUMAN    : queue a Siti send_whatsapp_notification to Neo
//
// Supervisor does NOT do the fix — it routes to the agent that should.
// Every action is idempotent: for each (agent, tier) pair we only fire once
// per cooldown window, tracked by reading our own recent writes.
//
// Env (via ~/.openclaw/secrets/neo-brain.env):
//   NEO_BRAIN_URL, NEO_BRAIN_SERVICE_ROLE_KEY
// Env (optional):
//   SUPERVISOR_DRY_RUN=1   — detect+log but don't write anything
//   SUPERVISOR_NOTIFY_TO   — WA target (default 60177519610)

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import os from 'node:os';

// ── env loader ──────────────────────────────────────────────────────
const envPath = process.env.NEO_BRAIN_ENV_PATH || `${homedir()}/.openclaw/secrets/neo-brain.env`;
let env = {};
try {
  env = Object.fromEntries(
    readFileSync(envPath, 'utf8').split('\n')
      .filter(l => l && !l.trimStart().startsWith('#'))
      .map(l => {
        const i = l.indexOf('=');
        return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
      })
      .filter(Boolean)
  );
} catch (e) {
  console.error(`[supervisor] failed to read ${envPath}: ${e.message}`);
  process.exit(1);
}

const SUPABASE_URL = env.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL;
const SERVICE_KEY  = env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[supervisor] NEO_BRAIN_URL or NEO_BRAIN_SERVICE_ROLE_KEY missing');
  process.exit(1);
}
const DRY_RUN     = process.env.SUPERVISOR_DRY_RUN === '1';
const NOTIFY_TO   = process.env.SUPERVISOR_NOTIFY_TO || '60177519610';
const ME          = 'supervisor';

// ── watched agents ──────────────────────────────────────────────────
// Continuous agents only. Scheduled agents (backup-sync, person-sync) report
// on their own cadence and show 'offline' between runs — they're governed by
// Uptime Kuma push monitors instead.
const WATCHLIST = {
  'siti':          { max_age_sec: 240, critical: true,  target_host: 'siti-vps' },
  'twin-ingest':   { max_age_sec: 240, critical: true,  target_host: 'neo-twin' },
  'naca-backend':  { max_age_sec: 180, critical: true,  target_host: 'siti-vps' },
  'dev-agent':     { max_age_sec: 300, critical: false, target_host: 'siti-vps' },
  'planner-agent': { max_age_sec: 300, critical: false, target_host: 'siti-vps' },
  'reviewer':      { max_age_sec: 300, critical: false, target_host: 'siti-vps' },
  'claw-mac':      { max_age_sec: 180, critical: true,  target_host: 'claw' },
};

// Cooldowns — once we fire a tier for an agent, don't repeat within this window.
const COOLDOWN_SEC = { 1: 1800, 2: 7200, 3: 21600 }; // 30m / 2h / 6h

// ── REST helpers ────────────────────────────────────────────────────
const H = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' });

const rest = async (path, opts = {}) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...H(), ...(opts.headers || {}) } });
  if (!r.ok && r.status !== 206) {
    const t = await r.text();
    throw new Error(`${opts.method || 'GET'} ${path} → ${r.status}: ${t.slice(0, 200)}`);
  }
  if (r.status === 204) return null;
  const text = await r.text();
  if (!text) return null; // Prefer=minimal returns empty body on 2xx
  return JSON.parse(text);
};

// ── detection ───────────────────────────────────────────────────────
/** Classify one heartbeat into a symptom (or null if healthy). */
function classify(hb, cfg, nowMs) {
  const ageSec = Math.round((nowMs - new Date(hb.reported_at).getTime()) / 1000);
  if (ageSec > cfg.max_age_sec) return { key: 'stale', detail: `no heartbeat for ${ageSec}s (>${cfg.max_age_sec}s)` };
  if (hb.status === 'offline')  return { key: 'offline', detail: 'agent self-reported offline' };
  if (hb.status === 'degraded') {
    // Peek at meta for extra context
    if (hb.meta?.wa_status === 'disconnected') return { key: 'wa_disconnected', detail: 'Siti WA connection dropped' };
    return { key: 'degraded', detail: `status=degraded` };
  }
  return null;
}

/** Which tier should we escalate to for this symptom + agent? */
function chooseTier(symptom, priorFiresByTier) {
  // Tier 2 already fired in cooldown → move to Tier 3 (human)
  if (priorFiresByTier[2]) return 3;
  // Tier 1 already fired in cooldown → Tier 2 (investigate)
  if (priorFiresByTier[1]) return 2;
  // wa_disconnected skips Tier 1 (no pm2 restart fixes an expired WA session)
  if (symptom.key === 'wa_disconnected') return 2;
  // First sight of stale/offline/degraded → Tier 1 (quick restart)
  return 1;
}

// ── dispatch actions ────────────────────────────────────────────────
// In DRY_RUN, every "would-fire" decision is persisted as a memory row so we can
// query a full 24h of observations tomorrow and calibrate thresholds from real
// frequencies (how noisy is each agent? which symptoms flap?) instead of guessing.
async function logObservation({ agent, tier, symptom, cfg, runId, plannedAction }) {
  if (!DRY_RUN) return;
  try {
    await rest('memories', {
      method: 'POST',
      body: JSON.stringify({
        content: `supervisor DRY-RUN · would fire tier ${tier} for '${agent}' on ${cfg.target_host} — ${symptom.key}: ${symptom.detail} → ${plannedAction}`,
        category: 'supervisor-observation',
        memory_type: 'would_fire',
        importance: 2,
        visibility: 'private',
        source: ME,
        metadata: { agent, tier, symptom: symptom.key, detail: symptom.detail, target_host: cfg.target_host, planned_action: plannedAction, run_id: runId },
      }),
    });
  } catch (e) { console.error('[supervisor] observation log failed:', e.message); }
}

async function tier1_requestRestart(agent, cfg, symptom, runId) {
  // v1: host-worker pattern isn't deployed yet, so don't write an executable command
  // that would sit pending forever. Instead, log the intent as a memory row.
  // When host-worker@<host> ships, swap this for an agent_commands insert.
  const content = `supervisor [tier 1] would restart '${agent}' on ${cfg.target_host} — ${symptom.detail}. host-worker not yet deployed; logging intent only.`;
  if (DRY_RUN) {
    console.log('DRY RUN ·', content);
    await logObservation({ agent, tier: 1, symptom, cfg, runId, plannedAction: 'restart_logged' });
    return { action: 'restart_logged', stubbed: true };
  }
  await rest('memories', {
    method: 'POST',
    body: JSON.stringify({
      content, category: 'supervisor', memory_type: 'incident', importance: 4, visibility: 'private',
      source: ME, metadata: { agent, tier: 1, symptom: symptom.key, detail: symptom.detail, run_id: runId, target_host: cfg.target_host, stubbed: true },
    }),
  });
  return { action: 'restart_logged', stubbed: true };
}

async function tier2_openInvestigation(agent, cfg, symptom, runId) {
  const text = `Agent '${agent}' on ${cfg.target_host} is ${symptom.key}: ${symptom.detail}. Prior tier-1 restart attempt(s) in the last ${COOLDOWN_SEC[1]}s did not resolve it. Investigate root cause, propose a fix, open a PR if code change is needed. Reference agent_heartbeats + recent agent_commands for the pattern. If the fix requires a restart only, reply with next steps.`;
  if (DRY_RUN) {
    console.log('DRY RUN · tier 2 intent →', agent, ':', symptom.key);
    await logObservation({ agent, tier: 2, symptom, cfg, runId, plannedAction: 'investigation_opened' });
    return { action: 'investigation_opened', stubbed: true };
  }
  // agent_intents has no metadata column — encode supervisor context in source_ref.
  const rows = await rest('agent_intents', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      source: 'supervisor',
      source_ref: `agent:${agent}|tier:2|symptom:${symptom.key}|run:${runId}`,
      raw_text: text,
      reporter: 'supervisor-agent',
      status: 'pending',
    }),
  });
  return { action: 'investigation_opened', intent_id: rows?.[0]?.id };
}

async function tier3_alertHuman(agent, cfg, symptom, runId, priorFires) {
  const crit = cfg.critical ? '🚨 *CRITICAL*' : '⚠️ *High*';
  const message = [
    `━━ 🛡️ supervisor ━━`,
    `${crit} — agent *${agent}* unrecovered`,
    ``,
    `📍 host: ${cfg.target_host}`,
    `🔍 symptom: ${symptom.key}`,
    `💬 ${symptom.detail}`,
    `📊 tier 1+2 already attempted this window:`,
    `  · restart logged ${priorFires[1] ? '✓' : '—'}`,
    `  · investigation opened ${priorFires[2] ? '✓' : '—'}`,
    ``,
    `Neither recovered the agent. Manual intervention needed.`,
  ].join('\n');
  if (DRY_RUN) {
    console.log('DRY RUN · tier 3 WA →', agent);
    await logObservation({ agent, tier: 3, symptom, cfg, runId, plannedAction: 'alert_queued' });
    return { action: 'alert_queued', stubbed: true };
  }
  const rows = await rest('agent_commands', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      from_agent: ME, to_agent: 'siti', command: 'send_whatsapp_notification',
      payload: { to: NOTIFY_TO, message }, priority: 1,
    }),
  });
  return { action: 'alert_queued', command_id: rows?.[0]?.id };
}

// ── cooldown lookup (which tiers have I fired for this agent recently?) ────
async function priorFiresForAgent(agent, nowMs) {
  const out = { 1: null, 2: null, 3: null };
  const cutoff = new Date(nowMs - 6 * 3600 * 1000).toISOString(); // widest window

  // Tier 1 = memories rows (supervisor/incident)
  const m = await rest(
    `memories?source=eq.${ME}&metadata->>agent=eq.${encodeURIComponent(agent)}&metadata->>tier=eq.1&created_at=gte.${cutoff}&order=created_at.desc&limit=1`,
  );
  if (m?.[0] && (nowMs - new Date(m[0].created_at).getTime()) / 1000 < COOLDOWN_SEC[1]) out[1] = m[0].created_at;

  // Tier 2 = agent_intents rows by supervisor (context encoded in source_ref)
  const i = await rest(
    `agent_intents?source=eq.supervisor&source_ref=like.agent:${encodeURIComponent(agent)}%7C*&created_at=gte.${cutoff}&order=created_at.desc&limit=1`,
  );
  if (i?.[0] && (nowMs - new Date(i[0].created_at).getTime()) / 1000 < COOLDOWN_SEC[2]) out[2] = i[0].created_at;

  // Tier 3 = agent_commands rows (supervisor → siti) containing agent name in message
  // Cheapest filter: from_agent=supervisor, command=send_whatsapp_notification, recent
  const c = await rest(
    `agent_commands?from_agent=eq.${ME}&command=eq.send_whatsapp_notification&created_at=gte.${cutoff}&order=created_at.desc&limit=20`,
  );
  const hit = (c || []).find(r => r.payload?.message?.includes(`agent *${agent}*`));
  if (hit && (nowMs - new Date(hit.created_at).getTime()) / 1000 < COOLDOWN_SEC[3]) out[3] = hit.created_at;

  return out;
}

// ── self heartbeat ──────────────────────────────────────────────────
async function writeOwnHeartbeat(meta) {
  try {
    await rest('agent_heartbeats?on_conflict=agent_name', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        agent_name: ME, status: 'ok',
        meta: { version: 'supervisor-agent-v1', hostname: os.hostname(), ...meta },
        reported_at: new Date().toISOString(),
      }),
    });
  } catch (e) { console.error('[supervisor] own heartbeat failed:', e.message); }
}

// ── main ────────────────────────────────────────────────────────────
async function main() {
  const runId = `sup-${Date.now().toString(36)}`;
  const startMs = Date.now();
  const all = await rest('agent_heartbeats?select=agent_name,status,reported_at,meta');
  const byName = Object.fromEntries((all || []).map(h => [h.agent_name, h]));

  const actions = [];
  for (const [agent, cfg] of Object.entries(WATCHLIST)) {
    const hb = byName[agent];
    if (!hb) {
      // Agent never reported at all — same as stale from supervisor's POV
      actions.push({ agent, tier: 1, symptom: { key: 'never_reported', detail: 'no heartbeat row exists' } });
      continue;
    }
    const symptom = classify(hb, cfg, startMs);
    if (!symptom) continue;

    const prior = await priorFiresForAgent(agent, startMs);
    const tier = chooseTier(symptom, prior);

    // Don't repeat within cooldown
    if (prior[tier]) {
      console.log(`[supervisor] skip ${agent}/${symptom.key} — tier ${tier} already fired at ${prior[tier]}`);
      continue;
    }

    let result;
    if (tier === 1) result = await tier1_requestRestart(agent, cfg, symptom, runId);
    else if (tier === 2) result = await tier2_openInvestigation(agent, cfg, symptom, runId);
    else result = await tier3_alertHuman(agent, cfg, symptom, runId, prior);

    console.log(`[supervisor] ${agent} ${symptom.key} → tier ${tier} ${result.action}${result.stubbed ? ' (stub)' : ''}`);
    actions.push({ agent, tier, symptom: symptom.key, action: result.action });
  }

  await writeOwnHeartbeat({
    run_id: runId,
    watched: Object.keys(WATCHLIST).length,
    actions_taken: actions.length,
    dry_run: DRY_RUN,
    last_actions: actions,
    cycle_ms: Date.now() - startMs,
  });
  console.log(`[supervisor] cycle done — watched=${Object.keys(WATCHLIST).length} actions=${actions.length} ${Date.now() - startMs}ms`);
}

main().catch(e => { console.error('[supervisor] fatal:', e.message); process.exit(1); });
