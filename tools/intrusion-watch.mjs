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
//   intrusion-watch.mjs --maintenance <host> --for 3h [--note "clean rebuild"] [--now]
//                  announce planned work: that box's changes fold into ONE digest per report until the window ends
//   intrusion-watch.mjs --maintenance-clear <host>
//   15 9 * * 1    intrusion-watch.mjs --weekly    the security ROUTINE: posture + chores
//   (v1.4, 2026-10-02) also judges the vault read log public.credential_reads
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
const VERSION = "intrusion-watch-v1.6"; // v1.6: public-door probes (naca-mcp, webhook, cockpit, twin-api) · v1.5: lane outcomes + API spend + token health (review week 1) · v1.4: vault read log (credential_reads) judged · v1.3: burst cap — max 3 warning pages per run, rest folded into one // v1.1 maintenance windows + egress pages · v1.2 known-provider owners are notes, not pages
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
// ── maintenance windows: meta.maintenance = [{host, until, by, note}] ────────
// During a window, a box's config diffs, package installs, posture regressions and
// a silent sentinel fold into ONE "🛠 in maintenance" page per sentinel report (every
// item still listed, crit ones marked). Logins, sudo, Tailscale-SSH and account changes
// are never folded. Windows expire on their own; the last 7 days stay for the record.
meta.maintenance = (meta.maintenance || []).filter((w) => new Date(w.until).getTime() > NOW - 7 * 86400e3);
const inMaint = (host) => meta.maintenance.find((w) => w.host === host && new Date(w.until).getTime() > NOW);
const folded = {};        // host → lines collected under a window, flushed as one page per report
// Egress: a box's own services reach the big clouds all day (Claude, Gemini, Supabase behind
// Cloudflare, AWS-hosted SaaS, Apple push, GitHub). Those owners are NOTES, not pages. A page is
// for an owner outside this list (a residential ISP, a mobile carrier, a bargain VPS host) —
// that is what a phone-home looks like. Extend without code: registry meta.allow.egress_owners.
const KNOWN_EGRESS_OWNERS = (allow.egress_owners && allow.egress_owners.length) ? allow.egress_owners : [
  "CLOUDFLARENET", "ANTHROPIC", "GOOGLE", "GOOGLE-CLOUD-PLATFORM", "AMAZON", "FACEBOOK", "AKAMAI-ASN", "AKAMAI-AS",
  "FASTLY", "MICROSOFT", "APPLE-ENGINEERING", "GITHUB", "TWILIO", "HETZNER", "TAILSCALE", "ORACLE-BMC", "DIGITALOCEAN",
  "ELEVENLABS", "OPENAI", "AKAMAI-LINODE-AP",
];
const knownOwner = (line) => { const o = (line.split(" -> ")[1] || "").toUpperCase(); return KNOWN_EGRESS_OWNERS.some((k) => o.startsWith(k.toUpperCase())); };
const pages = [];         // alerts raised this run
const notes = [];         // quiet findings for the daily line
const keyLabel = (fp) => allow.key_fps.find((k) => fp && fp.startsWith(k.fp))?.label;
const ipLabel = (ip) => {
  const clean = String(ip || "").replace(/^\[?::ffff:/, "").replace(/\]$/, "");
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(clean) || clean.startsWith("fd7a:")) return "tailnet";
  return allow.ips.find((k) => k.ip === clean)?.label;
};

// ── maintenance CLI ──────────────────────────────────────────────────────────
if (flag("--maintenance") || flag("--maintenance-clear")) {
  const clear = flag("--maintenance-clear");
  const host = opt(clear ? "--maintenance-clear" : "--maintenance");
  if (!host) { console.error("usage: --maintenance <host> --for 3h [--note text] [--now] | --maintenance-clear <host>"); process.exit(2); }
  const dm = /^(\d+)([mhd])$/.exec(opt("--for", "3h") || "");
  if (!clear && !dm) { console.error("--for must look like 45m, 3h or 1d"); process.exit(2); }
  const ms = clear ? 0 : Number(dm[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[dm[2]];
  // The judge reads this row at :x0 and writes {...meta, state} 10–20 s later; a write in that
  // window is clobbered. Wait for :x2–:x8 unless --now.
  if (!flag("--now")) { let m = new Date().getMinutes() % 10; while (!(m >= 2 && m <= 8)) { await new Promise((r) => setTimeout(r, 15000)); m = new Date().getMinutes() % 10; } }
  const { data: fresh } = await brain.from("agent_registry").select("meta").eq("agent_name", ME).maybeSingle();
  const fm = fresh?.meta || {};
  const list = (fm.maintenance || []).filter((w) => w.host !== host);
  if (!clear) list.push({ host, until: new Date(Date.now() + ms).toISOString(), by: process.env.MAINT_BY || `${process.env.USER || "operator"}@${process.env.HOSTNAME || "cli"}`, note: opt("--note", ""), since: new Date().toISOString() });
  const { error } = await brain.from("agent_registry").update({ meta: { ...fm, maintenance: list } }).eq("agent_name", ME);
  if (error) { console.error(`[${ME}] maintenance write failed: ${error.message}`); process.exit(1); }
  console.log(clear ? `[${ME}] maintenance cleared for ${host}` : `[${ME}] maintenance: ${host} until ${MYT(Date.now() + ms)} MYT (${opt("--for", "3h")}) — "${opt("--note", "")}"`);
  process.exit(0);
}

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
async function sendWA(text, toJid = NEO_JID) {
  const env = existsSync(SITI_ENV) ? readFileSync(SITI_ENV, "utf-8") : "";
  const token = env.match(/^SEND_API_TOKEN=(.+)$/m)?.[1]?.trim();
  if (!token) return { ok: false, why: "no SEND_API_TOKEN" };
  try {
    const r = await fetch(SITI_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ type: "send", toJid, text }), signal: AbortSignal.timeout(8000) });
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
const PAGE_CAP = Number(meta.alerts?.page_cap || 3);
let sentThisRun = 0;
const overflow = [];
/** page(key, emoji, signal, body, {cooldownH, level, channel}) — dedupes per key. */
async function page(key, emoji, signal, body, { cooldownH = 6, level = "warning", channel = "wa", dry = false, host = null } = {}) {
  const last = state.last_alerts[key];
  if (last && NOW - new Date(last).getTime() < cooldownH * 3600e3) { console.log(`[${ME}] (cooldown) ${key}`); return false; }
  const text = `${header(emoji, signal)}\n${body}`.trim();
  // Burst cap: WhatsApp flags numbers that send floods. Critical pages always go; warnings beyond
  // PAGE_CAP in one run fold into a single summary sent at the end of the run.
  if (!dry && !DRY && level !== "critical" && channel !== "email" && sentThisRun >= PAGE_CAP) {
    overflow.push(`${emoji} ${signal}`); state.last_alerts[key] = new Date().toISOString(); pages.push({ key, level, signal, dry, folded: true }); return true;
  }
  if (!dry && !DRY && channel !== "email") sentThisRun++;
  pages.push({ key, level, signal, dry });
  if (DRY || dry) { console.log(`[${ME}] ${dry ? "SELFTEST" : "DRY-RUN"} alert →\n${text}\n`); if (!dry) return true; state.last_alerts[key] = new Date().toISOString(); return true; }
  let delivered = false;
  if (channel !== "email") {
    const r = await sendWA(text);
    delivered = r.ok;
    if (!r.ok) { console.error(`[${ME}] WA send failed (${r.why}) — queuing + SMS + e-mail`); await queueWA(text); }
    // Per-host copies: registry meta.alerts.per_host = { "<host>": ["<phone>@s.whatsapp.net", ...] } (the box owner, e.g. Kai for academy).
    // WhatsApp only — SMS and e-mail fallbacks stay Neo's. Never blocks or replaces the owner page.
    for (const jid of (host && meta.alerts?.per_host?.[host]) || []) {
      const c = await sendWA(text, jid);
      console.log(`[${ME}] copy to ${jid.replace(/@.*/, "")} for ${host}: ${c.ok ? "sent" : "failed " + c.why}`);
    }
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
/** One digest page per sentinel report for a box under maintenance; never SMS (level warning), no cooldown (the report ts dedupes). */
async function flushMaint(name, host, ts) {
  const lines = folded[host]; if (!lines?.length) return;
  const w = inMaint(host) || {};
  await page(`maint:${name}:${ts}`, "🛠", `${host} in maintenance — ${lines.length} change(s)`, `by ${w.by || "?"} until ${MYT(w.until).slice(0, 17)} MYT${w.note ? ` — ${w.note}` : ""}\n${fmtList(lines, 12)}\n(folded: planned work announced with --maintenance; logins and account changes still page on their own)`, { host, cooldownH: 0, level: "warning" });
  folded[host] = [];
}
/** Body for a new "process -> owner" egress pair, with the live addresses behind it when the sentinel sent them. */
function egressBody(line, m, host) {
  const proc = line.split(" -> ")[0];
  const ips = (m.outbound || []).filter((o) => (o.proc || "?") === proc).map((o) => `${o.ip} ×${o.n}`).slice(0, 5);
  return `\`${line}\` — a program on ${host} is talking to a network it had not talked to before.${ips.length ? `\nnow: ${ips.join(", ")}` : ""}\nA new provider or a deploy? ignore. Otherwise on ${host}: \`sudo ss -tnp state established\` and find that process.`;
}

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
      if (inMaint(host)) { (folded[host] ||= []).push(`sentinel silent ${hb ? ago(hb.reported_at) + " min" : ""} — expected while the box is being rebuilt`); summary.pending.push(`${host} (maintenance)`); await flushMaint(name, host, hb?.meta?.ts || String(NOW)); continue; }
      summary.silent.push(host);
      await page(`silent:${name}`, "🚨", `sentinel silent on ${host}`, `No report for ${hb ? ago(hb.reported_at) + " min" : "ever"} (limit ${thr}). A box that stops reporting is either down, cut off, or someone killed the watcher.\nCheck: ssh in, \`~/.naca/sentinel/sentinel.log\`, crontab -l.`, { host, cooldownH: 3, level: "critical" });
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
      const kl = keyLabel(l.fp), il = ipLabel(l.ip);
      // the judge's own pull-mode SSH (EdgeXpert key into academy / NAS) is machinery, not a person: count apart
      if (kl && /edgexpert/i.test(kl) && (meta.pull_hosts || []).some((p) => p.name === name)) { a.pulls = (a.pulls || 0) + l.n; continue; }
      a.logins[key] = (a.logins[key] || 0) + l.n;
      // The 24 Sep signature was a KNOWN key (Neo's stolen Mac key) from an UNKNOWN
      // IP — so an unknown IP always pages, even with a known key. An unknown key
      // from a known place pages too (a key nobody allow-listed just got deployed).
      const unknownIp = !il, unknownKey = l.m !== "publickey" || !kl;
      if (unknownIp || unknownKey) {
        a.unknown += l.n;
        const crit = unknownKey;
        const why = unknownIp && unknownKey ? "unknown IP AND unknown key" : unknownIp ? `known key from an UNKNOWN place${kl ? ` (${kl})` : ""}` : "key not in the allow-list";
        await page(`login:${l.ip}:${(l.fp || l.m).slice(7, 15)}`, crit ? "🚨" : "⚠️", `${why} — login on ${host}`, `${l.n}× as *${l.u}* from ${l.ip}${il ? ` (${il})` : ""} via ${l.m}${l.fp ? `\nkey ${l.fp}${kl ? ` (${kl})` : ""}` : ""}\nIf this is you (new place / new key), reply *allow ${l.ip}* or *allow key ${(l.fp || "").slice(7, 15)}*. If not: kill the session on ${host} and remove the key.`, { host, level: crit ? "critical" : "warning", dry: isTest });
      }
    }
    a.failed += ev.failed || 0;
    for (const [pair, n] of Object.entries(ev.sudo?.by || {})) {
      a.sudo += n;
      if (allow.sudo_ok?.length && !allow.sudo_ok.includes(pair)) await page(`sudo:${name}:${pair}`, "⚠️", `unexpected sudo on ${host}`, `${pair} ran ${n} sudo command(s):\n${fmtList(ev.sudo.last || [], 5)}`, { host, dry: isTest });
    }
    if (ev.ts_ssh?.length) {
      a.ts_ssh += ev.ts_ssh.length;
      if (!allow.ts_ssh_ok?.includes(host)) await page(`tsssh:${name}`, "🚨", `Tailscale SSH session on ${host}`, `Tailscale SSH is supposed to be OFF everywhere since 25 Sep (that is how Todak01 got root).\n${fmtList(ev.ts_ssh, 6)}\nFix: \`sudo tailscale set --ssh=false\` on ${host}, then find who did it in the admin console.`, { host, level: "critical", dry: isTest });
    }
    if (ev.user_changes?.length) await page(`users:${name}`, "🚨", `account change on ${host}`, fmtList(ev.user_changes, 8), { host, level: "critical", dry: isTest });
    if (ev.pkg_installs?.length && inMaint(host)) { a.pkg += ev.pkg_installs.length; (folded[host] ||= []).push(`pkg: ${ev.pkg_installs.length} install(s) — ${ev.pkg_installs.slice(0, 3).map((x) => x.replace(/^\S+ \S+ install /, "")).join(", ")}`); }
    else if (ev.pkg_installs?.length) { a.pkg += ev.pkg_installs.length; await page(`pkg:${name}`, "⚠️", `packages installed on ${host}`, `${ev.pkg_installs.length} install(s) — the intruder's first move on tr-home was \`apt install docker\`.\n${fmtList(ev.pkg_installs, 6)}`, { host, cooldownH: 12, dry: isTest }); }
    if (m.rebooted) { a.reboots++; notes.push(`${host} rebooted (uptime ${Math.round((m.uptime_s || 0) / 60)} min)`); }
    // config diffs
    for (const sec of m.changed || []) {
      const d = m.diff?.[sec] || { added: [], removed: [] };
      a.changes.push(`${sec}: +${d.added.length}/-${d.removed.length}`);
      const crit = CRIT_SECTIONS.has(sec);
      // Laptops (mode "manual") sleep, wake on other networks, open and close apps:
      // their ports/units/temp files churn by nature. Only the access surface pages there.
      if (r.meta?.mode === "manual" && !crit && sec !== "selftest") { notes.push(`${host}: ${sec} changed (+${d.added.length}/-${d.removed.length}, laptop — not paged)`); continue; }
      // A key that was announced and allow-listed BEFORE it landed is the agreed deploy path — note, don't page.
      if (sec === "authkeys" && d.added.length && !d.removed.length && d.added.every((l) => keyLabel((l.match(/SHA256:\S+/) || [])[0]))) { notes.push(`${host}: authorized key added (allow-listed): ${d.added.map((l) => keyLabel((l.match(/SHA256:\S+/) || [])[0])).join("; ")}`); continue; }
      if (inMaint(host) && !isTest) { (folded[host] ||= []).push(`${crit ? "🚨 " : ""}${sec} +${d.added.length}/-${d.removed.length}${d.added.length ? ": " + d.added.slice(0, 2).map((l) => l.slice(0, 70)).join(" · ") : ""}`); continue; }
      if (sec === "egress") {
        // one page per NEW "process -> network owner" pair (24h cooldown per pair); a pair that stopped is only a note
        for (const line of d.added) {
          if (knownOwner(line)) { notes.push(`${host}: new outbound ${line} (known provider — not paged)`); continue; }
          await page(`change:${name}:egress:${line}`, "⚠️", `new outbound destination on ${host}`, egressBody(line, m, host), { host, cooldownH: 24, dry: isTest });
        }
        if (d.removed.length) notes.push(`${host}: egress stopped → ${d.removed.slice(0, 3).join("; ")}`);
        continue;
      }
      const dry = isTest || sec === "selftest";
      const body = `${d.added.length ? `added:\n${fmtList(d.added)}` : ""}${d.removed.length ? `\nremoved:\n${fmtList(d.removed)}` : ""}`.trim() || "(details truncated)";
      await page(`change:${name}:${sec}`, crit ? "🚨" : "⚠️", `${sec} changed on ${host}`, `${body}\n${crit ? "This is a persistence/access surface — verify NOW who did it." : "If this was a deploy, ignore; otherwise check the box."}`, { host, level: crit ? "critical" : "warning", cooldownH: crit ? 2 : 6, dry });
    }
    // posture regressions (facts)
    const f = m.facts || {};
    if (inMaint(host)) {
      const bad = [f.password_auth === "yes" && "🚨 password SSH ON", String(f.ts_run_ssh).toLowerCase() === "true" && "🚨 Tailscale SSH server ON", /https?:\/\//.test(f.ts_funnel || "") && "🚨 Tailscale Funnel exposed", f.preload && "🚨 ld.so.preload present"].filter(Boolean);
      if (bad.length) (folded[host] ||= []).push(...bad);
      await flushMaint(name, host, m.ts);
      continue;
    }
    if (f.password_auth === "yes") await page(`posture:${name}:pw`, "🚨", `password SSH turned ON on ${host}`, "PasswordAuthentication yes — keys-only is the rule since 25 Sep.", { host, level: "critical", cooldownH: 12, dry: isTest });
    if (String(f.ts_run_ssh).toLowerCase() === "true" && !allow.ts_ssh_ok?.includes(host)) await page(`posture:${name}:tsssh`, "🚨", `Tailscale SSH server ON on ${host}`, "RunSSH=true — turn it off: `sudo tailscale set --ssh=false`.", { host, level: "critical", cooldownH: 12, dry: isTest });
    if (/https?:\/\//.test(f.ts_funnel || "")) await page(`posture:${name}:funnel`, "🚨", `Tailscale Funnel exposed on ${host}`, `${f.ts_funnel}\nThe intruder published tr-home to the internet this way. \`tailscale funnel reset\`.`, { host, level: "critical", cooldownH: 12, dry: isTest });
    if (f.preload) await page(`posture:${name}:preload`, "🚨", `ld.so.preload present on ${host}`, "A preload library is the classic rootkit hook.", { host, level: "critical", cooldownH: 12, dry: isTest });
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

// ── 7. vault reads (credential_reads, logged by get_credential since 2026-10-02) ─
// Config: registry meta.vault = { bulk_distinct: 25, never_read: ["netlify_v2", ...], learn_days: 7 }.
// Learned pairs (key -> secrets it reads) live in state.vault_pairs; a pair seen for the first
// time AFTER the learning window pages once (warning). Unknown keys / bulk sweeps / a key that
// must never read the vault page at once (critical).
async function checkVaultReads() {
  const cfg = { bulk_distinct: 25, never_read: ["netlify_v2", "legacy_service_role"], learn_days: 7, ...(meta.vault || {}) };
  state.vault_learn_until ||= new Date(NOW + cfg.learn_days * 86400e3).toISOString();
  const learning = NOW < new Date(state.vault_learn_until).getTime();
  const wm = state.vault_reads_watermark || 0;
  const { data: rows, error } = await brain.from("credential_reads").select("id,read_at,service,credential_type,key_name,key_fp,ip,via").gt("id", wm).order("id").limit(5000);
  if (error) return { status: `read log unavailable: ${error.message.slice(0, 60)}` };
  if (!rows?.length) return { status: "ok", reads: 0, learning };
  state.vault_reads_watermark = rows[rows.length - 1].id;
  state.vault_pairs ||= {};
  const byKey = {};
  for (const r of rows) {
    const who = r.key_name || (r.via === "sql" ? "direct-sql" : `UNKNOWN:${r.key_fp || "nokey"}`);
    const sec = `${r.service}/${r.credential_type || "*"}`;
    (byKey[who] ||= { n: 0, secrets: new Set(), ips: new Set(), fresh: [] }).n++;
    byKey[who].secrets.add(sec); if (r.ip) byKey[who].ips.add(r.ip);
    const known = (state.vault_pairs[who] ||= []);
    if (!known.includes(sec)) { known.push(sec); byKey[who].fresh.push(sec); }
  }
  state.daily_vault_reads ||= {};
  for (const [who, k] of Object.entries(byKey)) {
    state.daily_vault_reads[who] = (state.daily_vault_reads[who] || 0) + k.n;
    const ips = [...k.ips].map((ip) => `${ip}${ipLabel(ip) ? ` (${ipLabel(ip)})` : ""}`).join(", ");
    const list = fmtList([...k.secrets]);
    if (who.startsWith("UNKNOWN:")) {
      await page(`vault:unknown:${who}`, "🚨", "vault read by an UNKNOWN key", `A key that is not one of our named machine keys just read ${k.secrets.size} secret(s) from the vault.\nFrom: ${ips || "?"}\n${list}\nIf no new machine key was made today: delete unknown keys in the Supabase dashboard (neo-brain → API keys) NOW, then rotate the secrets listed.`, { level: "critical", cooldownH: 1 });
    } else if (k.secrets.size > cfg.bulk_distinct) {
      await page(`vault:bulk:${who}`, "🚨", `vault SWEEP by ${who}: ${k.secrets.size} secrets in one run`, `Key "${who}" read ${k.secrets.size} different secrets within ~10 minutes (normal is a handful). This is what a thief does.\nFrom: ${ips || "?"}\n${list}\nIf this is not you: delete the "${who}" key in the Supabase dashboard (neo-brain → API keys), then rotate.`, { level: "critical", cooldownH: 1 });
    } else if (cfg.never_read.includes(who)) {
      await page(`vault:never:${who}`, "🚨", `vault read by "${who}", which must never read it`, `Rule: internet-facing processes never read the vault (Rules.md #17). Key "${who}" read:\n${list}\nFrom: ${ips || "?"}`, { level: "critical", cooldownH: 3 });
    } else if (who === "direct-sql") {
      notes.push(`vault read via direct SQL (owner-level): ${[...k.secrets].slice(0, 4).join(", ")}`);
    }
    if (k.fresh.length && !who.startsWith("UNKNOWN:")) {
      if (learning) notes.push(`vault learn: ${who} reads ${k.fresh.slice(0, 3).join(", ")}${k.fresh.length > 3 ? ` +${k.fresh.length - 3}` : ""}`);
      else await page(`vault:new:${who}:${k.fresh.join(",").slice(0, 80)}`, "⚠️", `${who} read a secret it never read before`, `Key "${who}" read secret(s) it has not used before:\n${fmtList(k.fresh)}\nFrom: ${ips || "?"}\nNew deploy or new tool? ignore (it is learned now). Otherwise find what on that box asked for it.`, { cooldownH: 24 });
    }
  }
  return { status: "ok", reads: rows.length, keys: Object.keys(byKey), learning };
}

// ── 8. lanes, spend, tokens (review 2026-10-03, items 1 + 2) ─────────────────
// Config: registry meta.lanes = { window_h: 48, dev_fail_min: 2, task_fail_min: 3 },
// meta.spend = { daily_warn_usd: 5, daily_crit_usd: 20 }, meta.tokens = { github: ["edge_cc_pat","readonly_pat"], expiry_warn_days: 14 }.
// Why: the self-repair lane failed six nights (27 Sep–2 Oct) and nobody was paged — health checks asked "is the process alive",
// not "did the lane succeed". The 23 Sep $285 day had no alarm faster than the next morning's money line.
const short = (v, n = 90) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
function failReason(r) {
  const res = r.result || {};
  return short(res.output || res.error || res.stderr || res.stop_reason || (typeof res === "string" ? res : ""), 110) || "no reason recorded";
}
async function checkLanes() {
  const cfg = { window_h: 48, dev_fail_min: 2, task_fail_min: 3, ...(meta.lanes || {}) };
  const since = new Date(NOW - cfg.window_h * 3600e3).toISOString();
  const { data: rows, error } = await brain.from("agent_commands").select("to_agent,command,status,payload,result,created_at").in("command", ["run_dev_task", "run_task"]).gte("created_at", since).limit(1000);
  if (error) return { status: `agent_commands unavailable: ${error.message.slice(0, 60)}` };
  const lanes = {};
  for (const r of rows || []) {
    const key = `${r.command}:${r.to_agent}`;
    const l = (lanes[key] ||= { done: 0, failed: 0, other: 0, reasons: {} });
    if (r.status === "done") l.done++;
    else if (r.status === "failed") { l.failed++; const why = failReason(r); l.reasons[why] = (l.reasons[why] || 0) + 1; }
    else l.other++;
  }
  const topReason = (l) => Object.entries(l.reasons).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const hint = (why) => /token|auth|401|credential|Username/i.test(why) ? "Looks like a dead credential: fix the token on that box (vault → file → restart), then re-run."
    : /spend limit|rate.?limit|disabled/i.test(why) ? "Looks like a cap or an org setting: raise/clear it, or move the lane to its own key."
    : "Open the job rows for that lane and read the last failure.";
  for (const [key, l] of Object.entries(lanes)) {
    const [command, agent] = key.split(":");
    const isDev = command === "run_dev_task";
    const min = isDev ? cfg.dev_fail_min : cfg.task_fail_min;
    if (l.failed >= min && l.failed > l.done) {
      const why = topReason(l);
      await page(`lane:${command}:${agent}`, "⚠️", `${isDev ? "dev" : "hands"} lane on ${agent} is failing: ${l.failed} failed, ${l.done} done in ${cfg.window_h}h`,
        `Most common reason: ${why}\n${hint(why)}`, { cooldownH: 12, host: agent.replace(/-cc$/, "") });
    }
  }
  // Siti's self-repair filings specifically (night-shift → run_dev_task). Two consecutive failed nights = the repair lane is dead.
  const ns = (rows || []).filter((r) => r.command === "run_dev_task" && r.payload?.source === "night-shift").sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  const lastTwo = ns.slice(-2);
  if (lastTwo.length === 2 && lastTwo.every((r) => r.status === "failed")) {
    const why = failReason(lastTwo[1]);
    await page("lane:self-repair", "⚠️", "Siti's self-repair lane has failed two nights running", `The night shift filed fixes but both jobs failed.\nLast reason: ${why}\n${hint(why)}`, { cooldownH: 24 });
  }
  const summary = Object.fromEntries(Object.entries(lanes).map(([k, l]) => [k, `${l.done}/${l.done + l.failed + l.other}`]));
  return { status: "ok", window_h: cfg.window_h, lanes: summary, self_repair_last: ns.slice(-1)[0]?.status || "none" };
}
async function checkSpend() {
  const cfg = { daily_warn_usd: 5, daily_crit_usd: 20, ...(meta.spend || {}) };
  const key = await vault("anthropic", "admin_api_key");
  if (!key) return { status: "no admin key (vault anthropic/admin_api_key)" };
  // The report is bucketed by UTC day and refuses a window that ends in the same bucket it starts in
  // ("ending date must be after starting date" when starting_at = today 00:00Z and ending_at defaults to now),
  // so ask for yesterday → tomorrow and read today's bucket out of it.
  const today = new Date(NOW); today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 864e5), end = new Date(today.getTime() + 864e5);
  try {
    const r = await fetch(`https://api.anthropic.com/v1/organizations/cost_report?starting_at=${start.toISOString()}&ending_at=${end.toISOString()}&bucket_width=1d`, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (!j.data) return { status: `cost_report ${r.status}: ${String(j?.error?.message || "").slice(0, 80)}` };
    let usd = 0, yday = 0;
    for (const b of j.data) { let sum = 0; for (const x of b.results || []) sum += Number(x.amount || 0) / 100; if (b.starting_at?.slice(0, 10) === today.toISOString().slice(0, 10)) usd += sum; else yday += sum; }
    usd = +usd.toFixed(2); yday = +yday.toFixed(2);
    if (usd >= cfg.daily_crit_usd) await page("spend:daily-crit", "🚨", `Anthropic API spend today is $${usd}`, `Over the $${cfg.daily_crit_usd} critical line before the day is out (UTC day). On 23 Sep a day like this was a stolen key.\nCheck the Console usage page by key; archive any key you cannot explain; the wallet is the only brake until workspace caps are set.`, { level: "critical", cooldownH: 6 });
    else if (usd >= cfg.daily_warn_usd) await page("spend:daily-warn", "⚠️", `Anthropic API spend today is $${usd}`, `Over the $${cfg.daily_warn_usd} warning line (normal days are under $0.50). Check the Console usage page by key.`, { cooldownH: 12 });
    return { status: "ok", today_usd: usd, yesterday_usd: yday, warn: cfg.daily_warn_usd, crit: cfg.daily_crit_usd };
  } catch (e) { return { status: `cost_report failed: ${String(e.message || e).slice(0, 60)}` }; }
}
async function checkTokens() {
  const cfg = { github: ["edge_cc_pat", "readonly_pat"], expiry_warn_days: 14, ...(meta.tokens || {}) };
  const out = {};
  for (const t of cfg.github) {
    const tok = await vault("github", t);
    if (!tok) { out[t] = "missing"; continue; }
    try {
      const r = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${tok}`, "User-Agent": "intrusion-watch" }, signal: AbortSignal.timeout(10000) });
      const exp = r.headers.get("github-authentication-token-expiration");
      if (r.status === 401) { out[t] = "DEAD"; await page(`token:github:${t}`, "🚨", `GitHub token ${t} is dead (401)`, "Every hand that clones or opens PRs with it is failing silently. Mint a replacement, vault it, install it on the box, restart the hand, prove a clone.", { level: "critical", cooldownH: 24 }); continue; }
      if (r.status !== 200) { out[t] = `http ${r.status}`; continue; }
      const days = exp ? Math.round((new Date(exp) - NOW) / 864e5) : null;
      out[t] = days === null ? "ok (no expiry)" : `ok (${days}d left)`;
      if (days !== null && days <= cfg.expiry_warn_days) await page(`token:github:${t}:expiry`, "⚠️", `GitHub token ${t} expires in ${days} day(s)`, "Mint the replacement now and install it on the box before it lapses.", { cooldownH: 48 });
    } catch (e) { out[t] = `check failed: ${String(e.message || e).slice(0, 40)}`; }
  }
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
  const pulls = hosts.reduce((s, h) => s + (state.acc[h].pulls || 0), 0);
  lines.push(`sudo ${sudo} · internet bots bounced off public SSH ${failed} · Tailscale-SSH sessions ${ts} · unknown logins ${hosts.reduce((s, h) => s + state.acc[h].unknown, 0)}${pulls ? ` · judge's own pulls ${pulls} (not counted above)` : ""}`);
  const ch = hosts.flatMap((h) => state.acc[h].changes.map((c) => `${h} ${c}`));
  lines.push(`Changes: ${ch.length ? ch.slice(0, 5).join(" · ") : "none"}`);
  const t = state.last_tailnet || {};
  lines.push(`Tailnet: ${t.n ?? "?"} devices (${t.online ?? "?"} online)${t.sshNodes?.length ? ` · SSH-server on: ${t.sshNodes.join(",")}` : ""}${t.stale?.length ? ` · stale >14d: ${t.stale.length}` : ""}`);
  lines.push(`GitHub: ${state.last_github?.status || "?"}${state.last_github?.keys != null ? ` (${state.last_github.keys} keys, ${state.last_github.public} public repos)` : ""} · Hetzner: ${state.last_hetzner?.status || "?"}${state.last_hetzner?.servers != null ? ` (${state.last_hetzner.servers} servers)` : ""}`);
  const b = state.last_brain || {};
  const vr = Object.entries(state.daily_vault_reads || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`);
  lines.push(`Vault reads 24h: ${vr.length ? vr.join(" · ") : "none logged"}${state.last_vault?.learning ? " (learning week — new key/secret pairs noted, not paged)" : ""}`);
  const ln = state.last_lanes?.lanes || {};
  lines.push(`Lanes ${state.last_lanes?.window_h || 48}h (done/total): ${Object.entries(ln).map(([k, v]) => `${k.replace("run_dev_task", "dev").replace("run_task", "hands")} ${v}`).join(" · ") || "no jobs"} · self-repair last: ${state.last_lanes?.self_repair_last || "?"}`);
  { const d = state.last_doors; lines.push(`Doors: ${d ? `${d.up}/${d.total} up` : "?"}${d?.down?.length ? ` · DOWN: ${d.down.map((k) => `${k} (${d.doors[k].replace("DOWN ", "")})`).join(", ")}` : ""}`); }
  lines.push(`API spend today: ${state.last_spend?.today_usd != null ? "$" + state.last_spend.today_usd : state.last_spend?.status || "?"} (warn $${state.last_spend?.warn ?? 5} · crit $${state.last_spend?.crit ?? 20}) · GitHub tokens: ${Object.entries(state.last_tokens || {}).map(([k, v]) => `${k} ${v}`).join(", ") || "?"}`);
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
// Public doors (5 Oct 2026). naca-mcp.neotodak.com and the GitHub webhook door died with Hermes on 25 Sep
// and nobody noticed for 11 days: the back ends on EdgeXpert were fine, the front doors were gone. Probe
// each door over the public internet every tick. "Up" = answers HTTPS with one of the expected statuses
// (a 401 from a PIN gate or a 400 from the webhook's header check is the door working). Two failed ticks in
// a row (≈20 min) page once per 12 h with what to check; recovery shows in the daily line. Override the list
// with registry meta.doors = [{name,url,method?,ok?,fix?}] and thresholds with meta.doors_cfg.
const DEFAULT_DOORS = [
  { name: "naca-mcp (claude.ai Siti tools)", url: "https://naca-mcp.neotodak.com/.well-known/oauth-authorization-server", ok: [200], fix: "neo-twin Caddy → EdgeXpert :3906 (pm2 naca-mcp-bridge-http)" },
  { name: "github webhook", url: "https://naca.neotodak.com/api/webhooks/github", method: "POST", ok: [400, 401], fix: "neo-twin Caddy → EdgeXpert :3100 (pm2 naca-backend); 13 repos deliver here, merges stop deploying while it is down" },
  { name: "cockpit (cc.neotodak.com)", url: "https://cc.neotodak.com/baca/", ok: [200, 302, 401], fix: "neo-twin Caddy → EdgeXpert :3620 (pm2 cockpit-door)" },
  { name: "twin-api", url: "https://twin-api.neotodak.com/", ok: [200, 404], fix: "pm2 twin-relay on neo-twin :3210 (user neotwin)" },
];
async function probeDoor(d) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), (d.timeout_s || 20) * 1000);
  const t0 = Date.now();
  try {
    const r = await fetch(d.url, { method: d.method || "GET", signal: ctl.signal, redirect: "manual", headers: { "user-agent": `${ME}/door-probe`, "content-type": "application/json" }, body: d.method === "POST" ? "{}" : undefined });
    return { up: (d.ok || [200]).includes(r.status), status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { up: false, status: 0, ms: Date.now() - t0, err: String(e?.cause?.code || e?.name || e?.message || e).slice(0, 60) };
  } finally { clearTimeout(timer); }
}
async function checkDoors() {
  const doors = Array.isArray(meta.doors) && meta.doors.length ? meta.doors : DEFAULT_DOORS;
  const cfg = { fail_ticks: 2, cooldown_h: 12, ...(meta.doors_cfg || {}) };
  state.doors ||= {};
  const out = {};
  for (const d of doors) {
    const r = await probeDoor(d);
    const st = (state.doors[d.name] ||= { fails: 0, last_ok_at: null, last_status: null });
    st.last_status = `${r.status || r.err || "?"} ${r.ms}ms`;
    if (r.up) {
      if (st.fails >= cfg.fail_ticks) st.recovered_at = new Date().toISOString();
      st.fails = 0; st.last_ok_at = new Date().toISOString();
    } else {
      st.fails++;
      if (st.fails >= cfg.fail_ticks) {
        await page(`door:${d.name}`, "🚪", `public door DOWN: ${d.name}`,
          `${d.url} has failed ${st.fails} checks in a row (last answer: ${st.last_status}).\n` +
          `Last seen up: ${st.last_ok_at ? st.last_ok_at.slice(0, 16).replace("T", " ") + "Z" : "never since the judge started watching"}.\n` +
          `What to check: ${d.fix || "the Caddy site on neo-twin and the back end on EdgeXpert"}. The 25 Sep lesson: a dead front door looks like silence, not an error.`,
          { cooldownH: cfg.cooldown_h, host: "neo-twin" });
      }
    }
    out[d.name] = r.up ? "up" : `DOWN (${st.last_status})`;
  }
  const down = Object.entries(out).filter(([, v]) => v !== "up").map(([k]) => k);
  return { status: down.length ? `${down.length} down` : "ok", up: doors.length - down.length, total: doors.length, doors: out, down };
}
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
    state.last_vault = await checkVaultReads();
    state.last_lanes = await checkLanes();
    state.last_spend = await checkSpend();
    state.last_tokens = await checkTokens();
    state.last_doors = await checkDoors();
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
    state.acc = {}; state.daily_pages = 0; state.daily_vault_writes = 0; state.daily_vault_reads = {}; state.selftest_ok = null; state.last_daily = new Date().toISOString();
  }
  if (mode === "weekly") {
    const text = weeklyText(sent);
    if (DRY) console.log(text); else { const r = await sendWA(text); if (!r.ok) { await queueWA(text); await sendEmail("🧭 NACA weekly security routine", text); } console.log(`[${ME}] weekly routine ${r.ok ? "sent" : "queued"}`); }
    state.last_weekly = new Date().toISOString();
  }
  if (overflow.length) {
    const text = `${header("📦", `${overflow.length} more alert(s) this cycle, folded`)}\n${fmtList(overflow, 15)}\n(burst cap ${PAGE_CAP}/run keeps Siti's number under WhatsApp's spam radar; ask me for details)`;
    const r = await sendWA(text); if (!r.ok) await queueWA(text);
    console.log(`[${ME}] folded ${overflow.length} warning page(s) into one`);
  }
  state.last_run = new Date().toISOString();
  state.last_notes = notes.slice(0, 20);
  if (!DRY) {
    const { error } = await brain.from("agent_registry").update({ meta: { ...meta, state } }).eq("agent_name", ME);
    if (error) console.error(`[${ME}] state save failed: ${error.message}`);
    const status = sent.silent.length || pages.some((p) => !p.dry && p.level === "critical") ? "degraded" : "ok";
    await brain.from("agent_heartbeats").upsert({ agent_name: ME, status, reported_at: new Date().toISOString(), meta: { version: VERSION, doors: state.last_doors?.status, doors_down: state.last_doors?.down, mode, sentinels: sent, pages: pages.length, selftests, notes: notes.slice(0, 10), github: state.last_github?.status, hetzner: state.last_hetzner?.status, tailnet: state.last_tailnet?.n, siti_line: state.last_brain?.siti_line, vault: { status: state.last_vault?.status, reads: state.last_vault?.reads, learning: state.last_vault?.learning }, lanes: state.last_lanes, spend: state.last_spend, tokens: state.last_tokens, last_daily: state.last_daily } }, { onConflict: "agent_name" });
  }
  console.log(`[${new Date().toISOString()}] ${ME} ${mode}: sentinels ${sent.fresh}/${sent.total}${sent.silent.length ? ` silent=${sent.silent.join(",")}` : ""}${sent.pending?.length ? ` pending=${sent.pending.join(",")}` : ""} pages=${pages.length}${selftests ? ` (selftest ${selftests})` : ""} notes=${notes.length}${notes.length ? " → " + notes.slice(0, DRY ? 30 : 4).join(" | ") : ""}`);
}
await main();
