// ClawBrowserSession — Phase 5b.1 L1 + L2 + L3 wrapper
// Attaches to a persistent Chrome on CLAW via CDP (separate automation profile).
// L1: window pin + acquire/goto/screenshot.
// L2: Gemini 2.5 Flash overlay preflight + dismiss.
// L3: click-memory cache in neo-brain — checked BEFORE L2, written AFTER L2 win.
// L4: vision fallback — not yet implemented.
//
// Profile: ~/.gemini/antigravity-browser-profile (logged-in automation profile)
// Port:    9333 (9222 is the openclaw gateway — do NOT share)
// Creds:   neo-brain credentials vault (service=google_gemini, type=api_key)
// Tables:  browser_action_memory (cache), browser_eval_runs (replay log)

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { NeoBrain } from "../packages/memory/src/index.js";

const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_PORT = 9333;
const DEFAULT_PROFILE = join(homedir(), ".gemini/antigravity-browser-profile");
const SCREENSHOT_DIR = join(homedir(), ".openclaw/media/screenshots");
const CTK_ENV = join(homedir(), "Projects/claude-tools-kit/.env");
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Hydrate process.env from CTK .env so NeoBrain picks up NEO_BRAIN_URL / SERVICE_ROLE_KEY.
(function hydrateEnv() {
  if (!existsSync(CTK_ENV)) return;
  for (const line of readFileSync(CTK_ENV, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (!process.env[k]) process.env[k] = v.replace(/^"(.*)"$/, "$1");
  }
})();

let _brain = null;
let _geminiKey = null;
function brain() {
  if (_brain) return _brain;
  _brain = new NeoBrain({ agent: "claw-browser-session" });
  return _brain;
}
async function geminiKey() {
  if (_geminiKey) return _geminiKey;
  _geminiKey = await brain().getCredentialValue("google_gemini", { type: "api_key" });
  return _geminiKey;
}

async function cdpVersion(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
    if (r.ok) return await r.json();
  } catch {}
  return null;
}

async function waitForCdp(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await cdpVersion(port);
    if (v) return v;
    await sleep(250);
  }
  throw new Error(`CDP on :${port} did not come up within ${timeoutMs}ms`);
}

function launchChrome({ port, userDataDir }) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-fre",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-features=Translate,MediaRouter,OfferMigrationToDiceUsers,OptGuideOnDeviceModel",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--password-store=basic",
    "--ash-no-nudges",
    "--auto-accept-browser-signin-for-tests",
  ];
  const child = spawn("/usr/bin/open", ["-a", "Google Chrome", "--new", "--args", ...args], { detached: true, stdio: "ignore" });
  child.unref();
  return child.pid;
}

// --- L2 preflight: Gemini 2.0 Flash ---
const PREFLIGHT_PROMPT = (intent) => `You are a UI preflight assistant for a web-automation agent. The agent wants to do this on the page you are looking at:

INTENT: ${intent}

First: is any overlay/modal/popup/ad/cookie-banner/login-nag/paywall actually BLOCKING the intent? A normal page feed or empty state is NOT a blocker — only flag things that obstruct the user.

If NO → return overlay_detected=false, dismiss_strategy.type="none".

If YES → return a dismiss_strategy. RULES for picking it:
1. Prefer dismiss_strategy.type="click_coords" ONLY when you can precisely locate a small dismiss control — a close "X", close icon, or a short text button like "Skip", "No thanks", "Maybe later", "Not now", "Continue without signing in". These controls are typically SMALL (roughly 20-100 pixels on each side) and usually in the TOP-RIGHT CORNER of the overlay, or as a small secondary action near the bottom.
2. Return the pixel coordinates of the CENTER OF THAT SMALL CONTROL — not the center of the whole modal. Coordinates are in a 1440x900 viewport, origin top-left.
3. If you cannot confidently locate a small dismiss control, set dismiss_strategy.type="keyboard_esc" instead. Do NOT guess modal-center coords — that almost never dismisses anything.
4. Also set overlay_description to one short sentence describing the blocker.`;

const PREFLIGHT_SCHEMA = {
  type: "object",
  properties: {
    overlay_detected: { type: "boolean" },
    overlay_description: { type: "string" },
    dismiss_strategy: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["click_coords", "keyboard_esc", "none"] },
        x: { type: "integer" },
        y: { type: "integer" },
      },
      required: ["type"],
    },
    confidence: { type: "number" },
  },
  required: ["overlay_detected", "dismiss_strategy"],
};

// Pick the first non-devtools tab whose target has a window; otherwise create one via CDP.
async function _selectOrCreateTabWithWindow(browser, context) {
  const existing = context.pages().filter(p => !p.url().startsWith("devtools://"));
  for (const page of existing) {
    try {
      const cdp = await context.newCDPSession(page);
      const { windowId } = await cdp.send("Browser.getWindowForTarget");
      await cdp.detach().catch(() => {});
      if (windowId) return page;
    } catch {}
  }
  // No windowed tab — ask the browser to create one explicitly.
  // Use Target.createTarget with newWindow:true via a throwaway CDP session on an existing page.
  const scratch = existing[0] || await context.newPage();
  const cdp = await context.newCDPSession(scratch);
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", newWindow: true });
    await cdp.detach().catch(() => {});
    // Poll Playwright's page list for the new target.
    for (let i = 0; i < 20; i++) {
      await sleep(150);
      const found = context.pages().find(p => {
        try { return p.mainFrame()._page?._guid && !p.url().startsWith("devtools://") && p !== scratch; }
        catch { return false; }
      }) || context.pages().find(p => p.url() === "about:blank" && p !== scratch);
      if (found) return found;
    }
    // Last resort: return scratch anyway; pinWindow will retry.
    return scratch;
  } catch (e) {
    await cdp.detach().catch(() => {});
    throw new Error(`unable to create windowed tab: ${e.message}`);
  }
}

// --- L3 cache helpers ---
function sha256hex(s) { return createHash("sha256").update(s).digest("hex"); }
function normalizedDomain(urlStr) {
  try { return new URL(urlStr).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function computePageStateHash(urlStr, title) {
  // Stable fingerprint of "what page am I on": path + page title.
  // Query strings and fragments excluded so `/marketplace/?foo=1` collides with `/marketplace/`.
  let path = "";
  try { path = new URL(urlStr).pathname; } catch {}
  return sha256hex(`${path}::${(title || "").trim()}`);
}
function computeIntentHash(intent) {
  return sha256hex(String(intent).trim().toLowerCase().replace(/\s+/g, " "));
}

async function geminiPreflight({ apiKey, screenshotBuf, intent, timeoutMs = 15000 }) {
  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: PREFLIGHT_PROMPT(intent) },
        { inline_data: { mime_type: "image/png", data: screenshotBuf.toString("base64") } },
      ],
    }],
    generationConfig: {
      temperature: 0,
      response_mime_type: "application/json",
      response_schema: PREFLIGHT_SCHEMA,
      maxOutputTokens: 512,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const r = await fetch(GEMINI_URL(GEMINI_MODEL, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`gemini empty response: ${JSON.stringify(data).slice(0, 300)}`);
  return JSON.parse(text);
}

export class ClawBrowserSession {
  constructor({ browser, context, page, port, userDataDir }) {
    this.browser = browser;
    this.context = context;
    this.page = page;
    this.port = port;
    this.userDataDir = userDataDir;
  }

  static async acquire({ profile, pinRect, port } = {}) {
    const userDataDir = profile ? (profile.startsWith("/") ? profile : join(homedir(), profile)) : DEFAULT_PROFILE;
    const cdpPort = port || DEFAULT_PORT;
    const rect = pinRect || { w: 1440, h: 900, x: 0, y: 0 };

    let info = await cdpVersion(cdpPort);
    if (!info) {
      const pid = launchChrome({ port: cdpPort, userDataDir });
      console.error(`[claw-browser] launched Chrome pid=${pid} port=${cdpPort} profile=${userDataDir}`);
      info = await waitForCdp(cdpPort);
    } else {
      console.error(`[claw-browser] attaching to existing Chrome on :${cdpPort} (${info.Browser})`);
    }

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const [context] = browser.contexts();
    if (!context) throw new Error("no browser context available via CDP");

    // Pick or create a TAB target with an associated window. Direct spawn/open from
    // SSH can give us a target without a window (screen locked, no GUI session, etc);
    // if that happens, fall back to CDP Target.createTarget with newWindow=true.
    let page = await _selectOrCreateTabWithWindow(browser, context);

    const session = new ClawBrowserSession({ browser, context, page, port: cdpPort, userDataDir });
    await session.pinWindow(rect);
    return session;
  }

  async pinWindow({ w = 1440, h = 900, x = 0, y = 0 } = {}) {
    const cdp = await this.context.newCDPSession(this.page);
    try {
      // Retry getWindowForTarget — on fresh Chrome launch the window attaches slightly later than the target.
      let windowId;
      for (let attempt = 0; attempt < 10; attempt++) {
        try { ({ windowId } = await cdp.send("Browser.getWindowForTarget")); break; }
        catch (e) { if (attempt === 9) throw e; await sleep(300); }
      }
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: x, top: y, width: w, height: h } });
      await this.page.setViewportSize({ width: w, height: h }).catch(() => {});
    } finally {
      await cdp.detach().catch(() => {});
    }
  }

  async goto(url, { waitUntil = "domcontentloaded", timeout = 30000 } = {}) {
    await this.page.goto(url, { waitUntil, timeout });
    return { url: this.page.url(), title: await this.page.title().catch(() => null) };
  }

  async screenshot({ name, fullPage = false } = {}) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = (name || "shot").replace(/[^a-z0-9_-]/gi, "_");
    const filepath = join(SCREENSHOT_DIR, `${ts}-${slug}.png`);
    await this.page.screenshot({ path: filepath, fullPage });
    return filepath;
  }

  // L2: ask Gemini Flash whether an overlay blocks the intent; dismiss if yes.
  // Returns { overlay_detected, overlay_description, dismissed, attempts, screenshots }.
  async preflight({ intent, maxAttempts = 2, settleMs = 600 } = {}) {
    if (!intent) throw new Error("preflight requires intent");
    const key = await geminiKey();
    const screenshots = [];
    let lastVerdict = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const buf = await this.page.screenshot({ fullPage: false });
      const shotPath = await this.screenshot({ name: `preflight-attempt${attempt}` });
      screenshots.push(shotPath);
      const verdict = await geminiPreflight({ apiKey: key, screenshotBuf: buf, intent });
      console.error(`[preflight attempt ${attempt}]`, JSON.stringify(verdict));
      lastVerdict = verdict;
      if (!verdict.overlay_detected) {
        return { overlay_detected: false, attempts: attempt, screenshots, verdict };
      }
      // Escalation: attempt 1 trusts Gemini; attempt 2+ forces keyboard_esc.
      // Gemini 2.5 Flash often gives modal-center coords for click_coords — unreliable for small X buttons.
      // Esc dismisses most real-world modals universally.
      const strat = attempt >= 2 ? { type: "keyboard_esc" } : (verdict.dismiss_strategy || { type: "none" });
      if (strat.type === "click_coords" && Number.isFinite(strat.x) && Number.isFinite(strat.y)) {
        await this.page.mouse.click(strat.x, strat.y);
      } else if (strat.type === "keyboard_esc") {
        await this.page.keyboard.press("Escape");
      } else {
        // Gemini said overlay but offered no strategy — escalate to Esc once.
        if (attempt < maxAttempts) { await this.page.keyboard.press("Escape"); await sleep(settleMs); continue; }
        return { overlay_detected: true, dismissed: false, attempts: attempt, screenshots, verdict };
      }
      await sleep(settleMs);
    }
    // Final verification pass — did the last action actually clear the overlay?
    const finalBuf = await this.page.screenshot({ fullPage: false });
    const finalShot = await this.screenshot({ name: "preflight-final-verify" });
    screenshots.push(finalShot);
    const finalVerdict = await geminiPreflight({ apiKey: key, screenshotBuf: finalBuf, intent });
    console.error("[preflight final-verify]", JSON.stringify(finalVerdict));
    if (!finalVerdict.overlay_detected) {
      return { overlay_detected: true, dismissed: true, attempts: maxAttempts, screenshots, verdict: finalVerdict };
    }
    return { overlay_detected: true, dismissed: false, attempts: maxAttempts, screenshots, verdict: finalVerdict };
  }

  // --- L3 cache I/O ---

  async lookupAction({ domain, pageStateHash, intentHash }) {
    const { data, error } = await brain().sb.from("browser_action_memory")
      .select("id, action, success_count, fail_count, coached_by, last_success_at")
      .eq("domain", domain)
      .eq("page_state_hash", pageStateHash)
      .eq("intent_hash", intentHash)
      .maybeSingle();
    if (error) throw new Error(`lookupAction: ${error.message}`);
    return data || null;
  }

  async upsertAction({ domain, pageStateHash, intentHash, action, coachedBy = null, notes = null }) {
    const { data, error } = await brain().sb.from("browser_action_memory")
      .upsert({
        domain, page_state_hash: pageStateHash, intent_hash: intentHash,
        action, coached_by: coachedBy, notes,
        last_success_at: new Date().toISOString(),
        success_count: 1,
      }, { onConflict: "domain,page_state_hash,intent_hash", ignoreDuplicates: false })
      .select("id")
      .single();
    if (error) throw new Error(`upsertAction: ${error.message}`);
    return data.id;
  }

  async recordActionOutcome({ id, success }) {
    const col = success ? "success_count" : "fail_count";
    const patch = { [col]: await this._incrementColumn(id, col) };
    if (success) patch.last_success_at = new Date().toISOString();
    const { error } = await brain().sb.from("browser_action_memory").update(patch).eq("id", id);
    if (error) throw new Error(`recordActionOutcome: ${error.message}`);
  }

  async _incrementColumn(id, col) {
    const { data, error } = await brain().sb.from("browser_action_memory").select(col).eq("id", id).single();
    if (error) throw new Error(`_incrementColumn: ${error.message}`);
    return (data?.[col] ?? 0) + 1;
  }

  // Manual coaching — human-written selector for L2-uncatchable cases (e.g. FB login nag).
  async coachAction({ domain, pageStateHash, intentHash, action, notes = null }) {
    return this.upsertAction({ domain, pageStateHash, intentHash, action, coachedBy: "human", notes });
  }

  // Replay log row — one per eval.
  async recordEvalRun(row) {
    const { data, error } = await brain().sb.from("browser_eval_runs").insert(row).select("id").single();
    if (error) throw new Error(`recordEvalRun: ${error.message}`);
    return data.id;
  }

  // Execute a cached action. No LLM involved.
  async executeAction(action) {
    switch (action?.type) {
      case "none":
        return; // cached "no overlay" — page is already clear, nothing to do
      case "keyboard_esc":
        await this.page.keyboard.press("Escape");
        return;
      case "click_coords":
        if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) throw new Error("click_coords needs x,y");
        await this.page.mouse.click(action.x, action.y);
        return;
      case "click_selector":
        if (!action.selector) throw new Error("click_selector needs selector");
        await this.page.click(action.selector, { timeout: 5000 });
        return;
      default:
        throw new Error(`unknown cached action type: ${action?.type}`);
    }
  }

  // L2→L3 action shape. Cache what ACTUALLY worked to clear the overlay (or 'none' for clean pages).
  static _actionFromPreflight(pre) {
    if (!pre.overlay_detected) return { type: "none" };
    if (!pre.dismissed) return null; // don't cache failures
    // On dismissal, the design has Esc forced on attempt 2+ — most wins are Esc.
    // For attempt-1 wins we trust Gemini's click_coords (rare, usually a large modal center that luckily worked).
    if (pre.attempts >= 2) return { type: "keyboard_esc" };
    const strat = pre.verdict?.dismiss_strategy;
    if (strat?.type === "click_coords") return { type: "click_coords", x: strat.x, y: strat.y };
    return { type: "keyboard_esc" };
  }

  // Main entry: L3 cache hit → execute → done.  L3 miss → L2 preflight → cache the winner.
  async act({ intent, url_context, timeout_ms, skipCache = false } = {}) {
    if (!intent) throw new Error("act() requires intent");
    const start = Date.now();
    if (url_context && this.page.url() !== url_context) {
      await this.goto(url_context, { timeout: timeout_ms || 30000 });
    }
    const url = this.page.url();
    const domain = normalizedDomain(url);
    const title = await this.page.title().catch(() => "");
    const pageStateHash = computePageStateHash(url, title);
    const intentHash = computeIntentHash(intent);
    const cacheKey = { domain, pageStateHash, intentHash };

    // --- L3 lookup ---
    if (!skipCache) {
      let cached;
      try { cached = await this.lookupAction(cacheKey); }
      catch (e) { console.error("[L3] lookup error:", e.message); }
      if (cached) {
        try {
          await this.executeAction(cached.action);
          await this.recordActionOutcome({ id: cached.id, success: true }).catch(e => console.error("[L3] record success failed:", e.message));
          return {
            layer: 3,
            intent, url, domain,
            cache_hit: true,
            cached_action: cached.action,
            coached_by: cached.coached_by,
            ready: true,
            duration_ms: Date.now() - start,
            note: "L3 cache hit — no LLM call",
          };
        } catch (e) {
          console.error("[L3] execute failed, falling through to L2:", e.message);
          await this.recordActionOutcome({ id: cached.id, success: false }).catch(() => {});
        }
      }
    }

    // --- L2 fallback ---
    const pre = await this.preflight({ intent });
    const ready = !pre.overlay_detected || pre.dismissed === true;
    let cachedId = null;
    if (ready) {
      const actionToCache = ClawBrowserSession._actionFromPreflight(pre);
      if (actionToCache) {
        try {
          cachedId = await this.upsertAction({
            ...cacheKey,
            action: actionToCache,
            coachedBy: "gemini-flash",
          });
        } catch (e) {
          console.error("[L3] upsert failed:", e.message);
        }
      }
    }

    return {
      layer: 2,
      intent, url, domain,
      cache_hit: false,
      cache_id_written: cachedId,
      preflight: pre,
      ready,
      duration_ms: Date.now() - start,
    };
  }

  async extract() {
    throw new Error("extract() is not implemented yet");
  }

  async release({ keepAlive = true } = {}) {
    await this.browser.close().catch(() => {});
    void keepAlive;
  }
}

export default ClawBrowserSession;
