#!/usr/bin/env node
// NACA credential leak-watch v2 — daily scan of broneotodak's GitHub for
// known credential patterns. Alerts Neo via Siti + logs to memories.
//
// v2 (2026-08-22): re-homed to EdgeXpert after the original died with the
// nclaw VPS (2026-07-28). gh CLI calls ported to the GitHub REST API so the
// box needs no extra tooling; GH token fetched from the vault at runtime;
// Siti send updated to the EdgeXpert endpoint (127.0.0.1:3501, Bearer).
//
// Patterns: Supabase service-role keys, Anthropic api/admin/oauth keys,
// GitHub classic PATs, Google OAuth client secrets.
// Placeholder filter + strict regex re-validation against file content.
// Dedupe via memories(category=vps_credential_leak) over 7 days.
//
// Cron (EdgeXpert, user neo):  0 8 * * *  (8am UTC = 4pm MYT)
//   cd /home/neo/claude-tools-kit && node tools/credential-leak-watch.js

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const OWNER = "broneotodak";
const DEDUPE_DAYS = 7;
const PATTERNS = [
  { name: "supabase_service_role", search: "sb_secret_", strict: /sb_secret_[A-Za-z0-9_-]{20,}/g },
  { name: "anthropic_api_key", search: "sk-ant-api03-", strict: /sk-ant-api03-[A-Za-z0-9_-]{40,}/g },
  { name: "anthropic_admin_key", search: "sk-ant-admin01-", strict: /sk-ant-admin01-[A-Za-z0-9_-]{40,}/g },
  { name: "anthropic_oauth_token", search: "sk-ant-oat01-", strict: /sk-ant-oat01-[A-Za-z0-9_-]{40,}/g },
  { name: "github_classic_pat", search: "ghp_", strict: /ghp_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g },
  { name: "google_oauth_secret", search: "GOCSPX-", strict: /GOCSPX-[A-Za-z0-9_-]{20,}/g },
];
const PLACEHOLDER_MARKERS = [
  /_here\b/i, /your[_-]?[a-z]/i, /<your/i, /\.\.\.$/, /xxx+/i, /placeholder/i,
  /example/i, /redacted/i, /\bREPLACE\b/i, /\bMASKED\b/i,
];

const NEO_SELF = "00000000-0000-0000-0000-000000000001";
const NEO_JID = process.env.NEO_JID || "60177519610@s.whatsapp.net";
const SITI_URL = process.env.SITI_SEND_URL || "http://127.0.0.1:3501/send";
const SITI_ENV = process.env.SITI_ENV_PATH || "/home/neo/naca/siti/.env";

// load CTK .env relative to this script (works from any cwd)
const HERE = dirname(fileURLToPath(import.meta.url));
for (const p of [join(HERE, "..", ".env")]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const BRAIN_URL = process.env.NEO_BRAIN_URL?.replace(/\/$/, "");
const SR_KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!BRAIN_URL || !SR_KEY) {
  console.error("missing NEO_BRAIN_URL / NEO_BRAIN_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function brain(path, opts = {}) {
  const r = await fetch(`${BRAIN_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SR_KEY,
      Authorization: `Bearer ${SR_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`brain ${path} → ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function getVaultCred(service, type) {
  try {
    const rows = await brain(`/rpc/get_credential`, {
      method: "POST",
      body: JSON.stringify({ p_owner_id: NEO_SELF, p_service: service, p_credential_type: type }),
    });
    return rows?.[0]?.credential_value || null;
  } catch {
    return null;
  }
}

// --- GitHub REST ---
let GH_TOKEN = process.env.GH_TOKEN || null;
async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (r.status === 403 || r.status === 422) {
    const body = (await r.text()).slice(0, 140);
    throw new Error(`github ${path.split("?")[0]} → ${r.status}: ${body}`);
  }
  if (!r.ok) throw new Error(`github ${path.split("?")[0]} → ${r.status}`);
  return r.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// code-search API allows ~10 req/min — throttle + one retry on rate-limit
async function searchCode(term) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const q = encodeURIComponent(`"${term}" user:${OWNER}`);
      const res = await gh(`/search/code?q=${q}&per_page=30`);
      return (res.items || []).map((i) => ({ repo: i.repository.full_name, path: i.path, url: i.html_url }));
    } catch (e) {
      if (/rate limit/i.test(e.message) && attempt === 0) {
        console.log(`rate-limited on "${term}" — waiting 65s`);
        await sleep(65_000);
        continue;
      }
      console.error(`search "${term}" failed: ${e.message?.slice(0, 120)}`);
      return null; // null = search itself failed (report), [] = clean
    }
  }
  return null;
}

async function fileContent(repo, path) {
  try {
    const res = await gh(`/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`);
    return Buffer.from(res.content || "", "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function realHits(content, strict) {
  const hits = [];
  for (const m of content.matchAll(strict)) {
    const line = content.slice(Math.max(0, content.lastIndexOf("\n", m.index) + 1), content.indexOf("\n", m.index) === -1 ? undefined : content.indexOf("\n", m.index));
    if (PLACEHOLDER_MARKERS.some((p) => p.test(line))) continue;
    hits.push(m[0].slice(0, 18) + "…");
  }
  return hits;
}

async function isDuped(key) {
  const since = new Date(Date.now() - DEDUPE_DAYS * 864e5).toISOString();
  const rows = await brain(
    `/memories?select=id&category=eq.vps_credential_leak&created_at=gte.${since}&content=ilike.${encodeURIComponent("%" + key + "%")}&limit=1`,
  );
  return rows.length > 0;
}

let GEMINI_KEY = null;
async function embed(text) {
  const key = GEMINI_KEY || process.env.GEMINI_API_KEY || (GEMINI_KEY = await getVaultCred("google_gemini", "api_key"));
  if (!key) throw new Error("no GEMINI_API_KEY (env or vault google_gemini/api_key) for embedding");
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 2048) }] }, outputDimensionality: 768 }),
    },
  );
  if (!r.ok) throw new Error(`gemini embed ${r.status}`);
  return (await r.json())?.embedding?.values || null;
}

async function saveMemory(content) {
  const vec = await embed(content); // brain rejects NULL-embedding knowledge writes
  await brain(`/memories`, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      content,
      embedding: vec ? `[${vec.join(",")}]` : null,
      category: "vps_credential_leak",
      memory_type: "event",
      importance: 8,
      visibility: "internal",
      source: "credential-leak-watch",
      metadata: { monitor: "credential-leak-watch", host: "edgexpert" },
    }),
  });
}

async function alertSiti(text) {
  try {
    const env = existsSync(SITI_ENV) ? readFileSync(SITI_ENV, "utf-8") : "";
    const token = env.match(/^SEND_API_TOKEN=(.+)$/m)?.[1]?.trim();
    if (!token) return console.error("no SEND_API_TOKEN — WA alert skipped");
    const r = await fetch(SITI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: "send", toJid: NEO_JID, text }),
    });
    console.log(`WA alert → ${r.status}`);
  } catch (e) {
    console.error(`WA alert failed: ${e.message}`);
  }
}

// === MAIN ===
const findings = [];
const failures = [];

GH_TOKEN = GH_TOKEN || (await getVaultCred("github", "personal_access_token"));
if (!GH_TOKEN) {
  console.error("no GitHub token (env GH_TOKEN or vault github/personal_access_token)");
  process.exit(1);
}
// fine-grained PATs sometimes lack code-search access — probe once, fall back to the classic PAT
if ((await searchCode("sb_secret_")) === null) {
  const classic = await getVaultCred("github", "pat_legacy_2025_06_ghp");
  if (classic) {
    console.log("primary token can't code-search — falling back to classic PAT");
    GH_TOKEN = classic;
  }
}

for (const p of PATTERNS) {
  await sleep(8_000); // stay under the 10/min code-search limit
  const items = await searchCode(p.search);
  if (items === null) {
    failures.push(p.name);
    continue;
  }
  for (const item of items) {
    const content = await fileContent(item.repo, item.path);
    const hits = realHits(content, p.strict);
    if (!hits.length) continue;
    const key = `${item.repo}/${item.path}`;
    if (await isDuped(key)) {
      console.log(`dupe (7d): ${key}`);
      continue;
    }
    findings.push({ pattern: p.name, ...item, hits });
  }
}

if (findings.length) {
  const lines = findings.map((f) => `• ${f.repo}/${f.path} — ${f.pattern} (${f.hits.join(", ")})`);
  const msg = `🔐 NACA · credential leak\n[~ credential-leak-watch on EdgeXpert]\n\n${lines.join("\n")}\n\nRotate + scrub, then commit removal.`;
  console.log(msg);
  for (const f of findings) {
    try {
      await saveMemory(
        `[credential-leak-watch] LEAK: ${f.repo}/${f.path} pattern=${f.pattern} hits=${f.hits.join(",")} url=${f.url}`,
      );
    } catch (e) {
      console.error(`memory save failed (alert still goes out): ${e.message?.slice(0, 160)}`);
    }
  }
  await alertSiti(msg);
} else {
  console.log(`clean — ${PATTERNS.length - failures.length}/${PATTERNS.length} patterns scanned, no real hits`);
}
if (failures.length) console.error(`pattern searches that FAILED (not clean): ${failures.join(", ")}`);
process.exit(failures.length && !findings.length ? 2 : 0);
