// Phase 5b.1 step 3 (v2) — golden-path evals mapped to Neo's real social-media workflows.
// Chrome is long-lived (persistent launchd service or manually launched). We attach,
// never spawn new, NEVER kill. Each run calls session.act() (full L3→L2 flow) and
// records a row in browser_eval_runs.

import { ClawBrowserSession } from "./claw-browser-session.mjs";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const EVAL_DIR = join(homedir(), ".openclaw/media/browser-evals");
if (!existsSync(EVAL_DIR)) mkdirSync(EVAL_DIR, { recursive: true });

const EVALS = [
  {
    label: "ig-post-create",
    url: "https://www.instagram.com/",
    intent: "start a new post from the feed",
    project: "social-media-posting",
  },
  {
    label: "fb-post-create",
    url: "https://www.facebook.com/",
    intent: "start a new post in the composer",
    project: "social-media-posting",
  },
  {
    label: "ig-dm-inbox",
    url: "https://www.instagram.com/direct/inbox/",
    intent: "open the most recent conversation to reply",
    project: "twin-autoreply",
  },
  {
    label: "fb-dm-inbox",
    url: "https://www.facebook.com/messages/",
    intent: "open the most recent conversation to reply",
    project: "twin-autoreply",
  },
];

async function withRetry(fn, { attempts = 3, baseMs = 1500 } = {}) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const msg = String(e.message || e);
      const is429 = msg.includes("gemini 429") || msg.includes("RESOURCE_EXHAUSTED");
      if (!is429 || i === attempts) throw e;
      const wait = baseMs * Math.pow(2, i - 1);
      console.error(`[retry ${i}] 429 — sleeping ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

const started = Date.now();
console.error(`[evals] start ${new Date().toISOString()}`);

let session;
try {
  session = await ClawBrowserSession.acquire({
    profile: ".gemini/antigravity-browser-profile",
    pinRect: { w: 1440, h: 900 },
  });
} catch (e) {
  console.error("[evals] acquire failed:", e.message);
  process.exit(1);
}

const results = [];
for (const ev of EVALS) {
  console.error(`\n[eval] ${ev.label} :: ${ev.url}`);
  const out = { label: ev.label, project: ev.project, url: ev.url, intent: ev.intent, ts: new Date().toISOString() };
  try {
    const r = await withRetry(() => session.act({ intent: ev.intent, url_context: ev.url, timeout_ms: 45000 }));
    const shot = await session.screenshot({ name: `eval-${ev.label}` });
    Object.assign(out, {
      status: "ok",
      layer: r.layer,
      cache_hit: r.cache_hit,
      duration_ms: r.duration_ms,
      ready: r.ready,
      cached_action: r.cached_action || null,
      coached_by: r.coached_by || null,
      overlay_detected: r.preflight?.overlay_detected ?? null,
      dismissed: r.preflight?.dismissed ?? null,
      preflight_description: r.preflight?.verdict?.overlay_description || null,
      final_url: r.url,
      screenshot: shot.path,
    });
    // Replay log in neo-brain
    await session.recordEvalRun({
      task_label: ev.label,
      domain: r.domain,
      intent: ev.intent,
      resolved_at_layer: r.layer,
      success: !!r.ready,
      duration_ms: r.duration_ms,
      preflight_ms: r.preflight ? r.duration_ms : null,
      screenshots_url: [shot.path],
      failure_reason: r.ready ? null : (r.preflight?.verdict?.overlay_description || "not ready"),
      metadata: { project: ev.project, url: ev.url, cache_hit: r.cache_hit, coached_by: r.coached_by || null },
    }).catch(e => console.error("[eval] recordEvalRun failed:", e.message));
  } catch (e) {
    out.status = "error";
    out.error = String(e.message || e);
    try { out.screenshot = (await session.screenshot({ name: `eval-${ev.label}-error` })).path; } catch {}
  }
  console.error(`[eval] ${ev.label} ->`, JSON.stringify({ status: out.status, layer: out.layer, cache_hit: out.cache_hit, ms: out.duration_ms, ready: out.ready, err: out.error }));
  results.push(out);
  await new Promise(r => setTimeout(r, 1200));
}

// Graceful disconnect — leaves Chrome alive. Sessions persist across runs.
await session.release({ keepAlive: true }).catch(() => {});

const outPath = join(EVAL_DIR, `evals-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(outPath, JSON.stringify({ started: new Date(started).toISOString(), ended: new Date().toISOString(), total_ms: Date.now() - started, results }, null, 2));
console.error(`\n[evals] results -> ${outPath}`);

console.log(JSON.stringify({ outPath, total_ms: Date.now() - started, results }, null, 2));
process.exit(results.every(r => r.status === "ok") ? 0 : 2);
