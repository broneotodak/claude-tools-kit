#!/usr/bin/env node
/**
 * Cross-session drift monitor — Phase 5 Step 1.3.
 *
 * Watches for signals that PARALLEL Claude Code sessions are shipping
 * code that may collide. The intent is not to block legitimate work —
 * it's to surface "hey, two sessions touched the same agent within the
 * last hour" so Neo (the human in the loop) can decide whether to
 * reconcile or sequence.
 *
 * Signals scanned:
 *
 *   (a) RESTART_BURST — 3+ agents (in agent_heartbeats) report a fresh
 *       boot (uptime_sec < 600) within the same 10-minute window.
 *       Suggests someone restarted multiple agents at once = active deploy.
 *
 *   (b) PARALLEL_SHARED_INFRA — 2+ memories with category=shared_infra_change
 *       written by claude_code source within the last 24h whose
 *       metadata.tables_touched arrays overlap.
 *
 *   (c) HEARTBEAT_VERSION_DRIFT — same agent_name reports 2+ different
 *       meta.version strings within 1h (split-brain across instances).
 *
 * Runs on the same 5-min cron as stuck-command-monitor on CLAW.
 * Alerts via Siti's /api/send. Dedupes via memories supervisor/drift_alert.
 */
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const RESTART_WINDOW_MIN = 10;
const RESTART_BURST_THRESHOLD = 3;
const PARALLEL_LOOKBACK_HR = 24;
const VERSION_DRIFT_LOOKBACK_HR = 1;
const ALERT_COOLDOWN_HR = 6;
const NEO_PHONE = "60177519610";
const NEO_OWNER_ID = "00000000-0000-0000-0000-000000000001";
const SITI_HOST = process.env.SITI_HOST || "100.79.179.67";
const SITI_PORT = process.env.SITI_PORT || "3800";
const SITI_PIN  = process.env.SITI_PIN  || "404282";

const brain = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function alreadyAlerted(signalKey) {
  const since = new Date(Date.now() - ALERT_COOLDOWN_HR * 3600_000).toISOString();
  const { data } = await brain.from("memories")
    .select("id").eq("source", "supervisor").eq("category", "drift_alert")
    .gte("created_at", since).filter("metadata->>signal_key", "eq", signalKey).limit(1);
  return (data || []).length > 0;
}

async function recordAlert(signalKey, summary) {
  await brain.from("memories").insert({
    content: `[drift-monitor] alerted Neo: ${summary}`,
    category: "drift_alert", source: "supervisor", visibility: "internal",
    importance: 5, subject_id: NEO_OWNER_ID,
    metadata: { signal_key: signalKey, alerted_at: new Date().toISOString() },
  });
}

async function notifyNeo(text) {
  try {
    const r = await fetch(`http://${SITI_HOST}:${SITI_PORT}/api/send`, {
      method: "POST",
      headers: { Cookie: `pin=${SITI_PIN}`, "content-type": "application/json" },
      body: JSON.stringify({ to: NEO_PHONE, text }), signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch { return false; }
}

async function checkRestartBurst() {
  // Fresh-boot agents (uptime < 600s)
  const { data } = await brain.from("agent_heartbeats")
    .select("agent_name,reported_at,meta")
    .gte("reported_at", new Date(Date.now() - 5 * 60_000).toISOString());
  const fresh = (data || []).filter(r => (r.meta?.uptime_sec ?? 9999) < 600);
  if (fresh.length < RESTART_BURST_THRESHOLD) return null;
  const agents = [...new Set(fresh.map(r => r.agent_name))];
  if (agents.length < RESTART_BURST_THRESHOLD) return null;
  const sig = `restart_burst:${agents.sort().join(",")}`;
  return { sig, summary: `${agents.length} agents restarted in last ~10min: ${agents.join(", ")}. Possible parallel deploy.` };
}

async function checkParallelSharedInfra() {
  const { data } = await brain.from("memories").select("content,metadata,created_at")
    .eq("source", "claude_code").eq("category", "shared_infra_change")
    .gte("created_at", new Date(Date.now() - PARALLEL_LOOKBACK_HR * 3600_000).toISOString());
  if (!data || data.length < 2) return null;
  // Look for overlapping tables_touched between any two
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      const a = data[i].metadata?.tables_touched || [];
      const b = data[j].metadata?.tables_touched || [];
      const overlap = a.filter(t => b.includes(t));
      if (overlap.length > 0) {
        const sig = `parallel_infra:${overlap.sort().join(",")}`;
        return { sig, summary: `2 sessions in last ${PARALLEL_LOOKBACK_HR}h touched: ${overlap.join(", ")}. Recheck CTK §9 pre-flight.` };
      }
    }
  }
  return null;
}

async function checkVersionDrift() {
  const { data } = await brain.from("agent_heartbeats").select("agent_name,reported_at,meta")
    .gte("reported_at", new Date(Date.now() - VERSION_DRIFT_LOOKBACK_HR * 3600_000).toISOString());
  const byAgent = {};
  for (const r of data || []) {
    const v = r.meta?.version;
    if (!v) continue;
    (byAgent[r.agent_name] ||= new Set()).add(v);
  }
  for (const [name, versions] of Object.entries(byAgent)) {
    if (versions.size > 1) {
      const sig = `version_drift:${name}:${[...versions].sort().join("|")}`;
      return { sig, summary: `${name} reported ${versions.size} different versions in ${VERSION_DRIFT_LOOKBACK_HR}h: ${[...versions].join(", ")}. Possible split-brain.` };
    }
  }
  return null;
}

async function main() {
  const checks = [
    { name: "RESTART_BURST", run: checkRestartBurst },
    { name: "PARALLEL_SHARED_INFRA", run: checkParallelSharedInfra },
    { name: "VERSION_DRIFT", run: checkVersionDrift },
  ];
  const findings = [];
  for (const c of checks) {
    try {
      const f = await c.run();
      if (f) findings.push({ ...f, signal: c.name });
    } catch (e) { console.error(`[drift] ${c.name} err:`, e.message); }
  }
  if (!findings.length) { console.log("[drift] no signals"); return; }

  const fresh = [];
  for (const f of findings) {
    if (!(await alreadyAlerted(f.sig))) fresh.push(f);
  }
  if (!fresh.length) { console.log(`[drift] ${findings.length} signal(s) but all in cooldown`); return; }

  const lines = ["🌀 Cross-session DRIFT detected:"];
  for (const f of fresh) lines.push(`• ${f.signal}: ${f.summary}`);
  lines.push("");
  lines.push("Action: read CTK §9, check shared_infra_change memories, decide whether to reconcile.");

  const sent = await notifyNeo(lines.join("\n"));
  if (sent) {
    for (const f of fresh) await recordAlert(f.sig, f.summary);
    console.log(`[drift] alerted Neo about ${fresh.length} signal(s)`);
  } else {
    console.log("[drift] WA send failed — retry next cycle");
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
