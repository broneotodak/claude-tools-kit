#!/usr/bin/env node
// claw-tripwire.mjs — split-brain guard for the CLAW retirement (2026-07-19).
//
// CLAW still has all nine legacy jobs installed on disk. If the laptop is ever
// powered on, launchd resumes them ALONGSIDE their new homes (NAS backup, tasp
// watchtower, naca-vps messengers) — double sends, double backups, two
// supervisors. This monitor pages Neo the moment CLAW signs of life appear:
//
//   (a) machine heartbeat `claw-mac` reports after the migration date
//   (b) a `backup-sync` heartbeat with the CLAW-era meta.version=backup-sync-v1
//
// One page per 6h per signal (memory-marker dedupe). Runs on the tasp
// watchtower via fleetops cron every 10 min. First-boot checklist lives in
// neo-brain — search "CLAW first-boot checklist".
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const MIGRATION_DATE = "2026-07-19T00:00:00Z";
const NEO_PHONE = "60177519610";
const COOLDOWN_HR = 6;

const brain = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const signals = [];

{
  const { data } = await brain.from("agent_heartbeats")
    .select("agent_name,reported_at,status")
    .eq("agent_name", "claw-mac")
    .gte("reported_at", MIGRATION_DATE)
    .limit(1);
  if (data?.length) signals.push(`machine heartbeat claw-mac at ${data[0].reported_at}`);
}
{
  const { data } = await brain.from("agent_heartbeats")
    .select("agent_name,reported_at,meta")
    .eq("agent_name", "backup-sync")
    .gte("reported_at", MIGRATION_DATE)
    .limit(1);
  if (data?.length && data[0].meta?.version === "backup-sync-v1")
    signals.push(`CLAW-era backup-sync (v1) heartbeat at ${data[0].reported_at}`);
}

if (!signals.length) { console.log("[claw-tripwire] quiet — CLAW still off"); process.exit(0); }

const since = new Date(Date.now() - COOLDOWN_HR * 3600e3).toISOString();
const { data: recent } = await brain.from("memories")
  .select("id").eq("source", "supervisor").eq("category", "claw_tripwire_alert")
  .gte("created_at", since).limit(1);
if (recent?.length) { console.log("[claw-tripwire] tripped but within cooldown"); process.exit(0); }

const message = [
  "🚨 *CLAW TRIPWIRE* — the retired laptop just came back online!",
  "",
  ...signals.map(s => `• ${s}`),
  "",
  "Its old jobs will resume and DOUBLE-RUN alongside the new homes.",
  "Run the first-boot checklist NOW (neo-brain: \"CLAW first-boot checklist\"):",
  "ssh zieel@100.93.159.1 → disable ai.openclaw.* launchd jobs.",
].join("\n");

await brain.from("agent_commands").insert({
  from_agent: "claw-tripwire", to_agent: "siti",
  command: "send_whatsapp_notification",
  payload: { to: NEO_PHONE, message }, priority: 1,
});
await brain.from("memories").insert({
  content: `[claw-tripwire] TRIPPED: ${signals.join(" | ")}`,
  category: "claw_tripwire_alert", source: "supervisor",
  memory_type: "event", importance: 7, visibility: "internal",
  metadata: { signals, tripped_at: new Date().toISOString() },
});
console.log(`[claw-tripwire] PAGED Neo — ${signals.length} signal(s)`);
