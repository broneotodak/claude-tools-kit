#!/usr/bin/env node
// intrusion-watch.mjs — the judge for the fleet sentinels (NACA, v1 · 2026-09-25)
//
// Born from the 22–25 Sep 2026 break-in (Todak01 pivot → Tailscale SSH root on
// tr-home / neo-twin / Hermes, stolen keys, proxies, sub2api). The sentinels
// (tools/sentinel/sentinel.py, cron */10 on every box) report what changed and
// who logged in. This judge reads those rows plus the tailnet, GitHub, Hetzner
// and neo-brain itself, applies the allow-list (known key fingerprints, known
// IPs) and pages Neo the moment something is off. It never depends on the box
// it is judging: a silent sentinel is an alarm, and when Siti's WhatsApp line
// is down the alert goes out by e-mail instead.
//
// Runs on EdgeXpert (cron, user neo, Node 22, CTK checkout):
//   */10 * * * *  intrusion-watch.mjs            every-10-min judge (+ pulls the
//                                                 SSH-only hosts listed in the registry row)
//   45 8 * * *    intrusion-watch.mjs --daily     one WhatsApp line: the day's security picture
//   15 9 * * 1    intrusion-watch.mjs --weekly    the security ROUTINE: posture + chores
//   --init --seed <json>                          create/refresh the registry rows + allow-list
//   --dry-run                                     print alerts, send nothing
//
// State + allow-list live in agent_registry row `intrusion-watch` (meta.allow,
// meta.state, meta.pull_hosts, meta.alerts, meta.open_items) — editable without
// a deploy, and no IPs in this public repo.
//
// Alert format (Monitoring.md rule): first line `<emoji> NACA · <signal>`,
// second line `[~ intrusion-watch on edgexpert]`. Cooldown per signal key.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
for (const p of [join(ROOT, ".env")]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
}
const ARGS = process.argv.slice(2);
const flag = (f) => ARGS.includes(f);
const opt = (k, d = null) => (ARGS.includes(k) ? ARGS[ARGS.indexOf(k) + 1] : d);
const DRY = flag("--dry-run");
const ME = "intrusion-watch";
const HOST_LABEL = "edgexpert";
const VERSION = "intrusion-watch-v1.0";
const NOW = Date.now();
const MYT = (d = new Date()) => new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour12: false });
const ago = (iso) => (iso ? Math.round((NOW - new Date(iso).getTime()) / 60000) : Infinity);

const BRAIN_URL = process.env.NEO_BRAIN_URL?.replace(/\/$/, "");
const SR_KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!BRAIN_URL || !SR_KEY) { console.error("missing NEO_BRAIN_URL / NEO_BRAIN_SERVICE_ROLE_KEY"); process.exit(1); }
const brain = createClient(BRAIN_URL, SR_KEY, { auth: { persistSession: false } });

const SITI_ENV = process.env.SITI_ENV_PATH || "/home/neo/naca/siti/.env";
const SITI_URL = process.env.SITI_SEND_URL || "http://127.0.0.1:3501/send";
const sitiEnv = (k) => (existsSync(SITI_ENV) ? readFileSync(SITI_ENV, "utf-8").match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim() : null);
const NEO_PHONE = process.env.NEO_PHONE || sitiEnv("NEO_PHONE") || sitiEnv("OWNER_PHONE") || "";
const NEO_JID = process.env.NEO_JID || (NEO_PHONE ? `${NEO_PHONE}@s.whatsapp.net` : "");

let nb = null; // optional SDK (vault reads + alert log with embeddings)
try {
  const { NeoBrain } = await import(join(ROOT, "packages", "memory", "src", "index.js"));
  nb = new NeoBrain({ agent: ME });
} catch (e) { console.error(`[${ME}] SDK unavailable (${e.message.slice(0, 80)}) — vault-backed checks skipped`); }
async function vault(service, type) {
  if (!nb) return null;
  try { return await nb.getCredentialValue(service, { type }); } catch { return null; }
}

// ── registry row = config + state ────────────────────────────────────────────
const { data: regRow } = await brain.from("agent_registry").select("*").eq("agent_name", ME).maybeSingle();
const meta = regRow?.meta || {};
const allow = meta.allow || { key_fps: [], ips: [], cidrs: ["100.64.0.0/10"], sudo_ok: [], ts_ssh_ok: [] };
const state = meta.state || { last_alerts: {}, seen: {}, snapshots: {}, acc: {}, history: [] };
state.acc ||= {}; state.history ||= []; state.last_alerts ||= {}; state.seen ||= {}; state.snapshots ||= {};
const pages = [];         // alerts raised this run
const notes = [];         // quiet findings for the daily line
const keyLabel = (fp) => allow.key_fps.find((k) => fp && fp.startsWith(k.fp))?.label;
const ipLabel = (ip) => {
  const clean = String(ip || "").replace(/^\[?::ffff:/, "").replace(/\]$/, "");
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(clean) || clean.startsWith("fd7a:")) return "tailnet";
  return allow.ips.find((k) => k.ip === clean)?.label;
};

// ── init: create/refresh rows from a seed file (IPs stay out of git) ─────────
if (flag("--init")) {
  const seed = JSON.parse(readFileSync(opt("--seed"), "utf-8"));
  const rows = [{
    agent_name: ME, display_name: "Intrusion Watch", emoji: "🛡️", agent_type: "monitor", status: "active",
    role_description: "Security judge: reads every sentinel-* heartbeat (box fingerprints + logins), the tailnet, GitHub, Hetzner and neo-brain itself; pages Neo on unknown keys/IPs, Tailscale-SSH sessions, config changes, new devices; daily security line 08:45 MYT; weekly routine Mon 09:15 MYT.",
    host: "EdgeXpert (Kenwingston Cyberjaya, tailnet 100.90.58.53) — cron user neo",
    repo_url: "https://github.com/broneotodak/claude-tools-kit",
    meta: { ...meta, runtime: "cron", schedule: "*/10 * * * * (+ --daily 45 8, --weekly 15 9 Mon)", host: "edgexpert", version: VERSION, hb_threshold_min: 30, monitor_threshold_sec: 1800,
      allow: seed.allow, pull_hosts: seed.pull_hosts || [], alerts: seed.alerts || {}, open_items: seed.open_items || [], state: meta.state || state, registered_by: "claude-code-neo-mbp 2026-09-25 (post-intrusion early detection)" },
  }];
  for (const s of seed.sentinels || []) {
    rows.push({
      agent_name: s.name, display_name: `Sentinel ${s.label}`, emoji: "👁️", agent_type: "monitor", status: "active",
      role_description: `Box-local intrusion sentinel on ${s.label}: fingerprints keys/sudoers/ports/units/cron/docker/Tailscale/sshd/SUID/tmp every 10 min + login/sudo/Tailscale-SSH events → heartbeat ${s.name}; judged by intrusion-watch.`,
      host: s.host, repo_url: "https://github.com/broneotodak/claude-tools-kit",
      meta: { runtime: s.runtime || "cron", schedule: "*/10 * * * *", host: s.label, hb_threshold_min: 30, monitor_threshold_sec: 1800, mode: s.mode || "push", registered_by: "claude-code-neo-mbp 2026-09-25" },
    });
  }
  const { error } = await brain.from("agent_registry").upsert(rows, { onConflict: "agent_name" });
  console.log(error ? `init FAILED: ${error.message}` : `init OK: ${rows.length} registry rows upserted`);
  process.exit(error ? 1 : 0);
}
if (!regRow) { console.error(`[${ME}] no registry row — run --init --seed <file> first`); process.exit(1); }

// ── alerting ─────────────────────────────────────────────────────────────────
function header(emoji, signal) { return `${emoji} NACA · ${signal}\n[~ ${ME} on ${HOST_LABEL}]`; }
async function sendWA(text) {
  const env = existsSync(SITI_ENV) ? readFileSync(SITI_ENV, "utf-8") : "";
  const token = env.match(/^SEND_API_TOKEN=(.+)$/m)?.[1]?.trim();
  if (!token) return { ok: false, why: "no SEND_API_TOKEN" };
  try {
    const r = await fetch(SITI_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ type: "send", toJid: NEO_JID, text }), signal: AbortSignal.timeout(8000) });
    return { ok: r.status === 200, why: `http ${r.status}` };
  } catch (e) { return { ok: false, why: e.message }; }
}
async function queueWA(text) {
  const { error } = await brain.from("agent_commands").insert({ from_agent: ME, to_agent: "siti", command: "send_whatsapp_notification", payload: { to: NEO_PHONE, message: text }, priority: 1 });
  return !error;
}
async function sendEmail(subject, text) {
  const key = await vault("resend-academy", "api_key");
  const to = meta.alerts?.email_to || ["neo@todak.com"];
  const from = meta.alerts?.email_from || "NACA Security <security@todakacademy.edu.my>";
  if (!key) return { ok: false, why: "no resend key" };
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject, text }), signal: AbortSignal.timeout(10000) });
    return { ok: r.ok, why: `http ${r.status}` };
  } catch (e) { return { ok: false, why: e.message }; }
}
/** SMS via Twilio — the channel that does not depend on Siti, EdgeXpert or e-mail. Numbers in registry meta.alerts. */
async function sendSMS(text) {
  const from = meta.alerts?.sms_from, to = meta.alerts?.sms_to;
  if (!from || !to) return { ok: false, why: "no sms numbers" };
  const sid = await vault("twilio", "account_sid"), tok = await vault("twilio", "auth_token");
  if (!sid || !tok) return { ok: false, why: "no twilio creds" };
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: from, To: to, Body: text.replace(/\*/g, "").slice(0, 300) }), signal: AbortSignal.timeout(10000) });
    return { ok: r.status === 201 || r.status === 200, why: `http ${r.status}` };
  } catch (e) { return { ok: false, why: e.message }; }
}
async function logAlert(text, level, key) {
  if (!nb) return;
  try { await nb.save(`[${ME}] ${text}`, { category: "security_alert", type: "event", importance: level === "critical" ? 8 : 6, visibility: "internal", source: ME, metadata: { signal: key, level, host: HOST_LABEL } }); } catch { /* best effort */ }
}
/** page(key, emoji, signal, body, {cooldownH, level, channel}) — dedupes per key. */
async function page(key, emoji, signal, body, { cooldownH = 6, level = "warning", channel = "wa", dry = false } = {}) {
  const last = state.last_alerts[key];
  if (last && NOW - new Date(last).getTime() < cooldownH * 3600e3) { console.log(`[${ME}] (cooldown) ${key}`); return false; }
  const text = `${header(emoji, signal)}\n${body}`.trim();
  pages.push({ key, level, signal, dry });
  if (DRY || dry) { console.log(`[${ME}] ${dry ? "SELFTEST" : "DRY-RUN"} alert →\n${text}\n`); if (!dry) return true; state.last_alerts[key] = new Date().toISOString(); return true; }
  let delivered = false;
  if (channel !== "email") {
    const r = await sendWA(text);
    delivered = r.ok;
    if (!r.ok) { console.error(`[${ME}] WA send failed (${r.why}) — queuing + SMS + e-mail`); await queueWA(text); }
  }
  // Critical pages ALWAYS also go by SMS (a WhatsApp 200 is not a delivery); any page goes by SMS when WhatsApp failed.
  if (level === "critical" || !delivered) {
    const s = await sendSMS(`${header(emoji, signal)}\n${body}`.replace(/\n\[~[^\]]*\]/, ""));
    if (s.ok) delivered = true; else console.error(`[${ME}] SMS failed (${s.why})`);
  }
  if (!delivered) {
    const e = await sendEmail(`${emoji} NACA security: ${signal}`, text);
    delivered = e.ok;
    if (!e.ok) console.error(`[${ME}] e-mail failed (${e.why})`);
  }
  state.last_alerts[key] = new Date().toISOString();
  await logAlert(text.replace(/\n/g, " | "), level, key);
  console.log(`[${ME}] PAGED ${key} (${delivered ? "delivered" : "queued"})`);
  return true;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function acc(host) { return (state.acc[host] ||= { logins: {}, unknown: 0, sudo: 0, failed: 0, ts_ssh: 0, changes: [], pkg: 0, reboots: 0 }); }
const fmtList = (arr, n = 6) => arr.slice(0, n).map((l) => `  • ${l}`).join("\n") + (arr.length > n ? `\n  … +${arr.length - n} more` : "");
const CRIT_SECTIONS = new Set(["authkeys", "sudoers", "preload", "sshd", "suid", "admins", "users"]);

// ── 1. pull-mode hosts (boxes we do not put a brain key on) ─────────────────
async function pullHosts() {
  const sentinel = join(HERE, "sentinel", "sentinel.py");
  for (const h of meta.pull_hosts || []) {
    const r = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=12", "-o", "StrictHostKeyChecking=accept-new", h.ssh, `SENTINEL_NAME=${h.name} python3 - --stdout --name ${h.name}`], { input: readFileSync(sentinel), encoding: "utf-8", timeout: 120000 });
    if (r.status !== 0 || !r.stdout.trim().startsWith("{")) { notes.push(`pull ${h.name}: ssh failed (${(r.stderr || "").trim().slice(0, 60)})`); continue; }
    try {
      const rep = JSON.parse(r.stdout.trim().split("\n").pop());
      const { error } = await brain.from("agent_heartbeats").upsert({ agent_name: h.name, status: rep.status, meta: rep.meta, reported_at: rep.meta.ts }, { onConflict: "agent_name" });
      if (error) notes.push(`pull ${h.name}: heartbeat write failed`);
      else console.log(`[${ME}] pulled ${h.name}: ${rep.status} changed=${rep.meta.changed.join(",") || "-"}`);
    } catch (e) { notes.push(`pull ${h.name}: bad report (${e.message.slice(0, 40)})`); }
  }
}

// ── 2. sentinels: freshness + events + diffs ─────────────────────────────────
async function checkSentinels() {
  // NOT filtered on status=active: naca-monitor's registry-status-writeback flips
  // active↔offline by heartbeat age, and an "offline" sentinel is exactly the one we must judge.
  const { data: rows } = await brain.from("agent_registry").select("agent_name,status,meta").like("agent_name", "sentinel-%").is("archived_at", null);
  const names = (rows || []).map((r) => r.agent_name);
  const { data: hbs } = await brain.from("agent_heartbeats").select("agent_name,status,reported_at,meta").in("agent_name", names.length ? names : ["-"]);
  const byName = Object.fromEntries((hbs || []).map((h) => [h.agent_name, h]));
  const summary = { total: names.length, fresh: 0, silent: [], pending: [] };
  for (const r of rows || []) {
    const name = r.agent_name, host = name.replace(/^sentinel-/, "");
    const hb = byName[name];
    const thr = r.meta?.hb_threshold_min || 30;
    if (!hb || ago(hb.reported_at) > thr) {
      // mode "manual" = not installed yet / a laptop that sleeps: listed, never paged, never degrades the judge
      if (r.meta?.mode === "manual") { summary.pending.push(host); continue; }
      summary.silent.push(host);
      await page(`silent:${name}`, "🚨", `sentinel silent on ${host}`, `No report for ${hb ? ago(hb.reported_at) + " min" : "ever"} (limit ${thr}). A box that stops reporting is either down, cut off, or someone killed the watcher.\nCheck: ssh in, \`~/.naca/sentinel/sentinel.log\`, crontab -l.`, { cooldownH: 3, level: "critical" });
      continue;
    }
    summary.fresh++;
    const m = hb.meta || {};
    if (state.seen[name] === m.ts) continue; // already judged this report
    state.seen[name] = m.ts;
    const a = acc(host), ev = m.events || {};
    const isTest = !!m.selftest;
    // logins
    for (const l of ev.logins || []) {
      const key = `${l.u}@${l.ip}`;
      a.logins[key] = (a.logins[key] || 0) + l.n;
      const kl = keyLabel(l.fp), il = ipLabel(l.ip);
      // The 24 Sep signature was a KNOWN key (Neo's stolen Mac key) from an UNKNOWN
      // IP — so an unknown IP always pages, even with a known key. An unknown key
      // from a known place pages too (a key nobody allow-listed just got deployed).
      const unknownIp = !il, unknownKey = l.m !== "publickey" || !kl;
      if (unknownIp || unknownKey) {
        a.unknown += l.n;
        const crit = unknownKey;
        const why = unknownIp && unknownKey ? "unknown IP AND unknown key" : unknownIp ? `known key from an UNKNOWN place${kl ? ` (${kl})` : ""}` : "key not in the allow-list";
        await page(`login:${l.ip}:${(l.fp || l.m).slice(7, 15)}`, crit ? "🚨" : "⚠️", `${why} — login on ${host}`, `${l.n}× as *${l.u}* from ${l.ip}${il ? ` (${il})` : ""} via ${l.m}${l.fp ? `\nkey ${l.fp}${kl ? ` (${kl})` : ""}` : ""}\nIf this is you (new place / new key), reply *allow ${l.ip}* or *allow key ${(l.fp || "").slice(7, 15)}*. If not: kill the session on ${host} and remove the key.`, { level: crit ? "critical" : "warning", dry: isTest });
      }
    }
    a.failed += ev.failed || 0;
    for (const [pair, n] of Object.entries(ev.sudo?.by || {})) {
      a.sudo += n;
      if (allow.sudo_ok?.length && !allow.sudo_ok.includes(pair)) await page(`sudo:${name}:${pair}`, "⚠️", `unexpected sudo on ${host}`, `${pair} ran ${n} sudo command(s):\n${fmtList(ev.sudo.last || [], 5)}`, { dry: isTest });
    }
    if (ev.ts_ssh?.length) {
      a.ts_ssh += ev.ts_ssh.length;
      if (!allow.ts_ssh_ok?.includes(host)) await page(`tsssh:${name}`, "🚨", `Tailscale SSH session on ${host}`, `Tailscale SSH is supposed to be OFF everywhere since 25 Sep (that is how Todak01 got root).\n${fmtList(ev.ts_ssh, 6)}\nFix: \`sudo tailscale set --ssh=false\` on ${host}, then find who did it in the admin console.`, { level: "critical", dry: isTest });
    }
    if (ev.user_changes?.length) await page(`users:${name}`, "🚨", `account change on ${host}`, fmtList(ev.user_changes, 8), { level: "critical", dry: isTest });
    if (ev.pkg_installs?.length) { a.pkg += ev.pkg_installs.length; await page(`pkg:${name}`, "⚠️", `packages installed on ${host}`, `${ev.pkg_installs.length} install(s) — the intruder's first move on tr-home was \`apt install docker\`.\n${fmtList(ev.pkg_installs, 6)}`, { cooldownH: 12, dry: isTest }); }
    if (m.rebooted) { a.reboots++; notes.push(`${host} rebooted (uptime ${Math.round((m.uptime_s || 0) / 60)} min)`); }
    // config diffs
    for (const sec of m.changed || []) {
      const d = m.diff?.[sec] || { added: [], removed: [] };
      a.changes.push(`${sec}: +${d.added.length}/-${d.removed.length}`);
      const crit = CRIT_SECTIONS.has(sec);
      const dry = isTest || sec === "selftest";
      const body = `${d.added.length ? `added:\n${fmtList(d.added)}` : ""}${d.removed.length ? `\nremoved:\n${fmtList(d.removed)}` : ""}`.trim() || "(details truncated)";
      await page(`change:${name}:${sec}`, crit ? "🚨" : "⚠️", `${sec} changed on ${host}`, `${body}\n${crit ? "This is a persistence/access surface — verify NOW who did it." : "If this was a deploy, ignore; otherwise check the box."}`, { level: crit ? "critical" : "warning", cooldownH: crit ? 2 : 6, dry });
    }
    // posture regressions (facts)
    const f = m.facts || {};
    if (f.password_auth === "yes") await page(`posture:${name}:pw`, "🚨", `password SSH turned ON on ${host}`, "PasswordAuthentication yes — keys-only is the rule since 25 Sep.", { level: "critical", cooldownH: 12, dry: isTest });
    if (String(f.ts_run_ssh).toLowerCase() === "true" && !allow.ts_ssh_ok?.includes(host)) await page(`posture:${name}:tsssh`, "🚨", `Tailscale SSH server ON on ${host}`, "RunSSH=true — turn it off: `sudo tailscale set --ssh=false`.", { level: "critical", cooldownH: 12, dry: isTest });
    if (/https?:\/\//.test(f.ts_funnel || "")) await page(`posture:${name}:funnel`, "🚨", `Tailscale Funnel exposed on ${host}`, `${f.ts_funnel}\nThe intruder published tr-home to the internet this way. \`tailscale funnel reset\`.`, { level: "critical", cooldownH: 12, dry: isTest });
    if (f.preload) await page(`posture:${name}:preload`, "🚨", `ld.so.preload present on ${host}`, "A preload library is the classic rootkit hook.", { level: "critical", cooldownH: 12, dry: isTest });
  }
  return summary;
}

// ── 3. tailnet: new devices, Tailscale-SSH servers, stale nodes ─────────────
function tailnet() {
  try {
    const j = JSON.parse(execFileSync("tailscale", ["status", "--json"], { encoding: "utf-8", timeout: 15000 }));
    const users = j.User || {};
    const peers = Object.values(j.Peer || {}).map((p) => ({ name: p.HostName, ip: p.TailscaleIPs?.[0], user: users[String(p.UserID)]?.LoginName || String(p.UserID), created: p.Created, online: !!p.Online, lastSeen: p.LastSeen, ssh: !!(p.SSH_HostKeys && p.SSH_HostKeys.length), os: p.OS }));
    peers.push({ name: j.Self?.HostName, ip: j.Self?.TailscaleIPs?.[0], user: "self", created: j.Self?.Created, online: true, ssh: !!(j.Self?.SSH_HostKeys?.length), os: j.Self?.OS });
    return peers;
  } catch (e) { notes.push(`tailnet read failed: ${e.message.slice(0, 50)}`); return null; }
}
async function checkTailnet() {
  const peers = tailnet();
  if (!peers) return null;
  // Snapshot format version: when the key scheme changes, re-baseline silently
  // instead of paging "new device" for every node we already knew (25 Sep lesson).
  const SNAP_V = 2;
  const snap = state.snapshots.tailnet_v === SNAP_V ? (state.snapshots.tailnet || {}) : {};
  const first = !Object.keys(snap).length;
  state.snapshots.tailnet_v = SNAP_V;
  const cur = {};
  for (const p of peers) {
    // keyed by IP: nodes shared in from another tailnet all show as "device-of-shared-to-user"
    const k = `${p.name}@${p.ip}`;
    cur[k] = { ip: p.ip, user: p.user, created: p.created, ssh: p.ssh };
    if (!first && !snap[k]) await page(`tailnet:new:${k}`, "🚨", `new device on the tailnet: ${p.name}`, `${p.os || "?"} · ${p.ip} · user ${p.user} · created ${p.created?.slice(0, 16)}\nTodak01 sat on our tailnet for 4 months before it was used. If you did not add this, remove it at login.tailscale.com → Machines.`, { level: "critical", cooldownH: 24 });
    if (p.ssh && !allow.ts_ssh_ok?.includes(p.name) && !(snap[k]?.ssh)) await page(`tailnet:ssh:${k}`, "⚠️", `Tailscale SSH server advertised by ${p.name}`, `Node ${p.name} (${p.ip}) is accepting Tailscale SSH. Turn it off on that box: \`sudo tailscale set --ssh=false\`.`, { cooldownH: 24 });
  }
  for (const k of Object.keys(snap)) if (!cur[k]) notes.push(`tailnet: ${k} removed`);
  state.snapshots.tailnet = cur;
  const stale = peers.filter((p) => !p.online && p.lastSeen && ago(p.lastSeen) > 14 * 1440).map((p) => `${p.name} (${Math.round(ago(p.lastSeen) / 1440)}d)`);
  return { n: peers.length, online: peers.filter((p) => p.online).length, stale, sshNodes: peers.filter((p) => p.ssh).map((p) => p.name) };
}

// ── 4. GitHub account (needs a READ-ONLY token in vault github/readonly_pat) ─
async function checkGithub() {
  const token = await vault("github", "readonly_pat");
  if (!token) return { status: "no token — vault github/readonly_pat missing" };
  const gh = async (p) => { const r = await fetch(`https://api.github.com${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10000) }); return r.ok ? r.json() : null; };
  const snap = state.snapshots.github || {};
  const out = { status: "ok" };
  const keys = await gh("/user/keys");
  if (keys) {
    const ids = keys.map((k) => `${k.id}:${k.title}`);
    if (snap.keys) for (const k of ids.filter((x) => !snap.keys.includes(x))) await page(`github:key:${k}`, "🚨", "new SSH key on the GitHub account", `${k} added to github.com/broneotodak. If not you: github.com/settings/keys → delete, then rotate.`, { level: "critical", cooldownH: 24 });
    snap.keys = ids; out.keys = ids.length;
  } else out.status = "token cannot read keys";
  const repos = await gh("/user/repos?visibility=public&per_page=100&sort=created");
  if (repos) {
    const names = repos.map((r) => r.full_name);
    if (snap.public_repos) for (const n of names.filter((x) => !snap.public_repos.includes(x))) await page(`github:public:${n}`, "⚠️", `repo now PUBLIC: ${n}`, "A private repo turned public (or a new public one) can leak keys. Check github.com/" + n + "/settings.", { cooldownH: 24 });
    snap.public_repos = names; out.public = names.length;
  }
  const events = await gh("/users/broneotodak/events?per_page=50");
  if (events) {
    const since = snap.events_watermark || new Date(NOW - 86400e3).toISOString();
    for (const e of events.filter((e) => e.created_at > since && ["MemberEvent", "PublicEvent", "DeleteEvent"].includes(e.type))) {
      if (e.type === "DeleteEvent" && e.payload?.ref_type === "branch") continue;
      await page(`github:event:${e.id}`, e.type === "PublicEvent" ? "🚨" : "⚠️", `GitHub ${e.type} on ${e.repo?.name}`, JSON.stringify(e.payload || {}).slice(0, 200), { cooldownH: 24 });
    }
    snap.events_watermark = events[0]?.created_at || since;
  }
  state.snapshots.github = snap;
  return out;
}

// ── 5. Hetzner (Neo's own account): new servers / ssh keys ──────────────────
async function checkHetzner() {
  const token = await vault("hetzner_cloud", "api_token");
  if (!token) return { status: "no token" };
  const hz = async (p) => { const r = await fetch(`https://api.hetzner.cloud/v1${p}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }); return r.ok ? r.json() : (r.status === 401 ? "dead" : null); };
  const servers = await hz("/servers");
  if (servers === "dead") return { status: "token revoked (rotated) — vault hetzner_cloud/api_token needs the new one" };
  if (!servers) return { status: "unreachable" };
  const snap = state.snapshots.hetzner || {};
  const names = servers.servers.map((s) => `${s.name} (${s.public_net?.ipv4?.ip})`);
  if (snap.servers) for (const n of names.filter((x) => !snap.servers.includes(x))) await page(`hetzner:server:${n}`, "🚨", `new Hetzner server: ${n}`, "Nobody creates servers on Neo's Hetzner account without you knowing. Check console.hetzner.cloud.", { level: "critical", cooldownH: 24 });
  const keys = await hz("/ssh_keys");
  const knames = keys?.ssh_keys?.map((k) => `${k.name} ${k.fingerprint}`) || [];
  if (snap.keys && keys) for (const n of knames.filter((x) => !snap.keys.includes(x))) await page(`hetzner:key:${n}`, "🚨", "new SSH key on Hetzner", n, { level: "critical", cooldownH: 24 });
  state.snapshots.hetzner = { servers: names, keys: knames };
  return { status: "ok", servers: names.length, keys: knames.length };
}

// ── 6. neo-brain itself: unknown agents, auth users, vault writes, Siti line ─
async function checkBrain() {
  const out = {};
  const [{ data: reg }, { data: hbs }] = await Promise.all([brain.from("agent_registry").select("agent_name"), brain.from("agent_heartbeats").select("agent_name,reported_at")]);
  const known = new Set((reg || []).map((r) => r.agent_name));
  const unknown = (hbs || []).filter((h) => !known.has(h.agent_name) && ago(h.reported_at) < 1440).map((h) => h.agent_name);
  for (const u of unknown) await page(`brain:agent:${u}`, "⚠️", `unregistered agent heartbeating: ${u}`, "Something is using a neo-brain key under a name that is not in agent_registry. Find the process, or register it.", { cooldownH: 24 });
  out.unknown_agents = unknown;
  try {
    const r = await fetch(`${BRAIN_URL}/auth/v1/admin/users?per_page=10`, { headers: { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` }, signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const n = Array.isArray(j.users) ? j.users.length : -1;
    out.auth_users = n;
    if (n > 0) await page("brain:auth-users", "🚨", `${n} auth user(s) exist on neo-brain`, `Sign-up is supposed to be OFF and the user table EMPTY (the 25 Sep vault hole). Users: ${j.users.map((u) => u.email).join(", ")}`, { level: "critical", cooldownH: 6 });
  } catch { out.auth_users = "?"; }
  const wm = state.vault_watermark || new Date(NOW - 3600e3).toISOString();
  const { data: creds } = await brain.from("credentials").select("service,credential_type,updated_at,metadata,is_active").gt("updated_at", wm).order("updated_at");
  for (const c of creds || []) notes.push(`vault write: ${c.service}/${c.credential_type} by ${c.metadata?.saved_by || c.metadata?.rotated_by || "?"}${c.is_active === false ? " (deactivated)" : ""}`);
  out.vault_writes = (creds || []).length;
  if (creds?.length) state.vault_watermark = creds[creds.length - 1].updated_at;
  else if (!state.vault_watermark) state.vault_watermark = wm;
  const { data: regNew } = await brain.from("agent_registry").select("agent_name,registered_at").gt("registered_at", state.registry_watermark || new Date(NOW - 86400e3).toISOString());
  for (const r of regNew || []) notes.push(`new registry row: ${r.agent_name}`);
  state.registry_watermark = new Date().toISOString();
  // the second watcher (neo-twin) watches us; we watch it back
  const { data: wd } = await brain.from("agent_heartbeats").select("reported_at,meta").eq("agent_name", "watchdog-twin").maybeSingle();
  out.watchdog = wd ? (ago(wd.reported_at) > 40 ? `stale (${ago(wd.reported_at)} min)` : "fresh") : "missing";
  if (wd && ago(wd.reported_at) > 40) await page("watchdog:stale", "⚠️", "second watcher on neo-twin is silent", `watchdog-twin last reported ${ago(wd.reported_at)} min ago. If neo-twin is down, the SMS fallback for an EdgeXpert outage is gone too.\nCheck: ssh root@neo-twin, /root/.naca/watchdog/watchdog.log.`, { cooldownH: 6 });
  const { data: wl } = await brain.from("agent_heartbeats").select("reported_at,meta").eq("agent_name", "wa-line-watch").maybeSingle();
  const lineState = wl?.meta?.line_state || "?";
  out.siti_line = ago(wl?.reported_at) > 20 ? `stale (${ago(wl?.reported_at)} min)` : lineState;
  if (out.siti_line !== "up") await page("siti:line", "⚠️", `Siti WhatsApp line is ${out.siti_line}`, "wa-line-watch says the line is not up (its own alerts went to Hermes, which is gone). Sent by e-mail because Siti cannot deliver right now.", { cooldownH: 2, channel: "email" });
  return out;
}

// ── daily line + weekly routine ──────────────────────────────────────────────
function dailyText(sent) {
  const hosts = Object.keys(state.acc).sort();
  const lines = [header("🛡️", `security line · ${MYT().slice(0, 10)}`)];
  lines.push(`Sentinels: ${sent.fresh}/${sent.total} fresh${sent.silent.length ? ` · SILENT: ${sent.silent.join(", ")}` : ""}${sent.pending?.length ? ` · not installed/asleep: ${sent.pending.join(", ")}` : ""}`);
  const lg = hosts.map((h) => { const a = state.acc[h]; const tot = Object.values(a.logins).reduce((s, n) => s + n, 0); const who = Object.entries(a.logins).map(([k, n]) => `${k.split("@")[0]}←${ipLabel(k.split("@")[1]) || k.split("@")[1]}`).slice(0, 3); return tot ? `${h} ${tot}${a.unknown ? ` (${a.unknown} UNKNOWN)` : ""} [${[...new Set(who)].join(", ")}]` : null; }).filter(Boolean);
  lines.push(`Logins 24h: ${lg.length ? lg.join(" · ") : "none"}`);
  const sudo = hosts.reduce((s, h) => s + state.acc[h].sudo, 0), failed = hosts.reduce((s, h) => s + state.acc[h].failed, 0), ts = hosts.reduce((s, h) => s + state.acc[h].ts_ssh, 0);
  lines.push(`sudo ${sudo} · failed/bruteforce ${failed} · Tailscale-SSH sessions ${ts} · unknown logins ${hosts.reduce((s, h) => s + state.acc[h].unknown, 0)}`);
  const ch = hosts.flatMap((h) => state.acc[h].changes.map((c) => `${h} ${c}`));
  lines.push(`Changes: ${ch.length ? ch.slice(0, 5).join(" · ") : "none"}`);
  const t = state.last_tailnet || {};
  lines.push(`Tailnet: ${t.n ?? "?"} devices (${t.online ?? "?"} online)${t.sshNodes?.length ? ` · SSH-server on: ${t.sshNodes.join(",")}` : ""}${t.stale?.length ? ` · stale >14d: ${t.stale.length}` : ""}`);
  lines.push(`GitHub: ${state.last_github?.status || "?"}${state.last_github?.keys != null ? ` (${state.last_github.keys} keys, ${state.last_github.public} public repos)` : ""} · Hetzner: ${state.last_hetzner?.status || "?"}${state.last_hetzner?.servers != null ? ` (${state.last_hetzner.servers} servers)` : ""}`);
  const b = state.last_brain || {};
  lines.push(`neo-brain: auth users ${b.auth_users ?? "?"} · vault writes ${state.daily_vault_writes || 0} · unknown agents ${b.unknown_agents?.length || 0} · Siti line ${b.siti_line || "?"}`);
  lines.push(`Alerts sent 24h: ${state.daily_pages || 0}${state.selftest_ok ? " · selftest ✓" : ""} · SMS fallback ${meta.alerts?.sms_to ? "armed" : "OFF"} · twin watchdog ${b.watchdog || "?"}`);
  return lines.join("\n");
}
function weeklyText(sent) {
  const lines = [header("🧭", `weekly security routine · ${MYT().slice(0, 10)}`)];
  const hist = state.history.slice(-7);
  const totLogins = hist.reduce((s, d) => s + (d.logins || 0), 0), unk = hist.reduce((s, d) => s + (d.unknown || 0), 0), pg = hist.reduce((s, d) => s + (d.pages || 0), 0);
  lines.push(`Week: ${totLogins} logins · ${unk} unknown · ${pg} alerts · sentinels ${sent.fresh}/${sent.total}`);
  const post = state.posture || {};
  const bad = Object.entries(post).filter(([, f]) => f.password_auth === "yes" || String(f.ts_run_ssh) === "true" || f.preload).map(([h]) => h);
  lines.push(`Posture: ${bad.length ? `⚠️ ${bad.join(", ")} need fixing` : "keys-only SSH + Tailscale-SSH off + no preload on every reporting box ✓"}`);
  const pub = Object.entries(post).map(([h, f]) => `${h}:${(f.public_listen || []).length}`).join(" ");
  lines.push(`Public-bind ports per box: ${pub || "?"} (VPS boxes should be 22/80/443 only)`);
  const t = state.last_tailnet || {};
  lines.push(`Tailnet chores: ${t.stale?.length ? `remove or re-check stale nodes → ${t.stale.join(", ")}` : "no stale nodes"}`);
  for (const item of meta.open_items || []) lines.push(`☐ ${item}`);
  lines.push("Reply *done <item>* and I'll tick it; *allow <ip|key>* to allow-list.");
  return lines.join("\n");
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const mode = flag("--daily") ? "daily" : flag("--weekly") ? "weekly" : "watch";
  await pullHosts();
  const sent = await checkSentinels();
  // posture snapshot for the weekly page
  const { data: hbs } = await brain.from("agent_heartbeats").select("agent_name,meta").like("agent_name", "sentinel-%");
  state.posture = Object.fromEntries((hbs || []).map((h) => [h.agent_name.replace(/^sentinel-/, ""), h.meta?.facts || {}]));
  if (mode === "watch" || !state.last_tailnet) state.last_tailnet = await checkTailnet();
  if (mode === "watch") {
    state.last_github = await checkGithub();
    state.last_hetzner = await checkHetzner();
    state.last_brain = await checkBrain();
  }
  const selftests = pages.filter((p) => p.dry).length;
  if (selftests) state.selftest_ok = new Date().toISOString();
  state.daily_pages = (state.daily_pages || 0) + pages.filter((p) => !p.dry).length;
  state.daily_vault_writes = (state.daily_vault_writes || 0) + (state.last_brain?.vault_writes || 0);
  if (mode === "daily") {
    const text = dailyText(sent);
    const hosts = Object.keys(state.acc);
    state.history.push({ day: MYT().slice(0, 10), logins: hosts.reduce((s, h) => s + Object.values(state.acc[h].logins).reduce((x, n) => x + n, 0), 0), unknown: hosts.reduce((s, h) => s + state.acc[h].unknown, 0), pages: state.daily_pages, changes: hosts.reduce((s, h) => s + state.acc[h].changes.length, 0) });
    state.history = state.history.slice(-14);
    if (DRY) console.log(text); else { const r = await sendWA(text); if (!r.ok) { await queueWA(text); await sendEmail("🛡️ NACA security line", text); } console.log(`[${ME}] daily line ${r.ok ? "sent" : "queued"}`); }
    state.acc = {}; state.daily_pages = 0; state.daily_vault_writes = 0; state.selftest_ok = null; state.last_daily = new Date().toISOString();
  }
  if (mode === "weekly") {
    const text = weeklyText(sent);
    if (DRY) console.log(text); else { const r = await sendWA(text); if (!r.ok) { await queueWA(text); await sendEmail("🧭 NACA weekly security routine", text); } console.log(`[${ME}] weekly routine ${r.ok ? "sent" : "queued"}`); }
    state.last_weekly = new Date().toISOString();
  }
  state.last_run = new Date().toISOString();
  state.last_notes = notes.slice(0, 20);
  if (!DRY) {
    const { error } = await brain.from("agent_registry").update({ meta: { ...meta, state } }).eq("agent_name", ME);
    if (error) console.error(`[${ME}] state save failed: ${error.message}`);
    const status = sent.silent.length || pages.some((p) => !p.dry && p.level === "critical") ? "degraded" : "ok";
    await brain.from("agent_heartbeats").upsert({ agent_name: ME, status, reported_at: new Date().toISOString(), meta: { version: VERSION, mode, sentinels: sent, pages: pages.length, selftests, notes: notes.slice(0, 10), github: state.last_github?.status, hetzner: state.last_hetzner?.status, tailnet: state.last_tailnet?.n, siti_line: state.last_brain?.siti_line, last_daily: state.last_daily } }, { onConflict: "agent_name" });
  }
  console.log(`[${new Date().toISOString()}] ${ME} ${mode}: sentinels ${sent.fresh}/${sent.total}${sent.silent.length ? ` silent=${sent.silent.join(",")}` : ""}${sent.pending?.length ? ` pending=${sent.pending.join(",")}` : ""} pages=${pages.length}${selftests ? ` (selftest ${selftests})` : ""} notes=${notes.length}${notes.length ? " → " + notes.slice(0, DRY ? 30 : 4).join(" | ") : ""}`);
}
await main();
