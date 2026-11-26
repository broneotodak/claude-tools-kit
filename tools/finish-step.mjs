#!/usr/bin/env node
// finish-step — the end-of-step routine, one command, runs ONCE and stops.
//
//   node tools/finish-step.mjs --title "P1-08 usage log" --repo broneotodak/siti-v2 --pr 201 \
//        [--step P1-08] [--deploy-project siti-router] [--verify "<command>"] [--note "<text>"] \
//        [--ledger spine_progress] [--total 43] [--wait-sec 120] [--dry-run]
//   node tools/finish-step.mjs --progress [--ledger spine_progress] [--total 43]   # print the one-line progress, change nothing
//
// What it does, in order (Neo 26 Nov 2026: "automate finishing a step — but NO infinite loops"):
//   1. the PR is MERGED (gh) — otherwise stop, say so
//   2. if --deploy-project: find the deploy order for that PR in agent_commands and wait for it
//      (bounded: --wait-sec, default 120, hard max 300) — it must say DEPLOY-RESULT: OK
//   3. if --verify: run that one command once (timeout 60 s) — it must exit 0
//   4. only if every check passed: save ONE shared_infra_change memory and ONE ledger row (category --ledger, default finish_step_progress)
//      (both idempotent: running it twice for the same repo#pr writes nothing new), then print progress
//
// HARD GUARDRAILS against runaway automation (this tool must never be able to loop):
//   - it never calls itself, never schedules anything, never starts/restarts a service, never calls an LLM,
//     never retries a failed check — a failure is reported once and the process exits with code 2
//   - every wait has a hard time limit; there is no `while(true)`; the only repeat is a poll with a fixed
//     maximum count (wait-sec / 10)
//   - single instance (lock file, stale after 10 min)
//   - daily cap: at most 25 ledger rows per UTC day (a stuck caller cannot flood the brain)
//   - kill switch: FINISH_STEP=off in the environment, or the file ~/.claude/finish-step.off → exits at once
//
// Exit codes: 0 done · 2 a check failed (nothing recorded) · 3 refused (kill switch / lock / daily cap) · 1 usage error

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const CTK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const LIMITS = { dailyRows: 25, waitDefaultSec: 120, waitMaxSec: 300, pollSec: 10, verifySec: 60, lockStaleMs: 10 * 60_000 };
const DEFAULT_LEDGER = 'finish_step_progress';
const safeLedger = (v) => (/^[a-z0-9_]{3,40}$/.test(String(v || '')) ? String(v) : DEFAULT_LEDGER);

// ---- pure helpers (unit tested) --------------------------------------------------------------------------

export function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (['dry-run', 'progress'].includes(k)) o[k] = true;
    else { o[k] = argv[i + 1]; i++; }
  }
  return o;
}

export function clampWait(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return LIMITS.waitDefaultSec;
  return Math.min(LIMITS.waitMaxSec, Math.round(n));
}

export function pollBudget(waitSec) {
  return Math.max(1, Math.floor(clampWait(waitSec) / LIMITS.pollSec)); // a fixed number of polls, never open-ended
}

export function finishKey(repo, pr) {
  return `finish-step:${String(repo).trim()}#${Number(pr)}`;
}

export function deployVerdict(row) {
  if (!row) return { ok: false, state: 'no-order', reason: 'no deploy order found for this PR' };
  if (row.status === 'failed' || row.status === 'error') return { ok: false, state: 'failed', reason: `deploy order ${row.status}` };
  if (row.status !== 'done') return { ok: false, state: 'pending', reason: `deploy order still ${row.status}` };
  const out = String(row.result?.output ?? row.result ?? '');
  return /DEPLOY-RESULT:\s*OK/.test(out) ? { ok: true, state: 'ok', reason: 'DEPLOY-RESULT: OK' } : { ok: false, state: 'not-ok', reason: 'deploy order is done but did not report DEPLOY-RESULT: OK' };
}

// Counts distinct step ids that look like plan steps (P1-08, P2-03 …); fixes tagged B-xx etc. are logged but not counted.
export function progressLine(rows, { total = null, label = 'Progress' } = {}) {
  const steps = new Set(rows.map((r) => r.step).filter((x) => x && /^P\d-\d+/.test(x)));
  const last = rows[0];
  const lastBit = last ? ` · last: ${last.title}${last.at ? ` (${String(last.at).slice(0, 10)})` : ''}` : '';
  return `${label}: ${steps.size}${total ? `/${total}` : ''} steps logged${lastBit}`;
}

export function dailyCapReached(countToday) {
  return Number(countToday) >= LIMITS.dailyRows;
}

// ---- guardrail plumbing ----------------------------------------------------------------------------------

function killSwitch() {
  if (String(process.env.FINISH_STEP || '').toLowerCase() === 'off') return 'FINISH_STEP=off';
  const f = path.join(os.homedir(), '.claude', 'finish-step.off');
  return fs.existsSync(f) ? f : null;
}

function takeLock() {
  const f = path.join(os.tmpdir(), 'finish-step.lock');
  try {
    const st = fs.statSync(f);
    if (Date.now() - st.mtimeMs < LIMITS.lockStaleMs) return null; // someone else is running
  } catch { /* no lock */ }
  fs.writeFileSync(f, String(process.pid));
  return f;
}

const sleepSync = (sec) => spawnSync('sleep', [String(sec)]);

function brain() {
  require('dotenv').config({ path: path.join(CTK, '.env'), quiet: true });
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY);
}

async function ledger(nb, cat) {
  const { data } = await nb.from('memories').select('content,created_at,metadata').eq('category', cat).order('created_at', { ascending: false }).limit(200);
  return (data || []).map((r) => {
    const m = /step=([^\s|]+)/.exec(r.content || '');
    const t = /title=([^|]+)/.exec(r.content || '');
    return { step: m?.[1] && m[1] !== '-' ? m[1] : null, key: /key=([^\s|]+)/.exec(r.content || '')?.[1] || null, title: (t?.[1] || '').trim(), at: r.created_at };
  });
}

function save(category, title, content, importance = 6) {
  // reuse the audited saver (embedding + trigger rules); args are passed as an array, never through a shell
  const out = execFileSync('node', [path.join(CTK, 'tools', 'save-memory.js'), category, title, content, String(importance)], { encoding: 'utf8', timeout: 60_000 });
  return /id:\s*([0-9a-f-]{36})/.exec(out)?.[1] || null;
}

// ---- main ------------------------------------------------------------------------------------------------

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const say = (m) => console.log(m);

  const ks = killSwitch();
  if (ks) { say(`finish-step: switched off (${ks}) — nothing done`); process.exit(3); }

  const cat = safeLedger(a.ledger);
  const prog = { total: a.total ? Number(a.total) || null : null, label: cat === 'spine_progress' ? 'Spine' : 'Progress' };
  if (a.progress) {
    const nb = brain();
    say(progressLine(await ledger(nb, cat), prog));
    return;
  }

  if (!a.title || !a.repo || !a.pr) { console.error('usage: finish-step.mjs --title "…" --repo owner/repo --pr N [--step P1-08] [--deploy-project p] [--verify cmd] [--note text] [--wait-sec 120] [--dry-run]'); process.exit(1); }
  const key = finishKey(a.repo, a.pr);

  const lock = a['dry-run'] ? 'dry' : takeLock();
  if (!lock) { say('finish-step: another run is in progress (lock) — nothing done'); process.exit(3); }
  const release = () => { if (lock !== 'dry') { try { fs.unlinkSync(path.join(os.tmpdir(), 'finish-step.lock')); } catch { /* gone */ } } };

  const report = [];
  const fail = (why) => { release(); say(`✗ ${why}\nfinish-step: NOT recorded (a check failed). Fix it, then run this once more.`); process.exit(2); };

  try {
    // 1. merged?
    let pr;
    try { pr = JSON.parse(execFileSync('gh', ['pr', 'view', String(a.pr), '--repo', a.repo, '--json', 'state,mergedAt,title,url'], { encoding: 'utf8', timeout: 30_000 })); }
    catch (e) { fail(`could not read PR ${a.repo}#${a.pr}: ${String(e.message).split('\n')[0]}`); }
    if (pr.state !== 'MERGED') fail(`${a.repo}#${a.pr} is ${pr.state}, not MERGED`);
    report.push(`✓ PR merged ${pr.mergedAt?.slice(0, 16).replace('T', ' ')}Z`);

    const nb = brain();

    // 2. deploy order (bounded poll)
    if (a['deploy-project']) {
      let verdict = { ok: false, state: 'no-order', reason: 'not looked up' };
      const polls = pollBudget(a['wait-sec']);
      for (let i = 0; i < polls; i++) {
        const { data } = await nb.from('agent_commands').select('status,result,created_at').eq('command', 'deploy_project').filter('payload->>pr_number', 'eq', String(a.pr)).filter('payload->>repo', 'eq', a.repo).order('created_at', { ascending: false }).limit(1);
        verdict = deployVerdict(data?.[0]);
        if (verdict.ok || verdict.state === 'failed' || verdict.state === 'no-order' || verdict.state === 'not-ok') break;
        if (i < polls - 1) sleepSync(LIMITS.pollSec);
      }
      if (!verdict.ok) fail(`deploy (${a['deploy-project']}): ${verdict.reason}`);
      report.push(`✓ deploy ${a['deploy-project']}: ${verdict.reason}`);
    }

    // 3. one verification command, once
    if (a.verify) {
      const r = spawnSync('bash', ['-c', a.verify], { encoding: 'utf8', timeout: LIMITS.verifySec * 1000 });
      if (r.status !== 0) fail(`verify failed (exit ${r.status ?? 'timeout'}): ${String(r.stdout || r.stderr || '').trim().split('\n').slice(-2).join(' / ').slice(0, 200)}`);
      report.push(`✓ verify ok: ${String(r.stdout).trim().split('\n').pop()?.slice(0, 100) || 'exit 0'}`);
    }

    // 4. record (idempotent) — only now, because every check passed
    const dup = await nb.from('memories').select('id').eq('category', cat).ilike('content', `%key=${key}%`).limit(1);
    if (dup.data?.length) {
      report.push('• already recorded earlier — nothing new written');
    } else if (a['dry-run']) {
      report.push('• dry run — would record 1 shared_infra_change + 1 ledger row');
    } else {
      const since = new Date(); since.setUTCHours(0, 0, 0, 0);
      const today = await nb.from('memories').select('id', { count: 'exact', head: true }).eq('category', cat).gte('created_at', since.toISOString());
      if (dailyCapReached(today.count || 0)) { release(); say(`finish-step: daily cap (${LIMITS.dailyRows} rows) reached — nothing recorded`); process.exit(3); }
      const body = `${a.title}. ${pr.url}. ${a.note || ''} Checks passed: ${report.join('; ')}. ${key}`;
      const id1 = save('shared_infra_change', `${a.title} (${new Date().toISOString().slice(0, 10)})`, body, 6);
      const id2 = save(cat, `Step done: ${a.title}`, `step=${a.step || '-'} | key=${key} | title=${a.title} | ${pr.url}`, 5);
      report.push(`• recorded (shared_infra_change ${id1?.slice(0, 8) || '?'}, ledger ${id2?.slice(0, 8) || '?'})`);
    }

    say(report.join('\n'));
    say(progressLine(await ledger(nb, cat), prog));
  } finally {
    release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('finish-step error:', e.message); process.exit(1); });
}
