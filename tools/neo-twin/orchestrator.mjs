#!/usr/bin/env node
/**
 * neo-twin v2 — orchestrator
 *
 * Phase 6 Step 9 (NACA milestones)
 * Spec: claude-tools-kit/specs/neo-twin-v2.md
 *
 * Reads recent wa-primary memories (where twin-ingest writes), checks per-target
 * state in legacy DB twin_active_state, runs Tier 1 (Haiku→Gemini) + Tier 2
 * (tr-home qwen2.5:32b), writes twin_drafts row. If shadow_mode=true on target,
 * NO send fires — draft has would_have_sent=true. If shadow_mode=false (live),
 * POSTs to twin-ingest's /api/send (localhost:3900).
 *
 * Marks memory.metadata.handled_by_neo_twin so we never re-process.
 *
 * Runs as pm2 process on Twin VPS. Configured via .env in same dir.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// ─── ENV / CONFIG ────────────────────────────────────────────────────────────
const NEO_BRAIN_URL = process.env.NEO_BRAIN_URL;
const NEO_BRAIN_KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
const LEGACY_DB_URL = process.env.LEGACY_DB_URL;        // SUPABASE_URL of uzamamymfzhelvkwpvgt
const LEGACY_DB_KEY = process.env.LEGACY_DB_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const TR_HOME_URL = process.env.TR_HOME_URL || "http://100.126.89.7:11434";
const TWIN_INGEST_URL = process.env.TWIN_INGEST_URL || "http://localhost:3900";
const TWIN_INGEST_TOKEN = process.env.TWIN_INGEST_SEND_TOKEN;

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "30000", 10);
const TIER1_TIMEOUT_MS = parseInt(process.env.TIER1_TIMEOUT_MS || "30000", 10);
const TIER2_TIMEOUT_MS = parseInt(process.env.TIER2_TIMEOUT_MS || "30000", 10);
const MEMORY_LOOKBACK_MIN = parseInt(process.env.MEMORY_LOOKBACK_MIN || "5", 10);
const OWNER_PHONE = process.env.OWNER_PHONE || "60177519610";

const REQUIRED = { NEO_BRAIN_URL, NEO_BRAIN_KEY, LEGACY_DB_URL, LEGACY_DB_KEY, ANTHROPIC_KEY, GEMINI_KEY, TWIN_INGEST_TOKEN };
for (const [k, v] of Object.entries(REQUIRED)) {
  if (!v) { console.error(`[fatal] missing env: ${k}`); process.exit(1); }
}

const brain = createClient(NEO_BRAIN_URL, NEO_BRAIN_KEY, { auth: { persistSession: false } });
const legacy = createClient(LEGACY_DB_URL, LEGACY_DB_KEY, { auth: { persistSession: false } });

// ─── STATS ───────────────────────────────────────────────────────────────────
const stats = {
  startedAt: Date.now(),
  polls: 0, candidates: 0, replied: 0, shadow_logged: 0,
  rate_limited: 0, skipped_no_state: 0, skipped_low_confidence: 0,
  tier1_failed: 0, tier2_failed: 0, send_failed: 0, errors: 0,
};

// ─── LOG ─────────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" });
  console.log(`[${ts}] [neo-twin] ${msg}`);
}
function logErr(msg, e) {
  log(`ERROR ${msg}: ${e?.message?.slice(0, 200) || e}`);
  stats.errors++;
}

// ─── 1. READ UNHANDLED MEMORIES ──────────────────────────────────────────────
async function fetchUnhandledMemories() {
  const cutoff = new Date(Date.now() - MEMORY_LOOKBACK_MIN * 60_000).toISOString();
  const { data, error } = await brain
    .from("memories")
    .select("id, content, metadata, created_at")
    .eq("source", "wa-primary")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) { logErr("fetchUnhandledMemories", error); return []; }
  // Filter client-side for missing handled_by_neo_twin (jsonb path filter is awkward in PostgREST)
  return (data || []).filter((m) => !(m.metadata?.handled_by_neo_twin));
}

// ─── 2. STATE LOOKUP ─────────────────────────────────────────────────────────
async function getActiveState(jid) {
  if (!jid) return null;
  const { data, error } = await legacy
    .from("twin_active_state")
    .select("*")
    .eq("target_jid", jid)
    .limit(1);
  if (error) { logErr(`getActiveState(${jid})`, error); return null; }
  return data?.[0] || null;
}

// ─── 3. RATE LIMIT ───────────────────────────────────────────────────────────
async function checkRateLimit(jid, maxPerHour) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error } = await legacy
    .from("twin_drafts")
    .select("id", { count: "exact", head: true })
    .eq("target_jid", jid)
    .gte("created_at", since)
    // Either we sent it OR shadow-mode logged it — both count toward budget
    .or("would_have_sent.eq.true,sent_reply.not.is.null");
  if (error) { logErr(`checkRateLimit(${jid})`, error); return { ok: true, count: 0 }; }
  return { ok: (count || 0) < maxPerHour, count: count || 0 };
}

// ─── 4. TIER 1 — HAIKU → GEMINI ──────────────────────────────────────────────
const TIER1_SYSTEM = `You are deciding whether and how to reply AS Neo Todak to a WhatsApp message in a group chat.

Real name: Ahmad Fadli Bin Ahmad Dahlan. CEO Todak Studios. Cyberjaya, Malaysia.
You are NOT an assistant. You ARE Neo. Output Neo's natural reply.

Style:
- SUPER casual. Lowercase mostly. Short. 1-2 lines.
- BM-DOMINANT: with most friends (Lan, Syaiful, Imel, Kak Riz), Neo writes ~90% Bahasa Malaysia.
  Only mix English when (a) it's a tech term ("PR", "claude", "API", "deploy"), (b) a culturally
  fixed phrase ("ok bro", "noted"), or (c) the recipient writes in English first. AVOID English
  idioms like "early bird", "by the way", "anyway", "actually" — translate to BM equivalents.
- Examples of natural Neo lines: "ok bro noted", "hahaha gila la", "nanti aku check", "wkwk apa la kau"
- Filler particles: "je", "la", "kot", "ah", "eh", "kan"
- Laughs: "hahaha" or "wkwk"
- emoji: rare, max 1
- if unsure: "ntah bro", "tak sure la", "nanti aku tanya"
- NEVER reveal you are an AI

Output a JSON object EXACTLY in this shape (no markdown, no preamble, no trailing text):
{"reply":"<the message Neo would send, or null if you should skip>","confidence":"<high|medium|low|abstain>"}

Confidence rules:
- "high": you understand the message + know what Neo would say
- "medium": reasonable guess, but ambiguous context
- "low": unsure, reply might be off
- "abstain": skip — you don't have enough context, the topic is sensitive,
            or the message is trivial like an emoji-only reaction
If confidence is "abstain", reply must be null.`;

async function tier1Haiku(systemPrompt, userMsg) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIER1_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.content?.[0]?.text || null;
  } catch (e) {
    log(`Haiku failed: ${e.message?.slice(0, 80)}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function tier1Gemini(systemPrompt, userMsg) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIER1_TIMEOUT_MS);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMsg }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 400, responseMimeType: "application/json" },
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (e) {
    log(`Gemini failed: ${e.message?.slice(0, 80)}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function parseTier1Output(raw) {
  if (!raw) return { reply: null, confidence: "abstain" };
  try {
    // Strip code fences if any
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const j = JSON.parse(cleaned);
    return {
      reply: typeof j.reply === "string" ? j.reply : null,
      confidence: ["high", "medium", "low", "abstain"].includes(j.confidence) ? j.confidence : "low",
    };
  } catch {
    // If model returned bare text, treat as low-confidence reply
    return { reply: raw.trim().slice(0, 500), confidence: "low" };
  }
}

async function tier1(memory) {
  const meta = memory.metadata || {};
  const senderName = meta.sender_name || meta.sender_phone || "someone";
  const groupName = meta.group_name || "";
  const userMsg = `Setting: ${meta.chat_type === "group" ? `group "${groupName}"` : "DM"}\n` +
                  `From: ${senderName}\n` +
                  `Message: ${memory.content?.slice(0, 1500)}`;

  let raw = await tier1Haiku(TIER1_SYSTEM, userMsg);
  let provider = "haiku";
  if (!raw) {
    raw = await tier1Gemini(TIER1_SYSTEM, userMsg);
    provider = "gemini";
  }
  if (!raw) {
    stats.tier1_failed++;
    return { provider: null, reply: null, confidence: "abstain", raw: null };
  }
  const parsed = parseTier1Output(raw);
  return { provider, ...parsed, raw };
}

// ─── 5. TIER 2 — TR-HOME ─────────────────────────────────────────────────────
const TIER2_SYSTEM = `You are rewriting a draft WhatsApp reply to match Neo Todak's personal style.

Neo's WhatsApp style:
- SUPER casual. Lowercase. Short. 1-2 lines. Sometimes one word.
- BM-DOMINANT: with most friends (Lan, Syaiful, Imel, Kak Riz), Neo writes ~90% Bahasa Malaysia.
  Only mix English when (a) it's a tech term ("PR", "claude", "API", "deploy"), (b) a culturally
  fixed phrase ("ok bro", "noted"), or (c) the recipient writes in English first. AVOID English
  idioms like "early bird", "by the way", "anyway", "actually" — translate to BM equivalents.
- Examples of natural Neo lines: "ok bro noted", "hahaha gila la", "nanti aku check", "wkwk apa la kau"
- Filler particles: "je", "la", "kot", "ah", "eh", "kan"
- Laughs: "hahaha" or "wkwk" — never "Haha,"
- emoji: rare, max 1
- if unsure: "ntah bro", "tak sure la", "nanti aku tanya"

You will receive an incoming WhatsApp message and a draft reply (correct content
but wrong tone). Rewrite the draft to sound like Neo. Keep ALL FACTS. Don't
hallucinate new info. Don't add preamble like "Here's the rewrite:". Output
only the rewritten message text, nothing else.`;

async function tier2(incomingMsg, tier1Reply) {
  if (!tier1Reply) return { ok: false, output: null, error: "no tier1 reply" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIER2_TIMEOUT_MS);
  try {
    const r = await fetch(`${TR_HOME_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:32b",
        messages: [
          { role: "system", content: TIER2_SYSTEM },
          { role: "user", content: `INCOMING:\n${incomingMsg}\n\nDRAFT:\n${tier1Reply}` },
        ],
        stream: false,
        options: { temperature: 0.7, num_predict: 200 },
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      stats.tier2_failed++;
      return { ok: false, output: null, error: `http ${r.status}` };
    }
    const j = await r.json();
    const out = j?.message?.content?.trim();
    if (!out) {
      stats.tier2_failed++;
      return { ok: false, output: null, error: "empty response" };
    }
    return { ok: true, output: out, error: null };
  } catch (e) {
    stats.tier2_failed++;
    return { ok: false, output: null, error: e.message?.slice(0, 100) };
  } finally {
    clearTimeout(t);
  }
}

// ─── 6. WRITE DRAFT ──────────────────────────────────────────────────────────
async function writeDraft(payload) {
  const { data, error } = await legacy.from("twin_drafts").insert(payload).select("id").single();
  if (error) { logErr("writeDraft", error); return null; }
  return data?.id || null;
}

// ─── 7. SEND ─────────────────────────────────────────────────────────────────
async function sendViaTwinIngest(toJid, text, draftId) {
  try {
    const r = await fetch(`${TWIN_INGEST_URL}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${TWIN_INGEST_TOKEN}` },
      body: JSON.stringify({ to_jid: toJid, text, draft_id: draftId }),
    });
    if (!r.ok) {
      stats.send_failed++;
      const err = await r.text();
      return { ok: false, error: `http ${r.status}: ${err.slice(0, 200)}` };
    }
    const j = await r.json();
    return { ok: true, message_id: j.message_id };
  } catch (e) {
    stats.send_failed++;
    return { ok: false, error: e.message?.slice(0, 100) };
  }
}

// ─── 8. MARK MEMORY HANDLED ──────────────────────────────────────────────────
async function markHandled(memoryId, statusVal, draftId) {
  // Read current metadata, merge handled_by_neo_twin field, write back
  const { data: row } = await brain.from("memories").select("metadata").eq("id", memoryId).single();
  const meta = { ...(row?.metadata || {}), handled_by_neo_twin: statusVal, neo_twin_draft_id: draftId || null, neo_twin_handled_at: new Date().toISOString() };
  const { error } = await brain.from("memories").update({ metadata: meta }).eq("id", memoryId);
  if (error) logErr(`markHandled(${memoryId})`, error);
}

// ─── 9. PROCESS ONE MEMORY ───────────────────────────────────────────────────
async function processMemory(memory) {
  const meta = memory.metadata || {};
  const chatJid = meta.chat_jid;
  const senderPhone = meta.sender_phone;
  const senderName = (meta.sender_name || "").toLowerCase();
  const content = memory.content || "";
  const isFromOwner = meta.is_from_owner === true;

  // Skip messages from self (Neo's own outgoing — would be a loop).
  // Multiple signals because Baileys uses LIDs in groups (sender_phone won't match
  // OWNER_PHONE for group msgs, and is_from_owner can be wrong for the same reason).
  // Most reliable: pushName ('Broneotodak' / 'Neo') + content prefix from twin-ingest.
  const ownerNames = new Set(["broneotodak", "neo", "neo todak", "ahmad fadli"]);
  const contentLooksLikeOwner = /^\[(?:dm|group:[^\]]+)\]\s+Neo said:/i.test(content);
  if (isFromOwner || senderPhone === OWNER_PHONE || ownerNames.has(senderName) || contentLooksLikeOwner) {
    await markHandled(memory.id, "skipped_self", null);
    stats.skipped_no_state++;
    return;
  }

  if (!chatJid) {
    await markHandled(memory.id, "skipped_no_chat_jid", null);
    return;
  }

  // 1. State lookup
  const state = await getActiveState(chatJid);
  if (!state || state.status !== "active") {
    await markHandled(memory.id, "skipped_no_state", null);
    stats.skipped_no_state++;
    return;
  }

  // 2. Pause check (auto-expire)
  if (state.status === "paused" && state.pause_until_ts && new Date(state.pause_until_ts) > new Date()) {
    await markHandled(memory.id, "skipped_paused", null);
    return;
  }

  // 3. Rate limit
  const rl = await checkRateLimit(chatJid, state.max_per_hour || 3);
  if (!rl.ok) {
    log(`RATE LIMITED ${chatJid} (${rl.count}/${state.max_per_hour})`);
    await writeDraft({
      target_jid: chatJid, target_kind: state.target_kind,
      sender_jid: senderPhone || null, sender_name: meta.sender_name || null,
      chat_jid: chatJid, chat_name: meta.group_name || null,
      inbound_message: memory.content?.slice(0, 1000),
      message_id: null, status: "skipped",
      rate_limited: true, would_have_sent: false,
      model_used: null, draft_reply: null,
    });
    await markHandled(memory.id, "rate_limited", null);
    stats.rate_limited++;
    return;
  }

  // 4. Tier 1
  const t1 = await tier1(memory);
  log(`TIER1 ${t1.provider || "FAIL"} confidence=${t1.confidence} for ${chatJid.slice(0, 25)}`);
  if (t1.confidence === "abstain" || !t1.reply) {
    await writeDraft({
      target_jid: chatJid, target_kind: state.target_kind,
      sender_jid: senderPhone || null, sender_name: meta.sender_name || null,
      chat_jid: chatJid, chat_name: meta.group_name || null,
      inbound_message: memory.content?.slice(0, 1000),
      tier1_output: t1.raw, tier2_output: null,
      message_id: null, status: "skipped",
      rate_limited: false, would_have_sent: false,
      model_used: t1.provider || "none",
      draft_reply: null,
    });
    await markHandled(memory.id, "skipped_low_confidence", null);
    stats.skipped_low_confidence++;
    return;
  }

  // 5. Tier 2 (rewrite into Neo style); fallback to Tier 1 raw if tr-home down
  const incomingForT2 = memory.content?.slice(0, 1000) || "";
  const t2 = await tier2(incomingForT2, t1.reply);
  const finalReply = t2.ok ? t2.output : t1.reply;
  if (!t2.ok) log(`TIER2 fallback to tier1 raw — ${t2.error}`);

  // 6. Write draft
  const isShadow = state.shadow_mode === true;
  const draftId = await writeDraft({
    target_jid: chatJid, target_kind: state.target_kind,
    sender_jid: senderPhone || null, sender_name: meta.sender_name || null,
    chat_jid: chatJid, chat_name: meta.group_name || null,
    inbound_message: memory.content?.slice(0, 1000),
    tier1_output: t1.reply, tier2_output: t2.output,
    tr_home_used: t2.ok,
    draft_reply: finalReply,
    sent_reply: isShadow ? null : finalReply,
    message_id: null,
    // legacy DB CHECK constraint allows: pending|sent|edited_sent|skipped
    // We use 'pending' for shadow drafts (would_have_sent=true distinguishes them)
    status: isShadow ? "pending" : "sent",
    rate_limited: false,
    would_have_sent: isShadow,
    model_used: t1.provider + (t2.ok ? "+qwen2.5:32b" : ""),
  });

  // 7. Send (only if not shadow)
  // If draft save failed (draftId is null), skip marking handled so we retry next poll
  if (!draftId) {
    log(`DRAFT save failed — leaving memory unhandled for retry`);
    return;
  }
  if (isShadow) {
    log(`SHADOW logged draft ${draftId.slice(0, 8)} to ${chatJid.slice(0, 25)} | "${finalReply.slice(0, 60)}"`);
    await markHandled(memory.id, "shadow_logged", draftId);
    stats.shadow_logged++;
  } else {
    const send = await sendViaTwinIngest(chatJid, finalReply, draftId);
    if (send.ok) {
      log(`SENT draft ${draftId?.slice(0, 8)} to ${chatJid.slice(0, 25)} | "${finalReply.slice(0, 60)}" | wa_id=${send.message_id?.slice(0, 12)}`);
      // update twin_drafts with message_id
      if (draftId) await legacy.from("twin_drafts").update({ message_id: send.message_id }).eq("id", draftId);
      await markHandled(memory.id, "replied", draftId);
      stats.replied++;
    } else {
      logErr(`SEND failed for draft ${draftId?.slice(0, 8)}`, send.error);
      // mark memory handled with error so we don't retry indefinitely
      await markHandled(memory.id, "send_failed", draftId);
    }
  }
}

// ─── 10. POLL LOOP ───────────────────────────────────────────────────────────
let pollInFlight = false;
async function poll() {
  if (pollInFlight) { log("poll skipped — previous still in-flight"); return; }
  pollInFlight = true;
  stats.polls++;
  try {
    const candidates = await fetchUnhandledMemories();
    stats.candidates += candidates.length;
    if (candidates.length === 0) return;
    log(`Polling — ${candidates.length} unhandled wa-primary memories`);
    for (const m of candidates) {
      try { await processMemory(m); }
      catch (e) { logErr(`processMemory(${m.id})`, e); }
    }
  } catch (e) {
    logErr("poll", e);
  } finally {
    pollInFlight = false;
  }
}

// ─── 11. STATS LOG (every 5 min) ────────────────────────────────────────────
setInterval(() => {
  const uptime = Math.round((Date.now() - stats.startedAt) / 1000);
  log(`stats uptime=${uptime}s ${JSON.stringify(stats)}`);
}, 5 * 60_000);

// ─── 12. STARTUP ─────────────────────────────────────────────────────────────
log("neo-twin orchestrator starting");
log(`config: poll=${POLL_INTERVAL_MS / 1000}s lookback=${MEMORY_LOOKBACK_MIN}min tr-home=${TR_HOME_URL} twin-ingest=${TWIN_INGEST_URL}`);
log(`endpoints — neo-brain ${NEO_BRAIN_URL?.slice(0, 38)}…  legacy ${LEGACY_DB_URL?.slice(0, 38)}…`);
poll();
setInterval(poll, POLL_INTERVAL_MS);

process.on("SIGTERM", () => { log("SIGTERM — exiting"); process.exit(0); });
process.on("SIGINT", () => { log("SIGINT — exiting"); process.exit(0); });
