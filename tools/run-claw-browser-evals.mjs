// Phase 5b.1 step 3 — 3 golden-path evals.
// Ephemeral Chrome: launch → run evals → kill Chrome + exit.
// Output: JSON array of results written to ~/.openclaw/media/browser-evals/<ts>.json
// Each eval captures nav_ms, preflight_ms, screenshot, overlay verdict.

import { ClawBrowserSession } from "./claw-browser-session.mjs";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const EVAL_DIR = join(homedir(), ".openclaw/media/browser-evals");
if (!existsSync(EVAL_DIR)) mkdirSync(EVAL_DIR, { recursive: true });

const EVALS = [
  {
    label: "ig-profile-lookup",
    url: "https://www.instagram.com/beritaharian/",
    intent: "view this profile — no action needed, just read",
    project: "twin-profile-lookup",
  },
  {
    label: "fb-marketplace",
    url: "https://www.facebook.com/marketplace/",
    intent: "browse marketplace listings",
    project: "socmed-feed-reading",
  },
  {
    label: "higgsfield-create",
    url: "https://higgsfield.ai/create",
    intent: "kick off a new video generation",
    project: "higgsfield-video-flow",
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
    const navStart = Date.now();
    const nav = await session.goto(ev.url, { timeout: 45000 });
    out.nav_ms = Date.now() - navStart;
    out.final_url = nav.url;
    out.title = nav.title;

    const preStart = Date.now();
    const pre = await withRetry(() => session.preflight({ intent: ev.intent }));
    out.preflight_ms = Date.now() - preStart;
    out.overlay_detected = pre.overlay_detected;
    out.dismissed = pre.dismissed ?? null;
    out.preflight_attempts = pre.attempts;
    out.verdict_description = pre.verdict?.overlay_description || null;

    const shot = await session.screenshot({ name: `eval-${ev.label}` });
    out.screenshot = shot;
    out.status = "ok";
    out.ready = !pre.overlay_detected || pre.dismissed === true;
  } catch (e) {
    out.status = "error";
    out.error = String(e.message || e);
    try { out.screenshot = await session.screenshot({ name: `eval-${ev.label}-error` }); } catch {}
  }
  console.error(`[eval] ${ev.label} ->`, JSON.stringify({ status: out.status, nav_ms: out.nav_ms, preflight_ms: out.preflight_ms, overlay: out.overlay_detected, ready: out.ready, err: out.error }));
  results.push(out);
  // polite spacing to avoid hammering Gemini RPM
  await new Promise(r => setTimeout(r, 1200));
}

await session.release({ keepAlive: false }).catch(() => {});

const outPath = join(EVAL_DIR, `evals-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(outPath, JSON.stringify({ started: new Date(started).toISOString(), ended: new Date().toISOString(), total_ms: Date.now() - started, results }, null, 2));
console.error(`\n[evals] results -> ${outPath}`);

// Kill Chrome on :9333 per user request — no overnight browsers.
try {
  execSync("pkill -f remote-debugging-port=9333", { stdio: "ignore" });
  console.error("[evals] Chrome on :9333 killed");
} catch {}

console.log(JSON.stringify({ outPath, total_ms: Date.now() - started, results }, null, 2));
process.exit(results.every(r => r.status === "ok") ? 0 : 2);
