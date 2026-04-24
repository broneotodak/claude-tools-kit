// ClawBrowserSession — Phase 5b.1 L1 + L2 wrapper
// Attaches to a persistent Chrome on CLAW via CDP (separate automation profile).
// L1: window pin + acquire/goto/screenshot.
// L2: Gemini 2.0 Flash overlay preflight + dismiss before every act.
// L3/L4: click-memory cache + vision fallback — not yet implemented.
//
// Profile: ~/.gemini/antigravity-browser-profile (logged-in automation profile)
// Port:    9333 (9222 is the openclaw gateway — do NOT share)
// Creds:   neo-brain credentials vault (service=google_gemini, type=api_key)

import { chromium } from "playwright";
import { spawn } from "node:child_process";
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

    let page = context.pages().find(p => !p.url().startsWith("devtools://")) || await context.newPage();

    // Ensure the window is realized before we try to pin it — a freshly-spawned
    // Chrome can still be attaching its window to the target when pinWindow runs.
    await page.goto("about:blank").catch(() => {});

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

  async act({ intent, url_context, timeout_ms } = {}) {
    if (!intent) throw new Error("act() requires intent");
    if (url_context && this.page.url() !== url_context) {
      await this.goto(url_context, { timeout: timeout_ms || 30000 });
    }
    const pre = await this.preflight({ intent });
    return {
      layer: 2,
      intent,
      url: this.page.url(),
      preflight: pre,
      ready: !pre.overlay_detected || pre.dismissed === true,
      note: "L2 preflight only — intent fulfilment requires L3 cache or L4 vision (not implemented)",
    };
  }

  async extract() {
    throw new Error("extract() is L3+ — not implemented yet");
  }

  async release({ keepAlive = true } = {}) {
    await this.browser.close().catch(() => {});
    void keepAlive;
  }
}

export default ClawBrowserSession;
