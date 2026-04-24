// Phase 5b.1.1 smoke — screenshot media bridge.
// 1) act({withScreenshot:true}) on an IG profile → expect media_id + media_url.
// 2) Query neo-brain media table → expect the row to exist with caption containing intent + domain.
// 3) Direct screenshot({uploadToBrain:false}) → expect just {path}, no media_id.
// 4) Direct screenshot({uploadToBrain:true, intent:...}) → expect media_id + media_url.
//
// Runs on CLAW. Never kills Chrome.

import { ClawBrowserSession } from "./claw-browser-session.mjs";
import { NeoBrain } from "../packages/memory/src/index.js";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// hydrate .env so NEO_BRAIN_URL + SERVICE_ROLE_KEY resolve
const CTK_ENV = join(homedir(), "Projects/claude-tools-kit/.env");
if (existsSync(CTK_ENV)) {
  for (const line of readFileSync(CTK_ENV, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}

const URL = "https://www.instagram.com/beritaharian/";
const INTENT = "screenshot this profile for Neo";

const session = await ClawBrowserSession.acquire({
  profile: ".gemini/antigravity-browser-profile",
  pinRect: { w: 1440, h: 900 },
});
const brain = new NeoBrain({ agent: "test-claw-browser-5b1.1" });

const results = {};

// --- pass 1: act with withScreenshot:true ---
console.error("\n[pass 1] act({withScreenshot:true}) on IG profile");
const p1 = await session.act({ intent: INTENT, url_context: URL, withScreenshot: true });
results.act = {
  layer: p1.layer,
  ready: p1.ready,
  cache_hit: p1.cache_hit,
  screenshot_media_id: p1.screenshot_media_id,
  screenshot_url: p1.screenshot_url ? p1.screenshot_url.slice(0, 80) + "…" : null,
  screenshot_path: p1.screenshot_path,
  screenshot_error: p1.screenshot_error || null,
};
console.error(JSON.stringify(results.act, null, 2));

// --- pass 2: verify row in neo-brain media table ---
console.error("\n[pass 2] verify row in neo-brain media table");
if (p1.screenshot_media_id) {
  const { data, error } = await brain.sb
    .from("media")
    .select("id, kind, mime_type, bytes, caption, source, source_ref, storage_url")
    .eq("id", p1.screenshot_media_id)
    .maybeSingle();
  if (error) throw new Error(`media row lookup failed: ${error.message}`);
  results.media_row = data;
  console.error(JSON.stringify(data, null, 2));
} else {
  results.media_row = null;
  console.error("SKIPPED — no screenshot_media_id from pass 1");
}

// --- pass 3: screenshot({uploadToBrain:false}) defaults ---
console.error("\n[pass 3] screenshot({uploadToBrain:false}) — path only, no upload");
const p3 = await session.screenshot({ name: "p3-no-upload" });
results.no_upload = p3;
console.error(JSON.stringify(p3));

// --- pass 4: screenshot({uploadToBrain:true, intent}) direct ---
console.error("\n[pass 4] screenshot({uploadToBrain:true, intent}) direct upload");
const p4 = await session.screenshot({
  name: "p4-direct-upload",
  uploadToBrain: true,
  intent: "direct screenshot call test",
});
results.direct_upload = {
  path: p4.path,
  media_id: p4.media_id,
  media_url: p4.media_url ? p4.media_url.slice(0, 80) + "…" : null,
  upload_error: p4.upload_error || null,
};
console.error(JSON.stringify(results.direct_upload, null, 2));

await session.release({ keepAlive: true }).catch(() => {});

// --- verdict ---
const domain = "instagram.com";
const captionOk =
  results.media_row &&
  results.media_row.caption &&
  results.media_row.caption.includes(INTENT) &&
  results.media_row.caption.includes(domain);

const pass =
  p1.layer !== undefined &&
  p1.ready === true &&
  p1.screenshot_media_id &&
  p1.screenshot_url &&
  results.media_row &&
  results.media_row.kind === "image" &&
  results.media_row.mime_type === "image/png" &&
  results.media_row.bytes > 1000 &&
  captionOk &&
  results.media_row.source === "claw-browser-session" &&
  results.media_row.source_ref?.url === URL &&
  p3.media_id === undefined &&
  p3.path &&
  p4.media_id &&
  p4.media_url;

console.log(JSON.stringify(results, null, 2));
console.error("\n[verdict]", pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 2);
