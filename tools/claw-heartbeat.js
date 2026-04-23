#!/usr/bin/env node
// claw-heartbeat.js
// Emits a single heartbeat row to neo-brain's agent_heartbeats table.
// Runs under launchd with StartInterval=60 — fires once per minute then exits.
// No external deps (uses Node 18+ fetch).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import os from 'node:os';
import net from 'node:net';

// ── env loader ──────────────────────────────────────────────────────
const envPath = process.env.NEO_BRAIN_ENV_PATH
  || `${homedir()}/.openclaw/secrets/neo-brain.env`;

let env = {};
try {
  env = Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .filter(l => l && !l.trimStart().startsWith('#'))
      .map(l => {
        const i = l.indexOf('=');
        return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
      })
      .filter(Boolean)
  );
} catch (e) {
  console.error(`[claw-heartbeat] failed to read ${envPath}: ${e.message}`);
  process.exit(1);
}

const SUPABASE_URL = env.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL;
const SERVICE_KEY = env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[claw-heartbeat] NEO_BRAIN_URL or NEO_BRAIN_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

// ── port-open check ─────────────────────────────────────────────────
const checkPort = (port, host = '127.0.0.1', timeout = 500) =>
  new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.connect(port, host, () => finish(true));
  });

// ── build heartbeat payload ─────────────────────────────────────────
async function buildMeta() {
  const [bridge, gateway, ollama, router, reminder] = await Promise.all([
    checkPort(3899, '127.0.0.1'),
    checkPort(18789, '127.0.0.1'),
    checkPort(11434, '127.0.0.1'),
    checkPort(3901, '127.0.0.1'),
    checkPort(3903, '127.0.0.1'),
  ]);

  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  return {
    version: 'claw-heartbeat-v1',
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.arch()}`,
    uptime_sec: Math.round(os.uptime()),
    loadavg_1m: Number(os.loadavg()[0].toFixed(2)),
    mem_used_mb: Math.round((totalMem - freeMem) / 1024 / 1024),
    mem_total_mb: Math.round(totalMem / 1024 / 1024),
    ports: {
      bridge_3899: bridge,
      gateway_18789: gateway,
      ollama_11434: ollama,
      whatsapp_router_3901: router,
      reminder_service_3903: reminder,
    },
    // Session health — placeholders in v1; real probes come in Phase 5b.
    // Known states from Phase 1 amendment:
    session_health: {
      ig: 'unknown',
      threads: 'unknown',
      linkedin: 'unknown',
      tiktok: 'needs_reauth',
      x: 'needs_reauth',
      facebook: 'unknown',
      wacli_send_only: 'needs_reauth',
    },
  };
}

// ── write to agent_heartbeats ───────────────────────────────────────
async function emit() {
  const meta = await buildMeta();

  const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_heartbeats`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      agent_name: 'claw-mac',
      status: 'ok',
      meta,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`heartbeat write failed ${res.status}: ${body}`);
  }

  console.log(
    `[${new Date().toISOString()}] heartbeat ok — ports: bridge=${meta.ports.bridge_3899} gateway=${meta.ports.gateway_18789} ollama=${meta.ports.ollama_11434}`
  );
}

emit().catch(err => {
  console.error('[claw-heartbeat] error:', err.message);
  process.exit(1);
});
