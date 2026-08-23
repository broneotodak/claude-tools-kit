#!/usr/bin/env node
// kb-reconcile — the KB's anti-drift monitor. Answers "has the maintained
// truth drifted from reality?" by three checks, then reports drift to
// neo-brain (category=kb_reconcile) and, on findings, to Neo via Siti.
//
//   1. STALE     — KB pages whose verified_at is older than STALE_DAYS.
//   2. MISSING   — active, non-exempt agents in agent_registry that no KB
//                  page mentions by name (new agent added, KB not updated).
//   3. GHOST     — agent names the KB still presents as live but which are
//                  archived in the registry (retired agent, KB not updated).
//
// Read-only against the registry + KB files. Cron (EdgeXpert) weekly.
//   node tools/kb-reconcile.mjs [--dir ~/Projects/neo-kb] [--days 45] [--quiet]

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
for (const p of [join(HERE, "..", ".env")]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const URL = process.env.NEO_BRAIN_URL?.replace(/\/$/, "");
const KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("need NEO_BRAIN_URL / NEO_BRAIN_SERVICE_ROLE_KEY"); process.exit(1); }

const args = process.argv.slice(2);
const QUIET = args.includes("--quiet");
const di = args.indexOf("--dir");
const KB_DIR = (di >= 0 ? args[di + 1] : join(process.env.HOME, "Projects", "neo-kb")).replace(/^~/, process.env.HOME);
const dd = args.indexOf("--days");
const STALE_DAYS = dd >= 0 ? parseInt(args[dd + 1], 10) : 45;
const NEO_JID = "60177519610@s.whatsapp.net";
const SKIP = new Set(["README.md", "INDEX.md"]);

function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    if (n.startsWith(".")) continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (n.endsWith(".md") && !SKIP.has(n)) out.push(f);
  }
  return out;
}

async function brain(path) {
  const r = await fetch(`${URL}/rest/v1${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`brain ${path} → ${r.status}`);
  return r.json();
}

// --- load KB ---
const files = walk(KB_DIR);
let kbText = "";
const stale = [];
const now = Date.now();
for (const f of files) {
  const rel = relative(KB_DIR, f);
  const raw = readFileSync(f, "utf-8");
  kbText += "\n" + raw;
  const v = raw.match(/^verified_at:\s*([0-9-]+)/m)?.[1];
  if (v) {
    const age = Math.round((now - new Date(v).getTime()) / 864e5);
    if (age > STALE_DAYS) stale.push({ page: rel, verified_at: v, ageDays: age });
  } else if (!rel.startsWith("archive/")) {
    stale.push({ page: rel, verified_at: "MISSING", ageDays: null });
  }
}

// --- registry reality ---
const reg = await brain(
  "/agent_registry?select=agent_name,status,archived_at,meta,agent_type&order=agent_name",
);
const active = reg.filter((r) => !r.archived_at && r.status !== "archived" && r.meta?.heartbeat_exempt !== true && r.agent_type !== "machine");
const archived = reg.filter((r) => r.archived_at || r.status === "archived");

// word-boundary mention check
const rx = (name) => new RegExp(`(^|[^a-z0-9-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9-]|$)`, "i");
const mentions = (name) => rx(name).test(kbText);
const missing = active.filter((r) => !mentions(r.agent_name)).map((r) => r.agent_name);

// GHOST is inherently noisy — the KB legitimately documents retired things in
// its Retired sections, and some archived rows are hosts/superseded stems.
// Only flag an archived agent that the KB presents as LIVE:
const RETIRE_WORDS = /retir|archiv|delet|decommission|obsolete|\bdead\b|\bgone\b|history|supersed|\bold\b|paused|🪦/i;
const activeStems = active.map((a) => a.agent_name);
const hostTokens = new Set(active.flatMap((a) => (a.host || "").toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)));
const linesFor = (name) => kbText.split("\n").filter((l) => rx(name).test(l));
const ghosts = archived
  .filter((r) => !["physical", "machine", "interface"].includes(r.agent_type)) // hosts/devices aren't "live agents"
  .filter((r) => !hostTokens.has(r.agent_name.toLowerCase())) // name is a live host (edgexpert)
  .filter((r) => !activeStems.some((a) => a !== r.agent_name && a.startsWith(r.agent_name + "-"))) // stem of a live agent (siti→siti-router)
  .filter((r) => {
    const ls = linesFor(r.agent_name);
    return ls.length > 0 && ls.every((l) => !RETIRE_WORDS.test(l)); // every mention is in LIVE context
  })
  .map((r) => r.agent_name);

const findings = [];
if (stale.length) findings.push(`⏳ STALE (>${STALE_DAYS}d): ${stale.map((s) => `${s.page}[${s.verified_at}]`).join(", ")}`);
if (missing.length) findings.push(`➕ MISSING from KB (active agents): ${missing.join(", ")}`);
if (ghosts.length) findings.push(`👻 GHOST in KB (archived but still shown live): ${ghosts.join(", ")}`);

if (!QUIET) {
  console.log(`kb-reconcile · ${files.length} pages · ${active.length} active agents`);
  if (!findings.length) console.log("✓ KB in sync with reality — no drift.");
  else findings.forEach((f) => console.log("  " + f));
}

// --- record + alert ---
async function post(path, body, headers = {}) {
  return fetch(`${URL}/rest/v1${path}`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
async function embed(text) {
  const g = process.env.GEMINI_API_KEY;
  if (!g) return null;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${g}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 2048) }] }, outputDimensionality: 768 }) });
  return r.ok ? (await r.json())?.embedding?.values : null;
}

if (findings.length) {
  const summary = `[kb-reconcile] KB drift: ${findings.join(" · ")}`;
  const vec = await embed(summary);
  await post("/memories", {
    content: summary, embedding: vec ? `[${vec.join(",")}]` : null,
    category: "kb_reconcile", memory_type: "event", importance: 6, visibility: "internal",
    source: "kb-reconcile", metadata: { stale, missing, ghosts, checked: files.length },
  }, { Prefer: "return=minimal" }).catch((e) => console.error("memory save:", e.message));

  // WA via Hermes lane (routine nag, mutable) — through agent_commands so it works headless
  const wa = `🗂️ NACA · KB drift\n[~ kb-reconcile]\n\n${findings.join("\n")}\n\nFix: edit the neo-kb page (auto-syncs).`;
  await post("/agent_commands", { to_agent: "hermes", command: "send_whatsapp_notification", status: "pending", payload: { toJid: NEO_JID, text: wa } }, { Prefer: "return=minimal" }).catch((e) => console.error("WA enqueue:", e.message));
}
process.exit(0);
