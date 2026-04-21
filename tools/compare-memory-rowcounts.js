#!/usr/bin/env node
/**
 * Soak-period parity check: compares row counts between legacy (uzamamymfzhelvkwpvgt)
 * and neo-brain (xsunmervpyrplzarebva). Flags drift so you know dual-write is healthy.
 *
 * Run manually or cron'd daily during the 2-week soak:
 *   node ~/Projects/claude-tools-kit/tools/compare-memory-rowcounts.js
 *   node ~/Projects/claude-tools-kit/tools/compare-memory-rowcounts.js --json > status.json
 *
 * Exit codes:
 *   0 — healthy (drift within tolerance)
 *   1 — significant drift detected
 *   2 — config/connection error
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { createClient } = require("@supabase/supabase-js");

const LEGACY_URL = process.env.SUPABASE_URL;
const LEGACY_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BRAIN_URL = process.env.NEO_BRAIN_URL;
const BRAIN_KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");

if (!LEGACY_URL || !LEGACY_KEY || !BRAIN_URL || !BRAIN_KEY) {
  console.error("env missing: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEO_BRAIN_URL / NEO_BRAIN_SERVICE_ROLE_KEY");
  process.exit(2);
}

const legacy = createClient(LEGACY_URL, LEGACY_KEY);
const brain = createClient(BRAIN_URL, BRAIN_KEY);

async function countLegacy(table, filter) {
  let q = legacy.from(table).select("id", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) return { error: error.message };
  return { count };
}
async function countBrain(table, filter) {
  let q = brain.from(table).select("id", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) return { error: error.message };
  return { count };
}

// Tolerance: allow small absolute drift for in-flight async writes.
const ABSOLUTE_TOLERANCE = 5;
// Percentage tolerance for large tables (e.g. memories growing during dual-write).
const PCT_TOLERANCE = 0.02; // 2%

function assess(legacyCount, brainCount) {
  if (legacyCount == null || brainCount == null) return "unknown";
  const diff = Math.abs(legacyCount - brainCount);
  const threshold = Math.max(ABSOLUTE_TOLERANCE, Math.ceil(legacyCount * PCT_TOLERANCE));
  if (diff <= threshold) return "ok";
  return "drift";
}

async function main() {
  const checks = [
    { name: "memories ≈ claude_desktop_memory", legacyTable: "claude_desktop_memory", brainTable: "memories" },
    { name: "facts ≈ neo_facts",                 legacyTable: "neo_facts",             brainTable: "facts" },
    { name: "personality ≈ neo_personality",     legacyTable: "neo_personality",       brainTable: "personality" },
    { name: "knowledge_nodes ≈ neo_knowledge_graph", legacyTable: "neo_knowledge_graph", brainTable: "knowledge_nodes" },
  ];

  const results = [];
  for (const c of checks) {
    const legacyRes = await countLegacy(c.legacyTable);
    const brainRes = await countBrain(c.brainTable);
    const status = assess(legacyRes.count, brainRes.count);
    results.push({
      check: c.name,
      legacy_table: c.legacyTable,
      brain_table: c.brainTable,
      legacy_count: legacyRes.count ?? null,
      brain_count: brainRes.count ?? null,
      legacy_error: legacyRes.error ?? null,
      brain_error: brainRes.error ?? null,
      drift: (brainRes.count ?? 0) - (legacyRes.count ?? 0),
      status,
    });
  }

  // Also count audit log for visibility
  const writeLog = await countBrain("memory_writes_log");
  const peopleCount = await countBrain("people");

  const overall = results.every((r) => r.status === "ok") ? "healthy" : "drift_detected";

  if (asJson) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      overall,
      results,
      memory_writes_log: writeLog.count,
      people_rows: peopleCount.count,
    }, null, 2));
  } else {
    const now = new Date().toISOString();
    console.log(`\n== soak parity check  (${now}) ==\n`);
    for (const r of results) {
      const statusIcon = r.status === "ok" ? "✓" : r.status === "drift" ? "⚠" : "?";
      const driftStr = r.drift > 0 ? `+${r.drift}` : `${r.drift}`;
      console.log(`${statusIcon} ${r.check.padEnd(40)} legacy=${String(r.legacy_count).padStart(5)}  brain=${String(r.brain_count).padStart(5)}  drift=${driftStr}`);
      if (r.legacy_error || r.brain_error) console.log(`   err: legacy=${r.legacy_error || "-"}  brain=${r.brain_error || "-"}`);
    }
    console.log(`\naudit: memory_writes_log=${writeLog.count}  people=${peopleCount.count}`);
    console.log(`overall: ${overall === "healthy" ? "✓ HEALTHY" : "⚠ DRIFT — investigate"}\n`);
  }

  process.exit(overall === "healthy" ? 0 : 1);
}

main().catch((e) => { console.error("fatal:", e.message); process.exit(2); });
