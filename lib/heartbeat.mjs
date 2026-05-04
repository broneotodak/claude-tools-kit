// claude-tools-kit / lib / heartbeat.mjs
//
// Canonical agent-heartbeat publisher for the NACA fleet.
//
// Every agent registered in `agent_registry` (status='active') is expected to
// upsert a row into `agent_heartbeats` (PK=agent_name) on a regular cadence.
// The supervisor and every fleet dashboard (command.neotodak.com,
// neotodak-command, presentation.* fleet pages, NACA app) all read from this
// single table. An agent that doesn't publish here will appear "missing" on
// every dashboard simultaneously — even when its process is alive.
//
// Vendored copy: each agent's repo includes its own copy of this file under
// `lib/heartbeat.mjs`. The canonical version lives at
// `claude-tools-kit/lib/heartbeat.mjs`. Updates are rare; when needed, copy
// the new file into the agent and PR per agent.
//
// Two usage shapes are supported:
//
// 1) One-shot — for launchd / cron / systemd timer schedulers that fire and
//    exit:
//
//        import { emitHeartbeat } from "./lib/heartbeat.mjs";
//        await emitHeartbeat({
//          agentName: "naca-pi",
//          status: "ok",
//          meta: { uptime_sec: 12345, role: "edge-pi" },
//        });
//
// 2) In-process loop — for long-running processes (pm2 daemons, services):
//
//        import { startHeartbeatLoop } from "./lib/heartbeat.mjs";
//        const stop = startHeartbeatLoop({
//          agentName: "neo-twin",
//          intervalMs: 60_000,
//          getPayload: () => ({
//            status: shadowSoakOk ? "ok" : "degraded",
//            meta: { current_groups, drafts_pending },
//          }),
//        });
//        process.on("SIGTERM", () => stop());
//
// Required env (read from process.env):
//   NEO_BRAIN_URL                 — neo-brain Supabase URL
//   NEO_BRAIN_SERVICE_ROLE_KEY    — service role key (server-side only)
//
// Status convention: "ok" | "degraded" | "offline" | "starting"
// "ok"        — healthy, doing work
// "degraded"  — partial — known sub-system unhealthy but still useful
// "offline"   — explicitly shutting down (last write before exit)
// "starting"  — booted, not yet ready (first write of process)

const PROTOCOL_VERSION = "heartbeat-v1";

/**
 * One-shot heartbeat publish. Returns when the row is written or throws.
 *
 * @param {object} opts
 * @param {string} opts.agentName  — must match agent_registry.agent_name exactly
 * @param {"ok"|"degraded"|"offline"|"starting"} [opts.status="ok"]
 * @param {object} [opts.meta={}]  — agent-specific structured metadata
 * @param {string} [opts.brainUrl] — overrides NEO_BRAIN_URL
 * @param {string} [opts.serviceKey] — overrides NEO_BRAIN_SERVICE_ROLE_KEY
 * @returns {Promise<void>}
 */
export async function emitHeartbeat({ agentName, status = "ok", meta = {}, brainUrl, serviceKey } = {}) {
  if (!agentName || typeof agentName !== "string") {
    throw new Error("emitHeartbeat: agentName is required");
  }
  const url = brainUrl || process.env.NEO_BRAIN_URL;
  const key = serviceKey || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("emitHeartbeat: NEO_BRAIN_URL and NEO_BRAIN_SERVICE_ROLE_KEY must be set");
  }

  const body = {
    agent_name: agentName,
    status,
    meta: { protocol: PROTOCOL_VERSION, ...meta },
    reported_at: new Date().toISOString(),
  };

  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/agent_heartbeats?on_conflict=agent_name`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "<unreadable>");
    throw new Error(`heartbeat upsert failed ${res.status}: ${errBody.slice(0, 300)}`);
  }
}

/**
 * Start a long-running heartbeat loop. Returns a stop() function that emits a
 * final "offline" beat (best-effort) and clears the interval.
 *
 * The first beat fires immediately. If a beat fails, the error is logged via
 * `onError` (default: console.error) and the loop continues — never throws to
 * the caller. Failures don't crash the host process.
 *
 * @param {object} opts
 * @param {string} opts.agentName
 * @param {number} [opts.intervalMs=60000]
 * @param {() => {status?: string, meta?: object} | Promise<...>} [opts.getPayload]
 *        Called every tick. Return current status + meta. May be sync or async.
 *        Defaults to `() => ({ status: "ok", meta: {} })`.
 * @param {(err: Error) => void} [opts.onError]
 * @param {string} [opts.brainUrl]
 * @param {string} [opts.serviceKey]
 * @returns {() => Promise<void>}  — stop function (also unrefs interval)
 */
export function startHeartbeatLoop({
  agentName,
  intervalMs = 60_000,
  getPayload = () => ({ status: "ok", meta: {} }),
  onError = (err) => console.error(`[heartbeat:${agentName}] ${err.message}`),
  brainUrl,
  serviceKey,
} = {}) {
  if (!agentName) throw new Error("startHeartbeatLoop: agentName is required");

  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const p = (await getPayload()) || {};
      await emitHeartbeat({
        agentName,
        status: p.status || "ok",
        meta: p.meta || {},
        brainUrl,
        serviceKey,
      });
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  // Fire immediately, then on interval. Unref so the loop doesn't keep the
  // process alive on its own.
  tick();
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === "function") handle.unref();

  return async function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(handle);
    // Best-effort final "offline" beat so dashboards see graceful shutdown.
    try {
      await emitHeartbeat({ agentName, status: "offline", meta: { reason: "shutdown" }, brainUrl, serviceKey });
    } catch {
      // swallow — process is exiting anyway
    }
  };
}

export default { emitHeartbeat, startHeartbeatLoop };
