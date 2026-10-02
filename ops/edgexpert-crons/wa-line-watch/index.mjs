// wa-line-watch — watchdog for Siti's WhatsApp line (EdgeXpert, cron */5)
//
// Born from the 2026-08-16 incident: wacli got StreamReplaced-kicked at 11:11
// and every process looked healthy while the WA line sat dead for 22h — Neo
// was the alarm. This watches the line itself, from the same signals that
// diagnosed the outage:
//   ~/.pm2/logs/siti-ingest-out.log    "wacli connected as"            → UP
//                                      "send_result: OK"               → UP
//                                      "send_result: FAIL ... websocket not connected" → DOWN
//   ~/.pm2/logs/siti-ingest-error.log  "Successfully authenticated"    → UP
//                                      "StreamReplaced"                → DOWN (never self-heals)
//                                      "Error reading from websocket"  → transient (3-min grace;
//                                                                        whatsmeow normally reauths in ~2s)
// Plus the /healthz probe on 127.0.0.1:3501 (wacli:false or unreachable → DOWN).
//
// On DOWN: auto `pm2 restart siti-ingest` (max once per 30 min), verify the
// reconnect in the log, and report via HERMES (independent WA number — Siti
// can't announce her own line being dead). Re-alerts hourly while still down;
// announces recovery. Heartbeats to agent_heartbeats as 'wa-line-watch'.
//
// 405 self-heal (2026-08-25): "Client outdated (405)" means WhatsApp retired
// the wacli client version — restarts can never fix it. The monitor instead
// rebuilds nclaw-wacli against whatsmeow@latest (build first; swap only on
// success; once per 6h) and restarts. session.db untouched → no re-QR.
//
// Test/ops flags (env): WLW_DRY_RUN=1 (no restart/alert, print verdict),
// WLW_TEST_ALERT=1 (send one Hermes test message), WLW_OUT_LOG/WLW_ERR_LOG
// (log path overrides for testing against copied logs).

import { readFileSync, writeFileSync, mkdirSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const HOME = '/home/neo';
const OUT_LOG = process.env.WLW_OUT_LOG || `${HOME}/.pm2/logs/siti-ingest-out.log`;
const ERR_LOG = process.env.WLW_ERR_LOG || `${HOME}/.pm2/logs/siti-ingest-error.log`;
const STATE_FILE = `${HOME}/naca/wa-line-watch/state.json`;
const PM2 = `${HOME}/.nvm/versions/node/v20.20.2/bin/pm2`;
const NEO_WA = '60177519610';
const DRY = process.env.WLW_DRY_RUN === '1';
const TRANSIENT_GRACE_MS = 3 * 60 * 1000;
const RESTART_COOLDOWN_MS = 30 * 60 * 1000;
const REALERT_MS = 60 * 60 * 1000;
// 405 self-heal: rebuild wacli with the latest whatsmeow. Build-first-then-swap
// (a failed build changes nothing), at most once per outage window.
const REBUILD_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const GO = '/home/neo/go-sdk/go/bin/go';
const WACLI_DIR = `${HOME}/naca/nclaw-wacli`;

// ── env (self-parsed; no dotenv, its banner pollutes stdout) ───────────────
const envText = readFileSync(`${HOME}/naca/siti/.env`, 'utf8');
const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const BRAIN_URL = env.NEO_BRAIN_URL;
const BRAIN_KEY = env.NEO_BRAIN_SERVICE_ROLE_KEY;

function log(...a) { console.log(new Date().toISOString(), ...a); }

// ── log tailing + event extraction ─────────────────────────────────────────
function tailFile(path, bytes = 262144) {
  try {
    const fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}

// pm2 prefixes every line "2026-08-17T09:42:22: " in box-local time.
function parseTs(line) {
  const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  return m ? new Date(m[1]).getTime() : null;
}

const PATTERNS = [
  { re: /wacli connected as/, kind: 'up' },
  { re: /Successfully authenticated/, kind: 'up' },
  { re: /send_result: OK/, kind: 'up' },
  { re: /send_result: FAIL .*websocket not connected/, kind: 'down' },
  { re: /StreamReplaced/, kind: 'down' },
  // WA servers force-retire old whatsmeow client versions (~every few months).
  // 2026-08-25: 13h outage where pm2 restarts could never help — needs a rebuild.
  { re: /Client outdated \(405\)/, kind: 'down', tag: 'outdated' },
  { re: /Error reading from websocket/, kind: 'transient' },
];

function collectEvents() {
  const events = [];
  for (const text of [tailFile(OUT_LOG), tailFile(ERR_LOG)]) {
    for (const line of text.split('\n')) {
      for (const { re, kind, tag } of PATTERNS) {
        if (re.test(line)) {
          const ts = parseTs(line);
          if (ts) events.push({ ts, kind, tag, line: line.slice(0, 160) });
          break;
        }
      }
    }
  }
  events.sort((a, b) => a.ts - b.ts);
  return events;
}

async function healthz() {
  try {
    const r = await fetch('http://127.0.0.1:3501/healthz', { signal: AbortSignal.timeout(3000) });
    return await r.json();
  } catch { return null; }
}

// verdict: {state: 'up'|'down'|'unknown', reason, since}
function verdictFromEvents(events, hz) {
  if (hz && hz.wacli === false) return { state: 'down', reason: 'wacli child process dead (healthz wacli:false)', since: Date.now() };
  if (!events.length) {
    if (hz === null && !process.env.WLW_OUT_LOG) return { state: 'down', reason: 'send API unreachable and no log events', since: Date.now() };
    return { state: 'unknown', reason: 'no recognizable log events', since: null };
  }
  const last = events[events.length - 1];
  if (last.kind === 'up') return { state: 'up', reason: 'last event healthy', since: last.ts };
  if (last.kind === 'down') return { state: 'down', reason: `definitive: ${last.line.replace(/^\S+ /, '')}`, since: last.ts };
  // transient socket error — grace for whatsmeow's own reconnect
  if (Date.now() - last.ts > TRANSIENT_GRACE_MS) {
    return { state: 'down', reason: `socket error with no reconnect for ${Math.round((Date.now() - last.ts) / 60000)} min`, since: last.ts };
  }
  return { state: 'up', reason: 'transient socket error within grace window', since: last.ts };
}

// ── hermes alert + heartbeat (both via neo-brain REST) ─────────────────────
async function brainPost(table, body, headers = {}) {
  const r = await fetch(`${BRAIN_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: BRAIN_KEY, Authorization: `Bearer ${BRAIN_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal', ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${table} POST ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function hermesAlert(message) {
  if (DRY) { log('[dry-run] hermes alert suppressed:', message.slice(0, 100)); return; }
  await brainPost('agent_commands', {
    from_agent: 'wa-line-watch', to_agent: 'hermes',
    command: 'send_whatsapp_notification',
    payload: { to: NEO_WA, message }, priority: 2,
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
  log('hermes alert queued');
}

async function heartbeat(status, meta) {
  try {
    await brainPost('agent_heartbeats', {
      agent_name: 'wa-line-watch', status, reported_at: new Date().toISOString(),
      meta: { version: 'wa-line-watch-v1', ...meta },
    }, { Prefer: 'resolution=merge-duplicates' });
  } catch (e) { log('heartbeat error:', e.message); }
}

// ── state ──────────────────────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  mkdirSync(`${HOME}/naca/wa-line-watch`, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function fmtMYT(ts) {
  return new Date(ts).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false });
}

// ── 405 self-heal: rebuild wacli against the latest whatsmeow ──────────────
// WhatsApp force-retires old client versions every ~4 months; a pm2 restart
// can never fix that. Proven manually 2026-08-25 (neo-brain e5d292d8):
// session.db is untouched, so the rebuilt client reconnects with no re-QR.
function rebuildWacli() {
  const env = { ...process.env, PATH: `/home/neo/go-sdk/go/bin:${process.env.PATH || ''}`, GOTOOLCHAIN: 'auto', HOME };
  log('405 self-heal: go get whatsmeow@latest ...');
  execFileSync(GO, ['get', 'go.mau.fi/whatsmeow@latest'], { cwd: WACLI_DIR, env, timeout: 300000 });
  log('405 self-heal: building nclaw-wacli.new ...');
  execFileSync(GO, ['build', '-o', 'nclaw-wacli.new', '.'], { cwd: WACLI_DIR, env, timeout: 600000 });
  // Build succeeded — only now touch the running setup.
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  execFileSync(PM2, ['stop', 'siti-ingest'], { timeout: 60000 });
  execFileSync('/usr/bin/mv', [`${WACLI_DIR}/nclaw-wacli`, `${WACLI_DIR}/nclaw-wacli.bak-auto-${stamp}`]);
  execFileSync('/usr/bin/mv', [`${WACLI_DIR}/nclaw-wacli.new`, `${WACLI_DIR}/nclaw-wacli`]);
  execFileSync(PM2, ['restart', 'siti-ingest'], { timeout: 60000 });
  log('405 self-heal: binary swapped, siti-ingest restarted');
}

// ── main ───────────────────────────────────────────────────────────────────
const state = loadState();
const hz = await healthz();
const events = collectEvents();
const v = verdictFromEvents(events, hz);
log(`line=${v.state} reason="${v.reason}"`);

if (process.env.WLW_TEST_ALERT === '1') {
  await hermesAlert(`✅ wa-line-watch deployed on EdgeXpert (cron */5). Test alert — Siti WA line is currently ${v.state.toUpperCase()}. From now on I'll WhatsApp you (via Hermes) within ~5 min if her line dies, after trying an auto-restart first.`);
}

if (v.state === 'down') {
  const downSince = state.downSince || v.since || Date.now();
  // Client-outdated (405) since this outage began → restarts can never fix it.
  const outdated = events.some((e) => e.tag === 'outdated' && e.ts >= downSince - 60000);
  let restarted = false, recovered = false, rebuilt = false, rebuildError = null;

  const waitForUp = async (sinceTs) => {
    // wait up to 60s for a fresh UP event in the log
    for (let i = 0; i < 6 && !recovered; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      const fresh = collectEvents().filter((e) => e.ts >= sinceTs - 5000);
      recovered = fresh.some((e) => e.kind === 'up');
    }
  };

  if (outdated) {
    // 405 self-heal path: skip pointless restarts, rebuild once per outage.
    if (!DRY && Date.now() - (state.lastRebuildAt || 0) > REBUILD_COOLDOWN_MS) {
      state.lastRebuildAt = Date.now();
      saveState(state);   // persist BEFORE the slow build so overlapping runs can't double-rebuild
      try { rebuildWacli(); rebuilt = true; } catch (e) { rebuildError = e.message; log('405 self-heal failed:', e.message); }
      if (rebuilt) await waitForUp(state.lastRebuildAt);
    }
  } else if (!DRY && Date.now() - (state.lastRestartAt || 0) > RESTART_COOLDOWN_MS) {
    log('auto-restarting siti-ingest...');
    try { execFileSync(PM2, ['restart', 'siti-ingest'], { timeout: 60000 }); restarted = true; } catch (e) { log('pm2 restart failed:', e.message); }
    state.lastRestartAt = Date.now();
    if (restarted) await waitForUp(state.lastRestartAt);
  }

  if (recovered) {
    const how = rebuilt
      ? 'wa-line-watch AUTO-REBUILT wacli with the latest whatsmeow (405 client-outdated) and restarted siti-ingest'
      : 'wa-line-watch auto-restarted siti-ingest';
    await hermesAlert(`⚠️→✅ Siti WA line was DOWN (${v.reason}; down since ~${fmtMYT(downSince)}). ${how} — line is back ONLINE. No action needed.`);
    Object.assign(state, { lastState: 'up', downSince: null, lastAlertAt: Date.now() });
  } else {
    if (Date.now() - (state.lastAlertAt || 0) > REALERT_MS) {
      const extra = restarted
        ? 'Auto-restart did NOT reconnect it — wacli may need a QR re-pair on EdgeXpert.'
        : 'Auto-restart on cooldown (last attempt <30 min ago).';
      const rebuildNote = rebuildError
        ? `Auto-rebuild attempt FAILED (${String(rebuildError).slice(0, 120)}). `
        : (rebuilt ? 'Auto-rebuild swapped the binary but the line has not come up yet. ' : '');
      const runbook = outdated
        ? 'WhatsApp retired this wacli client version (405) — pm2 restart CANNOT fix this. Runbook: ssh edge → cd /home/neo/naca/nclaw-wacli → PATH=/home/neo/go-sdk/go/bin:$PATH GOTOOLCHAIN=auto go get go.mau.fi/whatsmeow@latest && go build -o nclaw-wacli.new . → pm2 stop siti-ingest → backup old binary, mv nclaw-wacli.new nclaw-wacli → pm2 restart siti-ingest. session.db stays, no re-QR. Ref: neo-brain e5d292d8 / neo-kb Systems/WhatsApp.md.'
        : 'Runbook: ssh edge → pm2 restart siti-ingest → check ~/.pm2/logs/siti-ingest-out.log for "wacli connected as".';
      await hermesAlert(`🚨 Siti WA line is DOWN (${v.reason}; since ~${fmtMYT(downSince)}). ${outdated ? rebuildNote : extra + ' '}${runbook}`);
      state.lastAlertAt = Date.now();
    }
    Object.assign(state, { lastState: 'down', downSince });
  }
} else if (v.state === 'up') {
  if (state.lastState === 'down') {
    await hermesAlert(`✅ Siti WA line RECOVERED on its own (down since ~${state.downSince ? fmtMYT(state.downSince) : '?'}). Back online.`);
    state.lastAlertAt = Date.now();
  }
  Object.assign(state, { lastState: 'up', downSince: null });
}

saveState(state);
await heartbeat(v.state === 'down' ? 'alerting' : 'ok', {
  line_state: v.state, reason: v.reason,
  last_event_at: events.length ? new Date(events[events.length - 1].ts).toISOString() : null,
  healthz: hz,
});
log('done');
