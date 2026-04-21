#!/usr/bin/env node
/**
 * Backfill embeddings for public.knowledge_nodes in neo-brain.
 * Each node: embed = gemini-embedding-001 of (label + description).
 *
 * Usage:
 *   node tools/embed-knowledge-nodes.js          (real run)
 *   node tools/embed-knowledge-nodes.js --dry-run
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { createClient } = require("@supabase/supabase-js");

const BRAIN_URL = process.env.NEO_BRAIN_URL;
const BRAIN_KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
const DIMS = 768;
const SLEEP_MS = Number(process.env.EMBED_SLEEP_MS || 900); // ~66/min, under 100 rpm free tier
const DRY = process.argv.includes("--dry-run");

if (!BRAIN_URL || !BRAIN_KEY || !GEMINI_KEY) {
  console.error("env missing: NEO_BRAIN_URL / NEO_BRAIN_SERVICE_ROLE_KEY / GEMINI_API_KEY");
  process.exit(1);
}

const sb = createClient(BRAIN_URL, BRAIN_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function embed(text) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${GEMINI_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 2048) }] }, outputDimensionality: DIMS }),
    });
    if (r.status === 429) {
      const waitMs = 20000 + attempt * 10000; // 20s, 30s, 40s, 50s
      console.log(`  429 rate limit — backing off ${waitMs/1000}s (attempt ${attempt + 1}/4)`);
      await sleep(waitMs);
      continue;
    }
    if (!r.ok) throw new Error(`embed ${r.status}: ${(await r.text()).slice(0, 180)}`);
    const d = await r.json();
    return d?.embedding?.values;
  }
  throw new Error("embed: exhausted retries after 429s");
}

async function main() {
  const pageSize = 500;
  let updated = 0, failed = 0, skipped = 0;
  let loop = 0;

  while (true) {
    const { data: rows, error } = await sb
      .from("knowledge_nodes")
      .select("id, label, description")
      .is("embedding", null)
      .limit(pageSize);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) break;
    console.log(`loop ${loop++}: ${rows.length} rows to embed (remaining)`);

    for (const row of rows) {
      const text = [row.label || "", row.description || ""].filter(Boolean).join(" — ").trim();
      if (!text) { skipped++; continue; }
      try {
        const vec = await embed(text);
        if (!vec) { failed++; continue; }
        if (DRY) {
          updated++;
        } else {
          const { error: upErr } = await sb
            .from("knowledge_nodes")
            .update({ embedding: `[${vec.join(",")}]` })
            .eq("id", row.id);
          if (upErr) { console.error(`  update ${row.id}:`, upErr.message); failed++; continue; }
          updated++;
        }
        if (updated % 50 === 0) console.log(`  progress: ${updated} updated`);
        await sleep(SLEEP_MS);
      } catch (e) {
        console.error(`  fail ${row.id}:`, e.message);
        failed++;
      }
    }
    if (rows.length < pageSize) break;
  }

  console.log(`\ndone: updated=${updated} failed=${failed} skipped=${skipped}${DRY ? " (DRY RUN)" : ""}`);
}

main().catch(e => { console.error("fatal:", e); process.exit(1); });
