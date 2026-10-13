#!/usr/bin/env node
// qwen-box-health — standing vitals check for EdgeXpert (the GB10 box that runs @qwen).
//
// WHY: Neo asked (13 Oct 2026) for a standing health check on the box qwen lives on —
// report GPU busy / temp / RAM on a schedule, and page him when something crosses a
// safe limit. This is that check. It runs from cron, is silent when healthy, and only
// pages on a real state change (with an anti-flap cooldown), mirroring the hub-watch policy.
//
// SIGNALS — all direct driver/kernel reads (no named "is_healthy" heartbeat fields, so
// MONITORING_ENFORCEMENT's main false-signal trap does not apply):
//   GPU   nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,power.draw
//   CPU   /proc/stat  (busy % = delta over ~700 ms), /proc/loadavg (load1)
//   TEMP  /sys/class/thermal/thermal_zone*/temp  (max zone, millidegrees)
//   RAM   /proc/meminfo  (MemTotal / MemAvailable)
//
// ALERT POLICY (one rule, deliberately simple — anti-flap):
//   * healthy (OK)     → silent, except a single "back to normal" line when a WARN/CRIT clears
//   * WARN / CRIT      → page once for that state; re-page after PAGE_COOLDOWN_H if still bad
//   * never page twice for the same state inside the cooldown
//
// LANE: POST 127.0.0.1:3501/send (SEND_API_TOKEN from /home/neo/naca/siti/.env) — the same
// single WhatsApp route hub-watch uses. Never touches wacli's session.db (a second login
// would kick Siti's live WhatsApp offline).
//
// FLAGS:
//   (default) / --once   collect, decide, page if it's news, update state, log
//   --dry                collect + decide + print the decision; send nothing, write no state
//   --status             print the current snapshot + status; send nothing, write nothing
//
// ENV (thresholds, all overridable for synthetic tests):
//   GPU_TEMP_WARN=85  GPU_TEMP_CRIT=95        (°C)
//   CPU_TEMP_WARN=90  CPU_TEMP_CRIT=100       (°C, hottest thermal zone)
//   RAM_AVAIL_WARN_PCT=20  RAM_AVAIL_CRIT_PCT=10   (% free before it's warn/crit)
//   LOAD_WARN_X=1.5   LOAD_CRIT_X=3.0         (× core count, on load1)
//   PAGE_COOLDOWN_H=6                          (re-page interval per state)
//   SEND_API_TOKEN  HUB_WATCH_JID (default 60177519610@s.whatsapp.net)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- flags ----------
const ARGV = process.argv.slice(2);
const DRY = ARGV.includes('--dry');
const STATUS = ARGV.includes('--status');

// ---------- thresholds ----------
const num = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const TH = {
  gpuTempWarn: num(process.env.GPU_TEMP_WARN, 85),
  gpuTempCrit: num(process.env.GPU_TEMP_CRIT, 95),
  cpuTempWarn: num(process.env.CPU_TEMP_WARN, 90),
  cpuTempCrit: num(process.env.CPU_TEMP_CRIT, 100),
  ramAvailWarn: num(process.env.RAM_AVAIL_WARN_PCT, 20),
  ramAvailCrit: num(process.env.RAM_AVAIL_CRIT_PCT, 10),
  loadWarnX: num(process.env.LOAD_WARN_X, 1.5),
  loadCritX: num(process.env.LOAD_CRIT_X, 3.0),
  cooldownH: num(process.env.PAGE_COOLDOWN_H, 6),
};
const JID = process.env.HUB_WATCH_JID || '60177519610@s.whatsapp.net';
const SEND_URL = (process.env.SEND_API_URL || 'http://127.0.0.1:3501').replace(/\/$/, '') + '/send';

// ---------- collection (each returns null on failure, never throws) ----------
function gpu() {
  try {
    const line = execFileSync('nvidia-smi',
      ['--query-gpu=utilization.gpu,temperature.gpu,power.draw', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 8000 }).trim().split('\n')[0];
    const [util, temp, power] = line.split(',').map(s => Number(s.trim()));
    return { util, temp, power };
  } catch { return null; }
}
const toGB = kb => Math.round(kb / 1024 / 1024 * 10) / 10;
function memInfo() {
  try {
    const txt = readFileSync('/proc/meminfo', 'utf8');
    const get = k => { const m = txt.match(new RegExp(`^${k}:\\s+(\\d+)\\s+kB`, 'm')); return m ? Number(m[1]) : null; };
    const total = get('MemTotal'), avail = get('MemAvailable');
    if (total == null || avail == null) return null;
    return { totalGB: toGB(total), availGB: toGB(avail), usedGB: toGB(total - avail), availPct: Math.round(avail / total * 100) };
  } catch { return null; }
}
function cpuTemp() {
  let max = null;
  try {
    for (const z of readdirSync('/sys/class/thermal')) {
      if (!z.startsWith('thermal_zone')) continue;
      const v = Number(readFileSync(`/sys/class/thermal/${z}/temp`, 'utf8').trim());
      if (Number.isFinite(v)) max = max == null ? v : Math.max(max, v);
    }
  } catch {}
  return max == null ? null : Math.round(max / 1000);
}
function cpuSample() {
  const f = readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
  return { idle: (f[3] || 0) + (f[4] || 0), total: f.reduce((a, b) => a + b, 0) };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function cpuBusy() {
  try {
    const a = cpuSample();
    await sleep(700);
    const b = cpuSample();
    const dTotal = b.total - a.total;
    if (dTotal <= 0) return null;
    return Math.round((1 - (b.idle - a.idle) / dTotal) * 10) / 10;
  } catch { return null; }
}
function load1() {
  const m = readFileSync('/proc/loadavg', 'utf8').match(/^[\d.]+/);
  return m ? Number(m[0]) : null;
}
function cores() {
  try { return Number(execFileSync('nproc', { encoding: 'utf8' }).trim()) || 0; } catch { return 0; }
}

// ---------- assessment ----------
function assess(g, mem, cpuTempC, load, cores) {
  const lines = [];
  let status = 'ok';
  const bump = s => { if (s === 'crit') status = 'crit'; else if (s === 'warn' && status !== 'crit') status = 'warn'; };
  const check = (val, warnAt, critAt, invert, label) => {
    if (val == null) return;
    let s = 'ok';
    if (invert) { if (val <= critAt) s = 'crit'; else if (val <= warnAt) s = 'warn'; }
    else { if (val >= critAt) s = 'crit'; else if (val >= warnAt) s = 'warn'; }
    if (s !== 'ok') { lines.push(label(s)); bump(s); }
  };
  check(g?.temp, TH.gpuTempWarn, TH.gpuTempCrit, false, s => `GPU ${g.temp}°C ${s === 'crit' ? '(critical)' : '(warm)'} — warn at ${TH.gpuTempWarn}°C`);
  check(cpuTempC, TH.cpuTempWarn, TH.cpuTempCrit, false, s => `CPU ${cpuTempC}°C ${s === 'crit' ? '(critical)' : '(warm)'} — warn at ${TH.cpuTempWarn}°C`);
  check(mem?.availPct, TH.ramAvailWarn, TH.ramAvailCrit, true, s => `RAM ${mem.availPct}% free (${mem.availGB} GB) — ${s === 'crit' ? 'critically low' : 'running low'}`);
  if (load != null && cores) check(load, cores * TH.loadWarnX, cores * TH.loadCritX, false, s => `load ${load} on ${cores} cores — ${s === 'crit' ? 'saturated' : 'heavily loaded'}`);
  return { status, lines };
}

// ---------- state + decision ----------
const STATE = path.join(__dirname, 'state.json');
const loadState = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; } };
const saveState = st => { try { writeFileSync(STATE, JSON.stringify(st, null, 2)); } catch (e) { console.error('state write failed:', e.message); } };
const isoMinusH = (nowIso, h) => new Date(new Date(nowIso).getTime() - h * 3_600_000).toISOString();

function decide(state, status, nowIso) {
  const prev = state.last_status || null;
  const changed = prev !== status;
  const bad = status !== 'ok';
  const lastSentFor = (state.alert_keys && state.alert_keys[status]) || null;
  const withinCooldown = !!lastSentFor && lastSentFor >= isoMinusH(nowIso, TH.cooldownH);
  let alert = false;
  if (bad) alert = changed || !withinCooldown;         // newly crossed a limit, or still bad past cooldown
  else if (changed && prev) alert = true;              // recovered from a WARN/CRIT → one "back to normal"
  const keys = Object.assign({}, state.alert_keys || {});
  if (alert) keys[status] = nowIso;
  const cutoff = isoMinusH(nowIso, TH.cooldownH * 3);  // prune so meta can't grow unbounded
  for (const k of Object.keys(keys)) if (keys[k] < cutoff) delete keys[k];
  return { alert, keys, from: prev };
}

// ---------- render + send ----------
const DOT = { ok: '🟢', warn: '🟠', crit: '🔴' };
function snapshotText(s) {
  const head = s.status === 'ok' ? 'all healthy' : s.status === 'warn' ? 'watch this' : 'needs attention';
  const parts = [`${DOT[s.status]} qwen's box (EdgeXpert) — ${head}`];
  parts.push(s.g ? `GPU ${s.g.util}% busy · ${s.g.temp}°C · ${s.g.power} W` : 'GPU n/a');
  parts.push(`CPU ${s.cpu != null ? s.cpu + '% busy' : 'busy n/a'} · ${s.cpuTempC != null ? s.cpuTempC + '°C' : 'temp n/a'} · load ${s.load != null ? s.load : 'n/a'}/${s.cores}`);
  if (s.mem) parts.push(`RAM ${s.mem.usedGB} GB used / ${s.mem.totalGB} GB (${s.mem.availPct}% free)`);
  if (s.lines.length) { parts.push(''); for (const l of s.lines) parts.push('  • ' + l); }
  return parts.join('\n');
}
async function send(text) {
  const token = process.env.SEND_API_TOKEN;
  if (!token) return { ok: false, status: 0, error: 'SEND_API_TOKEN not set' };
  try {
    const r = await fetch(SEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'send', toJid: JID, text }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await r.text()).slice(0, 200);
    return { ok: r.ok, status: r.status, error: r.ok ? null : body };
  } catch (e) { return { ok: false, status: 0, error: String(e?.message || e).slice(0, 200) }; }
}

// ---------- main ----------
async function main() {
  const nowIso = new Date().toISOString();
  const c = cores();
  const [g, mem, cpuTempC, load] = [gpu(), memInfo(), cpuTemp(), load1()];
  const cpu = await cpuBusy();
  const { status, lines } = assess(g, mem, cpuTempC, load, c);
  const snap = { g, mem, cpu, cpuTempC, load, cores: c, status, lines };
  const text = snapshotText(snap);
  const logLine = `${nowIso} status=${status} gpu=${g ? `${g.util}%/${g.temp}C` : 'na'} cpu=${cpu != null ? cpu + '%' : 'na'} cputemp=${cpuTempC != null ? cpuTempC + 'C' : 'na'} load=${load != null ? load : 'na'} ram_avail=${mem ? mem.availPct + '%' : 'na'}`;

  if (STATUS) { console.log(text); return; }

  const state = loadState();
  const d = decide(state, status, nowIso);
  const verdict = d.alert ? (DRY ? 'would-page' : 'PAGE') : 'silent';
  console.log(logLine + ` · ${verdict}${d.from && d.alert ? ` (from ${d.from})` : ''}`);

  if (DRY) { console.log(`\n[dry — not sent]\n${text}`); return; }
  if (d.alert) {
    const res = await send(text);
    console.log(`whatsapp ${res.ok ? 'sent' : 'FAILED'} (${res.status}${res.error ? ' ' + res.error : ''})`);
  }
  saveState({
    last_status: status,
    alert_keys: d.keys,
    last_run: nowIso,
    last_alert: d.alert ? nowIso : (state.last_alert || null),
  });
}
main().catch(e => { console.error('qwen-box-health error:', e); process.exit(1); });
