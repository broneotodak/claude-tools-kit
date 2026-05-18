#!/usr/bin/env node
// pr-decision-dispatcher.js
//
// Role (post de-shard, 2026-05-18): a PURE EXECUTOR. It does NOT match
// verdicts. It watches `memories` for `pr-decision-recorded` rows — the
// verdict decision is recorded by siti-v2's VERDICT specialist (it matches
// Neo's WhatsApp "approve"/"reject" to the PR and writes that memory) — and
// for each undispatched decision it queues the action:
//   verdict=approve → agent_command merge_pr → dev-agent
//   verdict=reject  → agent_command close_pr → dev-agent
//
// WHY THE REWRITE: this tool used to ALSO match verdicts itself — read
// `pr-awaiting-decision` rows + Neo's WA replies + a local matchVerdict().
// That duplicated siti-v2's VERDICT specialist (the exact "verdict logic
// sharded across files" trap — feedback_verdict_sharded_implementations).
// Worse, its reply-reader queried memories source='nclaw_whatsapp_conversation'
// — a source emptied by the 2026-05-12 memory-table-separation migration —
// so it silently matched nothing. Net effect: siti-v2 recorded the decision
// but nothing turned it into a merge. PR siti-v2#77 stranded there 2026-05-18.
//
// De-shard: siti-v2 VERDICT specialist OWNS matching; this dispatcher OWNS
// execution. One owner per concern. No more dead-table reads, no more
// double-matching.
//
// Idempotency: the dispatcher polls every 30s. It must never double-merge.
// Guard = `alreadyDispatched()` — skip any pr_url that already has a
// merge_pr/close_pr command in agent_commands (the dispatcher is the only
// producer of those).
//
// Designed to run on CLAW via launchd every 30s.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { emitHeartbeat } from '../lib/heartbeat.mjs';

const envPath = process.env.NEO_BRAIN_ENV_PATH || `${homedir()}/.openclaw/secrets/neo-brain.env`;
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; })
    .filter(Boolean)
);
const URL = env.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL;
const KEY = env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('[pr-dispatch] env missing'); process.exit(1); }

// ── config ──────────────────────────────────────────────────────────
const ME = 'pr-decision-dispatcher';
// Only act on decisions recorded in the last 24h. Anything older that was
// never dispatched is stale and needs operator attention, not a silent
// late merge. The idempotency guard (not the window) is what prevents
// double-merges.
const LOOKBACK_MS = 24 * 3600 * 1000;

// ── REST helpers ────────────────────────────────────────────────────
const H = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
const rest = async (path, opts = {}) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, { ...opts, headers: { ...H(), ...(opts.headers || {}) } });
  if (!r.ok && r.status !== 206) throw new Error(`${opts.method || 'GET'} ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  if (r.status === 204) return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};

// ── core logic ──────────────────────────────────────────────────────

// Recorded verdict decisions in the lookback window. Written by siti-v2's
// VERDICT specialist (source='siti-v2-verdict-specialist'); older rows from
// this dispatcher's pre-rewrite self also appear and are harmless — the
// idempotency guard skips them since they were dispatched in the same call.
async function findRecordedDecisions() {
  const cutoff = new Date(Date.now() - LOOKBACK_MS).toISOString();
  return await rest(
    `memories?category=eq.pr-decision-recorded&created_at=gte.${encodeURIComponent(cutoff)}&order=created_at.desc&select=id,metadata,created_at`,
  );
}

// Has a merge_pr/close_pr command already been queued for this pr_url?
// The dispatcher is the ONLY producer of those commands, so one existing
// row = this decision is already executed. This is the idempotency guard.
async function alreadyDispatched(prUrl) {
  const r = await rest(
    `agent_commands?command=in.(merge_pr,close_pr)&payload->>pr_url=eq.${encodeURIComponent(prUrl)}&select=id&limit=1`,
  );
  return Array.isArray(r) && r.length > 0;
}

// Queue the PR action for dev-agent. dev-agent runs the actual `gh pr merge`
// / `gh pr close`.
async function dispatchAction({ prUrl, verdict, decidedBy }) {
  const command = verdict === 'approve' ? 'merge_pr' : 'close_pr';
  await rest('agent_commands', {
    method: 'POST',
    body: JSON.stringify({
      from_agent: ME,
      to_agent: 'dev-agent',
      command,
      payload: {
        pr_url: prUrl,
        decided_by: decidedBy || 'Neo via Siti',
        comment: verdict === 'reject' ? 'Rejected by operator (Neo) via Siti.' : undefined,
      },
      priority: 2,
    }),
  });
  console.log(`[pr-dispatch] ${verdict.toUpperCase()} → ${command} queued for ${prUrl}`);
}

// ── main ────────────────────────────────────────────────────────────
async function emitOkBeat(stats) {
  // Single source-of-truth heartbeat per cycle. Always called regardless of
  // whether there was work — otherwise the dispatcher only beats when busy,
  // which can be hours apart, and supervisor flags it offline.
  await emitHeartbeat({
    agentName: 'pr-decision-dispatcher',
    status: 'ok',
    meta: { ...stats, cycle_at: new Date().toISOString() },
    brainUrl: URL,
    serviceKey: KEY,
  }).catch(err => console.error('[pr-dispatch] heartbeat fail:', err.message));
}

async function main() {
  const decisions = await findRecordedDecisions();
  if (!decisions?.length) {
    console.log('[pr-dispatch] no recorded decisions in window');
    await emitOkBeat({ decisions: 0, dispatched: 0, skipped: 0 });
    return;
  }

  let dispatched = 0, skipped = 0;
  for (const d of decisions) {
    const meta = d.metadata || {};
    const prUrl = meta.pr_url;
    const verdict = meta.verdict;
    // hold never produces a pr-decision-recorded row (siti-v2's VERDICT
    // specialist acks hold without recording) — but stay defensive.
    if (!prUrl || (verdict !== 'approve' && verdict !== 'reject')) { skipped++; continue; }
    if (await alreadyDispatched(prUrl)) { skipped++; continue; }
    try {
      await dispatchAction({ prUrl, verdict, decidedBy: meta.decided_by });
      dispatched++;
    } catch (e) {
      console.error(`[pr-dispatch] dispatch failed for ${prUrl}: ${e.message}`);
    }
  }
  console.log(`[pr-dispatch] cycle done — decisions=${decisions.length} dispatched=${dispatched} skipped=${skipped}`);
  await emitOkBeat({ decisions: decisions.length, dispatched, skipped });
}

main().catch(async (e) => {
  console.error('[pr-dispatch] fatal:', e.message);
  // Best-effort degraded heartbeat so the dashboard reflects the failed cycle.
  await emitHeartbeat({
    agentName: 'pr-decision-dispatcher',
    status: 'degraded',
    meta: { error: e.message?.slice(0, 200), cycle_at: new Date().toISOString() },
    brainUrl: URL,
    serviceKey: KEY,
  }).catch(() => {});
  process.exit(1);
});
