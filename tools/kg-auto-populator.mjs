#!/usr/bin/env node
// NACA Knowledge Graph auto-populator — hourly cron.
// Scans agent_commands for new completions since last watermark, extracts
// triples about who-did-what. Writes to kg_triples, advances watermark.
//
// Watermark stored in memories(category=kg_populator_state, signal_key='last_processed_at').

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";

// === Env ===
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
if (!BRAIN_URL || !SR_KEY) { console.error("missing brain env"); process.exit(1); }

// === Brain helpers ===
async function brain(method, path, body) {
  const r = await fetch(`${BRAIN_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SR_KEY,
      Authorization: `Bearer ${SR_KEY}`,
      "Content-Type": "application/json",
      ...(method !== "GET" ? { Prefer: "return=representation,resolution=ignore-duplicates" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// === Watermark ===
const WATERMARK_KEY = "last_processed_at";

async function readWatermark() {
  const path = `/memories?category=eq.kg_populator_state&metadata->>signal_key=eq.${WATERMARK_KEY}&select=metadata,created_at&order=created_at.desc&limit=1`;
  const rows = await brain("GET", path);
  if (rows && rows.length > 0) return rows[0].metadata?.processed_until;
  // First run: 24h back
  return new Date(Date.now() - 24 * 3600 * 1000).toISOString();
}

async function writeWatermark(processedUntil, stats) {
  await brain("POST", "/memories", {
    content: `KG auto-populator processed until ${processedUntil} — ${stats.commands} commands → ${stats.triples} triples inserted of ${stats.sent ?? stats.triples} sent (${stats.skipped} skipped)`,
    category: "kg_populator_state",
    memory_type: "operational",
    importance: 3,
    visibility: "internal",
    source: "supervisor",
    metadata: { signal_key: WATERMARK_KEY, processed_until: processedUntil, ...stats },
  });
}

// === Triple extraction ===
function extractTriples(cmd) {
  const triples = [];
  const ts = cmd.completed_at || cmd.created_at;

  // Always: dispatched_to relationship
  if (cmd.from_agent && cmd.to_agent) {
    triples.push({
      subject_type: "agent", subject_key: cmd.from_agent,
      predicate: "dispatched_to",
      object_type: "agent", object_key: cmd.to_agent,
      source: "auto_agent_commands", source_ref: cmd.id,
      metadata: { command: cmd.command, status: cmd.status, ts },
    });
  }

  // Command-typed dispatch
  if (cmd.to_agent && cmd.command) {
    triples.push({
      subject_type: "agent", subject_key: cmd.to_agent,
      predicate: "received_command",
      object_type: "command_type", object_key: cmd.command,
      source: "auto_agent_commands", source_ref: cmd.id,
      metadata: { from: cmd.from_agent, status: cmd.status, ts },
    });
  }

  // PR relationships from result blob
  const result = cmd.result;
  if (result && typeof result === "object") {
    // dev-agent opened a PR
    if (result.pr_url && cmd.command !== "merge_pr" && cmd.command !== "close_pr") {
      triples.push({
        subject_type: "agent", subject_key: cmd.to_agent,
        predicate: "opened_pr",
        object_type: "pr", object_key: result.pr_url,
        source: "auto_agent_commands", source_ref: cmd.id,
        metadata: { command: cmd.command, ts },
      });
      // PR belongs to a project (if payload knows)
      if (cmd.payload?.project) {
        triples.push({
          subject_type: "pr", subject_key: result.pr_url,
          predicate: "belongs_to",
          object_type: "project", object_key: cmd.payload.project,
          source: "auto_agent_commands", source_ref: cmd.id,
        });
      }
    }
    // operator merge/close
    if (cmd.command === "merge_pr" && result.pr_url && result.action === "merge") {
      triples.push({
        subject_type: "agent", subject_key: cmd.to_agent,
        predicate: "merged_pr",
        object_type: "pr", object_key: result.pr_url,
        source: "auto_agent_commands", source_ref: cmd.id,
        metadata: { decided_by: result.decided_by, ts },
      });
    }
    if (cmd.command === "close_pr" && result.pr_url && result.action === "close") {
      triples.push({
        subject_type: "agent", subject_key: cmd.to_agent,
        predicate: "closed_pr",
        object_type: "pr", object_key: result.pr_url,
        source: "auto_agent_commands", source_ref: cmd.id,
      });
    }
  }

  return triples;
}

// === Main ===
async function main() {
  const watermark = await readWatermark();
  console.log(`[kg-populator] start — processing commands since ${watermark}`);

  // Pull terminal-state commands updated since watermark (cap 500/run for safety)
  const path = `/agent_commands?or=(status.eq.done,status.eq.failed,status.eq.cancelled)&completed_at=gte.${encodeURIComponent(watermark)}&order=completed_at.asc&limit=500`;
  const cmds = await brain("GET", path);
  if (!cmds || cmds.length === 0) {
    console.log(`[kg-populator] no new terminal commands, exiting`);
    return;
  }

  let totalTriples = 0, skipped = 0, sent = 0;
  const batch = [];
  for (const cmd of cmds) {
    const ts = extractTriples(cmd);
    if (ts.length === 0) { skipped++; continue; }
    batch.push(...ts);
  }

  // Normalize NULLs to '' for object_type/object_key (table columns are NOT NULL),
  // then dedupe within batch.
  const seen = new Set();
  const deduped = [];
  for (const t of batch) {
    t.object_type = t.object_type || "";
    t.object_key  = t.object_key  || "";
    const k = [t.subject_type, t.subject_key, t.predicate, t.object_type, t.object_key].join("\x1f");
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(t);
  }

  if (deduped.length > 0) {
    // PostgREST needs on_conflict param + resolution=ignore-duplicates header
    // (already in brain() helper) to silently skip rows that collide with seed
    // or earlier auto-populated triples.
    const conflictCols = "subject_type,subject_key,predicate,object_type,object_key";
    for (let i = 0; i < deduped.length; i += 100) {
      const chunk = deduped.slice(i, i + 100);
      sent += chunk.length;
      try {
        // With return=representation + resolution=ignore-duplicates, the response
        // body holds ONLY the rows actually inserted — collisions are omitted.
        // Count those, not chunk.length, so the heartbeat reflects REAL graph
        // growth instead of "rows attempted". (Was the silent-success bug.)
        const inserted = await brain("POST", `/kg_triples?on_conflict=${conflictCols}`, chunk);
        totalTriples += Array.isArray(inserted) ? inserted.length : 0;
      } catch (e) {
        console.error(`[kg-populator] chunk ${i / 100} insert failed: ${e.message?.slice(0, 200)}`);
      }
    }
  }

  // Advance strictly PAST the last processed command. The query filters
  // completed_at >= watermark, so reusing the raw last timestamp re-feeds the
  // same boundary command every run (the off-by-one that froze the watermark).
  // +1ms moves the cursor forward; on_conflict still guards against any dupes.
  const lastTs = cmds[cmds.length - 1].completed_at;
  const newWatermark = new Date(Date.parse(lastTs) + 1).toISOString();
  await writeWatermark(newWatermark, {
    commands: cmds.length,
    triples: totalTriples,
    sent,
    skipped,
  });

  console.log(`[kg-populator] done — ${cmds.length} commands → ${totalTriples} inserted / ${sent} sent (${skipped} skipped) — watermark advanced to ${newWatermark}`);
}

main().catch((e) => { console.error("[kg-populator] fatal:", e); process.exit(1); });
