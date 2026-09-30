#!/usr/bin/env node
// NACA credential leak-watch — daily scan of broneotodak's GitHub for
// known credential patterns. Alerts via Siti + logs to memories.
//
// Patterns: Supabase service-role keys (sb_secret_*), Anthropic API keys
// (sk-ant-api03-*), Anthropic admin keys (sk-ant-admin01-*).
//
// Filters out documentation placeholders (..._here, your_*, sb_secret_..., etc).
// Dedupes via memories(category=vps_credential_leak) over 7 days.
//
// Built-in deps + gh CLI only. Runs as openclaw on Hetzner (gh authed there).
// Cron: 0 8 * * *  (daily 8am UTC = 4pm Asia/Kuala_Lumpur)

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";

// === CONFIG ===
const OWNER = "broneotodak";
const DEDUPE_DAYS = 7;
const PATTERNS = [
  {
    name: "supabase_service_role",
    search: "sb_secret_",
    strict: /sb_secret_[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: "anthropic_api_key",
    search: "sk-ant-api03-",
    strict: /sk-ant-api03-[A-Za-z0-9_-]{40,}/g,
  },
  {
    name: "anthropic_admin_key",
    search: "sk-ant-admin01-",
    strict: /sk-ant-admin01-[A-Za-z0-9_-]{40,}/g,
  },
];
const PLACEHOLDER_MARKERS = [
  /_here\b/i, /your[_-]?[a-z]/i, /<your/i, /\.\.\.$/, /xxx+/i, /placeholder/i,
  /example/i, /redacted/i, /\bREPLACE\b/i,
];

const SITI_URL = process.env.SITI_SEND_URL || "http://localhost:3800/api/send";
const SITI_PIN = process.env.SITI_PIN || "404282";
const NEO_JID = process.env.NEO_JID || "60177519610@s.whatsapp.net";

// Load env
function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv(process.env.HOME + "/monitors/.env");

const BRAIN_URL = process.env.NEO_BRAIN_URL;
const SR_KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
if (!BRAIN_URL || !SR_KEY) {
  console.error("missing NEO_BRAIN_URL / NEO_BRAIN_SERVICE_ROLE_KEY");
  process.exit(1);
}

// === GH SEARCH ===
function ghSearchCode(query) {
  try {
    const out = execSync(
      `gh search code ${JSON.stringify(query)} --owner ${OWNER} --limit 30 --json repository,path,url`,
      { encoding: "utf-8", timeout: 30000 }
    );
    return JSON.parse(out);
  } catch (e) {
    console.error(`gh search failed for "${query}": ${e.message?.slice(0, 100)}`);
    return [];
  }
}

function ghGetFile(repo, path) {
  try {
    // repo is "owner/name" form; path may have slashes, encode safely
    const out = execSync(
      `gh api ${JSON.stringify(`repos/${repo}/contents/${path}`)} --jq .content`,
      { encoding: "utf-8", timeout: 15000 }
    ).trim();
    return Buffer.from(out, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

// === BRAIN ===
async function brain(method, path, body) {
  const r = await fetch(`${BRAIN_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SR_KEY,
      Authorization: `Bearer ${SR_KEY}`,
      "Content-Type": "application/json",
      ...(method !== "GET" ? { Prefer: "return=representation" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function recentlyAlerted(signalKey) {
  const cutoff = new Date(Date.now() - DEDUPE_DAYS * 86400000).toISOString();
  const path = `/memories?category=eq.vps_credential_leak&created_at=gt.${cutoff}&metadata->>signal_key=eq.${encodeURIComponent(signalKey)}&select=id&limit=1`;
  const rows = await brain("GET", path);
  return rows && rows.length > 0;
}

async function logFinding(payload) {
  await brain("POST", "/memories", {
    content: `Credential leak detected on GitHub: ${payload.pattern} in ${payload.repo}/${payload.path}`,
    category: "vps_credential_leak",
    memory_type: "operational",
    importance: 8,
    visibility: "internal",
    source: "supervisor",
    metadata: { signal_key: `${payload.pattern}/${payload.repo}/${payload.path}`, ...payload },
  });
}

async function sendSitiAlert(text) {
  try {
    const r = await fetch(SITI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PIN": SITI_PIN },
      body: JSON.stringify({ to: NEO_JID, text }),
    });
    if (!r.ok) console.error(`siti alert ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } catch (e) { console.error("siti send threw:", e.message); }
}

// === MAIN ===
function looksLikePlaceholder(matchedString) {
  return PLACEHOLDER_MARKERS.some((rx) => rx.test(matchedString));
}

async function main() {
  console.log(`[leak-watch] start ${new Date().toISOString()}`);
  let alerts = 0, scanned = 0, placeholders = 0;

  for (const p of PATTERNS) {
    const hits = ghSearchCode(p.search);
    for (const hit of hits) {
      scanned++;
      const repo = hit.repository?.nameWithOwner;
      const path = hit.path;
      if (!repo || !path) continue;

      // Fetch file content and re-validate with strict regex
      const content = ghGetFile(repo, path);
      if (!content) {
        console.log(`[leak-watch] skip ${repo}/${path} — could not fetch content`);
        continue;
      }

      // Find all strict matches in the file
      const matches = [...content.matchAll(p.strict)].map((m) => m[0]);
      const realMatches = matches.filter((s) => !looksLikePlaceholder(s));

      if (matches.length > 0 && realMatches.length === 0) {
        placeholders++;
        console.log(`[leak-watch] placeholder ${repo}/${path}: ${matches[0].slice(0, 30)}...`);
        continue;
      }
      if (realMatches.length === 0) continue;

      const signalKey = `${p.name}/${repo}/${path}`;
      if (await recentlyAlerted(signalKey)) {
        console.log(`[leak-watch] dedupe ${signalKey}`);
        continue;
      }

      const sample = realMatches[0];
      const masked = sample.slice(0, 18) + "..." + sample.slice(-4);
      const findings = {
        pattern: p.name,
        repo,
        path,
        url: hit.url,
        match_count: realMatches.length,
        sample_masked: masked,
      };
      await logFinding(findings);
      const friendlyPattern = (
        p.name === "supabase_service_role" ? "a Supabase service-role key (full database access)" :
        p.name === "anthropic_api_key"     ? "an Anthropic API key (controls your Claude spend)" :
        p.name === "anthropic_admin_key"   ? "an Anthropic ADMIN API key (org-level access)" :
        p.name
      );
      const msg = [
        "🚨 NACA · credential LEAK on GitHub",
        "[~ vps-credential-leak-watch on Hetzner]",
        "",
        `A scan found ${friendlyPattern} sitting in your "${repo}" repo on GitHub.`,
        `File:   ${path}`,
        `Sample: ${masked}  (${realMatches.length} match${realMatches.length === 1 ? "" : "es"})`,
        `Link:   ${hit.url}`,
        "",
        "What to do (in order):",
        "1. Rotate the key in its console (Supabase / Anthropic).",
        "2. Remove the file from the repo + scrub git history (filter-repo).",
        "3. Update every .env on every machine that uses the old key.",
        "",
        "If unsure, ping me and I'll walk through it.",
      ].join("\n");
      await sendSitiAlert(msg);
      alerts++;
    }
  }

  console.log(`[leak-watch] done — scanned ${scanned}, ${placeholders} placeholders, ${alerts} alert(s) fired`);
}

main().catch((e) => { console.error("[leak-watch] fatal:", e); process.exit(1); });
