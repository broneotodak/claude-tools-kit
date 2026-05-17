#!/usr/bin/env node
// cc-fleet-heartbeat.mjs
//
// Claude Code fleet heartbeat — wired as a CC hook (SessionStart /
// UserPromptSubmit / SessionEnd). Makes the NACA fleet able to SEE Claude
// Code as a live interface: it upserts a row in neo-brain.agent_heartbeats
// for the `claude-code-<machine>` agent registered in agent_registry.
//
// WHY: Claude Code is Neo's most capable NACA interface (codes, deploys,
// runs migrations) but historically had zero fleet presence — no registry
// row, no heartbeat. The fleet's observability (supervisor, check_agent_
// status, dashboards) was blind to its busiest interface. This closes that
// gap. The matching registry row is `heartbeat_exempt: true`, so the
// supervisor never false-alarms when no session is open — gaps are normal.
//
// IDENTITY: defaults to `claude-code-neo-mbp` (the registered row). On any
// other machine, FIRST create that machine's agent_registry row (with
// heartbeat_exempt: true) THEN set CC_FLEET_AGENT_NAME — do NOT let a fresh
// agent_name auto-discover, it would land non-exempt and page Neo.
//
// SAFETY: a hook must never disrupt the session. Every failure path exits
// 0; a hard timer caps runtime. Reads creds from CTK .env.

import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

// Never let this hook hang or crash the session.
const HARD_TIMEOUT = setTimeout(() => process.exit(0), 8000);
HARD_TIMEOUT.unref();
const bail = () => { clearTimeout(HARD_TIMEOUT); process.exit(0); };

const AGENT_NAME = process.env.CC_FLEET_AGENT_NAME || 'claude-code-neo-mbp';
const FLEET_HOST = process.env.CC_FLEET_HOST || 'neo-mbp';
const THROTTLE_SEC = 120; // activity heartbeats land at most once per 2 min
const THROTTLE_FILE = join(tmpdir(), `cc-fleet-hb-${AGENT_NAME}.ts`);
const ERROR_LOG = join(tmpdir(), 'cc-fleet-hb-error.log');

function logError(msg) {
  try { writeFileSync(ERROR_LOG, `${new Date().toISOString()} ${msg}\n`, { flag: 'a' }); } catch { /* ignore */ }
}

// ── env (NEO_BRAIN_URL + service key live in CTK .env) ───────────────
function loadEnv() {
  const candidates = [
    process.env.NEO_BRAIN_ENV_PATH,
    join(homedir(), 'Projects', 'claude-tools-kit', '.env'),
    join(homedir(), '.openclaw', 'secrets', 'neo-brain.env'),
  ].filter(Boolean);
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const env = {};
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line || line.trimStart().startsWith('#')) continue;
        const i = line.indexOf('=');
        if (i < 0) continue;
        env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
      }
      if (env.NEO_BRAIN_URL && env.NEO_BRAIN_SERVICE_ROLE_KEY) return env;
    } catch { /* try next */ }
  }
  return {};
}

// ── stdin (the hook event payload) ───────────────────────────────────
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(data); } };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    setTimeout(done, 2000); // hooks always get stdin fast; cap the wait
  });
}

const EVENT_MAP = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'activity',
  PostToolUse: 'activity',
  Stop: 'activity',
  SessionEnd: 'session_end',
};

async function main() {
  const env = loadEnv();
  const url = env.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL;
  const key = env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
  if (!url || !key) bail(); // no creds → silently skip, never break the session

  let payload = {};
  try { payload = JSON.parse((await readStdin()) || '{}'); } catch { payload = {}; }

  const eventName = payload.hook_event_name || '';
  const event = EVENT_MAP[eventName] || 'activity';

  // Throttle: only routine activity pings. Session start/end always write.
  if (event === 'activity') {
    try {
      const last = statSync(THROTTLE_FILE).mtimeMs;
      if (Date.now() - last < THROTTLE_SEC * 1000) bail();
    } catch { /* no throttle file yet → proceed */ }
  }

  const cwd = payload.cwd || process.cwd();
  const meta = {
    version: 'cc-fleet-hb-v1',
    host: FLEET_HOST,
    event,
    cwd,
    project: basename(cwd) || null,
    model: payload.model || payload.model_id || null,
    cc_session_id: payload.session_id || null,
    machine: hostname(),
    reported_by: 'cc-fleet-heartbeat hook',
  };

  try {
    const r = await fetch(`${url}/rest/v1/agent_heartbeats?on_conflict=agent_name`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        agent_name: AGENT_NAME,
        status: 'ok',
        meta,
        reported_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      logError(`heartbeat ${r.status}: ${(await r.text()).slice(0, 200)}`);
    } else {
      try { writeFileSync(THROTTLE_FILE, String(Date.now())); } catch { /* ignore */ }
    }
  } catch (e) {
    logError(`fetch failed: ${e?.message || e}`);
  }
  bail();
}

main().catch((e) => { logError(`unhandled: ${e?.message || e}`); bail(); });
