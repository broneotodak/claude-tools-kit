#!/usr/bin/env node
// backup-neo-brain.mjs
// Logical snapshot of all public tables in neo-brain (Supabase) → NDJSON.gz on NAS.
//
// Uses the REST API + service_role key (no DB password required — avoids relying on
// a credential we don't have in the vault). Each table is paginated via PostgREST
// Range headers and streamed through gzip to keep memory flat.
//
// Usage:
//   node backup-neo-brain.mjs [YYYY-MM-DD]   # defaults to today
// Env (read from ~/.openclaw/secrets/neo-brain.env):
//   NEO_BRAIN_URL, NEO_BRAIN_SERVICE_ROLE_KEY
// Env (optional):
//   BACKUP_SSH_TARGET   — ssh alias or user@host for NAS (default: nas-remote)
//   BACKUP_REMOTE_ROOT  — remote path root (default: /volume1/docker/backups/neo-brain)

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";

const envPath = process.env.NEO_BRAIN_ENV_PATH || `${homedir()}/.openclaw/secrets/neo-brain.env`;
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter(l => l && !l.trimStart().startsWith("#"))
    .map(l => {
      const i = l.indexOf("=");
      return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")];
    })
    .filter(Boolean),
);

const URL = env.NEO_BRAIN_URL;
const KEY = env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("backup-neo-brain: env missing"); process.exit(1); }

const SSH_TARGET = process.env.BACKUP_SSH_TARGET || "nas-remote";
const REMOTE_ROOT = process.env.BACKUP_REMOTE_ROOT || "/volume1/docker/backups/neo-brain";
const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);
const REMOTE_DIR = `${REMOTE_ROOT}/${DATE}`;

const PAGE = 1000;

// ── helpers ────────────────────────────────────────────────────────
async function listTables() {
  // PostgREST /rest/v1/ returns an OpenAPI document that lists every exposed table.
  const r = await fetch(`${URL}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`OpenAPI fetch ${r.status}`);
  const doc = await r.json();
  return Object.keys(doc.definitions || {}).filter(n => !n.startsWith("rpc/"));
}

async function countRows(table) {
  const r = await fetch(`${URL}/rest/v1/${encodeURIComponent(table)}?select=*`, {
    method: "HEAD",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" },
  });
  const cr = r.headers.get("content-range"); // e.g. "0-0/123"
  if (!cr) return null;
  const m = cr.match(/\/(\d+|\*)$/);
  return m && m[1] !== "*" ? parseInt(m[1], 10) : null;
}

async function *fetchRows(table) {
  let offset = 0;
  while (true) {
    const to = offset + PAGE - 1;
    const r = await fetch(`${URL}/rest/v1/${encodeURIComponent(table)}?select=*`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${offset}-${to}`,
        "Range-Unit": "items",
        Accept: "application/json",
      },
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`fetch ${table} ${r.status}: ${body.slice(0, 200)}`);
    }
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error(`${table}: non-array response`);
    for (const row of rows) yield row;
    if (rows.length < PAGE) return;
    offset += PAGE;
  }
}

// Pipe rows → gzip → ssh "cat > remote-file". All streams, flat memory.
function dumpTableToRemote(table) {
  const remoteFile = `${REMOTE_DIR}/${table}.ndjson.gz`;
  const ssh = spawn("ssh", [SSH_TARGET, `mkdir -p '${REMOTE_DIR}' && cat > '${remoteFile}'`], {
    stdio: ["pipe", "inherit", "inherit"],
  });
  const gz = createGzip({ level: 6 });
  gz.pipe(ssh.stdin);
  return {
    sshDone: new Promise((resolve, reject) => ssh.on("exit", c => (c === 0 ? resolve() : reject(new Error(`ssh exit ${c}`))))),
    async write(obj) {
      const line = JSON.stringify(obj) + "\n";
      if (!gz.write(line)) await new Promise(r => gz.once("drain", r));
    },
    end() { return new Promise((r) => gz.end(() => r())); },
  };
}

// ── main ────────────────────────────────────────────────────────────
const t0 = Date.now();
const tables = await listTables();
console.log(`[backup-neo-brain] ${DATE} — ${tables.length} tables → ${SSH_TARGET}:${REMOTE_DIR}`);

const summary = [];
for (const table of tables) {
  const tS = Date.now();
  const total = await countRows(table).catch(() => null);
  const dump = dumpTableToRemote(table);
  let n = 0;
  try {
    for await (const row of fetchRows(table)) {
      await dump.write(row);
      n++;
    }
    await dump.end();
    await dump.sshDone;
    const ms = Date.now() - tS;
    summary.push({ table, rows: n, ms });
    console.log(`  ✓ ${table}: ${n}${total != null ? `/${total}` : ""} rows in ${ms}ms`);
  } catch (e) {
    await dump.end().catch(() => {});
    summary.push({ table, rows: n, error: e.message });
    console.error(`  ✗ ${table}: FAILED after ${n} rows — ${e.message}`);
  }
}

// Manifest
const manifest = {
  date: DATE,
  source: URL,
  snapshot_type: "logical_rest",
  started_at: new Date(t0).toISOString(),
  finished_at: new Date().toISOString(),
  duration_ms: Date.now() - t0,
  tables: summary,
  total_rows: summary.reduce((a, s) => a + s.rows, 0),
  errors: summary.filter(s => s.error).length,
};

const mSsh = spawn("ssh", [SSH_TARGET, `cat > '${REMOTE_DIR}/manifest.json'`], { stdio: ["pipe", "inherit", "inherit"] });
mSsh.stdin.end(JSON.stringify(manifest, null, 2));
await new Promise((r) => mSsh.on("exit", r));

console.log(`[backup-neo-brain] done — ${manifest.total_rows} rows, ${manifest.errors} errors, ${manifest.duration_ms}ms`);
if (manifest.errors > 0) process.exit(2);
