#!/usr/bin/env node
// ctk-preflight.js
//
// "Have you read the room?" check for every Claude Code session before it
// starts data ops. Prints the short version of what every session needs to
// know:
//   - DB-level enforcement health (memories trigger live? still armed?)
//   - Recent shared_infra_change activity from OTHER sessions in the last 24h
//   - Pending operator items (PRs > N hours awaiting decision)
//   - Memory-hygiene snapshot (NULL knowledge embeddings, test rows)
//   - Top-5 CTK rules that catch the most session drift
//
// USAGE
//   node ctk-preflight.js                  # human-readable; recommended for sessions
//   node ctk-preflight.js --json           # JSON for piping into other tools
//
// EXIT CODES
//   0 = all systems green
//   1 = soft warnings present (read the output before acting)
//   2 = fatal (env missing / fetch failed)
//
// INSTALL AS SESSION-START HOOK (recommended):
// Add to ~/.claude/settings.json under "hooks" (Claude Code config) so the
// preflight prints automatically at the start of every session — no per-session
// goodwill required:
//   "SessionStart": [{
//     "matcher": "",
//     "hooks": [{
//       "type": "command",
//       "command": "node /Users/broneotodak/Projects/claude-tools-kit/tools/ctk-preflight.js",
//       "timeout": 15
//     }]
//   }]
//
// Until that's installed, the global ~/.claude/CLAUDE.md should mandate
// running this script as the first thing in every CC session that touches
// NACA shared infra.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');

const envPath = `${process.env.HOME}/Projects/claude-tools-kit/.env`;
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; })
    .filter(Boolean),
);
const URL = env.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL;
const KEY = env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  if (JSON_OUT) console.log(JSON.stringify({ status: 'fatal', error: 'env_missing' }));
  else console.error('NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY required');
  process.exit(2);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// ── checks ──────────────────────────────────────────────────────────

async function checkTriggerArmed() {
  // Verify the embedding-enforcement trigger is still installed.
  const sql = `SELECT trigger_name FROM information_schema.triggers WHERE event_object_table='memories' AND trigger_name='memories_embedding_guard'`;
  const r = await fetch(`${URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (r.ok) return { armed: (await r.json()).length > 0 };
  // Fallback: do a deliberate bad INSERT and check the error message.
  const probe = await fetch(`${URL}/rest/v1/memories`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      content: 'ctk-preflight probe — must reject',
      category: 'ctk_preflight_probe',
      source: 'ctk-preflight',
      subject_id: '00000000-0000-0000-0000-000000000001',
    }),
  });
  if (probe.status === 400 || probe.status === 500) {
    const body = await probe.text();
    return { armed: body.includes('NULL embedding rejected') };
  }
  // If probe somehow succeeded, the trigger isn't armed; clean up the row.
  return { armed: false };
}

async function recentSharedInfraChange() {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const r = await fetch(
    `${URL}/rest/v1/memories?category=eq.shared_infra_change&created_at=gte.${since}&order=created_at.desc&limit=10&select=created_at,source,memory_type,content`,
    { headers: H },
  );
  return (await r.json()) || [];
}

async function fleetHealthSnapshot() {
  try {
    const r = await fetch('https://command.neotodak.com/api/health', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { status: 'unreachable', code: r.status };
    return await r.json();
  } catch (e) {
    return { status: 'unreachable', error: e.message };
  }
}

async function pendingOperatorItems() {
  // Stuck PR reminders in the last 24h via memories category
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const r = await fetch(
    `${URL}/rest/v1/memories?category=eq.pr-stuck-reminder&created_at=gte.${since}&order=created_at.desc&limit=10&select=content,metadata`,
    { headers: H },
  );
  return (await r.json()) || [];
}

function runHygiene() {
  try {
    const out = execFileSync('node', [
      `${process.env.HOME}/Projects/claude-tools-kit/tools/memory-hygiene-check.js`,
      '--json',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out);
  } catch (e) {
    // hygiene exits 1 on warning, 2 on fatal — child stdout still parseable
    try { return JSON.parse(e.stdout); } catch { return { status: 'fatal', error: e.message }; }
  }
}

// ── rules digest (the 5 that catch most session drift) ──────────────
const RULES_DIGEST = [
  '1. Use @todak/memory SDK for KNOWLEDGE writes — never raw POST. DB trigger now enforces this; bypass = error.',
  '2. Verify state via DB query before assuming. Semantic-search neo-brain before saying "no result exists".',
  '3. Multi-session: pre-flight + post-deploy `shared_infra_change` memory. Other sessions may be mid-deploy on the same surface.',
  '4. No hardcoded agent-name lists (Agent Plug & Play / refactor v2). Use agent_registry; lint guard catches violations.',
  '5. Read per-repo CLAUDE.md and naca/docs/spec/ before deciding what to change. Don\'t reason from stale memory of the repo.',
];

// ── main ────────────────────────────────────────────────────────────
(async () => {
  const [trigger, recent, fleet, pending] = await Promise.all([
    checkTriggerArmed(),
    recentSharedInfraChange(),
    fleetHealthSnapshot(),
    pendingOperatorItems(),
  ]);
  const hygiene = runHygiene();

  // verdict
  let exit = 0;
  const warnings = [];
  if (!trigger.armed) { exit = 1; warnings.push('memories trigger NOT armed'); }
  if (hygiene.status === 'warning') { exit = 1; warnings.push(`memory hygiene: ${hygiene.knowledge_null_embedding} knowledge NULL + ${hygiene.debug_test_rows} debug rows`); }
  if (fleet.status === 'degraded' || fleet.status === 'down') { exit = 1; warnings.push(`fleet status: ${fleet.status}`); }
  if (pending.length > 0) { exit = 1; warnings.push(`${pending.length} pending operator items`); }

  if (JSON_OUT) {
    console.log(JSON.stringify({
      exit, warnings,
      trigger_armed: trigger.armed,
      hygiene,
      fleet,
      recent_shared_infra_change: recent.length,
      pending_operator_items: pending.length,
    }, null, 2));
    process.exit(exit);
  }

  // Human-readable
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  CTK pre-flight · session orientation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`${trigger.armed ? '🟢' : '🔴'} memories trigger:      ${trigger.armed ? 'ARMED · DB rejects knowledge writes with NULL embedding' : 'NOT ARMED — investigate before any agent work'}`);
  const fleetEmoji = fleet.status === 'ok' ? '🟢' : fleet.status === 'degraded' ? '🟡' : '🔴';
  console.log(`${fleetEmoji} fleet:                 ${fleet.status || 'unknown'}${fleet.agents ? ` · ${fleet.agents.active} active / ${fleet.agents.exempt} exempt / ${fleet.agents.offline} offline` : ''}`);
  const hygEmoji = hygiene.status === 'ok' ? '🟢' : '🟡';
  console.log(`${hygEmoji} memory hygiene:        ${hygiene.knowledge_null_embedding || 0} knowledge NULL · ${hygiene.debug_test_rows || 0} debug rows · ${hygiene.total_rows || '?'} total`);
  const pendEmoji = pending.length === 0 ? '🟢' : '🟡';
  console.log(`${pendEmoji} operator pending:      ${pending.length} item(s) in last 24h`);
  console.log('');
  console.log('━━ Last 24h shared_infra_change (what other sessions just shipped) ━━');
  if (recent.length === 0) {
    console.log('  (none)');
  } else {
    for (const r of recent) {
      const ts = (r.created_at || '').slice(11, 16);
      const summary = (r.content || '').split('\n')[0].slice(0, 100);
      console.log(`  [${ts}] (${r.source || '?'}) ${summary}`);
    }
  }
  console.log('');
  console.log('━━ Top-5 rules every session must honour ━━');
  for (const rule of RULES_DIGEST) console.log(`  ${rule}`);
  console.log('');
  console.log('Full rules → ~/Projects/claude-tools-kit/enforcement/CTK_ENFORCEMENT.md');
  console.log('Per-repo  → <repo>/CLAUDE.md');
  console.log('Workflow  → ~/Projects/claude-tools-kit/WORKFLOW.md');
  if (warnings.length) {
    console.log('');
    console.log('⚠️  warnings:');
    for (const w of warnings) console.log(`   - ${w}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(exit);
})().catch((e) => {
  if (JSON_OUT) console.log(JSON.stringify({ status: 'fatal', error: e.message }));
  else console.error('preflight fatal:', e.message);
  process.exit(2);
});
