#!/usr/bin/env node
// idle-agent-clock — "use it or archive it" for fleet parts that sit idle.
//
// WHY (NACA audit 2026-09-23, fix 4): 53 agents were registered active, but several did
// nothing — neo-twin had sent 0 replies since May, creative-router had no real traffic,
// dev-agent ran 3 jobs in 30 days, the Codex cheap lane ran 2. Idle parts still cost
// upkeep (monitoring, fixes, session time). Each one now gets a dated clock.
//
// WHAT: registry-driven (no agent list here). Any agent_registry row whose meta carries
//   probation: { subject, since, review_on, reason, signal }
// is on the clock. `signal` says how use is counted, from records the fleet already keeps:
//   { kind: "commands",        to_agent }                  agent_commands sent to it
//   { kind: "commands_engine", engine }                    hands jobs with payload.engine
//   { kind: "table_count",     table, time_col }           rows written since `since`
//   { kind: "heartbeat_field", agent, field }              a counter in its heartbeat meta
//                                                          (daily max is remembered, since it
//                                                          resets when the process restarts)
// Every run writes meta.probation.{uses, last_checked}. On or after review_on it sends
// Neo ONE WhatsApp line per item (via Siti's queue) with the count and a plain
// recommendation, then records meta.probation.reported_at so it never repeats.
// Deciding keep/archive stays with Neo; a Claude Code session carries it out.
//
// Usage: node tools/idle-agent-clock.mjs [--dry] [--report-now]
// Env: NEO_BRAIN_URL, NEO_BRAIN_SERVICE_ROLE_KEY (CTK .env). Daily cron on EdgeXpert.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
for (const p of [join(HERE, "..", ".env")]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const URL_ = (process.env.NEO_BRAIN_URL || "").replace(/\/$/, "");
const KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY || "";
const NEO_PHONE = process.env.NEO_PHONE || "60177519610";
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const REPORT_NOW = args.includes("--report-now");

async function rest(path, opts = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "count=exact", ...(opts.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${opts.method || "GET"} ${path.split("?")[0]} → ${r.status}: ${t.slice(0, 160)}`);
  return { json: t ? JSON.parse(t) : null, count: Number((r.headers.get("content-range") || "").split("/")[1]) };
}

/** The PostgREST query that counts one signal since `sinceIso`. Pure — tested. */
export function signalQuery(signal, sinceIso) {
  const since = encodeURIComponent(sinceIso);
  switch (signal?.kind) {
    case "commands":
      return `agent_commands?select=id&to_agent=eq.${encodeURIComponent(signal.to_agent)}&created_at=gte.${since}&limit=1`;
    case "commands_engine":
      return `agent_commands?select=id&payload->>engine=eq.${encodeURIComponent(signal.engine)}&created_at=gte.${since}&limit=1`;
    case "table_count":
      return `${encodeURIComponent(signal.table)}?select=*&${encodeURIComponent(signal.time_col || "created_at")}=gte.${since}&limit=1`;
    case "heartbeat_field":
      return `agent_heartbeats?select=meta&agent_name=eq.${encodeURIComponent(signal.agent)}&limit=1`;
    default:
      return null;
  }
}

/** Heartbeat counters reset on restart: keep the largest value ever seen. */
export function heartbeatUses(prevUses, meta, field) {
  const now = Number(meta?.[field]);
  return Math.max(Number(prevUses) || 0, Number.isFinite(now) ? now : 0);
}

export function isDue(probation, todayIso) {
  return Boolean(probation?.review_on) && todayIso.slice(0, 10) >= probation.review_on && !probation.reported_at;
}

export function verdictLine(agent, p) {
  const uses = Number(p.uses) || 0;
  const what = p.subject || agent;
  const rec = uses === 0 ? "not used once → suggest ARCHIVE"
    : uses < 5 ? `used ${uses}× → barely used, suggest archive unless you still want it`
    : `used ${uses}× → in use, suggest KEEP`;
  return `• ${what}: ${rec}`;
}

async function countSignal(row) {
  const p = row.meta.probation;
  const q = signalQuery(p.signal, new Date(`${p.since}T00:00:00+08:00`).toISOString());
  if (!q) return { uses: p.uses ?? null, error: `unknown signal ${JSON.stringify(p.signal)}` };
  const { json, count } = await rest(q);
  if (p.signal.kind === "heartbeat_field") return { uses: heartbeatUses(p.uses, json?.[0]?.meta, p.signal.field) };
  return { uses: Number.isFinite(count) ? count : null };
}

async function notifyNeo(text) {
  await rest("agent_commands", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ from_agent: "idle-agent-clock", to_agent: "siti", command: "send_whatsapp_notification",
      priority: 3, payload: { to: NEO_PHONE, message: text } }),
  });
}

async function main() {
  if (!URL_ || !KEY) { console.error("need NEO_BRAIN_URL / NEO_BRAIN_SERVICE_ROLE_KEY"); process.exit(1); }
  const { json: rows } = await rest("agent_registry?select=agent_name,meta&meta->probation=not.is.null");
  const today = new Date(Date.now() + 8 * 3600_000).toISOString();          // MYT date
  const due = [];
  for (const row of rows || []) {
    const p = row.meta.probation;
    let res;
    try { res = await countSignal(row); } catch (e) { res = { uses: p.uses ?? null, error: e.message }; }
    const next = { ...p, uses: res.uses, last_checked: new Date().toISOString(), ...(res.error ? { last_error: res.error } : {}) };
    console.log(`${row.agent_name.padEnd(18)} ${String(p.subject || "").slice(0, 34).padEnd(34)} uses=${res.uses ?? "?"} review_on=${p.review_on}${res.error ? ` ERR ${res.error}` : ""}`);
    if (isDue(next, today) || (REPORT_NOW && !next.reported_at)) due.push({ agent: row.agent_name, p: next });
    if (!DRY) {
      await rest(`agent_registry?agent_name=eq.${encodeURIComponent(row.agent_name)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ meta: { ...row.meta, probation: next } }),
      });
    }
  }
  if (!due.length) { console.log("nothing due"); return; }
  const msg = ["🕰️ Use-it-or-archive — 30-day clock is up", ...due.map((d) => verdictLine(d.agent, d.p)),
    "Tell Claude Code which to keep; the rest get archived."].join("\n");
  console.log(`\n${msg}`);
  if (DRY) return;
  await notifyNeo(msg);
  for (const d of due) {
    const { json } = await rest(`agent_registry?select=meta&agent_name=eq.${encodeURIComponent(d.agent)}`);
    const meta = json?.[0]?.meta || {};
    await rest(`agent_registry?agent_name=eq.${encodeURIComponent(d.agent)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ meta: { ...meta, probation: { ...meta.probation, reported_at: new Date().toISOString() } } }),
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message); process.exit(1); });
