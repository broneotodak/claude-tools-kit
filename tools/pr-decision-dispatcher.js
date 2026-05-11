#!/usr/bin/env node
// pr-decision-dispatcher.js
// Phase 3 Step 2 — closes the loop between Siti's WA notification and dev-agent's
// PR action commands. Watches:
//   1. memories where category='pr-awaiting-decision' (written by reviewer)
//   2. Neo's recent inbound WA messages (source=nclaw_whatsapp_conversation,
//      role=user, lid=Neo's, body matches approve/reject/hold)
//
// When a Neo message arrives AFTER an awaiting-decision row was created and the
// body matches a verdict keyword, dispatch:
//   approve  → agent_command merge_pr → dev-agent
//   reject   → agent_command close_pr → dev-agent
//   hold     → memory operator-review-pending (I see it next session) + Siti ack
//
// Marks each handled awaiting-decision row by inserting a follow-up memory
// (category=pr-decision-recorded) with pr_url so we don't re-dispatch.
//
// Designed to run on CLAW via launchd every 30s. Idempotent.

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
const NEO_LID = process.env.NEO_LID || '158286791843952';        // Neo's WA Linked Identity
const NEO_PHONE = process.env.NEO_PHONE || '60177519610';
const NEO_NUMBER_FOR_SITI = NEO_PHONE;
const ME = 'pr-decision-dispatcher';
const LOOKBACK_MS = 6 * 3600 * 1000;  // only consider awaiting rows from last 6h

// Verdict keywords — English + Indonesian/Sundanese for Neo's habits.
// Anchored form (whole body must be one token) — bare-verdict path.
const VERDICTS = {
  approve: /^\s*(approve|approved|setuju|ok|oke|merge|✅)\s*$/i,
  reject:  /^\s*(reject|rejected|tolak|close|cancel|❌)\s*$/i,
  hold:    /^\s*(hold|holdon|pending|tunda|tahan|wait|🤔)\s*$/i,
};
// Same tokens without anchors — used to match the leading verb in the
// natural-language "<verdict> [pr] [#]<n>" form ("approve pr #8").
const VERDICT_WORDS = {
  approve: /^(approve|approved|setuju|ok|oke|merge|✅)$/i,
  reject:  /^(reject|rejected|tolak|close|cancel|❌)$/i,
  hold:    /^(hold|holdon|pending|tunda|tahan|wait|🤔)$/i,
};

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
// Returns { verdict, pr_number } | null. Bare tokens get pr_number=null;
// "<verdict> [pr] [#]<n>" replies carry pr_number and disambiguate which
// awaiting PR the reply applies to (#132 — without this, two PRs awaiting
// + bare "approve" silently dispatched both).
function matchVerdict(body) {
  const raw = String(body || '').trim().replace(/[!?.,\s]+$/, '').trim();
  if (!raw) return null;
  // Path 1 — bare verdict token (existing behavior preserved).
  for (const [v, re] of Object.entries(VERDICTS)) {
    if (re.test(raw)) return { verdict: v, pr_number: null };
  }
  // Path 2 — "<verdict-token> [pr] [#]<n>" with optional trailing emphasis
  // already stripped above. Only the FIRST token is checked against the
  // verb list, so prose containing "approve" mid-sentence won't match.
  const m = raw.toLowerCase().match(/^(\S+)\s+(?:pr\s*)?#?(\d+)$/);
  if (m) {
    const verb = m[1];
    const num = Number(m[2]);
    for (const [v, re] of Object.entries(VERDICT_WORDS)) {
      if (re.test(verb)) return { verdict: v, pr_number: num };
    }
  }
  return null;
}

async function findAwaiting() {
  const cutoff = new Date(Date.now() - LOOKBACK_MS).toISOString();
  return await rest(`memories?category=eq.pr-awaiting-decision&created_at=gte.${encodeURIComponent(cutoff)}&order=created_at.desc&select=id,content,metadata,created_at`);
}

async function alreadyDecided(prUrl) {
  // Has a follow-up `pr-decision-recorded` memory been written for this pr_url?
  const r = await rest(`memories?category=eq.pr-decision-recorded&metadata->>pr_url=eq.${encodeURIComponent(prUrl)}&select=id&limit=1`);
  return Array.isArray(r) && r.length > 0;
}

async function neoRepliesAfter(sinceIso) {
  // Recent Neo inbound messages, ordered by time asc so we process in order.
  // Bug fix 2026-04-25: encodeURIComponent the timestamp — its '+' was being
  // URL-decoded as space, making the gte filter malformed and returning 0 rows.
  return await rest(
    `memories?source=eq.nclaw_whatsapp_conversation&metadata->>role=eq.user&metadata->>from_lid=eq.${NEO_LID}&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.asc&select=content,created_at&limit=20`,
  );
}

async function recordDecision({ awaiting, verdict, replyAt, replyBody }) {
  const meta = awaiting.metadata || {};
  const prUrl = meta.pr_url;

  // 1) Mark this PR as decided so we don't re-dispatch (idempotent guard)
  await rest('memories', {
    method: 'POST',
    body: JSON.stringify({
      content: `PR decision recorded: ${verdict.toUpperCase()} — ${meta.repo}#${meta.pr_number || '?'} (${meta.pr_title || '?'})`,
      category: 'pr-decision-recorded',
      memory_type: 'event',
      importance: 6,
      visibility: 'private',
      source: ME,
      metadata: {
        pr_url: prUrl,
        pr_number: meta.pr_number,
        verdict,
        decided_by: 'Neo (WhatsApp reply)',
        reply_body: replyBody,
        reply_at: replyAt,
        awaiting_memory_id: awaiting.id,
        reviewer_verdict: meta.reviewer_verdict,
        repo: meta.repo,
        project: meta.project,
      },
    }),
  });

  // 2) Dispatch action
  if (verdict === 'approve' || verdict === 'reject') {
    const command = verdict === 'approve' ? 'merge_pr' : 'close_pr';
    await rest('agent_commands', {
      method: 'POST',
      body: JSON.stringify({
        from_agent: ME,
        to_agent: 'dev-agent',
        command,
        payload: {
          pr_url: prUrl,
          decided_by: 'Neo via WhatsApp',
          comment: verdict === 'reject' ? 'Rejected by operator (Neo) via Siti.' : undefined,
        },
        priority: 2,
      }),
    });
    console.log(`[pr-dispatch] ${verdict.toUpperCase()} → ${command} queued for ${prUrl}`);
  } else {
    // verdict === 'hold' — write an operator-review-pending memory so the next
    // CC session sees it via memory search, AND Siti acks immediately.
    await rest('memories', {
      method: 'POST',
      body: JSON.stringify({
        content: `Neo asked to HOLD on PR ${meta.repo}#${meta.pr_number || '?'} — ${meta.pr_title || '(no title)'}. Discuss next session.`,
        category: 'operator-review-pending',
        memory_type: 'event',
        importance: 7,
        visibility: 'private',
        source: ME,
        metadata: {
          pr_url: prUrl,
          pr_number: meta.pr_number,
          repo: meta.repo,
          project: meta.project,
          reviewer_verdict: meta.reviewer_verdict,
          reviewer_summary: meta.reviewer_summary,
          held_at: replyAt,
        },
      }),
    });
    console.log(`[pr-dispatch] HOLD → operator-review-pending memory written for ${prUrl}`);

    // Ack to Neo via Siti (since dev-agent isn't involved)
    await rest('agent_commands', {
      method: 'POST',
      body: JSON.stringify({
        from_agent: ME, to_agent: 'siti', command: 'send_whatsapp_notification',
        payload: {
          to: NEO_NUMBER_FOR_SITI,
          message: `🤔 Holding ${meta.repo}#${meta.pr_number || '?'} — flagged for next session with Claude. PR stays open. (${prUrl})`,
        },
        priority: 3,
      }),
    });
  }
}

// ── main ────────────────────────────────────────────────────────────
async function emitOkBeat({ awaiting, dispatched, skipped }) {
  // Single source-of-truth heartbeat for this cycle. Always called regardless
  // of whether any awaiting rows existed — otherwise the dispatcher only beats
  // when there's work, which can be hours apart, and supervisor flags it
  // offline.
  await emitHeartbeat({
    agentName: 'pr-decision-dispatcher',
    status: 'ok',
    meta: { awaiting, dispatched, skipped, cycle_at: new Date().toISOString() },
    brainUrl: URL,
    serviceKey: KEY,
  }).catch(err => console.error('[pr-dispatch] heartbeat fail:', err.message));
}

// Send a Siti clarification message via agent_commands. Used when bare-token
// approval lands with >1 PRs awaiting — we dispatch to the most recent and
// tell Neo about it so a wrong call is visible immediately, not silent.
async function sendSitiClarification({ chosen, others, verdict, replyBody }) {
  const meta = chosen.metadata || {};
  const verbEmoji = verdict === 'approve' ? '✅ Approved' : verdict === 'reject' ? '❌ Rejected' : `Recorded ${verdict.toUpperCase()}`;
  const chosenRef = `${meta.repo}#${meta.pr_number || '?'}`;
  const othersList = others.map((o, i) => {
    const om = o.metadata || {};
    return `  ${i + 1}) ${om.repo}#${om.pr_number || '?'} — ${(om.pr_title || '').slice(0, 60)}`;
  }).join('\n');
  const message = `${verbEmoji} — most-recent: *${chosenRef}* (${meta.pr_title || ''}).\n\nYou had ${others.length + 1} PRs awaiting. The others stayed open:\n${othersList}\n\nIf you meant a different one, reply: \`${verdict} pr #<number>\` and I'll route it correctly.`;
  await rest('agent_commands', {
    method: 'POST',
    body: JSON.stringify({
      from_agent: ME,
      to_agent: 'siti',
      command: 'send_whatsapp_notification',
      payload: { to: NEO_NUMBER_FOR_SITI, message },
      priority: 2,
    }),
  });
}

async function main() {
  let processed = 0, skipped = 0;
  const awaiting = await findAwaiting();
  if (!awaiting?.length) {
    console.log('[pr-dispatch] no awaiting decisions');
    await emitOkBeat({ awaiting: 0, dispatched: 0, skipped: 0 });
    return;
  }

  // Filter to undecided + pr_url-bearing awaiting rows up front so we know
  // the real candidate set for disambiguation (vs naively counting all rows).
  const candidates = [];
  for (const a of awaiting) {
    const meta = a.metadata || {};
    if (!meta.pr_url) { skipped++; continue; }
    if (await alreadyDecided(meta.pr_url)) { skipped++; continue; }
    candidates.push(a);
  }

  // Track replies we've already "consumed" inside this cycle so a single
  // bare-token "approve" doesn't fan-out to every awaiting row.
  // Key: `<reply.created_at>|<reply.content>`.
  const consumedReplies = new Set();
  const replyKey = (r) => `${r.created_at}|${String(r.content).trim()}`;

  for (const a of candidates) {
    const meta = a.metadata || {};
    const replies = await neoRepliesAfter(a.created_at);
    if (!replies?.length) continue;

    for (const r of replies) {
      const v = matchVerdict(r.content);
      if (!v) continue;
      // If the reply names an explicit PR number ("approve pr #8"), only
      // apply it to the awaiting row whose pr_number matches — prevents a
      // PR-specific verdict from being mis-routed to a different awaiting
      // row that happens to be older.
      if (v.pr_number != null && Number(meta.pr_number) !== v.pr_number) continue;

      // Bare-token disambiguation: if the reply has no explicit pr_number,
      // it could in principle apply to ANY undecided awaiting. Pre-refactor
      // the loop happily dispatched the SAME bare "approve" to every
      // awaiting in turn — a silent fan-out merging PRs Neo never meant.
      // Now: bare token applies ONCE per cycle, to the most-recent awaiting
      // (candidates are ordered desc by findAwaiting). The chosen row gets
      // the verdict; the others stay awaiting; Siti acks with the
      // disambiguation note so the wrong call is visible immediately.
      if (v.pr_number == null) {
        if (consumedReplies.has(replyKey(r))) {
          break; // this bare-token reply has already been used this cycle
        }
        consumedReplies.add(replyKey(r));

        const othersInCycle = candidates.filter((c) => c.id !== a.id);
        try {
          await recordDecision({ awaiting: a, verdict: v.verdict, replyAt: r.created_at, replyBody: r.content });
          processed++;
          if (othersInCycle.length > 0) {
            await sendSitiClarification({ chosen: a, others: othersInCycle, verdict: v.verdict, replyBody: r.content });
            console.log(`[pr-dispatch] bare-token ${v.verdict.toUpperCase()} disambiguated to most-recent ${meta.pr_url}; ${othersInCycle.length} others left awaiting`);
          }
        } catch (e) {
          console.error(`[pr-dispatch] dispatch failed for ${meta.pr_url}: ${e.message}`);
        }
        break; // first matching reply consumed for this awaiting; move on
      }

      // Explicit pr_number match — original safe path.
      try {
        await recordDecision({ awaiting: a, verdict: v.verdict, replyAt: r.created_at, replyBody: r.content });
        processed++;
      } catch (e) {
        console.error(`[pr-dispatch] dispatch failed for ${meta.pr_url}: ${e.message}`);
      }
      break; // only first matching reply per awaiting row
    }
  }
  console.log(`[pr-dispatch] cycle done — awaiting=${awaiting.length} candidates=${candidates.length} dispatched=${processed} skipped=${skipped}`);
  await emitOkBeat({ awaiting: awaiting.length, dispatched: processed, skipped });
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
