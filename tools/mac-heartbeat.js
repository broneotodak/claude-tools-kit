#!/usr/bin/env node
// mac-heartbeat.js
// Generic Mac fleet-node heartbeat reporter. Runs every 60s via launchd.
// Adapts claw-heartbeat.js to be machine-agnostic — derives agent_name from
// hostname slug so each new MBP gets a unique identity automatically.
//
// First heartbeat from a new agent_name triggers supervisor's auto-discovery
// path (Phase 4). Subsequent heartbeats are routine.
//
// Reads creds from ~/.openclaw/secrets/neo-brain.env.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import os from "node:os";
import net from "node:net";

// ── env ─────────────────────────────────────────────────────────────
const envPath = process.env.NEO_BRAIN_ENV_PATH || `${homedir()}/.openclaw/secrets/neo-brain.env`;
let env = {};
try {
  env = Object.fromEntries(
    readFileSync(envPath, "utf8").split("\n")
      .filter(l => l && !l.trimStart().startsWith("#"))
      .map(l => { const i = l.indexOf("="); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")]; })
      .filter(Boolean),
  );
} catch (e) {
  console.error(`[mac-heartbeat] failed to read ${envPath}: ${e.message}`);
  process.exit(1);
}
const SUPABASE_URL = env.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL;
const SERVICE_KEY = env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[mac-heartbeat] NEO_BRAIN_URL or NEO_BRAIN_SERVICE_ROLE_KEY missing");
  process.exit(1);
}

// ── derive agent identity from hostname ─────────────────────────────
// scutil --get LocalHostName gives the user-facing name (e.g. "slave").
// Slug it: lowercase, alphanumerics + hyphens, max 32 chars.
function slugHostname(raw) {
  return String(raw || "unknown")
    .toLowerCase()
    .replace(/\.local$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "unknown";
}
const HOSTNAME = process.env.MAC_HOSTNAME_OVERRIDE || os.hostname();
const AGENT_NAME = process.env.MAC_AGENT_NAME || `mac-${slugHostname(HOSTNAME)}`;
const ROLE = process.env.MAC_AGENT_ROLE || "fleet-node";

// ── port-open check ─────────────────────────────────────────────────
const checkPort = (port, host = "127.0.0.1", timeout = 400) =>
  new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = ok => { if (done) return; done = true; socket.destroy(); resolve(ok); };
    socket.setTimeout(timeout);
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
    socket.connect(port, host, () => finish(true));
  });

// ── build payload ───────────────────────────────────────────────────
async function buildMeta() {
  // Common ports we care about across fleet machines.
  // If the port is open, the corresponding service is probably running.
  const [ollama, claudeMCP, ssh] = await Promise.all([
    checkPort(11434),  // Ollama
    checkPort(3899),   // claw-bridge / Claude Code MCP
    checkPort(22),     // SSH (always-on, sanity check)
  ]);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    version: "mac-heartbeat-v1",
    role: ROLE,
    hostname: HOSTNAME,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    uptime_sec: Math.round(os.uptime()),
    loadavg_1m: Number(os.loadavg()[0].toFixed(2)),
    mem_used_mb: Math.round((totalMem - freeMem) / 1024 / 1024),
    mem_total_mb: Math.round(totalMem / 1024 / 1024),
    cpu_count: os.cpus().length,
    ports: { ollama_11434: ollama, mcp_3899: claudeMCP, ssh_22: ssh },
  };
}

// ── upsert ──────────────────────────────────────────────────────────
async function emit() {
  const meta = await buildMeta();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/agent_heartbeats?on_conflict=agent_name`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ agent_name: AGENT_NAME, status: "ok", meta, reported_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`heartbeat ${r.status}: ${(await r.text()).slice(0, 200)}`);
  console.log(`[${new Date().toISOString()}] ${AGENT_NAME} ok — load=${meta.loadavg_1m} mem=${meta.mem_used_mb}/${meta.mem_total_mb}MB`);
}

emit().catch(err => { console.error("[mac-heartbeat] error:", err.message); process.exit(1); });
