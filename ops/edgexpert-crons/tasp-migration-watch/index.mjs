// tasp-migration-watch v2 — auto-apply pipeline (2026-08-04, Neo approved).
//
// v1 only alerted; a human session then applied. v2 closes the loop:
// for each new supabase/migrations/*.sql on todak-academy-v2 main:
//
//   1. CLASSIFY the SQL mechanically (comments + $body$ sections stripped):
//      structure-only changes are AUTO-APPLY; anything touching data rows at
//      the top level (DELETE/UPDATE/TRUNCATE/DROP TABLE/DROP COLUMN/ALTER
//      TYPE/unguarded INSERT/role or extension changes) is ESCALATE.
//      DML inside function bodies is fine — bodies are stripped first.
//   2. AUTO-APPLY runs the file verbatim against the academy DB over a
//      single implicit transaction (multi-statement simple query): any error
//      rolls the whole file back. Connection = ACADEMY_DB_URL (scoped to the
//      academy project only — deliberately NOT an org-wide key).
//   3. VERIFY: every CREATE TABLE/FUNCTION/INDEX named in the file is
//      checked in the catalogs post-apply.
//   4. One WhatsApp per file via the Siti owner lane (agent_commands):
//      ✅ auto-applied+verified / ⚠️ escalated (policy) / ❌ failed+rolled back.
//
// Ordering: within a batch, files apply in COMMIT order (git log date of the
// commit that added each file), NOT filename order — the July delete_student
// clobber (uuid_cast_fix vs jwt_super_admin) is exactly the bug filename
// ordering causes.
//
// Crash-safety: state.applied is written IMMEDIATELY after a successful
// apply (before the WA), so a notify failure retries the WA next run without
// re-running SQL. Files are marked seen only after their outcome message is
// enqueued.
//
// Modes: `node index.mjs` (cron), `--classify-only f1.sql,f2.sql` (print
// classification for named repo files, no side effects).
//
// Env (.env, 600): NEO_BRAIN_URL, NEO_BRAIN_SERVICE_ROLE_KEY, NEO_WHATSAPP,
// ACADEMY_DB_URL. Git auth: repo-scoped read-only deploy key (core.sshCommand).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, 'repo');
const STATE = path.join(HERE, 'state.json');

const env = { ...process.env };
for (const line of readFileSync(path.join(HERE, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] ??= m[2].trim();
}
const { NEO_BRAIN_URL, NEO_BRAIN_SERVICE_ROLE_KEY, ACADEMY_DB_URL } = env;
const NEO_WHATSAPP = env.NEO_WHATSAPP || '60177519610';
for (const [k, v] of Object.entries({ NEO_BRAIN_URL, NEO_BRAIN_SERVICE_ROLE_KEY, ACADEMY_DB_URL })) {
  if (!v) { console.error(`missing ${k} in .env`); process.exit(1); }
}

const git = (...args) =>
  execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });

// ---------- classification ----------

function stripSql(sql) {
  let s = sql.replace(/--[^\n]*/g, ' ');
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/(\$[a-zA-Z_]*\$)[\s\S]*?\1/g, ' FNBODY ');
  return s;
}

function classify(sql) {
  const top = stripSql(sql);
  const flags = [];
  const RULES = [
    [/\bdrop\s+table\b/i, 'DROP TABLE'],
    [/\bdrop\s+schema\b/i, 'DROP SCHEMA'],
    [/\btruncate\b/i, 'TRUNCATE'],
    [/\bdelete\s+from\b/i, 'top-level DELETE'],
    [/\bupdate\s+[\w."]+\s+set\b/i, 'top-level UPDATE'],
    [/\balter\s+table\s+[^;]*\bdrop\s+column\b/i, 'DROP COLUMN'],
    [/\balter\s+table\s+[^;]*\balter\s+column\s+[^;]*\btype\b/i, 'ALTER COLUMN TYPE'],
    [/\bcreate\s+extension\b/i, 'CREATE EXTENSION'],
    [/\b(create|alter|drop)\s+role\b/i, 'ROLE change'],
    [/\balter\s+system\b/i, 'ALTER SYSTEM'],
  ];
  for (const [re, label] of RULES) if (re.test(top)) flags.push(label);
  // DROP FUNCTION paired with a CREATE of the SAME function in this file is a
  // signature replace (the only way to change a return type) — safe. Twice in
  // 3 days (2026-08-05 fail, 2026-08-07 escalate) this pattern caused manual
  // work. Only UNPAIRED drops (true removals) escalate.
  const norm = (n) => n.toLowerCase().replace(/^public\./, '').replace(/"/g, '');
  const dropped = [...top.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?([\w."]+)/gi)].map((m) => norm(m[1]));
  const created = [...top.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(/gi)].map((m) => norm(m[1]));
  for (const d of dropped) if (!created.includes(d)) flags.push(`DROP FUNCTION without matching CREATE (${d})`);
  for (const stmt of top.split(';')) {
    if (/\binsert\s+into\b/i.test(stmt) && !/\bnot\s+exists\b|\bon\s+conflict\b/i.test(stmt)) {
      flags.push('unguarded INSERT');
    }
  }
  if (/\$[a-zA-Z_]*\$/.test(top)) flags.push('unparsed dollar-quoted section');
  return [...new Set(flags)];
}

function extractObjects(sql) {
  const s = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const objects = [];
  for (const m of s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)) objects.push({ type: 'table', name: m[1] });
  for (const m of s.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(/gi)) objects.push({ type: 'function', name: m[1] });
  for (const m of s.matchAll(/create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(?:concurrently\s+)?([\w."]+)\s+on/gi)) objects.push({ type: 'index', name: m[1] });
  return objects;
}

// ---------- side effects ----------

async function enqueueWhatsApp(message) {
  const res = await fetch(`${NEO_BRAIN_URL}/rest/v1/agent_commands`, {
    method: 'POST',
    headers: {
      apikey: NEO_BRAIN_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${NEO_BRAIN_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      from_agent: 'tasp-migration-watch',
      to_agent: 'siti',
      command: 'send_whatsapp_notification',
      payload: { to: NEO_WHATSAPP, message },
      priority: 3,
    }),
  });
  if (!res.ok) throw new Error(`agent_commands enqueue ${res.status}`);
}

async function applySql(sql, filename) {
  const client = new pg.Client({ connectionString: ACADEMY_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql); // multi-statement simple query = one implicit transaction
    // Shared ledger: the rack box apply-migrations.sh tracks applies in
    // _tasp_migrations_applied. Record ours there too — on 2026-08-28 a box
    // full-sweep replayed a watch-applied file (absent from the box ledger)
    // and reverted a newer function definition. One ledger, no replays.
    if (filename) {
      await client.query(
        "INSERT INTO public._tasp_migrations_applied(filename, applied_by) VALUES ($1, 'tasp-migration-watch') ON CONFLICT (filename) DO NOTHING",
        [filename]
      ).catch((e) => console.error("ledger insert failed:", e.message));
    }
  } finally {
    await client.end();
  }
}

async function verifyObjects(objects) {
  if (!objects.length) return { ok: true, detail: 'no named objects to check' };
  const client = new pg.Client({ connectionString: ACADEMY_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const missing = [];
    for (const o of objects) {
      const bare = o.name.replace(/^public\./i, '').replace(/"/g, '');
      const q = o.type === 'function'
        ? `SELECT COUNT(*) c FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.proname=$1`
        : o.type === 'index'
          ? `SELECT COUNT(*) c FROM pg_indexes WHERE schemaname='public' AND indexname=$1`
          : `SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`;
      const r = await client.query(q, [bare]);
      if (Number(r.rows[0].c) === 0) missing.push(`${o.type} ${bare}`);
    }
    return missing.length
      ? { ok: false, detail: `missing after apply: ${missing.join(', ')}` }
      : { ok: true, detail: objects.map((o) => `${o.type} ${o.name.replace(/^public\./i, '')}`).join(', ') };
  } finally {
    await client.end();
  }
}

// ---------- main ----------

const MIG_PREFIX = 'supabase/migrations/';
const fileSql = (f) => git('show', `origin/main:${MIG_PREFIX}${f}`);

if (process.argv[2] === '--classify-stdin') {
  const sql = readFileSync(0, 'utf8');
  const flags = classify(sql);
  console.log(flags.length ? 'ESCALATE [' + flags.join('; ') + ']' : 'AUTO-APPLY');
  process.exit(0);
}

if (process.argv[2] === '--classify-only') {
  for (const f of (process.argv[3] || '').split(',').filter(Boolean)) {
    const flags = classify(fileSql(f));
    console.log(`${f}: ${flags.length ? 'ESCALATE [' + flags.join('; ') + ']' : 'AUTO-APPLY'}`);
  }
  process.exit(0);
}

git('fetch', '--depth=1', '--filter=blob:none', 'origin', 'main');
const files = git('ls-tree', '--name-only', 'origin/main', MIG_PREFIX)
  .split('\n').map((s) => s.trim()).filter((f) => f.endsWith('.sql'))
  .map((f) => path.basename(f));

const state = JSON.parse(readFileSync(STATE, 'utf8'));
state.applied ??= {};
state.escalated ??= {};
const seen = new Set(state.seen);
const saveState = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');

let fresh = files.filter((f) => !seen.has(f));
const stamp = new Date().toISOString();
if (!fresh.length) {
  console.log(`${stamp} ok — ${files.length} migrations on main, nothing new`);
  process.exit(0);
}

// Apply in commit order, not filename order (delete_student clobber lesson).
const commitTime = (f) => Number(git('log', '-1', '--format=%ct', 'origin/main', '--', MIG_PREFIX + f).trim() || 0);
fresh = fresh.map((f) => [f, commitTime(f)]).sort((a, b) => a[1] - b[1]).map(([f]) => f);

for (const f of fresh) {
  const sql = fileSql(f);
  const flags = classify(sql);

  if (flags.length) {
    state.escalated[f] = { at: stamp, flags };
    saveState();
    await enqueueWhatsApp([
      `⚠️ TASP migration needs human eyes — auto-apply skipped by policy:`,
      `• ${f}`,
      `Reason: contains ${flags.join('; ')}.`,
      '',
      'Hand it to any Claude session: "apply the pending TASP migrations". You will get a ✅ here once handled.',
    ].join('\n'));
    seen.add(f); state.seen = [...seen].sort(); saveState();
    console.log(`${stamp} ESCALATED ${f} [${flags.join('; ')}]`);
    continue;
  }

  if (!state.applied[f]) {
    try {
      await applySql(sql, f);
      state.applied[f] = stamp;
      saveState();
    } catch (e) {
      const err = String(e.message || e).slice(0, 250);
      state.escalated[f] = { at: stamp, error: err };
      saveState();
      await enqueueWhatsApp([
        `❌ TASP auto-apply FAILED (rolled back, DB unchanged):`,
        `• ${f}`,
        `Postgres said: ${err}`,
        '',
        'Hand it to any Claude session to investigate: "apply the pending TASP migrations".',
      ].join('\n'));
      seen.add(f); state.seen = [...seen].sort(); saveState();
      console.log(`${stamp} FAILED ${f}: ${err}`);
      continue;
    }
  }

  const verify = await verifyObjects(extractObjects(sql));
  await enqueueWhatsApp(verify.ok
    ? [`✅ TASP migration auto-applied + verified:`, `• ${f}`, `Checked: ${verify.detail}.`, '', 'Nothing to do — FYI only.'].join('\n')
    : [`⚠️ TASP migration applied but verification found a gap:`, `• ${f}`, `${verify.detail}`, '', 'Hand to a Claude session to inspect.'].join('\n'));
  seen.add(f); state.seen = [...seen].sort(); saveState();
  console.log(`${stamp} ${verify.ok ? 'AUTO-APPLIED' : 'APPLIED-UNVERIFIED'} ${f} (${verify.detail})`);
}
