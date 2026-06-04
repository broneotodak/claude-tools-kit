#!/usr/bin/env node
// run-reviewer-retro.js — RETROSPECTIVE reviewer-quality eval (read-only).
//
// Phase 0 noted "approve → merged" is near-tautological in an auto-merge fleet —
// it doesn't measure whether the APPROVAL WAS RIGHT. This fills that gap with
// the one signal that does: did approved PRs HOLD, or get reverted?
//
//   - Pull every reviewer review_pr verdict (latest per PR) from agent_commands.
//   - GitHub: each PR's outcome (merged / closed-unmerged / open).
//   - Per-repo, best-effort revert detection: a "Revert …(#N)" PR/commit means
//     PR #N was reverted → an APPROVE on it is a FALSE APPROVE.
//   - request-changes outcome: respected (not merged) vs overridden (merged anyway).
//
// READ-ONLY. neo-brain via PostgREST GET; GitHub via `gh api` GET. Touches no
// live agent. Run on-demand.
//
// USAGE:  node --env-file=.env eval/agents/run-reviewer-retro.js
// Output: eval/agents/results/reviewer-retro-<date>.{json,md}

import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const NEO = (process.env.NEO_BRAIN_URL || '').replace(/\/$/, '');
const KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!NEO || !KEY) { console.error('FATAL: NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY required'); process.exit(1); }

const stamp = new Date().toISOString().slice(0, 10);
const DIR = './eval/agents/results';

async function fetchAll(table, query) {
  const pageSize = 1000; let from = 0; const rows = [];
  for (;;) {
    const res = await fetch(`${NEO}/rest/v1/${table}?${query}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${from}-${from + pageSize - 1}`, 'Range-Unit': 'items' },
    });
    if (!res.ok && res.status !== 206) throw new Error(`${table} ${res.status}`);
    const batch = await res.json(); rows.push(...batch);
    if (batch.length < pageSize) break; from += pageSize;
  }
  return rows;
}
const parsePr = (u) => { const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(u || ''); return m ? { owner: m[1], repo: m[2], num: +m[3], key: `${m[1]}/${m[2]}#${m[3]}`, repoKey: `${m[1]}/${m[2]}` } : null; };

function gh(args) {
  try { return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000 }); }
  catch { return null; }
}
const prStateCache = new Map();
function prState(p) {
  if (prStateCache.has(p.key)) return prStateCache.get(p.key);
  const raw = gh(['api', `repos/${p.owner}/${p.repo}/pulls/${p.num}`, '--jq', '{merged:.merged,state:.state}']);
  let out = { state: 'gh_error' };
  if (raw) { try { const j = JSON.parse(raw); out = { state: j.merged ? 'merged' : (j.state === 'closed' ? 'closed_unmerged' : 'open') }; } catch {} }
  prStateCache.set(p.key, out); return out;
}
// Per-repo set of PR numbers that were reverted (best-effort: a PR whose title
// starts with "Revert" and references "#N" reverts PR #N). Misses reverts done
// via raw commit or without the #N reference — flagged as a limitation.
const revertCache = new Map();
function revertedNums(repoKey) {
  if (revertCache.has(repoKey)) return revertCache.get(repoKey);
  const [owner, repo] = repoKey.split('/');
  const raw = gh(['pr', 'list', '--repo', repoKey, '--state', 'all', '--search', 'revert in:title', '--limit', '50', '--json', 'title,body']);
  const set = new Set();
  if (raw) {
    try {
      for (const pr of JSON.parse(raw)) {
        for (const m of `${pr.title} ${pr.body || ''}`.matchAll(/#(\d+)/g)) set.add(+m[1]);
      }
    } catch {}
  }
  revertCache.set(repoKey, set); return set;
}

async function main() {
  console.log('Mining reviewer verdicts (read-only)…');
  const cmds = await fetchAll('agent_commands',
    "select=payload,result,created_at&to_agent=eq.reviewer&command=eq.review_pr&order=created_at");
  // latest verdict per PR
  const byPr = new Map();
  for (const c of cmds) {
    const v = c.result?.verdict; const u = c.payload?.pr_url;
    if (!v || !u) continue;
    const p = parsePr(u); if (!p) continue;
    const prev = byPr.get(p.key);
    if (!prev || c.created_at > prev.created_at) byPr.set(p.key, { p, verdict: v, created_at: c.created_at });
  }
  console.log(`  ${byPr.size} distinct reviewed PRs. Cross-referencing GitHub…`);

  const items = [];
  for (const { p, verdict } of byPr.values()) {
    const st = prState(p).state;
    const reverted = st === 'merged' && revertedNums(p.repoKey).has(p.num);
    items.push({ pr: p.key, verdict, state: st, reverted });
  }

  // Approval correctness
  const appr = items.filter((i) => i.verdict === 'approve');
  const apprResolvedMerged = appr.filter((i) => i.state === 'merged');
  const apprHeld = apprResolvedMerged.filter((i) => !i.reverted).length;
  const apprReverted = apprResolvedMerged.filter((i) => i.reverted).length;
  const apprClosed = appr.filter((i) => i.state === 'closed_unmerged').length;
  const apprErr = appr.filter((i) => i.state === 'gh_error').length;
  const approvalCorrectness = (apprHeld + apprReverted) ? +(100 * apprHeld / (apprHeld + apprReverted)).toFixed(1) : null;

  // request-changes outcome: respected (not merged) vs overridden (merged anyway)
  const rc = items.filter((i) => i.verdict === 'request-changes');
  const rcOverridden = rc.filter((i) => i.state === 'merged').length;
  const rcRespected = rc.filter((i) => i.state === 'closed_unmerged').length;

  const report = {
    generated: new Date().toISOString(), eval: 'reviewer-retrospective-v1',
    distinct_prs: byPr.size,
    approve: { total: appr.length, merged: apprResolvedMerged.length, held: apprHeld, reverted: apprReverted, closed_unmerged: apprClosed, gh_error: apprErr },
    approval_correctness_pct: approvalCorrectness,
    false_approves: appr.filter((i) => i.reverted).map((i) => i.pr),
    request_changes: { total: rc.length, overridden_merged: rcOverridden, respected_closed: rcRespected },
    comment_verdicts: items.filter((i) => i.verdict === 'comment').length,
  };

  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/reviewer-retro-${stamp}.json`, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(`${DIR}/reviewer-retro-${stamp}.md`, renderMd(report));
  console.log(`\n✓ approval correctness ${approvalCorrectness}% · ${apprReverted} false-approve(s) · req-changes overridden ${rcOverridden}/${rc.length}`);
  console.log(`✓ wrote ${DIR}/reviewer-retro-${stamp}.{json,md}`);
}

function renderMd(r) {
  const a = r.approve, rc = r.request_changes;
  const L = [];
  L.push(`# Reviewer retrospective eval (${stamp})`);
  L.push('');
  L.push(`Did the reviewer's verdicts hold up? Mines ${r.distinct_prs} distinct reviewed PRs (latest verdict each) vs their GitHub outcome. The signal Phase 0 couldn't give: **approval correctness** (approved-and-held vs approved-then-reverted). Read-only.`);
  L.push('');
  L.push('## Headline');
  L.push(`- **Approval correctness: ${r.approval_correctness_pct}%** — of approved PRs that merged, ${a.held} held vs **${a.reverted} reverted** (false approves).`);
  L.push(`- request-changes: ${rc.respected_closed}/${rc.total} respected (not merged), **${rc.overridden_merged} overridden** (merged anyway).`);
  L.push('');
  L.push('## approve verdicts');
  L.push(`- total ${a.total} → merged ${a.merged} (held ${a.held} / reverted ${a.reverted}), closed-unmerged ${a.closed_unmerged}, unresolved ${a.gh_error}`);
  if (r.false_approves.length) { L.push(`- **False approves (approved → reverted):** ${r.false_approves.join(', ')}`); }
  else { L.push('- No detected false approves (see revert-detection limitation).'); }
  L.push('');
  L.push('## Notes / honesty');
  L.push('- Revert detection is BEST-EFFORT: matches PRs reverted by a "Revert …(#N)" PR. Misses reverts via raw commit or without a #N reference — so false-approve count is a LOWER BOUND.');
  L.push('- request-changes "overridden" can be a legitimate operator override, not necessarily a reviewer false-positive — treat as a signal to inspect, not a verdict.');
  L.push('- In an auto-merge fleet most approves merge fast; this eval is about what happened AFTER the merge, which is the real quality question.');
  return L.join('\n') + '\n';
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
