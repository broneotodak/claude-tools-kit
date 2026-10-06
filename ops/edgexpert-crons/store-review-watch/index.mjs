#!/usr/bin/env node
// store-review-watch — polls App Store Connect for police sentri : RUSH review state; on change, asks Siti to WhatsApp Neo
// via the fleet path (scheduled_actions send_whatsapp → timekeeper → agent_commands → siti). Cron every 30 min on EdgeXpert.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createSign } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
const here = dirname(fileURLToPath(import.meta.url));
const CTK = "/home/neo/Projects/claude-tools-kit";
for (const line of readFileSync(resolve(CTK, ".env"), "utf8").split("\n")) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1"); }
const { NeoBrain } = await import(resolve(CTK, "packages/memory/src/index.js"));
const nb = new NeoBrain({ agent: "store-review-watch" });
const APP = { name: "police sentri : RUSH", id: "6812404214", version: "b6edffaa-fa17-4ceb-a547-d734d483e4de", submission: "54ac7b10-4785-4558-b7c1-73e63f637ddc", keyId: "4WGP8QU8F4", issuer: "6494819c-c63d-4082-a571-3a18bba77615" };
const NEO = "60177519610";
const stateFile = resolve(here, "state.json"); const logsDir = resolve(here, "logs"); mkdirSync(logsDir, { recursive: true });
const log = (...a) => console.log(new Date().toISOString(), ...a);

let p8 = String(await nb.getCredentialValue("appstoreconnect-todak-studios", { type: "api_key" })).replace(/\\n/g, "\n").trim();
if (!p8.includes("BEGIN PRIVATE KEY")) p8 = `-----BEGIN PRIVATE KEY-----\n${p8}\n-----END PRIVATE KEY-----`;
const jwt = () => { const now = Math.floor(Date.now() / 1000), b64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"); const h = b64({ alg: "ES256", kid: APP.keyId, typ: "JWT" }); const p = b64({ iss: APP.issuer, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }); const s = createSign("SHA256"); s.update(`${h}.${p}`); return `${h}.${p}.${s.sign({ key: p8, dsaEncoding: "ieee-p1363" }).toString("base64url")}`; };
const apple = async (path) => { const r = await fetch("https://api.appstoreconnect.apple.com" + path, { headers: { Authorization: "Bearer " + jwt() } }); const j = await r.json(); if (!r.ok) throw new Error(`Apple ${r.status}: ${JSON.stringify(j.errors || j).slice(0, 200)}`); return j; };

const sub = (await apple(`/v1/reviewSubmissions/${APP.submission}?fields[reviewSubmissions]=state,submittedDate`)).data.attributes;
const ver = (await apple(`/v1/appStoreVersions/${APP.version}?fields[appStoreVersions]=versionString,appVersionState`)).data.attributes;
const PLAY_PKG = "com.todakstudios.policesentrirush";
let play = "unknown";
try { const r = await fetch(`https://play.google.com/store/apps/details?id=${PLAY_PKG}&hl=en`, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } }); const body = r.status === 200 ? await r.text() : ""; play = r.status === 200 && /police sentri : RUSH - Apps on Google Play/.test(body) ? "LIVE" : r.status === 404 ? "NOT_LIVE" : `HTTP_${r.status}`; } catch (e) { play = "ERR"; }
const cur = { submission: sub.state, version: ver.appVersionState, versionString: ver.versionString, play, checkedAt: new Date().toISOString() };
const prev = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
log("apple+play:", JSON.stringify(cur), "prev:", prev ? `${prev.submission}/${prev.version}/${prev.play}` : "(first run)");

const HUMAN = { WAITING_FOR_REVIEW: "menunggu review Apple", IN_REVIEW: "sedang di-review oleh Apple 👀", UNRESOLVED_ISSUES: "Apple ada isu — REJECTED / perlu tindakan ❌", COMPLETE: "review Apple selesai ✅", CANCELING: "dibatalkan", CANCELED: "dibatalkan", READY_FOR_SALE: "LIVE di App Store 🎉", PENDING_DEVELOPER_RELEASE: "APPROVED ✅ — menunggu Neo tekan Release", REJECTED: "REJECTED oleh Apple ❌", DEVELOPER_REJECTED: "ditarik balik oleh developer", PROCESSING_FOR_DISTRIBUTION: "approved, Apple tengah proses untuk distribusi", PENDING_APPLE_RELEASE: "approved, menunggu Apple release", METADATA_REJECTED: "REJECTED (metadata) ❌", INVALID_BINARY: "REJECTED (binary) ❌", WAITING_FOR_EXPORT_COMPLIANCE: "menunggu export compliance" };
const appleChanged = !prev || prev.submission !== cur.submission || prev.version !== cur.version;
const playChanged = !!prev && prev.play !== cur.play && ["LIVE", "NOT_LIVE"].includes(cur.play) && ["LIVE", "NOT_LIVE", "unknown", undefined].includes(prev.play);
const changed = appleChanged || playChanged;
if (changed && prev) {
  const headline = HUMAN[cur.version] && cur.version !== "WAITING_FOR_REVIEW" && cur.version !== "IN_REVIEW" ? HUMAN[cur.version] : (HUMAN[cur.submission] || cur.submission);
  const appleMsg = `📱 police sentri : RUSH (iOS ${cur.versionString}) — status Apple berubah: ${headline}\n\nSubmission: ${prev.submission} → ${cur.submission}\nVersion: ${prev.version} → ${cur.version}\n\nhttps://appstoreconnect.apple.com/apps/${APP.id}/distribution`;
  const playMsg = cur.play === "LIVE" ? `🤖 police sentri : RUSH dah LIVE di Google Play 🎉\nhttps://play.google.com/store/apps/details?id=${PLAY_PKG}` : `🤖 police sentri : RUSH — Google Play store page tak lagi public (${prev.play} → ${cur.play}). Check Play Console.`;
  const message = (appleChanged ? appleMsg : playMsg) + `\n(store-review-watch, EdgeXpert)`;
  const db = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await db.from("scheduled_actions").insert({ fire_at: new Date().toISOString(), action_kind: "send_whatsapp", action_payload: { to: NEO, message }, created_by: "store-review-watch", description: `police sentri : RUSH store state → apple ${cur.submission}/${cur.version}, play ${cur.play}`, max_attempts: 3, status: "scheduled" }).select("id").single();
  if (error) { log("scheduled_actions insert FAILED:", error.message); process.exit(1); }
  log("notified Neo via scheduled_actions", data.id);
  // event memory via the proven CLI path (same as every other fleet job)
  try { const { execFileSync } = await import("node:child_process"); const title = appleChanged ? `police sentri : RUSH — Apple review state ${prev.submission}/${prev.version} → ${cur.submission}/${cur.version}` : `police sentri : RUSH — Google Play ${prev.play} → ${cur.play}`; execFileSync("/home/neo/.nvm/versions/node/v22.23.2/bin/node", [resolve(CTK, "tools/save-memory.js"), "Project", title, message, "7"], { cwd: CTK, stdio: "ignore", timeout: 60000 }); log("event memory saved"); } catch (e) { log("memory save skipped:", e.message); }
}
writeFileSync(stateFile, JSON.stringify(cur, null, 2));
