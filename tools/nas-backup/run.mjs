#!/usr/bin/env node
// nas-backup/run.mjs — nightly neo-brain snapshot, NAS-local edition.
// Successor to the CLAW-hosted backup-sync.sh (migrated 2026-07-19; CLAW retired).
// Runs INSIDE a node:20-alpine container on the Ugreen NAS via crond at
// 19:00 UTC (= 03:00 MYT). The backup writes to a bind-mounted local dir, so
// no network hop is involved in the data path.
//
//   1. snapshot all neo-brain tables → $BACKUP_LOCAL_DIR/<MYT date>/  (backup-neo-brain.mjs)
//   2. prune to BACKUP_RETAIN_DAYS date-dirs (default 14)
//   3. report: agent_heartbeats upsert (backup-sync) + memories row
//      (category backup_run) + Siti WhatsApp notification via agent_commands
//
// Env (container --env-file): NEO_BRAIN_URL, NEO_BRAIN_SERVICE_ROLE_KEY,
//   BACKUP_LOCAL_DIR=/backups, BS_NOTIFY_TO (default Neo), BACKUP_RETAIN_DAYS.

import { readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const URL = process.env.NEO_BRAIN_URL;
const KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
const ROOT = process.env.BACKUP_LOCAL_DIR || "/backups";
const RETAIN = parseInt(process.env.BACKUP_RETAIN_DAYS || "14", 10);
const NOTIFY_TO = process.env.BS_NOTIFY_TO || "60177519610";
if (!URL || !KEY) { console.error("[nas-backup] env missing"); process.exit(1); }

// MYT date (UTC+8) — matches the historical CLAW naming, where the 03:00 MYT
// run labeled the folder with the MYT calendar date.
const DATE = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const t0 = Date.now();
let errors = 0;
const subtasks = [];

function step(name, ok, secs) {
  subtasks.push(`${name}:${ok ? "ok" : "fail"}:${secs}s`);
  if (!ok) errors++;
  console.log(`[nas-backup] ${ok ? "✓" : "✗"} ${name} — ${secs}s`);
}

// ── 1) snapshot ─────────────────────────────────────────────────────
{
  const tS = Date.now();
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "backup-neo-brain.mjs");
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [script, DATE], {
      stdio: "inherit",
      env: { ...process.env, BACKUP_LOCAL_DIR: ROOT },
    });
    p.on("exit", resolve);
    p.on("error", () => resolve(1));
  });
  step("neo-brain-snapshot", code === 0, Math.round((Date.now() - tS) / 1000));
}

// ── 2) retention ────────────────────────────────────────────────────
{
  const tS = Date.now();
  let ok = true;
  try {
    const dirs = readdirSync(ROOT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
    for (const d of dirs.slice(RETAIN)) {
      console.log(`[nas-backup]   prune ${d}`);
      rmSync(join(ROOT, d), { recursive: true, force: true });
    }
  } catch (e) { ok = false; console.error("[nas-backup] retention error:", e.message); }
  step("retention", ok, Math.round((Date.now() - tS) / 1000));
}

// ── 3) report ───────────────────────────────────────────────────────
function dirSize(p) {
  let total = 0;
  try {
    for (const f of readdirSync(p)) {
      const st = statSync(join(p, f));
      total += st.isDirectory() ? dirSize(join(p, f)) : st.size;
    }
  } catch { /* best-effort */ }
  return total;
}
const sizeMB = Math.round(dirSize(join(ROOT, DATE)) / 1048576);
const durationSec = Math.round((Date.now() - t0) / 1000);
const mm = Math.floor(durationSec / 60), ss = durationSec % 60;
const durationStr = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
const status = errors === 0 ? "ok" : "degraded";
const meta = {
  version: "backup-sync-v2-nas", host: "nas", date: DATE, errors, subtasks,
  duration_sec: durationSec, size_neo_brain: `${sizeMB} MB`,
};

const post = (path, body) => fetch(`${URL}/rest/v1/${path}`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify(body),
});

{
  const r = await post("agent_heartbeats?on_conflict=agent_name",
    { agent_name: "backup-sync", status, meta, reported_at: new Date().toISOString() });
  console.log(r.ok ? "[nas-backup] heartbeat written" : `heartbeat write failed ${r.status}`);
}
try {
  const r = await post("memories", {
    content: `backup-sync ${status} — ${DATE} · ${errors} errors · ${durationStr} · neo-brain=${sizeMB} MB · host=nas`,
    category: "backup_run", memory_type: "event", importance: 3,
    visibility: "private", source: "backup-sync", metadata: meta,
  });
  if (!r.ok) console.error("memory write failed", r.status, await r.text());
} catch (e) { console.error("memory write failed", e.message); }

const lines = [
  "━━ 💾 backup-sync (NAS) ━━",
  errors === 0 ? "✅ *Nightly Backup Complete*" : "⚠️ *Nightly Backup Had Errors*",
  "", `📅 ${DATE}`, `📦 neo-brain ${sizeMB} MB`, `⏱️ ${durationStr}`, "",
  subtasks.map(s => `${s.includes(":ok:") ? "✓" : "✗"} ${s.split(":")[0]}`).join("  "),
];
try {
  const r = await post("agent_commands", {
    from_agent: "backup-sync", to_agent: "siti", command: "send_whatsapp_notification",
    payload: { to: NOTIFY_TO, message: lines.join("\n") }, priority: 3,
  });
  console.log(r.ok ? "[nas-backup] siti notification queued" : `siti notify failed ${r.status}`);
} catch (e) { console.error("siti notify error", e.message); }

console.log(`[nas-backup] done — errors=${errors} duration=${durationSec}s size=${sizeMB}MB`);
process.exit(errors > 0 ? 2 : 0);
