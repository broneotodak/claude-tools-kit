#!/usr/bin/env node
// tools/coach-browser-action.mjs — Phase 5b.2.1 interactive coaching tool.
//
// You do the workflow once in the Chrome window; this tool captures your clicks,
// text, and file uploads as stable selectors, lets you review/edit, and saves
// the sequence to browser_action_memory as a coached row. Future act() calls
// with the same {intent, domain, page} hit L3 and execute the sequence.
//
// Usage:
//   node tools/coach-browser-action.mjs --intent post_to_instagram --url https://www.instagram.com/
//
// Flags:
//   --intent <name>      required. cache key intent.
//   --url <url>          required. page to start on (must match the page you
//                        want future act() calls to execute on).
//   --profile <path>     optional. Chrome profile (default: .gemini/antigravity-browser-profile).
//
// Review commands:
//   r                    redisplay steps
//   d N                  delete step N
//   t N <varname>        template step N's text/file as {{varname}}
//   s                    save
//   a                    abort

import { createInterface } from "node:readline/promises";
import { stdin as stdinSource, stdout as stdoutSink } from "node:process";
import { ClawBrowserSession } from "./claw-browser-session.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return null;
  const v = process.argv[i + 1];
  return v.startsWith("--") ? null : v;
}

const intent = arg("intent");
const url = arg("url");
const profile = arg("profile") || ".gemini/antigravity-browser-profile";

if (!intent || !url) {
  console.error("Usage: node tools/coach-browser-action.mjs --intent <name> --url <url> [--profile <path>]");
  process.exit(1);
}

// Capture script. Installed via addInitScript so it survives navigation,
// AND injected into the already-loaded page via evaluate. Listeners use
// capture:true (gets events regardless of bubbling stopPropagation) and
// filter on e.isTrusted so we only record real user actions.
const installCapture = () => {
  if (window.__coach_installed) return;
  window.__coach_installed = true;
  window.__coach_steps = window.__coach_steps || [];

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return null;
    try {
      // aria-label — most stable on FB/IG (class names are hashed)
      const aria = el.getAttribute("aria-label");
      if (aria) return `[aria-label="${aria.replace(/"/g, '\\"')}"]`;

      // data-testid — when present, it's canonical
      const tid = el.dataset && el.dataset.testid;
      if (tid) return `[data-testid="${tid}"]`;

      // role + accessible name
      const role = el.getAttribute("role");
      const textRaw = (el.innerText || el.textContent || "").trim();
      if (role && textRaw) {
        const t = textRaw.slice(0, 60).replace(/"/g, '\\"');
        return `[role="${role}"]:has-text("${t}")`;
      }

      // semantic tags with visible text
      if (el.tagName === "BUTTON" && textRaw) {
        return `button:has-text("${textRaw.slice(0, 60).replace(/"/g, '\\"')}")`;
      }
      if (el.tagName === "A" && el.getAttribute("href")) {
        return `a[href="${el.getAttribute("href")}"]`;
      }

      // file input — by type + name if available, else just by type
      if (el.tagName === "INPUT" && el.type === "file") {
        if (el.name) return `input[type="file"][name="${el.name}"]`;
        if (el.accept) return `input[type="file"][accept="${el.accept}"]`;
        return `input[type="file"]`;
      }

      // plain id if present (rare on IG/FB)
      if (el.id) return `#${el.id}`;

      // fallback: short nth-of-type path up to 6 levels
      const path = [];
      let cur = el;
      while (cur && cur.tagName !== "BODY" && path.length < 6) {
        let seg = cur.tagName.toLowerCase();
        if (cur.parentElement) {
          const sibs = [...cur.parentElement.children].filter(c => c.tagName === cur.tagName);
          if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
        }
        path.unshift(seg);
        cur = cur.parentElement;
      }
      return path.join(" > ");
    } catch { return null; }
  }

  document.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    // walk up to the nearest button/a/[role] or 3 levels — clicks on inner spans are common
    let el = e.target;
    for (let i = 0; i < 4 && el && el.tagName !== "BUTTON" && el.tagName !== "A" && !el.getAttribute?.("role") && !el.getAttribute?.("aria-label"); i++) {
      el = el.parentElement;
    }
    el = el || e.target;
    const sel = selectorFor(el);
    if (!sel) return;
    const preview = (el.innerText || el.textContent || "").trim().slice(0, 40);
    window.__coach_steps.push({ type: "click_selector", selector: sel, preview, ts: Date.now() });
  }, true);

  document.addEventListener("input", (e) => {
    if (!e.isTrusted) return;
    const t = e.target;
    if (!t) return;
    const tag = t.tagName;
    const isText = (tag === "INPUT" && t.type !== "file" && t.type !== "submit" && t.type !== "button") ||
                   tag === "TEXTAREA" || t.isContentEditable;
    if (!isText) return;
    const sel = selectorFor(t);
    if (!sel) return;
    const val = t.isContentEditable ? (t.innerText || "") : (t.value || "");
    const steps = window.__coach_steps;
    const last = steps[steps.length - 1];
    if (last && last.type === "type_into" && last.selector === sel) {
      last.text = val;
      last.ts = Date.now();
    } else {
      steps.push({ type: "type_into", selector: sel, text: val, ts: Date.now() });
    }
  }, true);

  document.addEventListener("change", (e) => {
    if (!e.isTrusted) return;
    if (e.target.tagName === "INPUT" && e.target.type === "file") {
      const sel = selectorFor(e.target);
      if (!sel) return;
      window.__coach_steps.push({ type: "upload_file", selector: sel, file_path: "{{file}}", ts: Date.now() });
    }
  }, true);

  console.log("[coach] capture installed");
};

const session = await ClawBrowserSession.acquire({
  profile,
  pinRect: { w: 1440, h: 900 },
});

// addInitScript re-runs on every navigation, so steps persist in window.__coach_steps
// only within the current document — we accept that v1 coaching is single-page.
// For multi-page workflows, coach each page separately.
await session.context.addInitScript(installCapture);
console.error(`[coach] navigating to ${url}`);
await session.goto(url);
await session.page.evaluate(installCapture);

console.error("\n" + "=".repeat(60));
console.error("COACHING MODE ACTIVE");
console.error("=".repeat(60));
console.error(`Intent: ${intent}`);
console.error(`URL:    ${url}`);
console.error("Profile:", profile);
console.error("");
console.error("→ In the Chrome window on CLAW, do the workflow you want to teach.");
console.error("  File uploads are auto-templated as {{file}}.");
console.error("  Text entries are captured literally — you'll template them in review.");
console.error("  Clicks deep inside buttons will walk up to the nearest button/[role].");

const rl = createInterface({ input: stdinSource, output: stdoutSink });
await rl.question("\nPress Enter when the workflow is complete...");

let steps = await session.page.evaluate(() => window.__coach_steps || []);
console.error(`\n[coach] captured ${steps.length} step(s)`);

if (steps.length === 0) {
  console.error("[coach] nothing to save. aborting.");
  await session.release({ keepAlive: true }).catch(() => {});
  process.exit(1);
}

function printSteps(arr) {
  console.error("\n" + "-".repeat(60));
  for (let i = 0; i < arr.length; i++) {
    const s = arr[i];
    let line = `  ${String(i + 1).padStart(2)}. ${s.type.padEnd(14)} ${s.selector}`;
    if (s.type === "type_into") line += `\n       text: "${(s.text || "").slice(0, 60)}"`;
    else if (s.type === "upload_file") line += `\n       file: ${s.file_path}`;
    else if (s.type === "click_selector" && s.preview) line += `\n       preview: "${s.preview}"`;
    console.error(line);
  }
  console.error("-".repeat(60));
}

// Review loop
while (true) {
  printSteps(steps);
  const raw = (await rl.question("\n[r]edisplay / [d N] delete / [t N varname] template / [s]ave / [a]bort: ")).trim();
  const parts = raw.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  if (cmd === "a") {
    console.error("[coach] aborted, nothing saved.");
    rl.close();
    await session.release({ keepAlive: true }).catch(() => {});
    process.exit(0);
  }
  if (cmd === "s") break;
  if (cmd === "r" || !cmd) continue;
  if (cmd === "d") {
    const n = parseInt(parts[1], 10);
    if (!Number.isInteger(n) || n < 1 || n > steps.length) { console.error("bad index"); continue; }
    steps.splice(n - 1, 1);
    continue;
  }
  if (cmd === "t") {
    const n = parseInt(parts[1], 10);
    const varname = parts[2];
    if (!Number.isInteger(n) || n < 1 || n > steps.length || !varname) {
      console.error("usage: t <step_number> <varname>"); continue;
    }
    const s = steps[n - 1];
    if (s.type === "type_into") s.text = `{{${varname}}}`;
    else if (s.type === "upload_file") s.file_path = `{{${varname}}}`;
    else { console.error("only type_into and upload_file can be templated"); continue; }
    continue;
  }
  console.error(`unknown command: "${raw}"`);
}

rl.close();

// Strip ephemera before saving
const cleanedSteps = steps.map(({ ts, preview, ...rest }) => rest);
const action = { type: "sequence", steps: cleanedSteps };

// Compute cache key from CURRENT page state (where you ended up after the
// workflow may not be the intent's landing page — but the lookup key is set
// when act() is called on the ORIGINAL URL, so we hash the URL the user gave).
const { createHash } = await import("node:crypto");
const originalPath = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
const originalDomain = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
const originalTitle = ""; // title is unknown before the page loads; use empty string so act()'s lookup matches.
const pageStateHash = createHash("sha256").update(`${originalPath}::${originalTitle}`).digest("hex");
const intentHash = createHash("sha256").update(intent.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");

// If the workflow is on the original page AND the page has a title now, ALSO write a
// row keyed with the real title — whichever matches at act()-time wins.
const realTitle = await session.page.title().catch(() => "");
const realPageStateHash = createHash("sha256").update(`${originalPath}::${realTitle.trim()}`).digest("hex");

console.error("\n[coach] cache key candidates:");
console.error(`  domain:       ${originalDomain}`);
console.error(`  page path:    ${originalPath}`);
console.error(`  page title:   "${realTitle}"`);
console.error(`  intent:       "${intent}"`);
console.error(`  intent_hash:  ${intentHash.slice(0, 16)}…`);

try {
  const id1 = await session.coachAction({
    domain: originalDomain,
    pageStateHash: realPageStateHash,
    intentHash,
    action,
    notes: `human-coached for intent "${intent}" at ${new Date().toISOString()}`,
  });
  console.error(`[coach] SAVED row id=${id1} (page_state_hash keyed on real title)`);
  console.error(`\n[coach] next act({intent:"${intent}", url_context:"${url}", vars:{...}}) will hit L3.`);
} catch (e) {
  console.error(`[coach] save failed: ${e.message}`);
  await session.release({ keepAlive: true }).catch(() => {});
  process.exit(1);
}

await session.release({ keepAlive: true }).catch(() => {});
process.exit(0);
