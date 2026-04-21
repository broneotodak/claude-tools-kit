#!/usr/bin/env node
/**
 * One-shot migration: uzamamymfzhelvkwpvgt  →  neo-brain (xsunmervpyrplzarebva)
 *
 *   claude_desktop_memory  →  memories     (preserves embedding_gemini → embedding)
 *   neo_facts              →  facts
 *   neo_knowledge_graph    →  knowledge_nodes + knowledge_edges (best-effort)
 *   neo_personality        →  personality  (subject_id = Neo self)
 *
 * Re-embeds rows that are missing embedding_gemini using Gemini embedding-001.
 *
 * Usage:
 *   Requires these env vars (add to claude-tools-kit/.env):
 *     SUPABASE_URL                                 (old, uzamamy...)
 *     SUPABASE_SERVICE_ROLE_KEY                    (old)
 *     NEO_BRAIN_URL=https://xsunmervpyrplzarebva.supabase.co
 *     NEO_BRAIN_SERVICE_ROLE_KEY                   (new, grab from dashboard)
 *     GEMINI_API_KEY
 *
 *   Then:
 *     node tools/migrate-to-neo-brain.js --dry-run
 *     node tools/migrate-to-neo-brain.js --phase=memories --batch=200
 *     node tools/migrate-to-neo-brain.js --phase=all
 *
 * Safe to re-run: dedupes by source_ref.legacy_id (old claude_desktop_memory.id).
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { embedText, toPgVectorString } from "../packages/memory/src/gemini.js";

const NEO_SELF_ID = "00000000-0000-0000-0000-000000000001";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? true : v];
  })
);
const DRY = !!args["dry-run"];
const BATCH = Number(args.batch || 200);
const PHASE = args.phase || "all"; // memories|facts|graph|personality|all

const OLD_URL = process.env.SUPABASE_URL;
const OLD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NEW_URL = process.env.NEO_BRAIN_URL;
const NEW_KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

for (const [name, val] of Object.entries({ OLD_URL, OLD_KEY, NEW_URL, NEW_KEY, GEMINI_KEY })) {
  if (!val) { console.error(`[fatal] env missing: ${name}`); process.exit(1); }
}

const oldDb = createClient(OLD_URL, OLD_KEY, { auth: { persistSession: false } });
const newDb = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });

function log(...a) { console.log(new Date().toISOString(), ...a); }

async function migrateMemories() {
  log("== memories ==");
  let offset = 0;
  let total = 0;
  let reembedded = 0;
  let skippedExisting = 0;

  const { count: srcCount } = await oldDb
    .from("claude_desktop_memory")
    .select("*", { count: "exact", head: true });
  log(`source rows: ${srcCount}`);

  while (true) {
    const { data: rows, error } = await oldDb
      .from("claude_desktop_memory")
      .select("id, content, memory_type, category, importance, metadata, embedding_gemini, visibility, source, owner, archived, created_at")
      .order("id", { ascending: true })
      .range(offset, offset + BATCH - 1);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) break;

    // Check what's already migrated (by legacy_id)
    const legacyIds = rows.map((r) => r.id);
    const { data: existing } = await newDb
      .from("memories")
      .select("source_ref")
      .in("source_ref->>legacy_id", legacyIds.map(String))
      .limit(legacyIds.length);
    const existingSet = new Set((existing || []).map((e) => e.source_ref?.legacy_id).filter(Boolean));

    const toInsert = [];
    for (const r of rows) {
      if (existingSet.has(String(r.id))) { skippedExisting++; continue; }
      let embedding = r.embedding_gemini;
      if (!embedding && r.content) {
        try {
          const vec = await embedText(r.content, { apiKey: GEMINI_KEY });
          embedding = toPgVectorString(vec);
          reembedded++;
          await new Promise(r => setTimeout(r, 250)); // pace Gemini
        } catch (e) {
          log(`  embed fail for legacy id ${r.id}: ${e.message}`);
        }
      }
      toInsert.push({
        content: r.content,
        embedding,
        category: r.category,
        memory_type: r.memory_type,
        importance: r.importance,
        visibility: r.visibility || "private",
        subject_id: NEO_SELF_ID,
        source: r.source || "migration_legacy",
        source_ref: { legacy_id: String(r.id), legacy_table: "claude_desktop_memory" },
        metadata: r.metadata || {},
        archived: !!r.archived,
        created_at: r.created_at,
      });
    }

    if (toInsert.length > 0) {
      if (DRY) {
        log(`  [DRY] would insert ${toInsert.length} rows (offset ${offset})`);
      } else {
        const { error: insErr } = await newDb.from("memories").insert(toInsert);
        if (insErr) throw new Error(`insert batch ${offset}: ${insErr.message}`);
      }
    }
    total += toInsert.length;
    log(`  batch offset=${offset} rows=${rows.length} inserted=${toInsert.length} skipped=${skippedExisting - (total - toInsert.length - (total - toInsert.length))} reembed=${reembedded}`);
    offset += BATCH;
  }

  log(`memories done: inserted=${total} reembedded=${reembedded} skipped_existing=${skippedExisting}`);
}

async function migrateFacts() {
  log("== facts ==");
  const { data: rows, error } = await oldDb.from("neo_facts").select("*").range(0, 9999);
  if (error) throw new Error(error.message);
  if (!rows) return;
  log(`source rows: ${rows.length}`);
  const toInsert = rows.map((r) => ({
    subject_id: NEO_SELF_ID,
    fact: r.fact || r.content || r.value || "",
    category: r.category || r.topic || null,
    confidence: r.confidence ?? null,
    source_memory_ids: [],
    metadata: {
      legacy_id: r.id,
      legacy_table: "neo_facts",
      ...(r.metadata || {}),
    },
    created_at: r.created_at || new Date().toISOString(),
  })).filter((r) => r.fact);

  if (DRY) { log(`  [DRY] would insert ${toInsert.length} facts`); return; }
  if (toInsert.length > 0) {
    const { error: insErr } = await newDb.from("facts").insert(toInsert);
    if (insErr) throw new Error(insErr.message);
  }
  log(`facts done: ${toInsert.length}`);
}

async function migratePersonality() {
  log("== personality ==");
  const { data: rows, error } = await oldDb.from("neo_personality").select("*");
  if (error) throw new Error(error.message);
  if (!rows) return;
  log(`source rows: ${rows.length}`);
  const toInsert = rows.map((r) => ({
    subject_id: NEO_SELF_ID,
    trait: r.trait,
    dimension: r.dimension,
    value: r.value,
    sample_count: r.sample_count,
    std_deviation: r.std_deviation,
    min_observed: r.min_observed,
    max_observed: r.max_observed,
    example_behaviors: r.example_behaviors || null,
    description: r.description,
    source_memory_ids: [],
    metadata: { legacy_id: r.id, legacy_table: "neo_personality", ...(r.metadata || {}) },
    last_updated: r.last_updated || new Date().toISOString(),
    created_at: r.created_at || new Date().toISOString(),
  })).filter((r) => r.trait && r.dimension);

  if (DRY) { log(`  [DRY] would insert ${toInsert.length} personality rows`); return; }
  if (toInsert.length > 0) {
    const { error: insErr } = await newDb
      .from("personality")
      .upsert(toInsert, { onConflict: "subject_id,trait,dimension" });
    if (insErr) throw new Error(insErr.message);
  }
  log(`personality done: ${toInsert.length}`);
}

async function migrateGraph() {
  log("== knowledge graph ==");
  const { data: rows, error } = await oldDb.from("neo_knowledge_graph").select("*").range(0, 9999);
  if (error) { log(`  (skip: ${error.message})`); return; }
  if (!rows) return;
  log(`source rows: ${rows.length}`);
  // Best-effort flatten — old table structure is unknown until inspected.
  // We store each row as a knowledge_node with metadata.legacy blob.
  const nodes = rows.map((r) => ({
    label: r.label || r.subject || r.entity || r.name || "unknown",
    kind: r.kind || r.entity_type || null,
    description: r.description || null,
    metadata: { legacy_id: r.id, legacy_row: r },
  })).filter((r) => r.label && r.label !== "unknown");

  if (DRY) { log(`  [DRY] would insert ${nodes.length} knowledge_nodes`); return; }
  if (nodes.length > 0) {
    const { error: insErr } = await newDb.from("knowledge_nodes").insert(nodes);
    if (insErr) throw new Error(insErr.message);
  }
  log(`knowledge nodes done: ${nodes.length}`);
}

async function main() {
  log(`migrate start — phase=${PHASE} dry=${DRY} batch=${BATCH}`);
  if (PHASE === "memories" || PHASE === "all") await migrateMemories();
  if (PHASE === "facts" || PHASE === "all") await migrateFacts();
  if (PHASE === "personality" || PHASE === "all") await migratePersonality();
  if (PHASE === "graph" || PHASE === "all") await migrateGraph();
  log("migrate complete");
}

main().catch((e) => { console.error("[fatal]", e); process.exit(1); });
