import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { startHeartbeatLoop } from "../../lib/heartbeat.mjs";

// --- Config ---
const HOME = homedir();
const SUPABASE_URL = "https://uzamamymfzhelvkwpvgt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6YW1hbXltZnpoZWx2a3dwdmd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxNDMwNjgsImV4cCI6MjA2MzcxOTA2OH0.2ZKxIzgXEFFjLRlS3LlNYYKK1IuJ0CIkWKo-sMdSxlI";
const WACLI_URL = "http://127.0.0.1:3898";
const CLAUDEN_API_URL = "https://clauden.neotodak.com/api/openclaw";
const NEO_PHONE = "60177519610";
const POLL_INTERVAL_MS = 60 * 1000; // 60 seconds
const PORT = 3904;

let WACLI_TOKEN = "";
try {
  const envFile = readFileSync(resolve(HOME, ".openclaw/secrets/wacli-service.env"), "utf-8");
  const match = envFile.match(/WACLI_SERVICE_TOKEN=(.+)/);
  if (match) WACLI_TOKEN = match[1].trim();
} catch { console.warn("Could not read wacli token"); }

// neo-brain creds for heartbeat — read same .env shared with claw-heartbeat.
// If absent, startHeartbeatLoop will throw on the first beat; we swallow that
// rather than block server startup.
let NEO_BRAIN_URL = "", NEO_BRAIN_KEY = "";
try {
  const _e = readFileSync(resolve(HOME, ".openclaw/secrets/neo-brain.env"), "utf-8");
  for (const line of _e.split("\n")) {
    const i = line.indexOf("="); if (i < 0 || line.trimStart().startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k === "NEO_BRAIN_URL") NEO_BRAIN_URL = v;
    if (k === "NEO_BRAIN_SERVICE_ROLE_KEY") NEO_BRAIN_KEY = v;
  }
} catch { /* heartbeat will be silently disabled */ }

let OPENCLAW_API_KEY = "";
try {
  OPENCLAW_API_KEY = readFileSync(resolve(HOME, ".openclaw/secrets/openclaw-api.key"), "utf-8").trim();
} catch {
  // Try env var fallback
  OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || "";
  if (!OPENCLAW_API_KEY) console.warn("No OPENCLAW_API_KEY found — remember action will fail");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Helpers ---
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// --- Send WhatsApp via wacli (Indo Bank Neo → Neo's phone) ---
async function sendWhatsApp(message) {
  try {
    const resp = await fetch(`${WACLI_URL}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${WACLI_TOKEN}`,
      },
      body: JSON.stringify({
        to: NEO_PHONE,
        message,
        kind: "text",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (resp.ok) {
      log("WhatsApp sent via wacli");
      return true;
    }
    log(`wacli send failed: ${resp.status}`);
    return false;
  } catch (err) {
    log(`WhatsApp send error: ${err.message}`);
    return false;
  }
}

// --- Store memory via ClaudeN API ---
async function storeMemory(record, visibility) {
  const vis = visibility || record.suggested_visibility || "internal";

  // Format content for pgVector storage
  const parts = [];
  parts.push(`[Meeting: ${record.title || "Untitled"} | ${record.recorded_at ? new Date(record.recorded_at).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]} | ${record.duration_minutes || "?"}min]`);

  if (record.participants && record.participants.length > 0) {
    parts.push(`Participants: ${record.participants.join(", ")}`);
  }

  if (record.summary) {
    parts.push(`\nSummary: ${record.summary}`);
  }

  if (record.topics && record.topics.length > 0) {
    parts.push(`\nKey topics: ${record.topics.join(", ")}`);
  }

  if (record.action_items && record.action_items.length > 0) {
    parts.push(`\nAction items:\n${record.action_items.map(a => `- ${a}`).join("\n")}`);
  }

  const content = parts.join("\n");

  try {
    const resp = await fetch(CLAUDEN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENCLAW_API_KEY}`,
      },
      body: JSON.stringify({
        action: "remember",
        content,
        category: `plaud_${record.classification || "meeting"}`,
        importance: record.suggested_importance || 5,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      log(`ClaudeN API error: ${resp.status} ${text}`);
      return null;
    }

    const result = await resp.json();
    log(`Memory stored: ${JSON.stringify(result.data)}`);

    // Update visibility if private
    if (vis === "private" && result.data?.id) {
      await supabase
        .from("claude_desktop_memory")
        .update({ visibility: "private" })
        .eq("id", result.data.id);
      log(`Visibility set to private for memory ${result.data.id}`);
    }

    return result.data;
  } catch (err) {
    log(`Store memory error: ${err.message}`);
    return null;
  }
}

// --- Format WhatsApp preview ---
function formatPreview(record) {
  const stars = "⭐".repeat(Math.min(record.suggested_importance || 5, 7));
  let msg = `📝 *New Recording*\n`;
  msg += `📌 ${record.title || "Untitled"} (${record.duration_minutes || "?"}min)\n`;
  msg += `🏷️ Type: ${record.classification || "unknown"} | Visibility: ${record.suggested_visibility || "internal"}\n`;
  msg += `⭐ Importance: ${record.suggested_importance || 5}/7\n`;

  if (record.summary) {
    msg += `\n*Summary:*\n${record.summary}\n`;
  }

  if (record.action_items && record.action_items.length > 0) {
    msg += `\n*Action items:*\n${record.action_items.map(a => `• ${a}`).join("\n")}\n`;
  }

  if (record.participants && record.participants.length > 0) {
    msg += `\n👥 ${record.participants.join(", ")}\n`;
  }

  const baseUrl = "https://clauden.neotodak.com/api/plaud";
  msg += `\n*Tap to respond:*\n`;
  msg += `✅ Save: ${baseUrl}?action=approve&id=${record.id}\n`;
  msg += `❌ Discard: ${baseUrl}?action=reject&id=${record.id}\n`;
  msg += `🔒 Private: ${baseUrl}?action=private&id=${record.id}`;

  return msg;
}

// --- Poll for pending transcripts ---
async function pollPending() {
  log("Polling for pending transcripts...");

  try {
    const { data: pending, error } = await supabase
      .from("plaud_pending")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(5);

    if (error) {
      log(`Supabase query error: ${error.message}`);
      return;
    }

    if (!pending || pending.length === 0) {
      log("No pending transcripts.");
      return;
    }

    log(`Found ${pending.length} pending transcript(s)`);

    for (const record of pending) {
      const preview = formatPreview(record);
      const sent = await sendWhatsApp(preview);

      if (sent) {
        await supabase
          .from("plaud_pending")
          .update({ status: "notified" })
          .eq("id", record.id);
        log(`Notified Neo about: ${record.title}`);
      } else {
        log(`Failed to notify about: ${record.title}`);
      }

      // Small delay between messages
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    log(`Poll error: ${err.message}`);
  }
}

// --- HTTP Server ---
const server = createServer(async (req, res) => {
  const url = req.url?.split("?")[0];

  // Health check
  if (url === "/health") {
    return json(res, 200, {
      ok: true,
      service: "plaud-ingest",
      port: PORT,
      uptime: process.uptime(),
      wacli: WACLI_TOKEN ? "configured" : "NOT configured",
      clauden_api: OPENCLAW_API_KEY ? "configured" : "NOT configured",
    });
  }

  // GET /pending — list pending transcripts
  if (req.method === "GET" && url === "/pending") {
    const { data, error } = await supabase
      .from("plaud_pending")
      .select("id,title,classification,suggested_visibility,suggested_importance,status,created_at")
      .in("status", ["pending", "notified"])
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { pending: data });
  }

  // POST /approve/:id — approve transcript for memory storage
  if (req.method === "POST" && url?.startsWith("/approve/")) {
    const id = url.split("/approve/")[1];
    if (!id) return json(res, 400, { error: "ID required" });

    // Get the record
    const { data: record, error } = await supabase
      .from("plaud_pending")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !record) return json(res, 404, { error: "Transcript not found" });
    if (record.status === "stored") return json(res, 409, { error: "Already stored" });

    // Check for visibility override in body
    let visibility = record.suggested_visibility;
    try {
      const body = await parseBody(req);
      if (body.visibility) visibility = body.visibility;
    } catch {
      // No body — use default visibility
    }

    // Store to pgVector via ClaudeN
    const result = await storeMemory(record, visibility);
    if (!result) return json(res, 500, { error: "Failed to store memory" });

    // Update status
    await supabase
      .from("plaud_pending")
      .update({
        status: "stored",
        stored_memory_id: result.id || null,
      })
      .eq("id", id);

    log(`Approved and stored: ${record.title} (visibility: ${visibility})`);

    // Confirm via WhatsApp
    await sendWhatsApp(`✅ *Saved to memory*\n📌 ${record.title}\n🔑 Visibility: ${visibility}\n${result.embedded ? "🧠 Embedded & searchable" : "💾 Stored (embedding pending)"}`);

    return json(res, 200, { ok: true, stored: result, visibility });
  }

  // POST /reject/:id — reject/discard transcript
  if (req.method === "POST" && url?.startsWith("/reject/")) {
    const id = url.split("/reject/")[1];
    if (!id) return json(res, 400, { error: "ID required" });

    const { error } = await supabase
      .from("plaud_pending")
      .update({ status: "rejected" })
      .eq("id", id);

    if (error) return json(res, 500, { error: error.message });

    log(`Rejected transcript: ${id}`);
    await sendWhatsApp(`❌ *Discarded*\nTranscript ${id.substring(0, 8)}... has been discarded.`);

    return json(res, 200, { ok: true, status: "rejected" });
  }

  json(res, 404, { error: "Not found" });
});

// --- Startup ---
server.listen(PORT, "127.0.0.1", () => {
  log(`Plaud ingest service running on http://127.0.0.1:${PORT}`);
  log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  log(`wacli: ${WACLI_TOKEN ? "configured" : "NOT configured"}`);
  log(`ClaudeN API: ${OPENCLAW_API_KEY ? "configured" : "NOT configured"}`);
  log(`Endpoints: /health, /pending, /approve/:id, /reject/:id`);

  // Initial poll
  pollPending();
  // Poll for new transcripts every 60s
  setInterval(pollPending, POLL_INTERVAL_MS);

  // Heartbeat — publish to agent_heartbeats so fleet dashboards see plaud-pipeline.
  if (NEO_BRAIN_URL && NEO_BRAIN_KEY) {
    const stopHb = startHeartbeatLoop({
      agentName: "plaud-pipeline",
      intervalMs: 60_000,
      brainUrl: NEO_BRAIN_URL,
      serviceKey: NEO_BRAIN_KEY,
      getPayload: () => ({
        status: "ok",
        meta: {
          uptime_sec: Math.round(process.uptime()),
          listening_port: PORT,
          wacli_configured: !!WACLI_TOKEN,
          openclaw_configured: !!OPENCLAW_API_KEY,
          version: "plaud-ingest-v1",
        },
      }),
    });
    process.on("SIGTERM", async () => { log("SIGTERM — exiting"); await stopHb(); process.exit(0); });
  } else {
    console.warn("[plaud-ingest] NEO_BRAIN_URL/KEY missing — heartbeat disabled. Add to ~/.openclaw/secrets/neo-brain.env to enable.");
  }
});
