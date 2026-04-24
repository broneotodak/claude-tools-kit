// Phase 5b.2.1 smoke test — primitives + template vars + L3 sequence execution.
//
// Part A: wrapper primitives (readText) against example.com.
// Part B: template var substitution — executeAction directly with {{var}}.
// Part C: end-to-end L3 hit — write a coached sequence row, call act(), verify
//         layer=3 + cache_hit=true + action_output matches executed steps.
// Cleans up test rows from browser_action_memory on exit.

import { createHash } from "node:crypto";
import { ClawBrowserSession } from "./claw-browser-session.mjs";
import { NeoBrain } from "../packages/memory/src/index.js";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CTK_ENV = join(homedir(), "Projects/claude-tools-kit/.env");
if (existsSync(CTK_ENV)) {
  for (const line of readFileSync(CTK_ENV, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}

const TEST_URL = "https://example.com/";
const TEST_INTENT = "smoke-5b2-read-example-sections";
const TEST_VAR_INTENT = "smoke-5b2-template-substitution";

const session = await ClawBrowserSession.acquire({
  profile: ".gemini/antigravity-browser-profile",
  pinRect: { w: 1440, h: 900 },
});
const brain = new NeoBrain({ agent: "test-claw-browser-5b2" });

const created = []; // ids to delete on exit
const results = {};
let pass = true;

try {
  await session.goto(TEST_URL);

  // --- Part A: primitives ---
  console.error("\n[A] session.readText('h1')");
  const h1 = await session.readText("h1");
  results.readText_h1 = h1;
  console.error(`     → "${h1}"`);
  if (h1 !== "Example Domain") { console.error("     FAIL expected 'Example Domain'"); pass = false; }

  console.error("\n[A] session.readAttr('a', 'href') — link to IANA");
  const href = await session.readAttr("a", "href");
  results.readAttr_a = href;
  console.error(`     → ${href}`);
  if (!href || !href.includes("iana.org")) { console.error("     FAIL expected an iana.org link"); pass = false; }

  // --- Part B: template vars via executeAction ---
  console.error("\n[B] executeAction({type:read_text, selector:'{{sel}}'}, vars:{sel:'h1'})");
  const b = await session.executeAction(
    { type: "read_text", selector: "{{sel}}" },
    { vars: { sel: "h1" } }
  );
  results.template_var = b.output;
  console.error(`     → "${b.output}"`);
  if (b.output !== "Example Domain") { console.error("     FAIL template substitution broken"); pass = false; }

  // --- Part C: end-to-end L3 hit with a real coached sequence ---
  console.error("\n[C] write coached sequence row then call act() → expect L3 hit");
  const title = await session.page.title().catch(() => "");
  const domain = "example.com";
  const path = new URL(TEST_URL).pathname;
  const pageStateHash = createHash("sha256").update(`${path}::${title.trim()}`).digest("hex");
  const intentHash = createHash("sha256").update(TEST_INTENT.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");

  // Clean stale if rerun
  await brain.sb.from("browser_action_memory")
    .delete()
    .eq("domain", domain)
    .eq("page_state_hash", pageStateHash)
    .eq("intent_hash", intentHash);

  const action = {
    type: "sequence",
    steps: [
      { type: "read_text", selector: "h1" },
      { type: "read_text", selector: "p" },
    ],
  };
  const rowId = await session.coachAction({
    domain, pageStateHash, intentHash,
    action,
    notes: `5b.2.1 smoke test — ${new Date().toISOString()}`,
  });
  created.push(rowId);
  console.error(`     coached row id=${rowId}`);

  const r = await session.act({ intent: TEST_INTENT, url_context: TEST_URL });
  results.act = {
    layer: r.layer,
    cache_hit: r.cache_hit,
    coached_by: r.coached_by,
    ready: r.ready,
    action_output: r.action_output,
    duration_ms: r.duration_ms,
  };
  console.error(`     layer=${r.layer} cache_hit=${r.cache_hit} coached_by=${r.coached_by} ready=${r.ready}`);
  console.error(`     action_output: ${JSON.stringify(r.action_output)}`);

  if (r.layer !== 3) { console.error("     FAIL expected layer 3"); pass = false; }
  if (r.cache_hit !== true) { console.error("     FAIL expected cache_hit true"); pass = false; }
  if (r.coached_by !== "human") { console.error("     FAIL expected coached_by=human"); pass = false; }
  if (!Array.isArray(r.action_output) || r.action_output.length !== 2) {
    console.error("     FAIL action_output should be array of 2 step outputs"); pass = false;
  } else {
    if (r.action_output[0].output !== "Example Domain") { console.error("     FAIL step 1 should return h1 text"); pass = false; }
    if (!r.action_output[1].output || r.action_output[1].output.length < 20) {
      console.error("     FAIL step 2 should return the first paragraph (non-empty, ≥20 chars)");
      pass = false;
    }
  }

  // --- Part D: template vars through act() + sequence ---
  console.error("\n[D] coached sequence with {{var}} + act({vars}) → expect substitution");
  const varIntentHash = createHash("sha256").update(TEST_VAR_INTENT.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
  await brain.sb.from("browser_action_memory")
    .delete()
    .eq("domain", domain)
    .eq("page_state_hash", pageStateHash)
    .eq("intent_hash", varIntentHash);

  const varAction = {
    type: "sequence",
    steps: [{ type: "read_text", selector: "{{target}}" }],
  };
  const varRowId = await session.coachAction({
    domain, pageStateHash, intentHash: varIntentHash,
    action: varAction,
    notes: "5b.2.1 smoke — template vars",
  });
  created.push(varRowId);

  const d = await session.act({ intent: TEST_VAR_INTENT, url_context: TEST_URL, vars: { target: "h1" } });
  results.act_with_vars = {
    layer: d.layer,
    cache_hit: d.cache_hit,
    action_output: d.action_output,
  };
  console.error(`     layer=${d.layer} cache_hit=${d.cache_hit}`);
  console.error(`     action_output: ${JSON.stringify(d.action_output)}`);

  if (d.layer !== 3 || d.cache_hit !== true) { console.error("     FAIL expected L3 hit"); pass = false; }
  if (!Array.isArray(d.action_output) || d.action_output[0]?.output !== "Example Domain") {
    console.error("     FAIL vars substitution didn't resolve into selector"); pass = false;
  }

} finally {
  // cleanup test rows regardless of pass/fail
  if (created.length) {
    const { error } = await brain.sb.from("browser_action_memory").delete().in("id", created);
    if (error) console.error(`[cleanup] delete failed: ${error.message}`);
    else console.error(`\n[cleanup] deleted ${created.length} test row(s)`);
  }
  await session.release({ keepAlive: true }).catch(() => {});
}

console.log(JSON.stringify(results, null, 2));
console.error("\n[verdict]", pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 2);
