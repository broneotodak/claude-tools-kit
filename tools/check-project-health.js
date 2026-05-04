#!/usr/bin/env node
/**
 * check-project-health.js — fleet & project health one-shot check.
 *
 * REVAMP-V1.0.0 Step 3. Wraps the queries documented in WORKFLOW.md so
 * Neo (or cron) can ask "is the fleet healthy?" without remembering the
 * exact PostgREST filters every time.
 *
 * USAGE
 *   node tools/check-project-health.js                  # fleet-wide
 *   node tools/check-project-health.js <project-name>   # one project
 *
 * EXAMPLES
 *   node tools/check-project-health.js
 *   node tools/check-project-health.js siti
 *   node tools/check-project-health.js naca-app
 *
 * EXIT CODES
 *   0 — all checks passed
 *   2 — at least one WARN, no FAIL
 *   1 — at least one FAIL
 *
 * Designed to run cleanly in a terminal (ANSI colors) AND in cron (no
 * colors when stdout isn't a TTY).
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEO_BRAIN_URL;
const KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('NEO_BRAIN_URL / NEO_BRAIN_SERVICE_ROLE_KEY missing'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const isTTY = process.stdout.isTTY;
const c = (code, text) => isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
const green  = s => c('32', s);
const yellow = s => c('33', s);
const red    = s => c('31', s);
const dim    = s => c('2',  s);
const bold   = s => c('1',  s);

// Track results so we can compute exit code.
let pass = 0, warn = 0, fail = 0;
function record(status) {
  if (status === 'PASS') pass++;
  else if (status === 'WARN') warn++;
  else if (status === 'FAIL') fail++;
}
function statusBadge(status) {
  if (status === 'PASS') return green('[PASS]');
  if (status === 'WARN') return yellow('[WARN]');
  if (status === 'FAIL') return red('[FAIL]');
  return dim('[ N/A]');
}
function printCheck(label, status, details = []) {
  record(status);
  const padded = label.padEnd(44);
  console.log(`${padded} ${statusBadge(status)}`);
  for (const line of details) console.log(`  ${dim(line)}`);
}

function fmtAge(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s/60)}m`;
  if (s < 86400) return `${Math.round(s/3600)}h`;
  return `${Math.round(s/86400)}d`;
}

// ── individual checks ────────────────────────────────────────────────

async function checkHeartbeats() {
  const [{ data: reg }, { data: hb }, { data: agents }] = await Promise.all([
    sb.from('project_registry').select('project,tier,active').eq('active', true),
    sb.from('agent_heartbeats').select('agent_name,status,reported_at'),
    // agent_registry — used to look up cadence metadata (scheduled vs always-running)
    // AND to filter out archived agents whose stale heartbeats would otherwise show as offline.
    sb.from('agent_registry').select('agent_name,status,meta'),
  ]);
  const hbMap = new Map((hb||[]).map(h => [h.agent_name, h]));
  const agentMeta = new Map((agents||[]).map(a => [a.agent_name, a]));
  const t1Projects = (reg||[]).filter(r => r.tier === 'tier_1');
  // Filter out heartbeats from agents whose registry status is 'archived' or
  // who don't appear in registry at all (could be ghost rows from removed agents).
  // We intentionally include unregistered agents so we don't silently miss
  // an agent that was added via PM2 but never registered — but skip explicitly-archived.
  const liveHb = (hb || []).filter(h => {
    const ag = agentMeta.get(h.agent_name);
    return !ag || ag.status !== 'archived';
  });
  let liveCount = 0, staleCount = 0, offlineCount = 0, scheduledOkCount = 0;
  const offline = [], stale = [], scheduledOk = [];
  for (const h of liveHb) {
    const ageMin = (Date.now() - new Date(h.reported_at).getTime()) / 60000;
    const ag = agentMeta.get(h.agent_name);
    const isScheduled = ag?.meta?.always_running === false;
    const cadence = ag?.meta?.cadence;
    // Scheduled job: it's "OK" if it ran within its expected cadence window.
    // daily_03_myt = ran some time in the last ~25h (allow slop)
    // hourly = ran in last 70min
    // weekly = ran in last 8 days
    if (isScheduled) {
      const okThresholdMin =
        cadence === 'hourly' ? 70 :
        cadence?.startsWith('daily') ? 25 * 60 :
        cadence === 'weekly' ? 8 * 24 * 60 :
        24 * 60; // unknown cadence → assume daily-ish
      if (ageMin < okThresholdMin) {
        scheduledOkCount++;
        scheduledOk.push(`${h.agent_name} (${cadence || 'scheduled'}, ${fmtAge(h.reported_at)} ago)`);
        continue;
      }
      // Scheduled job missed its window → real offline.
      offlineCount++;
      offline.push(`${h.agent_name} (scheduled ${cadence}, ${fmtAge(h.reported_at)} — missed window)`);
      continue;
    }
    // Always-running agent: 5min/60min thresholds
    if (ageMin < 5) liveCount++;
    else if (ageMin < 60) { staleCount++; stale.push(`${h.agent_name} (${fmtAge(h.reported_at)})`); }
    else { offlineCount++; offline.push(`${h.agent_name} (${fmtAge(h.reported_at)})`); }
  }
  const total = liveCount + staleCount + offlineCount + scheduledOkCount;
  const status = offlineCount === 0 && staleCount === 0 ? 'PASS'
    : offlineCount <= 2 && staleCount <= 1 ? 'WARN'
    : 'FAIL';
  const details = [`${liveCount} live (<5min) · ${scheduledOkCount} scheduled-ok · ${staleCount} stale · ${offlineCount} offline · ${t1Projects.length} tier_1 in registry`];
  if (stale.length) details.push(`stale (5–60m): ${stale.slice(0,5).join(', ')}${stale.length>5?` +${stale.length-5} more`:''}`);
  if (offline.length) details.push(`offline: ${offline.slice(0,5).join(', ')}${offline.length>5?` +${offline.length-5} more`:''}`);
  if (scheduledOk.length) details.push(`scheduled-ok: ${scheduledOk.slice(0,3).join(', ')}${scheduledOk.length>3?` +${scheduledOk.length-3} more`:''}`);
  printCheck('Heartbeats', status, details);
}

async function checkStuckCommands(filterProject) {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  let q = sb.from('agent_commands').select('id,from_agent,to_agent,command,status,created_at')
    .in('status', ['pending', 'claimed', 'running'])
    .lt('created_at', cutoff);
  const { data } = await q;
  const stuck = data || [];
  const status = stuck.length === 0 ? 'PASS' : stuck.length <= 3 ? 'WARN' : 'FAIL';
  const details = [`${stuck.length} commands stuck >10min in pending/claimed/running`];
  for (const r of stuck.slice(0, 5)) {
    details.push(`${fmtAge(r.created_at).padStart(4)} ago · ${r.from_agent}→${r.to_agent} · ${r.command} · [${r.status}]`);
  }
  if (stuck.length > 5) details.push(`+${stuck.length - 5} more`);
  printCheck('Stuck commands', status, details);
}

async function checkOrphanPRs() {
  const cutoff = new Date(Date.now() - 6 * 3600_000).toISOString();
  const horizon = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: aw } = await sb.from('memories')
    .select('id,metadata,created_at')
    .eq('category', 'pr-awaiting-decision')
    .gte('created_at', horizon)
    .lt('created_at', cutoff);
  const orphans = [];
  for (const r of aw || []) {
    const url = r.metadata?.pr_url; if (!url) continue;
    const { data: dec } = await sb.from('memories')
      .select('id').eq('category', 'pr-decision-recorded')
      .eq('metadata->>pr_url', url).limit(1);
    if (!dec || dec.length === 0) {
      orphans.push({ url, age: r.created_at });
    }
  }
  const status = orphans.length === 0 ? 'PASS' : orphans.length <= 2 ? 'WARN' : 'FAIL';
  const details = [`${orphans.length} pr-awaiting-decision rows older than 6h with no decision recorded`];
  for (const o of orphans.slice(0, 5)) {
    details.push(`${fmtAge(o.age).padStart(4)} ago · ${o.url}`);
  }
  if (orphans.length > 5) details.push(`+${orphans.length - 5} more`);
  printCheck('Orphan PR decisions', status, details);
}

async function checkMemoryActivity() {
  const since1d = new Date(Date.now() - 24 * 3600_000).toISOString();
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ count: c1d }, { count: c7d }] = await Promise.all([
    sb.from('memories').select('id', { count: 'exact', head: true }).gte('created_at', since1d),
    sb.from('memories').select('id', { count: 'exact', head: true }).gte('created_at', since7d),
  ]);
  const status = c1d >= 30 ? 'PASS' : c1d >= 10 ? 'WARN' : 'FAIL';
  printCheck('Memory activity', status, [
    `${c1d} writes in last 24h · ${c7d} writes in last 7d`,
    c1d < 10 ? 'Fewer than 10 in 24h is suspicious — check that Siti / agents are saving' : '',
  ].filter(Boolean));
}

async function checkRegistryHealth() {
  const { data } = await sb.from('project_registry').select('tier,active');
  const counts = { tier_1: 0, tier_2: 0, tier_3: 0, decommissioned: 0, transferred: 0, untagged: 0 };
  let inactiveCount = 0;
  for (const r of data || []) {
    if (!r.active) inactiveCount++;
    counts[r.tier || 'untagged']++;
  }
  const status = counts.untagged === 0 ? 'PASS' : counts.untagged < 3 ? 'WARN' : 'FAIL';
  const distLine = `tier_1=${counts.tier_1} · tier_2=${counts.tier_2} · tier_3=${counts.tier_3} · decommissioned=${counts.decommissioned} · transferred=${counts.transferred}`;
  const details = [`${data?.length || 0} total · ${inactiveCount} inactive · ${distLine}`];
  if (counts.untagged > 0) details.push(`${counts.untagged} rows have no tier — backfill needed`);
  printCheck('Registry health', status, details);
}

async function checkScopeAdoption() {
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();
  // Sample last 7d to see how Layer A scope tagging is rolling out.
  const { data } = await sb.from('memories')
    .select('metadata')
    .gte('created_at', since7d)
    .limit(2000);
  let tagged = 0, untagged = 0;
  for (const r of data || []) {
    if (r.metadata?.scope) tagged++; else untagged++;
  }
  const total = tagged + untagged;
  const pct = total ? Math.round((tagged / total) * 100) : 0;
  // This is informational — Layer A only tags going forward, so adoption
  // grows organically. PASS at any level; flag if it's been long enough
  // that we'd expect to see traction.
  const status = pct >= 30 ? 'PASS' : pct >= 5 ? 'WARN' : 'WARN';
  printCheck('Scope tagging adoption (Layer A)', status, [
    `${pct}% of last-7d memories tagged with metadata.scope (${tagged}/${total})`,
    pct < 30 ? 'Will grow organically — backfill optional in Step 6' : '',
  ].filter(Boolean));
}

// ── project-specific checks ──────────────────────────────────────────

async function checkProject(projectName) {
  console.log(bold(`\n📦  Project deep-check: ${projectName}\n`));

  // 1. Registry lookup (fuzzy — registry key, then display_name, then repo).
  // The registry uses historical keys like "nclaw-dashboard" for Siti, so
  // accept friendly names too.
  let row = null;
  let matchKind = null;
  const direct = await sb.from('project_registry').select('*').eq('project', projectName).maybeSingle();
  if (direct.data) { row = direct.data; matchKind = 'project key'; }
  if (!row) {
    const byName = await sb.from('project_registry').select('*').ilike('display_name', `%${projectName}%`).limit(2);
    if (byName.data?.length === 1) { row = byName.data[0]; matchKind = 'display_name'; }
    else if (byName.data?.length > 1) {
      printCheck('Registry lookup', 'FAIL', [
        `"${projectName}" matches ${byName.data.length} projects by display_name — be specific:`,
        ...byName.data.map(r => `  ${r.project} (${r.display_name})`),
      ]);
      return;
    }
  }
  if (!row) {
    const byRepo = await sb.from('project_registry').select('*').ilike('repo', `%/${projectName}`).limit(2);
    if (byRepo.data?.length === 1) { row = byRepo.data[0]; matchKind = 'repo'; }
  }
  if (!row) {
    printCheck('Registry lookup', 'FAIL', [
      `"${projectName}" not in project_registry as a key, display_name, or repo last-segment.`,
      'Run with no args to see the full health snapshot, then check the registry list manually.',
    ]);
    return;
  }
  printCheck('Registry lookup', 'PASS', [
    `${row.display_name} · tier=${row.tier} · active=${row.active}` + (matchKind === 'project key' ? '' : ` · matched via ${matchKind}: ${row.project}`),
    `repo=${row.repo || '(none)'} · deploy=${row.deploy_method || '-'} · url=${row.deploy_url || '-'}`,
  ]);

  // 2. Recent memory activity for this project
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: mems } = await sb.from('memories')
    .select('id,category,created_at,content')
    .or(`category.ilike.%${projectName}%,content.ilike.%${projectName}%`)
    .gte('created_at', since7d)
    .order('created_at', { ascending: false })
    .limit(5);
  const memStatus = (mems?.length || 0) > 0 ? 'PASS' : row.active ? 'WARN' : 'PASS';
  printCheck('Recent memory writes', memStatus, [
    `${mems?.length || 0} writes mentioning "${projectName}" in last 7d`,
    ...((mems||[]).slice(0,3).map(m => `${fmtAge(m.created_at).padStart(4)} ago · ${m.category} · ${(m.content||'').slice(0,70)}`)),
  ]);

  // 3. Open PRs (gh CLI; best-effort)
  if (row.repo) {
    try {
      const { execSync } = await import('child_process');
      const out = execSync(`gh pr list --repo ${row.repo} --state open --json number,title --limit 5`, {
        encoding: 'utf-8', timeout: 10000,
      }).trim();
      const prs = JSON.parse(out || '[]');
      const status = prs.length === 0 ? 'PASS' : prs.length <= 3 ? 'PASS' : 'WARN';
      const details = [`${prs.length} open PR(s)`];
      for (const p of prs) details.push(`#${p.number} · ${p.title}`);
      printCheck('Open PRs (GitHub)', status, details);
    } catch (e) {
      printCheck('Open PRs (GitHub)', 'N/A', [`gh CLI not available or auth issue: ${e.message.slice(0,80)}`]);
    }
  }

  // 4. Stuck commands targeting this project (best-effort: match by from/to_agent
  //    or payload content)
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: stuck } = await sb.from('agent_commands')
    .select('id,from_agent,to_agent,command,status,created_at')
    .or(`from_agent.eq.${projectName},to_agent.eq.${projectName}`)
    .in('status', ['pending', 'claimed', 'running'])
    .lt('created_at', cutoff);
  const sStatus = (stuck?.length || 0) === 0 ? 'PASS' : 'WARN';
  printCheck('Stuck commands for this project', sStatus, [`${stuck?.length || 0} stuck`]);

  // 5. Heartbeat (if this project IS an agent). Try the registry key,
  //    the friendly name, the repo last segment — agents publish under
  //    different names than the registry keeps (siti vs nclaw-dashboard).
  const candidates = [projectName, row.project, row.display_name?.toLowerCase()?.replace(/\s+.*$/, ''),
                      row.repo?.split('/').pop()].filter(Boolean);
  let hb = null;
  for (const name of [...new Set(candidates)]) {
    const { data } = await sb.from('agent_heartbeats')
      .select('agent_name,status,reported_at').eq('agent_name', name).maybeSingle();
    if (data) { hb = data; break; }
  }
  if (hb) {
    const ageMin = (Date.now() - new Date(hb.reported_at).getTime()) / 60000;
    const hbStatus = ageMin < 5 ? 'PASS' : ageMin < 60 ? 'WARN' : 'FAIL';
    printCheck('Heartbeat', hbStatus, [
      `agent_name=${hb.agent_name} · last reported ${fmtAge(hb.reported_at)} ago · status=${hb.status}`,
    ]);
  } else if (row.tier === 'tier_1') {
    printCheck('Heartbeat', 'WARN', [
      `No heartbeat row found (tried: ${[...new Set(candidates)].join(', ')}).`,
      `tier_1 projects should publish heartbeats. If this is a doc-only or repo-only project, ignore.`,
    ]);
  }
}

// ── main ──────────────────────────────────────────────────────────────

async function main() {
  const projectArg = process.argv[2];
  const t0 = Date.now();

  if (projectArg) {
    await checkProject(projectArg);
  } else {
    console.log(bold(`\n🛡️   Fleet Health Check · ${new Date().toISOString()}\n`));
    await checkHeartbeats();
    await checkStuckCommands();
    await checkOrphanPRs();
    await checkMemoryActivity();
    await checkRegistryHealth();
    await checkScopeAdoption();
  }

  // Summary
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const total = pass + warn + fail;
  console.log('');
  console.log(dim('─'.repeat(60)));
  let summary;
  if (fail > 0) summary = red(`${fail} FAIL`) + ` · ${warn ? yellow(warn + ' WARN') : 'no warnings'} · ${green(pass + ' pass')} · ${dim(elapsed + 's')}`;
  else if (warn > 0) summary = yellow(`${warn} WARN`) + ` · ${green(pass + ' pass')} · ${dim(elapsed + 's')}`;
  else summary = green(`${pass}/${total} checks passed`) + ` · ${dim(elapsed + 's')}`;
  console.log(`Summary: ${summary}`);

  // Exit code
  if (fail > 0) process.exit(1);
  if (warn > 0) process.exit(2);
  process.exit(0);
}

main().catch(e => {
  console.error(red('check-project-health fatal:'), e.message);
  process.exit(1);
});
