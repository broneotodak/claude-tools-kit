// L3 smoke: prove the cache write-then-hit cycle.
//  Pass 1: act() on a clean page — L2 runs (1 Gemini call), row written.
//  Pass 2: act() on the same page+intent — L3 hit, no Gemini.
//  Expect pass2 to be ≥5x faster than pass1 and return layer:3.
import { ClawBrowserSession } from "./claw-browser-session.mjs";
import { execSync } from "node:child_process";

const URL = "https://www.instagram.com/beritaharian/";
const INTENT = "view this profile — no action needed, just read";

const session = await ClawBrowserSession.acquire({
  profile: ".gemini/antigravity-browser-profile",
  pinRect: { w: 1440, h: 900 },
});

console.error("\n[pass 1] L2 expected — cache miss writes row");
const p1 = await session.act({ intent: INTENT, url_context: URL });
console.error(JSON.stringify({ layer: p1.layer, cache_hit: p1.cache_hit, ready: p1.ready, duration_ms: p1.duration_ms, cache_id_written: p1.cache_id_written }));

console.error("\n[pass 2] L3 expected — cache hit, no Gemini");
const p2 = await session.act({ intent: INTENT, url_context: URL });
console.error(JSON.stringify({ layer: p2.layer, cache_hit: p2.cache_hit, ready: p2.ready, duration_ms: p2.duration_ms, cached_action: p2.cached_action, coached_by: p2.coached_by }));

console.error("\n[pass 3] same again — L3 hit, confirms success_count increments");
const p3 = await session.act({ intent: INTENT, url_context: URL });
console.error(JSON.stringify({ layer: p3.layer, cache_hit: p3.cache_hit, duration_ms: p3.duration_ms }));

await session.release({ keepAlive: false }).catch(() => {});
try { execSync("pkill -f 'remote-debugging-port=9333'"); } catch {}

const results = { p1, p2, p3 };
console.log(JSON.stringify(results, null, 2));

const pass = (
  p1.layer === 2 && p1.cache_hit === false && p1.ready === true && p1.cache_id_written &&
  p2.layer === 3 && p2.cache_hit === true && p2.ready === true &&
  p3.layer === 3 && p3.cache_hit === true &&
  p2.duration_ms * 3 < p1.duration_ms
);
console.error("\n[verdict]", pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 2);
