#!/usr/bin/env node
// eval/agents/run-revert-scan.js — Phase 1 REVERT SCAN.
//
// The Phase 0 baseline can measure "the fleet merged it" but NOT "the change
// actually stuck". In an auto-merge fleet "approve → merged" is near-tautological
// (the README flags this as the missing correctness signal). The real question
// — is the autonomous merge pipeline net-positive? — is answered by the REVERT
// RATE: of everything the fleet shipped, what fraction was later reverted,
// rolled back, or hotfixed-away?
//
// This mines the fleet-AUTHORED merged PRs (from agent_commands.result.pr_url —
// the precise universe of code changes the fleet shipped) and cross-refs each
// against revert signals in its repo:
//   - revert PRs            (title ^Revert / "revert:" )
//   - git-revert commits    (message ^Revert / "This reverts commit <sha>")
// matched to the original by merge-commit SHA, PR number, or quoted title.
//
// USAGE
//   node --env-file=.env --no-warnings eval/agents/run-revert-scan.js
//
// READ-ONLY. neo-brain GET only; all GitHub access is gh GET (no writes).
// Needs NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY + an authed `gh`.
//
// Outputs (committed, redacted):
//   - results/revert-scan-<date>.json   (full machine-readable)
//   - results/revert-scan-<date>.md      (the scoreboard)

import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const NEO = (process.env.NEO_BRAIN_URL || '').replace(/\/$/, '');
const KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!NEO || !KEY) {
  console.error('FATAL: NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY required (read-only).');
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 10);
const OUT_DIR = './eval/agents/results';
const OUT_JSON = `${OUT_DIR}/revert-scan-${stamp}.json`;
const OUT_MD = `${OUT_DIR}/revert-scan-${stamp}.md`;

// Keep in sync with .githooks/pre-commit / @todak/memory ruleset.
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

async function fetchAll(table, query) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const res = await fetch(`${NEO}/rest/v1/${table}?${query}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${from}-${from + pageSize - 1}`, 'Range-Unit': 'items' },
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

function parsePrUrl(u) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(u || '');
  return m ? { owner: m[1], repo: m[2], num: +m[3], key: `${m[1]}/${m[2]}#${m[3]}`, repoKey: `${m[1]}/${m[2]}` } : null;
}

// ── GitHub GET helpers (execFile + arg array; never shell-interp) ────────────
function ghJson(args) {
  const raw = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
  return raw.trim() ? JSON.parse(raw) : null;
}

// Full state of one fleet-authored PR: merged?, its merge-commit SHA, title.
const prCache = new Map();
function ghPrFull(owner, repo, num) {
  const key = `${owner}/${repo}#${num}`;
  if (prCache.has(key)) return prCache.get(key);
  let out;
  try {
    const j = ghJson(['api', `repos/${owner}/${repo}/pulls/${num}`,
      '--jq', '{merged:.merged,state:.state,sha:.merge_commit_sha,title:.title}']);
    out = { state: j.merged ? 'merged' : (j.state === 'closed' ? 'closed_unmerged' : 'open'), sha: j.sha || null, title: j.title || '' };
  } catch (e) {
    const msg = String(e.stderr || e.message || '');
    out = { state: /Not Found|HTTP 404/.test(msg) ? 'not_found' : 'gh_error', sha: null, title: '' };
  }
  prCache.set(key, out);
  return out;
}

// All revert signals in a repo (bounded: revert-titled PRs + last 200 commits).
// Builds the target sets we match originals against.
const repoRevertCache = new Map();
function ghRepoReverts(owner, repo) {
  const rk = `${owner}/${repo}`;
  if (repoRevertCache.has(rk)) return repoRevertCache.get(rk);
  const revertedShas = new Set();   // SHAs named in "This reverts commit <sha>"
  const revertedPrNums = new Set(); // PR #s named in "Reverts #N"
  const revertedTitles = new Set(); // original titles quoted in Revert "<title>"
  const evidence = [];              // raw reverts found (for the report / human audit)

  const harvest = (text, via, ref) => {
    if (!text) return;
    let m;
    const reShaG = /This reverts commit ([0-9a-f]{7,40})/gi;
    while ((m = reShaG.exec(text))) revertedShas.add(m[1].toLowerCase());
    const rePrG = /\bReverts?\b[^#]*#(\d+)/gi;
    while ((m = rePrG.exec(text))) revertedPrNums.add(+m[1]);
    const reTitleG = /\bRevert\s+"([^"]+)"/gi;
    while ((m = reTitleG.exec(text))) revertedTitles.add(m[1].trim());
    evidence.push({ via, ref });
  };

  // 1) Revert-titled PRs (any state — the revert may itself be open/merged).
  try {
    const prs = ghJson(['pr', 'list', '--repo', rk, '--state', 'all', '--search', 'revert in:title',
      '--json', 'number,title,body,state', '-L', '100']) || [];
    for (const p of prs) {
      if (!/^revert\b|\brevert:/i.test(p.title || '')) continue;
      harvest(`${p.title}\n${p.body || ''}`, 'revert_pr', `#${p.number}`);
    }
  } catch { /* repo may not exist / no access — skip silently */ }

  // 2) git-revert commits on the default branch (last 200 commits, bounded).
  try {
    const commits = ghJson(['api', `repos/${rk}/commits?per_page=100`, '--paginate', '--slurp',
      '--jq', '[.[][] | {sha:.sha, msg:.commit.message}] | .[0:200]']) || [];
    for (const c of commits) {
      if (!/^Revert\b|This reverts commit/i.test(c.msg || '')) continue;
      harvest(c.msg, 'revert_commit', c.sha.slice(0, 9));
    }
  } catch { /* skip */ }

  const out = { revertedShas, revertedPrNums, revertedTitles, evidenceCount: evidence.length, evidence: evidence.slice(0, 30) };
  repoRevertCache.set(rk, out);
  return out;
}

function isReverted(pr, rev) {
  if (rev.revertedPrNums.has(pr.num)) return 'pr_number';
  if (pr.sha && [...rev.revertedShas].some((s) => pr.sha.toLowerCase().startsWith(s) || s.startsWith(pr.sha.toLowerCase()))) return 'merge_sha';
  if (pr.title && rev.revertedTitles.has(pr.title.trim())) return 'title';
  return null;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Mining neo-brain agent_commands (read-only)…');
  // dev-agent is the authoring agent — its result.pr_url is the precise set of
  // code changes the fleet SHIPPED. (planner dispatches; reviewer reviews; only
  // dev-agent authors.) payload.pr_url is a fallback for older rows.
  const cmds = await fetchAll('agent_commands',
    'select=to_agent,command,status,payload,result,created_at&to_agent=eq.dev-agent&order=created_at');
  const authored = cmds
    .filter((r) => ['investigate_bug', 'feature_request'].includes(r.command))
    .map((r) => ({ command: r.command, created_at: r.created_at, pr_url: r.result?.pr_url || r.payload?.pr_url || null }))
    .filter((r) => r.pr_url);

  // dedup by pr_url
  const byUrl = new Map();
  for (const r of authored) if (!byUrl.has(r.pr_url)) byUrl.set(r.pr_url, r);
  const fleetPrs = [...byUrl.values()].map((r) => ({ ...r, ...parsePrUrl(r.pr_url) })).filter((r) => r.owner);
  console.log(`  dev-agent authoring commands with a PR: ${authored.length} (dedup ${fleetPrs.length})`);

  const repos = [...new Set(fleetPrs.map((r) => r.repoKey))];
  console.log(`  repos touched: ${repos.length} — ${repos.join(', ') || '(none)'}`);

  // Pre-fetch revert signals per repo.
  console.log('Fetching revert signals from GitHub (GET only)…');
  const repoRev = {};
  for (const rk of repos) { const [o, r] = rk.split('/'); repoRev[rk] = ghRepoReverts(o, r); }

  // Enrich each fleet PR + match against reverts.
  const results = [];
  for (const pr of fleetPrs) {
    const full = ghPrFull(pr.owner, pr.repo, pr.num);
    const rev = repoRev[pr.repoKey];
    const revertedBy = full.state === 'merged' ? isReverted({ num: pr.num, sha: full.sha, title: full.title }, rev) : null;
    results.push({ pr_url: pr.pr_url, command: pr.command, created_at: pr.created_at, state: full.state, title: redact(full.title), reverted: !!revertedBy, reverted_match: revertedBy });
  }

  const merged = results.filter((r) => r.state === 'merged');
  const reverted = merged.filter((r) => r.reverted);
  const resolved = results.filter((r) => ['merged', 'closed_unmerged', 'not_found', 'open'].includes(r.state));
  const ghErr = results.filter((r) => r.state === 'gh_error').length;

  const perRepo = {};
  for (const rk of repos) {
    const m = merged.filter((r) => parsePrUrl(r.pr_url).repoKey === rk);
    const rv = m.filter((r) => r.reverted);
    perRepo[rk] = { fleet_merged: m.length, fleet_reverted: rv.length, revert_rate_pct: pct(rv.length, m.length), total_reverts_in_repo: repoRev[rk].evidenceCount };
  }

  const report = {
    generated: new Date().toISOString(),
    phase: 'phase-1-revert-scan',
    window: windowOf(fleetPrs),
    universe: 'dev-agent authored PRs (investigate_bug/feature_request) recorded in agent_commands',
    totals: {
      fleet_authoring_prs: fleetPrs.length,
      fleet_merged: merged.length,
      fleet_reverted: reverted.length,
      stuck_rate_pct: pct(merged.length - reverted.length, merged.length),
      revert_rate_pct: pct(reverted.length, merged.length),
      gh_unresolved: ghErr,
    },
    per_repo: perRepo,
    reverted_prs: reverted.map((r) => ({ pr_url: r.pr_url, title: r.title, matched_by: r.reverted_match, command: r.command })),
    notes: [
      'Universe is dev-agent authored PRs in agent_commands — the precise set the fleet shipped. claude-code-action PRs (the retired-reviewer replacement) are NOT in agent_commands and are a known gap; extend by classifying merged PRs by Co-Authored-By trailer.',
      'Revert detection scans revert-titled PRs + the last 200 default-branch commits per repo. A revert older than 200 commits back, or one that neither names the SHA/PR# nor quotes the title, is missed (under-counts).',
      'autonomous dispatch wound down ~2026-05-29; this is the historical active window.',
    ],
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(OUT_MD, renderMd(report));
  console.log(`\n✓ wrote ${OUT_JSON}\n✓ wrote ${OUT_MD}`);
  console.log(`\nHEADLINE: ${report.totals.fleet_merged} fleet PRs merged, ${report.totals.fleet_reverted} reverted → STUCK RATE ${report.totals.stuck_rate_pct}%`);
}

function renderMd(r) {
  const t = r.totals;
  const L = [];
  L.push(`# NACA agent eval — revert scan (${stamp})`);
  L.push('');
  L.push('The fleet\'s **correctness** signal that Phase 0 was missing: of everything the fleet *shipped* (merged), what fraction later got **reverted** vs **stuck**. In an auto-merge fleet "approve → merged" is near-tautological; this is the number that says whether the autonomous merge pipeline is net-positive.');
  L.push('');
  L.push(`**Universe:** ${r.universe} · window ${r.window.first}→${r.window.last}`);
  L.push('');
  L.push('## Headline');
  L.push('');
  L.push('| Metric | Value |');
  L.push('|---|---|');
  L.push(`| Fleet authoring PRs | ${t.fleet_authoring_prs} |`);
  L.push(`| ...merged | ${t.fleet_merged} |`);
  L.push(`| ...later reverted | **${t.fleet_reverted}** |`);
  L.push(`| **STUCK rate (merged & not reverted)** | **${t.stuck_rate_pct}%** |`);
  L.push(`| revert rate | ${t.revert_rate_pct}% |`);
  L.push(`| unresolved on GitHub (gh_error) | ${t.gh_unresolved} |`);
  L.push('');
  L.push('## Per repo');
  L.push('');
  L.push('| Repo | fleet merged | fleet reverted | revert rate | total reverts in repo |');
  L.push('|---|---|---|---|---|');
  for (const [rk, v] of Object.entries(r.per_repo)) {
    L.push(`| ${rk} | ${v.fleet_merged} | ${v.fleet_reverted} | ${v.revert_rate_pct ?? '—'}% | ${v.total_reverts_in_repo} |`);
  }
  L.push('');
  if (r.reverted_prs.length) {
    L.push('## Reverted fleet PRs');
    L.push('');
    for (const p of r.reverted_prs) L.push(`- ${p.pr_url} — _${p.title}_ (matched by ${p.matched_by}, ${p.command})`);
  } else {
    L.push('## Reverted fleet PRs');
    L.push('');
    L.push('_None detected._ Either the fleet\'s shipped changes stuck, or reverts fell outside the scan window (see limitations).');
  }
  L.push('');
  L.push('## Limitations (honest)');
  for (const n of r.notes) L.push(`- ${n}`);
  L.push('- A high stuck-rate here is **necessary but not sufficient** for trusting the pipeline: a bad change that nobody noticed/reverted still counts as "stuck". Pair with the dev-agent sandbox eval (does the fix actually pass tests) for the full picture.');
  L.push('');
  L.push('## How to use this');
  L.push('- This is the **historical baseline** for the dev-agent fix pipeline. Re-run after re-activating the Siti→dev-agent pipeline (with the Agent SDK engine) to A/B whether the new engine\'s shipped fixes stick more often.');
  return L.join('\n') + '\n';
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
