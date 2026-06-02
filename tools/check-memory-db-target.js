#!/usr/bin/env node
'use strict';

/**
 * Ratchet guard — stops CTK tools from (re)introducing reads/writes against the FROZEN legacy
 * memory archive (process.env.SUPABASE_URL = uzamamymfzhelvkwpvgt / claude_desktop_memory /
 * flowstate_activities). That class of bug — tools silently reading stale data — is the one we
 * keep paying for; this makes it impossible to add a new instance.
 *
 *   node tools/check-memory-db-target.js        Pre-commit mode: scan STAGED ADDED lines only and
 *                                               fail on any NEW legacy memory access. Existing
 *                                               offenders are NOT blocked, so in-flight work on
 *                                               other branches isn't held hostage (true ratchet).
 *   node tools/check-memory-db-target.js --all  Audit mode: print every existing offender
 *                                               (the burn-down punch-list). Always exits 0.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PATTERNS = [
  { re: /claude_desktop_memory/, why: 'legacy memory table (frozen archive)' },
  { re: /flowstate_activities/, why: 'legacy activity table (parked)' },
  { re: /uzamamymfzhelvkwpvgt/, why: 'hardcoded legacy archive project ref' },
  { re: /process\.env\.SUPABASE_URL\b/, why: 'SUPABASE_URL resolves to the legacy archive — use tools/lib/neo-brain.js getNeoBrainClient()' },
];

// Tools that legitimately touch the archive (migration / backup / parity), per the 2026-06-01 audit,
// plus this guard and the shared lib (which name the legacy ref in strings/comments by necessity).
const ALLOWLIST = new Set([
  'backup-memory-complete.js',
  'compare-memory-rowcounts.js',
  'migrate-to-neo-brain.js',
  'migrate-credentials-to-neo-brain.js',
  'import-contacts-as-identities.js',
  'promote-interacted-contacts.js',
  'check-memory-db-target.js',
  'lib/neo-brain.js',

  // non-memory / generic — uses SUPABASE_URL legitimately (2026-06-01 burn-down, case C)
  'query-supabase-project.js',     // non-memory / generic — uses SUPABASE_URL legitimately
  'run-sql-migration.js',          // non-memory / generic — uses SUPABASE_URL legitimately
  'ctk-pre-prompt-validator.js',   // non-memory / generic — uses SUPABASE_URL legitimately

  // deprecated, gated behind --force-legacy (2026-06-01 burn-down, case B). Legacy
  // client is built lazily and the main() guard exits before it is reached.
  'analyze-tech-stack.js',         // deprecated, gated behind --force-legacy
  'claude-code-auto-save.js',      // deprecated, gated behind --force-legacy
  'claude-startup-context.js',     // deprecated, gated behind --force-legacy
  'memory-enrichment.js',          // deprecated, gated behind --force-legacy
  'rag-embed-memories.js',         // deprecated, gated behind --force-legacy
  'unified-memory-strategy.js',    // deprecated, gated behind --force-legacy
  'sub-agent-memory-system.js',    // deprecated, gated behind --force-legacy
  'sub-agent-monitor.js',          // deprecated, gated behind --force-legacy
  'sub-agent-orchestrator.js',     // deprecated, gated behind --force-legacy
  'sub-agents-enhanced.js',        // deprecated, gated behind --force-legacy
]);

const isToolJs = (f) => f.startsWith('tools/') && f.endsWith('.js') && !f.includes('tools/archive/');
const relName = (f) => f.replace(/^tools\//, '');
const allowed = (f) => ALLOWLIST.has(relName(f)) || ALLOWLIST.has(path.basename(f));
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

function scan(content) {
  const hits = [];
  content.split('\n').forEach((line, i) => {
    if (isComment(line)) return;
    for (const p of PATTERNS) if (p.re.test(line)) { hits.push({ line: i + 1, why: p.why }); break; }
  });
  return hits;
}

// ---------- audit mode ----------
if (process.argv.includes('--all')) {
  const dir = path.resolve(__dirname);
  const offenders = [];
  for (const f of fs.readdirSync(dir)) {
    const rel = 'tools/' + f;
    if (!isToolJs(rel) || allowed(rel) || !fs.statSync(path.join(dir, f)).isFile()) continue;
    const hits = scan(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (hits.length) offenders.push({ file: rel, hits });
  }
  if (!offenders.length) { console.log('✅ No live tools target the legacy archive.'); process.exit(0); }
  console.log(`⚠️  ${offenders.length} live tool(s) still target the legacy archive — burn-down punch-list:\n`);
  offenders.sort((a, b) => a.file.localeCompare(b.file)).forEach((o) => {
    console.log('  ' + o.file);
    [...new Map(o.hits.map((h) => [h.why, h])).values()].slice(0, 3).forEach((h) => console.log(`      ${h.why}`));
  });
  process.exit(0);
}

// ---------- pre-commit ratchet mode ----------
let diff = '';
try { diff = execSync('git diff --cached -U0 -- tools/', { encoding: 'utf8' }); } catch { process.exit(0); }

const blocks = [];
let cur = null;
for (const line of diff.split('\n')) {
  const m = line.match(/^\+\+\+ b\/(.+)$/);
  if (m) { cur = m[1]; continue; }
  if (!cur || !isToolJs(cur) || allowed(cur)) continue;
  if (line.startsWith('+') && !line.startsWith('+++')) {
    const added = line.slice(1);
    if (isComment(added)) continue;
    for (const p of PATTERNS) if (p.re.test(added)) { blocks.push({ file: cur, why: p.why, text: added.trim().slice(0, 100) }); break; }
  }
}

if (blocks.length) {
  console.error('\n\x1b[31m[memory-db-guard] Commit blocked — new legacy-archive memory access:\x1b[0m');
  blocks.forEach((b) => console.error(`  ${b.file}: ${b.why}\n      ${b.text}`));
  console.error('\nFix: use tools/lib/neo-brain.js getNeoBrainClient() (live neo-brain) or the @todak/memory SDK.');
  console.error('Bypass (discouraged): git commit --no-verify\n');
  process.exit(1);
}
process.exit(0);
