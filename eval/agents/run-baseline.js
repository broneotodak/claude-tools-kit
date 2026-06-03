#!/usr/bin/env node
// eval/agents/run-baseline.js — Phase 0 RETROSPECTIVE agent eval baseline.
//
// The self-managed reasoning agents (planner, dev-agent, reviewer) have no
// behavioural eval today, so we have no scoreboard to argue from. This script
// builds the FIRST one with ZERO new labelling — it mines outcomes that
// already happened, recorded in neo-brain:
//   - agent_intents     → planner: raw intent → decomposition success/failure
//   - agent_commands    → dev-agent + reviewer: command outcomes, verdicts
// and (optional --github) cross-refs the recorded pr_url against GitHub to turn
// "agent finished" into "fix actually landed / approval held".
//
// This is architecture-NEUTRAL: it scores recorded outcomes, so the same script
// re-run after any agent change (e.g. a Claude-Agent-SDK migration of dev-agent)
// is a direct A/B. It is the baseline the migration decision needs.
//
// USAGE
//   node --env-file=.env --no-warnings eval/agents/run-baseline.js
//   node --env-file=.env --no-warnings eval/agents/run-baseline.js --github
//
// READ-ONLY. No writes to neo-brain. The --github pass is GET-only (gh api).
//
// Outputs (committed, redacted):
//   - results/agents-baseline-<date>.json   (full machine-readable)
//   - results/agents-baseline-<date>.md      (the scoreboard)

import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const NEO = (process.env.NEO_BRAIN_URL || '').replace(/\/$/, '');
const KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!NEO || !KEY) {
  console.error('FATAL: NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY required (read-only).');
  process.exit(1);
}

const WITH_GH = process.argv.includes('--github');
const stamp = new Date().toISOString().slice(0, 10);
const OUT_DIR = './eval/agents/results';
const OUT_JSON = `${OUT_DIR}/agents-baseline-${stamp}.json`;
const OUT_MD = `${OUT_DIR}/agents-baseline-${stamp}.md`;

// Command taxonomy — the headline lesson from the data: dev-agent's raw
// completion rate is meaningless unless you separate AUTHORING (the model
// actually writes a fix/feature — where a managed write→test→fix loop would
// help) from PLUMBING (react to a git event: merge, push, close).
const DEV_AUTHORING = new Set(['investigate_bug', 'feature_request']);
const DEV_PLUMBING = new Set(['merge_pr', 'on_main_push', 'on_pr_merged', 'close_pr', 'restart']);

// Keep in sync with .githooks/pre-commit / @todak/memory ruleset. ccc_sk_ added
// 2026-06-02 after the NACA backend token leak (custom format no scanner knew).
function redact(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/sk-ant-api03-[A-Za-z0-9_-]+/g, '[REDACTED-ANTHROPIC-KEY]')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED-API-KEY]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED-JWT]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED-AWS-KEY]')
    .replace(/ccc_sk_[A-Za-z0-9_]{4,}/g, '[REDACTED-NACA-TOKEN]')
    .replace(/xox[bp]-[A-Za-z0-9-]+/g, '[REDACTED-SLACK-TOKEN]');
}

// PostgREST pull with Range pagination (neo-brain caps page size). Read-only.
async function fetchAll(table, query) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const res = await fetch(`${NEO}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${from + pageSize - 1}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) throw new Error(`${table} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

const pct = (num, den) => (den ? +(100 * num / den).toFixed(1) : null);
const dateOf = (iso) => (iso ? iso.slice(0, 10) : null);
function windowOf(rows, key = 'created_at') {
  const ds = rows.map((r) => r[key]).filter(Boolean).sort();
  return ds.length ? { first: dateOf(ds[0]), last: dateOf(ds[ds.length - 1]) } : { first: null, last: null };
}
function tally(rows, fn) {
  const m = {};
  for (const r of rows) { const k = fn(r); if (k == null) continue; m[k] = (m[k] || 0) + 1; }
  return m;
}

// ── GitHub cross-ref (optional) ─────────────────────────────────────────────
// Parse a pr_url, ask gh for state. execFile + arg array (never shell-interp a
// URL). Cached + fault-tolerant: a 404 / unauth marks 'unknown', never throws.
const ghCache = new Map();
function ghApiOnce(owner, repo, num) {
  const raw = execFileSync('gh', ['api', `repos/${owner}/${repo}/pulls/${num}`,
    '--jq', '{state:.state,merged:.merged,merged_at:.merged_at}'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000 });
  const j = JSON.parse(raw);
  return { state: j.merged ? 'merged' : (j.state === 'closed' ? 'closed_unmerged' : 'open') };
}
// Per-PR resilient: one retry on a transient error, 404 → not_found, persistent
// failure → gh_error for THAT pr only (never a global poison — a single flaky
// call must not zero out the whole enrichment, the bug the first run hit).
function ghPrState(prUrl) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl || '');
  if (!m) return { state: 'unparseable' };
  const [, owner, repo, num] = m;
  const key = `${owner}/${repo}#${num}`;
  if (ghCache.has(key)) return ghCache.get(key);
  // Single attempt, short timeout — a few unresolvable PRs (deleted repo / blip)
  // become gh_error and are excluded from the rate; they must never stall the run.
  let out;
  try { out = ghApiOnce(owner, repo, num); }
  catch (e) {
    const msg = String(e.stderr || e.message || '');
    out = /Not Found|HTTP 404/.test(msg) ? { state: 'not_found' } : { state: 'gh_error' };
  }
  ghCache.set(key, out);
  return out;
}
function enrichPRs(prUrls) {
  const uniq = [...new Set(prUrls.filter(Boolean))];
  const states = {};
  for (const u of uniq) { const k = u; states[k] = ghPrState(u).state; }
  const dist = tally(Object.values(states).map((s) => ({ s })), (r) => r.s);
  return { checked: uniq.length, dist };
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Mining neo-brain (read-only)…');
  const intents = await fetchAll('agent_intents',
    'select=status,error,dispatched_command_ids,created_at,decomposed_at&order=created_at');
  const cmds = await fetchAll('agent_commands',
    'select=to_agent,command,status,payload,result,created_at,completed_at&to_agent=in.(dev-agent,reviewer)&order=created_at');
  console.log(`  agent_intents: ${intents.length} rows | agent_commands(dev+reviewer): ${cmds.length} rows`);

  // ── PLANNER (agent_intents) ──
  const pStatus = tally(intents, (r) => r.status);
  const pDone = pStatus.done || 0, pFailed = pStatus.failed || 0, pCancelled = pStatus.cancelled || 0;
  const failedIntents = intents.filter((r) => r.status === 'failed' && r.error);
  const failBucket = tally(failedIntents, (r) => {
    const e = (r.error || '').toLowerCase();
    if (/overloaded|529/.test(e)) return 'anthropic_overloaded';
    if (/rate.?limit|429/.test(e)) return 'rate_limit';
    if (/timeout|etimedout|fetch failed|econnreset/.test(e)) return 'network';
    if (/no command|no dispatch|empty/.test(e)) return 'no_command_produced';
    if (/unknown agent|not in registry|invalid|schema|required/.test(e)) return 'invalid_target_or_payload';
    if (/401|403|auth|credential/.test(e)) return 'auth';
    return 'other';
  });
  const doneIntents = intents.filter((r) => r.status === 'done');
  const avgCmds = doneIntents.length
    ? +(doneIntents.reduce((s, r) => s + (r.dispatched_command_ids?.length || 0), 0) / doneIntents.length).toFixed(2)
    : null;
  const planner = {
    window: windowOf(intents),
    total: intents.length,
    by_status: pStatus,
    decomposition_success_rate_pct: pct(pDone, pDone + pFailed), // exclude cancelled
    failure_breakdown: failBucket,
    avg_commands_per_success: avgCmds,
    sample_errors: failedIntents.slice(-5).map((r) => redact((r.error || '').slice(0, 160))),
  };

  // ── DEV-AGENT (agent_commands) ──
  const dev = cmds.filter((r) => r.to_agent === 'dev-agent');
  function devClass(rows, label) {
    const st = tally(rows, (r) => r.status);
    const done = st.done || 0, failed = st.failed || 0;
    const withPr = rows.filter((r) => r.result?.pr_url).length;
    const errClasses = tally(rows.filter((r) => r.status === 'failed'),
      (r) => redact(String(r.result?.error || r.result?.reason || 'unspecified').slice(0, 60)));
    return {
      label, total: rows.length, by_status: st,
      completion_rate_pct: pct(done, done + failed),
      pr_produced: withPr,
      error_classes: errClasses,
    };
  }
  const devAuthoringRows = dev.filter((r) => DEV_AUTHORING.has(r.command));
  const devPlumbingRows = dev.filter((r) => DEV_PLUMBING.has(r.command));
  const devAgent = {
    window: windowOf(dev),
    total: dev.length,
    by_command: tally(dev, (r) => r.command),
    authoring: devClass(devAuthoringRows, 'authoring (investigate_bug + feature_request)'),
    plumbing: devClass(devPlumbingRows, 'plumbing (merge_pr/on_main_push/on_pr_merged/close_pr)'),
  };

  // ── REVIEWER (agent_commands) ──
  const rev = cmds.filter((r) => r.to_agent === 'reviewer');
  const revStatus = tally(rev, (r) => r.status);
  const verdicts = tally(rev, (r) => r.result?.verdict || null);
  const skipped = rev.filter((r) => r.result?.skipped).length;
  const verdictTotal = Object.values(verdicts).reduce((a, b) => a + b, 0);
  const reviewer = {
    window: windowOf(rev),
    total: rev.length,
    by_status: revStatus,
    verdicts,
    verdict_total: verdictTotal,
    approve_share_pct: pct(verdicts.approve || 0, verdictTotal),
    request_changes_share_pct: pct(verdicts['request-changes'] || 0, verdictTotal),
    skipped_already_merged: skipped,
    skipped_rate_pct: pct(skipped, rev.length), // the self-merge-race no-op rate
  };

  // ── GitHub enrichment (optional) — turns "finished" into "landed" ──
  let github = { enabled: false };
  if (WITH_GH) {
    console.log('Cross-referencing pr_url against GitHub (read-only)…');
    const devPRs = devAuthoringRows.map((r) => r.result?.pr_url);
    // reviewer keeps the PR ref in payload (the input), not result (the verdict-bearing row has no pr_url).
    const approvedPRs = rev.filter((r) => r.result?.verdict === 'approve').map((r) => r.payload?.pr_url || r.result?.pr_url);
    const devEnriched = enrichPRs(devPRs);
    const apprEnriched = enrichPRs(approvedPRs);
    // rate over RESOLVED PRs only (known merged/closed/open); exclude not_found
    // (PR deleted) + gh_error (couldn't read) so unresolvable PRs don't deflate it.
    const resolved = (dist) => (dist.merged || 0) + (dist.closed_unmerged || 0) + (dist.open || 0);
    github = {
      enabled: true,
      dev_authoring_prs: devEnriched,
      dev_landed_rate_pct: pct(devEnriched.dist.merged || 0, resolved(devEnriched.dist)),
      dev_resolved: resolved(devEnriched.dist),
      reviewer_approved_prs: apprEnriched,
      approve_then_merged_rate_pct: pct(apprEnriched.dist.merged || 0, resolved(apprEnriched.dist)),
      approve_resolved: resolved(apprEnriched.dist),
      note: (devEnriched.dist.gh_error || apprEnriched.dist.gh_error)
        ? 'some PRs unresolved (gh_error) — rate is over resolvable PRs' : 'ok',
    };
  }

  const report = { generated: new Date().toISOString(), phase: 'phase-0-retrospective', planner, dev_agent: devAgent, reviewer, github };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(OUT_MD, renderMd(report));
  console.log(`\n✓ wrote ${OUT_JSON}\n✓ wrote ${OUT_MD}`);
}

function renderMd(r) {
  const p = r.planner, d = r.dev_agent, v = r.reviewer, g = r.github;
  const L = [];
  L.push(`# NACA agent eval — Phase 0 baseline (${stamp})`);
  L.push('');
  L.push('Retrospective scoreboard mined from recorded outcomes (`agent_intents`, `agent_commands`). Zero new labelling. Architecture-neutral — re-run after any agent change for a direct A/B. **Not** a quality judgement yet (that is Phase 2); these are *outcome* rates.');
  L.push('');
  L.push('## Scoreboard');
  L.push('');
  L.push('| Agent | Headline metric | Score | Window |');
  L.push('|---|---|---|---|');
  L.push(`| planner-agent | intent decomposition success | **${p.decomposition_success_rate_pct}%** (${p.by_status.done || 0} done / ${p.by_status.failed || 0} failed) | ${p.window.first}→${p.window.last} |`);
  L.push(`| dev-agent (authoring) | command completion | **${d.authoring.completion_rate_pct}%** (${d.authoring.by_status.done || 0}/${(d.authoring.by_status.done || 0) + (d.authoring.by_status.failed || 0)}) | ${d.window.first}→${d.window.last} |`);
  L.push(`| dev-agent (plumbing) | command completion | ${d.plumbing.completion_rate_pct}% | (for contrast) |`);
  L.push(`| reviewer | verdict produced (of non-skipped) | approve **${v.approve_share_pct}%** / req-changes ${v.request_changes_share_pct}% | ${v.window.first}→${v.window.last} |`);
  if (g.enabled) {
    L.push(`| dev-agent (authoring) | **PR landed** (merged) | **${g.dev_landed_rate_pct}%** of ${g.dev_resolved} resolved | via GitHub |`);
    L.push(`| reviewer | approve → merged held | ${g.approve_then_merged_rate_pct}% of ${g.approve_resolved} resolved | via GitHub |`);
  }
  L.push('');
  L.push('## planner-agent');
  L.push(`- Total intents: ${p.total} — ${JSON.stringify(p.by_status)}`);
  L.push(`- **Decomposition success: ${p.decomposition_success_rate_pct}%** (done / done+failed, cancelled excluded)`);
  L.push(`- Avg commands per successful intent: ${p.avg_commands_per_success}`);
  L.push(`- Failure breakdown: ${JSON.stringify(p.failure_breakdown)}`);
  L.push(`  - **The dominant failure is \`invalid_target_or_payload\`** — the planner emits commands to an unknown agent or with a payload that fails registry validation. That is a prompt/grounding problem (and exactly what Phase 1's deterministic decomposition eval will track), *not* model overload.`);
  L.push('');
  L.push('## dev-agent');
  L.push(`- Commands by verb: ${JSON.stringify(d.by_command)}`);
  L.push(`- **Authoring vs plumbing matters:** the raw all-command rate conflates model work (investigate_bug/feature_request) with git-event plumbing (merge_pr/on_main_push). Segmented:`);
  L.push(`  - Authoring: ${d.authoring.completion_rate_pct}% complete, ${d.authoring.pr_produced} PRs produced, errors: ${JSON.stringify(d.authoring.error_classes)}`);
  L.push(`  - Plumbing: ${d.plumbing.completion_rate_pct}% complete`);
  if (g.enabled) L.push(`- **PR landed (merged): ${g.dev_landed_rate_pct}%** of ${g.dev_resolved} resolved authoring PRs (${g.dev_authoring_prs.checked} checked) — ${JSON.stringify(g.dev_authoring_prs.dist)}. This is the "fix actually worked" number a managed write→test→fix loop should move.`);
  L.push('');
  L.push('## reviewer');
  L.push(`- review_pr dispatched: ${v.total} — ${JSON.stringify(v.by_status)}`);
  L.push(`- Verdicts: ${JSON.stringify(v.verdicts)} (approve ${v.approve_share_pct}%, request-changes ${v.request_changes_share_pct}%)`);
  L.push(`- **Skipped \`already_merged\`: ${v.skipped_already_merged} (${v.skipped_rate_pct}% of dispatches)** — the fleet-origin self-merge races the reviewer, so nearly half its dispatches are no-ops. Decide: gate self-merge on review, or stop dispatching reviewer for fleet-origin PRs.`);
  if (g.enabled) L.push(`- Approve → still-merged: ${g.approve_then_merged_rate_pct}% of ${g.approve_resolved} resolved (${g.reviewer_approved_prs.checked} checked) — ${JSON.stringify(g.reviewer_approved_prs.dist)}.`);
  L.push('');
  L.push('## Limitations (honest)');
  L.push('- "done/completion" = the agent finished its run, **not** that the output was correct. The GitHub pass (`--github`) is the only "did it actually land" signal here; true quality scoring is Phase 2 (seeded-defect reviewer eval + dev-agent sandbox replay).');
  L.push('- Revert detection is not done in Phase 0 (merged≠never-reverted). Add a revert scan in Phase 1.');
  L.push('- dev-agent/reviewer dispatch wound down after ~2026-05-29 (autonomous-dispatch paused); this baseline is the historical active window. Planner intents continue to today.');
  L.push('- neo-brain RAG already has its own eval (`eval/neo-brain/`, recall@5 ~63.8% hybrid) — fold it into the same monthly cadence rather than duplicating here.');
  L.push('');
  L.push('## Next (Phase 1)');
  L.push('- Deterministic **planner decomposition** eval: 20 frozen intents → expected (agent,command)+payload; score routing accuracy + command-validity + hallucination rate (directly attacks the `invalid_target_or_payload` failure).');
  L.push('- **Siti router classification** eval from `siti-v2/test/fixtures/messages.json` (per-intent precision/recall).');
  return L.join('\n') + '\n';
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
