#!/usr/bin/env node
/**
 * Stuck-command monitor — Phase 5 Step 1.
 *
 * Scans neo-brain.agent_commands for rows that should have been picked up
 * by a downstream agent but weren't. Detects two failure modes:
 *
 *   (a) status='pending' for > PENDING_THRESHOLD_MIN  → no agent claimed it
 *   (b) status='running' for > RUNNING_THRESHOLD_MIN  → handler hung
 *
 * On first detection of a stuck cmd, sends a WhatsApp alert to Neo via
 * Siti's /api/send. Dedupes via a memory marker (source='supervisor',
 * metadata.alerted_cmd_id) — same cmd won't alert again for ALERT_COOLDOWN_HR.
 *
 * Surfaces today's class of bug (poster-agent / timekeeper race, hung
 * handlers, downstream agent crashed) in <5 min instead of 1+ hr.
 *
 * Cron: every 5 minutes (line in user crontab)
 */
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const PENDING_THRESHOLD_MIN  = 10;   // pending > 10 min = stuck
const RUNNING_THRESHOLD_MIN  = 15;   // running > 15 min = handler hung
const ALERT_COOLDOWN_HR      = 1;    // don't re-alert same cmd for 1 hour
const NEO_PHONE              = "60177519610";
const NEO_OWNER_ID           = "00000000-0000-0000-0000-000000000001";
const SITI_HOST              = process.env.SITI_HOST || "100.79.179.67";
const SITI_PORT              = process.env.SITI_PORT || "3800";
const SITI_PIN               = process.env.SITI_PIN  || "404282";

const brain = createClient(
  process.env.NEO_BRAIN_URL,
  process.env.NEO_BRAIN_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function alreadyAlerted(cmdId) {
  const since = new Date(Date.now() - ALERT_COOLDOWN_HR * 3600_000).toISOString();
  const { data } = await brain
    .from("memories")
    .select("id")
    .eq("source", "supervisor")
    .eq("category", "stuck_command_alert")
    .gte("created_at", since)
    .filter("metadata->>cmd_id", "eq", cmdId)
    .limit(1);
  return (data || []).length > 0;
}

async function recordAlert(cmdId, summary) {
  await brain.from("memories").insert({
    content: `[stuck-command-monitor] alerted Neo about stuck cmd ${cmdId.slice(0, 8)}: ${summary}`,
    category: "stuck_command_alert",
    source: "supervisor",
    visibility: "internal",
    importance: 5,
    subject_id: NEO_OWNER_ID,
    metadata: { cmd_id: cmdId, alerted_at: new Date().toISOString() },
  });
}

async function notifyNeo(text) {
  try {
    const r = await fetch(`http://${SITI_HOST}:${SITI_PORT}/api/send`, {
      method: "POST",
      headers: { "Cookie": `pin=${SITI_PIN}`, "content-type": "application/json" },
      body: JSON.stringify({ to: NEO_PHONE, text }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch (e) { return false; }
}

async function main() {
  const now = Date.now();
  const pendingCutoff = new Date(now - PENDING_THRESHOLD_MIN * 60_000).toISOString();
  const runningCutoff = new Date(now - RUNNING_THRESHOLD_MIN * 60_000).toISOString();

  const { data: pending } = await brain
    .from("agent_commands")
    .select("id,from_agent,to_agent,command,status,created_at,payload")
    .eq("status", "pending")
    .lt("created_at", pendingCutoff)
    .limit(20);

  const { data: running } = await brain
    .from("agent_commands")
    .select("id,from_agent,to_agent,command,status,created_at,payload")
    .eq("status", "running")
    .lt("created_at", runningCutoff)
    .limit(20);

  const stuck = [...(pending || []), ...(running || [])];
  if (!stuck.length) { console.log("[stuck-monitor] all clear"); return; }

  const fresh = [];
  for (const cmd of stuck) {
    if (!(await alreadyAlerted(cmd.id))) fresh.push(cmd);
  }
  if (!fresh.length) { console.log(`[stuck-monitor] ${stuck.length} stuck but all already alerted (cooldown)`); return; }

  // Build a single combined alert
  const lines = ["⚠️ STUCK COMMANDS detected:"];
  for (const c of fresh) {
    const ageMin = Math.round((now - new Date(c.created_at).getTime()) / 60_000);
    const channel = c.payload?.channel ? ` [${c.payload.channel}]` : "";
    lines.push(`• ${c.from_agent}→${c.to_agent} \`${c.command}\`${channel} — ${c.status} ${ageMin}min (id ${c.id.slice(0, 8)})`);
  }
  lines.push("");
  lines.push("Likely causes: agent crashed, race condition, downstream offline. Check pm2 + supervisor.");
  const text = lines.join("\n");

  const sent = await notifyNeo(text);
  if (sent) {
    for (const c of fresh) await recordAlert(c.id, `${c.to_agent}/${c.command} ${c.status}`);
    console.log(`[stuck-monitor] alerted Neo about ${fresh.length} stuck cmd(s)`);
  } else {
    console.log(`[stuck-monitor] WA send failed — will retry next cycle`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
