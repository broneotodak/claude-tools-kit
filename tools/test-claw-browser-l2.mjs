// L2 smoke: Gemini preflight end-to-end.
//  1. Synthetic modal injected on a blank page — must detect + dismiss
//  2. Instagram feed — must NOT false-positive
//  3. Facebook feed — must NOT false-positive
//  4. Higgsfield (logged-in) — logged-in state; Gemini should say clean
import { ClawBrowserSession } from "./claw-browser-session.mjs";

const session = await ClawBrowserSession.acquire({
  profile: ".gemini/antigravity-browser-profile",
  pinRect: { w: 1440, h: 900 },
});

async function injectSyntheticModal() {
  await session.page.evaluate(() => {
    const existing = document.getElementById("__claw_test_modal");
    if (existing) existing.remove();
    const backdrop = document.createElement("div");
    backdrop.id = "__claw_test_modal";
    backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif";
    backdrop.innerHTML = `
      <div style="background:#fff;border-radius:12px;width:520px;padding:36px;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.4)">
        <button id="__claw_close" aria-label="Close" style="position:absolute;top:12px;right:12px;width:36px;height:36px;border:none;background:#eee;border-radius:8px;font-size:20px;cursor:pointer">X</button>
        <h1 style="margin:0 0 16px 0;font-size:28px">Upgrade to Pro!</h1>
        <p style="margin:0 0 20px 0;font-size:16px;color:#555">Unlock all features for just $99/month. This popup blocks the whole page until you dismiss it.</p>
        <button style="background:#4f46e5;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:16px;cursor:pointer">Subscribe Now</button>
      </div>`;
    document.body.appendChild(backdrop);
    document.getElementById("__claw_close").addEventListener("click", () => backdrop.remove());
    const onEsc = (e) => { if (e.key === "Escape") { backdrop.remove(); window.removeEventListener("keydown", onEsc); } };
    window.addEventListener("keydown", onEsc);
  });
}
async function modalPresent() {
  return await session.page.evaluate(() => !!document.getElementById("__claw_test_modal"));
}

async function trial(label, run, expect) {
  console.error(`\n[trial] ${label}  expect=${expect}`);
  const result = await run();
  const final = await session.screenshot({ name: `${label}-l2-final` });
  return { label, expect, ...result, final_screenshot: final };
}

const out = [];

// 1. Synthetic modal — navigate then inject
out.push(await trial("synthetic", async () => {
  await session.goto("https://example.com", { timeout: 30000 });
  await injectSyntheticModal();
  const before = await modalPresent();
  const r = await session.act({ intent: "click the main primary content link on example.com" });
  const after = await modalPresent();
  return { modal_before: before, modal_after: after, ...r };
}, "detect_and_dismiss"));

// 2. IG feed
out.push(await trial("ig-clean", async () => {
  return await session.act({ intent: "open the first post in the feed", url_context: "https://www.instagram.com/" });
}, "no_overlay"));

// 3. FB feed
out.push(await trial("fb-clean", async () => {
  return await session.act({ intent: "read the first post in the feed", url_context: "https://www.facebook.com/" });
}, "no_overlay"));

// 4. Higgsfield (logged-in — expected clean)
out.push(await trial("higgsfield", async () => {
  return await session.act({ intent: "click the main create/generate button", url_context: "https://higgsfield.ai/" });
}, "no_overlay"));

console.log(JSON.stringify(out, null, 2));
await session.release({ keepAlive: true });

const pass = (
  out[0].modal_before === true &&
  out[0].preflight.overlay_detected === true &&
  out[0].preflight.dismissed === true &&
  out[0].modal_after === false &&
  out[1].preflight.overlay_detected === false &&
  out[2].preflight.overlay_detected === false &&
  out[3].preflight.overlay_detected === false
);
console.error("\n[verdict]", pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 2);
