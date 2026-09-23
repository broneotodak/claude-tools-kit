#!/usr/bin/env node
// sync-kb-to-brain — embeds every neo-kb page into neo-brain as source='kb'
// memories so Siti, the twin, and every agent can recall maintained truth
// via their existing recall/read_memory tools.
//
// Replace-not-append: each page is keyed by metadata.kb_path; a re-sync deletes
// that page's old row(s) first, so the KB never accumulates stale copies of
// itself in the vector store (the failure mode of the diary layer).
//
// Usage:
//   node tools/sync-kb-to-brain.mjs [--dir ~/Projects/neo-kb] [--dry] [--force]
// Only pages whose content changed are re-embedded (sha256 in metadata.content_hash).
// Requires NEO_BRAIN_URL, NEO_BRAIN_SERVICE_ROLE_KEY, GEMINI_API_KEY in CTK .env.

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { createHash } from "crypto";
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
const GEMINI = process.env.GEMINI_API_KEY;
if (!URL || !KEY || !GEMINI) {
  console.error("need NEO_BRAIN_URL / NEO_BRAIN_SERVICE_ROLE_KEY / GEMINI_API_KEY");
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const FORCE = args.includes("--force"); // re-embed every page even if unchanged
const dirArg = args.indexOf("--dir");
const KB_DIR = (dirArg >= 0 ? args[dirArg + 1] : join(process.env.HOME, "Projects", "neo-kb")).replace(/^~/, process.env.HOME);
const NEO_SELF = "00000000-0000-0000-0000-000000000001";

// skip index/navigation files — they carry no durable facts
const SKIP = new Set(["README.md", "INDEX.md"]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".md") && !SKIP.has(name)) out.push(full);
  }
  return out;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  let body = text;
  if (m) {
    body = text.slice(m[0].length);
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^(\w+):\s*(.+)$/);
      if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
    }
  }
  return { meta, body };
}

async function brain(path, opts = {}) {
  const r = await fetch(`${URL}/rest/v1${path}`, {
    ...opts,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`brain ${opts.method || "GET"} ${path} → ${r.status}: ${(await r.text()).slice(0, 140)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

const MAX = 2048;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Gemini rate-limits bursts (429). Retry with backoff instead of dying mid-sync,
// and pace chunks so a big page does not trip the limit in the first place.
async function embedChunk(t) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: { parts: [{ text: t }] }, outputDimensionality: 768 }) },
    );
    if (r.ok) return (await r.json())?.embedding?.values;
    if ((r.status === 429 || r.status >= 500) && attempt < 6) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new Error(`gemini ${r.status}`);
  }
}
async function embed(text) {
  if (text.length <= MAX) return embedChunk(text);
  const parts = [];
  for (let i = 0; i < text.length; i += MAX) {
    parts.push(await embedChunk(text.slice(i, i + MAX)));
    await sleep(300);
  }
  // mean-pool + renormalize (same as the SDK)
  const pooled = parts[0].map((_, i) => parts.reduce((s, v) => s + v[i], 0) / parts.length);
  const norm = Math.sqrt(pooled.reduce((s, v) => s + v * v, 0));
  return norm ? pooled.map((v) => v / norm) : pooled;
}

// A page longer than PART_MAX is stored as several rows split at "## " headings,
// never truncated (the old 20k slice silently dropped the tail of big pages).
const PART_MAX = 20000;
function splitPage(body) {
  if (body.length <= PART_MAX) return [body];
  const sections = body.split(/\n(?=## )/);
  const parts = [];
  let cur = "";
  for (const sec of sections) {
    if (cur && (cur.length + sec.length + 1) > PART_MAX) { parts.push(cur); cur = ""; }
    if (sec.length > PART_MAX) {
      for (let i = 0; i < sec.length; i += PART_MAX) parts.push(sec.slice(i, i + PART_MAX));
      continue;
    }
    cur = cur ? `${cur}\n${sec}` : sec;
  }
  if (cur) parts.push(cur);
  return parts;
}

// What is already in the brain: kb_path → content_hash (skip unchanged pages).
async function existingHashes() {
  const rows = await brain(`/memories?source=eq.kb&select=metadata`);
  const map = new Map();
  for (const r of rows || []) {
    const m = r.metadata || {};
    if (m.kb_path && (m.part || 1) === 1) map.set(m.kb_path, m.content_hash || null);
  }
  return map;
}

const pages = walk(KB_DIR);
console.log(`${DRY ? "[DRY] " : ""}syncing ${pages.length} pages from ${KB_DIR}`);
const have = DRY ? new Map() : await existingHashes();
let synced = 0, skipped = 0, failed = 0;
for (const full of pages) {
  const rel = relative(KB_DIR, full);
  const raw = readFileSync(full, "utf-8");
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  if (!FORCE && have.get(rel) === hash) { skipped++; continue; }
  const { meta, body } = parseFrontmatter(raw);
  const title = (body.match(/^#\s+(.+)$/m)?.[1] || rel).trim();
  const chunks = splitPage(body.trim());
  if (DRY) {
    console.log(`  would sync ${rel.padEnd(28)} "${title.slice(0, 48)}" (${body.length} chars, ${chunks.length} row(s))`);
    continue;
  }
  try {
    const rows = [];
    for (let i = 0; i < chunks.length; i++) {
      const head = `# neo-kb · ${rel}${chunks.length > 1 ? ` (part ${i + 1}/${chunks.length})` : ""}\n${meta.verified_at ? `(verified ${meta.verified_at})\n` : ""}\n`;
      const vec = await embed(chunks[i]);
      rows.push({
        content: head + chunks[i],
        embedding: `[${vec.join(",")}]`,
        category: "kb_page",
        memory_type: "reference",
        importance: 8,
        visibility: meta.sensitivity && /high/.test(meta.sensitivity) ? "private" : "internal",
        source: "kb",
        subject_id: NEO_SELF,
        metadata: {
          kb_path: rel,
          title,
          part: i + 1,
          parts: chunks.length,
          content_hash: hash,
          verified_at: meta.verified_at || null,
          sensitivity: meta.sensitivity || "internal",
          synced_from: "neo-kb",
        },
      });
    }
    // replace only once every part embedded: a failure never leaves the page missing
    await brain(`/memories?source=eq.kb&metadata->>kb_path=eq.${encodeURIComponent(rel)}`, { method: "DELETE" });
    await brain(`/memories`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    synced++;
    console.log(`  ✓ ${rel.padEnd(28)} ${title.slice(0, 48)}${chunks.length > 1 ? ` (${chunks.length} parts)` : ""}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${rel}: ${e.message}`);
  }
}
console.log(DRY ? "[DRY] done" : `synced ${synced}, unchanged ${skipped}, failed ${failed} of ${pages.length} pages (source=kb)`);
if (failed) process.exit(2);
