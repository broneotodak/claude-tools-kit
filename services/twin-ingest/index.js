import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { startDashboard, setSock, dashState, addRecentMessage } from "./dashboard.js";

const brain = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OWNER_PHONE = process.env.OWNER_PHONE || "60177519610";
const OWNER_ID = process.env.OWNER_ID || "00000000-0000-0000-0000-000000000001";
const MIN_LEN = parseInt(process.env.MIN_MESSAGE_LENGTH || "10");
const THRESHOLD = parseInt(process.env.USEFULNESS_THRESHOLD || "3");

// Owner identity recognition: loaded from canonical people row at startup.
// Used to detect that a message came from Neo even when WhatsApp delivers a
// group LID instead of his phone number, or when his pushName changes.
const OWNER_LIDS = new Set();         // LIDs/phone-strings registered as Neo's identifiers
const OWNER_NICKNAMES = new Set();    // lowercased nicknames + display_name + push_name aliases
let ownerLoadedAt = 0;
const OWNER_RELOAD_MS = 10 * 60 * 1000;

async function loadOwnerIdentity() {
  if (Date.now() - ownerLoadedAt < OWNER_RELOAD_MS) return;
  try {
    const { data, error } = await brain
      .from("people")
      .select("display_name,push_name,phone,lid,nicknames,identifiers")
      .eq("id", OWNER_ID)
      .maybeSingle();
    if (error || !data) {
      console.error("[twin] loadOwnerIdentity failed:", error?.message);
      return;
    }
    OWNER_LIDS.clear();
    OWNER_NICKNAMES.clear();
    if (data.phone) OWNER_LIDS.add(String(data.phone));
    if (data.lid) OWNER_LIDS.add(String(data.lid));
    OWNER_LIDS.add(OWNER_PHONE);
    for (const i of data.identifiers || []) {
      if (!i?.value) continue;
      const v = String(i.value);
      if (i.type === "phone" || i.type === "lid") OWNER_LIDS.add(v);
      if (i.type === "push_name" || i.type === "nickname") OWNER_NICKNAMES.add(v.toLowerCase().trim());
    }
    if (data.display_name) OWNER_NICKNAMES.add(data.display_name.toLowerCase().trim());
    if (data.push_name) OWNER_NICKNAMES.add(data.push_name.toLowerCase().trim());
    for (const n of data.nicknames || []) if (n) OWNER_NICKNAMES.add(String(n).toLowerCase().trim());
    // Hardcoded baseline (in case canonical row hasn't been seeded yet)
    for (const n of ["neo", "fadli", "bro neo", "boss neo", "broneotodak", "brozaid10camp", "ahmad fadli", "neo todak"]) {
      OWNER_NICKNAMES.add(n);
    }
    ownerLoadedAt = Date.now();
    console.log(`[twin] owner identity loaded: ${OWNER_LIDS.size} LIDs/phones, ${OWNER_NICKNAMES.size} nicknames`);
  } catch (e) {
    console.error("[twin] loadOwnerIdentity exception:", e.message?.slice(0, 100));
  }
}

function isSenderTheOwner({ senderPhone, pushName, isFromMe }) {
  if (isFromMe) return true;
  if (senderPhone && OWNER_LIDS.has(String(senderPhone))) return true;
  if (pushName && OWNER_NICKNAMES.has(pushName.toLowerCase().trim())) return true;
  return false;
}

function isOwnerAlias(name) {
  if (!name) return false;
  return OWNER_NICKNAMES.has(name.toLowerCase().trim());
}

// Drop low-signal placeholder facts the LLM emits when nothing concrete is in the message.
const NOISE_FACT_PATTERNS = [
  /^sender of the message\.?$/i,
  /^is the sender\.?$/i,
  /^is the sender of the message\.?$/i,
  /^refers to .{0,40} attributed to/i,
];
function isNoiseFact(fact) {
  if (!fact || typeof fact !== "string") return true;
  const trimmed = fact.trim();
  if (trimmed.length < 8) return true;
  return NOISE_FACT_PATTERNS.some(rx => rx.test(trimmed));
}

// Group filter: skip these (archived, low-value)
const SKIP_GROUPS = new Set(); // Populated from neo-brain on startup
const IMPORTANT_GROUPS = new Set(); // Always process these

// ── neo-twin v2: monitored groups bypass MIN_LEN + classifier filter ──
const LEGACY_DB_URL = process.env.LEGACY_DB_URL;
const LEGACY_DB_SERVICE_ROLE_KEY = process.env.LEGACY_DB_SERVICE_ROLE_KEY;
const legacy = (LEGACY_DB_URL && LEGACY_DB_SERVICE_ROLE_KEY)
  ? createClient(LEGACY_DB_URL, LEGACY_DB_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;
const MONITORED_GROUPS = new Set();
let monitoredLastFetch = 0;
const MONITORED_REFRESH_MS = 5 * 60 * 1000;

async function refreshMonitoredGroups() {
  if (!legacy) return;
  if (Date.now() - monitoredLastFetch < MONITORED_REFRESH_MS) return;
  try {
    const { data, error } = await legacy
      .from("twin_active_state")
      .select("target_jid, target_kind, status")
      .eq("status", "active");
    if (error) { console.error("[twin] monitored-groups fetch err:", error.message); return; }
    MONITORED_GROUPS.clear();
    for (const r of data || []) {
      if (r.target_kind === "group" && r.target_jid) MONITORED_GROUPS.add(r.target_jid);
    }
    monitoredLastFetch = Date.now();
    console.log(`[twin] monitored groups refreshed: ${MONITORED_GROUPS.size} active`);
  } catch (e) {
    console.error("[twin] monitored-groups refresh exception:", e.message?.slice(0, 100));
  }
}


// Rate limiting
let lastClassifyAt = 0;
const CLASSIFY_COOLDOWN_MS = 1500; // throttle during history sync

// Stats
const stats = dashState.stats;
stats.startedAt = Date.now();

// ── EMBEDDINGS ──
// Generate 768-d vector for memory content. Mirrors Siti's pattern:
// outputDimensionality:768 to match the pgvector schema; without this,
// Gemini's API now defaults to 3072-d, which silently fails match_memories.
// On any failure returns null so the insert still happens (we'd rather have
// a recallable-by-text-only row than no row at all; an enricher can backfill).
async function geminiEmbed(text) {
  if (!GEMINI_KEY || !text?.trim()) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_KEY}`;
  const body = { content: { parts: [{ text: text.slice(0, 2048) }] }, outputDimensionality: 768 };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error("[embed] gemini fail:", r.status, (await r.text()).slice(0, 120));
      return null;
    }
    const data = await r.json();
    return data?.embedding?.values || null;
  } catch (err) {
    console.error("[embed] error:", err.message?.slice(0, 80));
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── WHATSAPP CONNECTION ──

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth-state");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false, // We'll use our own QR display
    logger: pino({ level: "warn" }),
    browser: ["NeoTwin", "Chrome", "1.0.0"],
    // Read-only: don't mark messages as read
    markOnlineOnConnect: false,
  });
  setSock(sock); // neo-twin v2: expose sock for /api/send

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n[twin] ══════════════════════════════════");
      console.log("[twin] SCAN THIS QR CODE WITH WHATSAPP");
      console.log("[twin] Settings → Linked Devices → Link a Device");
      console.log("[twin] Or open: http://5.161.126.222:3900/qr");
      console.log("[twin] ══════════════════════════════════\n");
      qrcode.generate(qr, { small: true });
      dashState.qr = qr;
      dashState.qrCapturedAt = Date.now();
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("[twin] disconnected, reason:", reason);
      dashState.connected = false;
      if (reason !== DisconnectReason.loggedOut) {
        console.log("[twin] reconnecting in 5s...");
        setTimeout(startWhatsApp, 5000);
      } else {
        console.log("[twin] logged out — delete ./auth-state and restart to re-link");
      }
    }

    if (connection === "open") {
      console.log("[twin] ✅ WhatsApp connected as " + OWNER_PHONE);
      console.log("[twin] READ-ONLY MODE — will NOT send any messages");
      dashState.connected = true;
      dashState.phone = OWNER_PHONE;
      dashState.qr = null;
      dashState.qrCapturedAt = null;
      console.log("[twin] Listening for messages...");
      reportHeartbeat("ok");
    }
  });

  // ONLY listen to messages — never send
  // Handle full history sync (old conversations)
  sock.ev.on("messaging-history.set", async ({ messages, chats, contacts, isLatest }) => {
    console.log(`[twin] 📜 HISTORY SYNC: ${messages.length} messages, ${chats?.length || 0} chats, ${contacts?.length || 0} contacts, isLatest: ${isLatest}`);
    
    let processed = 0;
    for (const msg of messages) {
      try {
        // Throttle to avoid Gemini rate limits
        await new Promise(r => setTimeout(r, 1500));
        await processMessage(msg, sock);
        processed++;
        if (processed % 50 === 0) {
          console.log(`[twin] 📜 history progress: ${processed}/${messages.length}`);
        }
      } catch (e) {
        stats.errors++;
      }
    }
    console.log(`[twin] 📜 history sync complete: ${processed}/${messages.length} processed`);
  });

  // Process new incoming messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    const isHistorySync = type === "append";
    if (isHistorySync) console.log(`[twin] history sync batch: ${messages.length} messages`);

    for (const msg of messages) {
      try {
        await processMessage(msg, sock);
      } catch (e) {
        stats.errors++;
        console.error("[twin] process error:", e.message?.slice(0, 100));
      }
    }
  });

  return sock;
}

// ── MESSAGE PROCESSING PIPELINE ──

async function processMessage(msg, sock) {
  stats.total++;

  // Extract text content
  const text = msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || msg.message?.videoMessage?.caption
    || "";

  // Identify sender first so we can check isMonitored before length-filtering
  const jid = msg.key.remoteJid || "";
  const isGroup = jid.endsWith("@g.us");
  const isMonitored = isGroup && MONITORED_GROUPS.has(jid);

  // Length filter: monitored groups bypass it (orchestrator's Tier 1 abstain handles trivial msgs)
  if (!isMonitored && (!text || text.length < MIN_LEN)) {
    stats.skipped++;
    return;
  }
  if (!text) {
    stats.skipped++;
    return;
  }
  const senderJid = isGroup ? (msg.key.participant || "") : jid;
  const senderPhone = senderJid.split("@")[0];
  const pushName = msg.pushName || "";
  const isFromMe = msg.key.fromMe;

  // Skip messages from self (we're reading, not writing)
  // But DO process our own messages — they reveal Neo's preferences/thoughts

  // === Lever A (2026-05-07): drop incoming-only group messages ===
  // Audit found 32% of wa-primary memories were other-people group chatter
  // (3,213 group rows / 25 groups, only 1 from Neo). Phase 6 corpus polluted.
  // Keep: Neo's own group sends (isFromMe), and ALL messages in MONITORED_GROUPS
  // (orchestrator needs the context to draft replies). Drop: incoming messages
  // in non-monitored groups. Memory: shared_infra_change e97f491e.
  if (isGroup && !isFromMe && !isMonitored) {
    stats.skipped++;
    return;
  }

  // Skip filtered groups (legacy SKIP_GROUPS list — kept for completeness)
  if (isGroup && SKIP_GROUPS.has(jid)) {
    stats.skipped++;
    return;
  }

  // Get group name for context
  let groupName = "";
  if (isGroup) {
    try {
      const metadata = await sock.groupMetadata(jid);
      groupName = metadata?.subject || "";
    } catch { groupName = "unknown group"; }
  }

  // Log for monitoring
  const source = isGroup ? `[${groupName}] ${pushName}` : pushName || senderPhone;
  console.log(`[twin] ${isFromMe ? "→" : "←"} ${source}: ${text.slice(0, 60)}${text.length > 60 ? "..." : ""}`);

  // Classify usefulness (skip trivial messages)
  const classification = await classifyMessage(text, pushName, isGroup, groupName, isFromMe);
  stats.classified++;

  // Threshold filter: monitored groups bypass (orchestrator decides via Tier 1 abstain)
  if (!classification || (!isMonitored && classification.score < THRESHOLD)) {
    stats.skipped++;
    return;
  }

  // Process — extract facts and save to neo-brain
  stats.processed++;
  await ingestMessage({
    text,
    chatJid: jid,
    senderPhone,
    pushName,
    isGroup,
    groupName,
    isFromMe,
    classification,
    timestamp: msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString(),
  });
}

// ── GEMINI CLASSIFIER ──

// ── IMPROVED GEMINI CLASSIFIER (v2) ──

async function classifyMessage(text, sender, isGroup, groupName, isFromMe) {
  // Rate limit
  const now = Date.now();
  if (now - lastClassifyAt < CLASSIFY_COOLDOWN_MS) {
    await new Promise(r => setTimeout(r, CLASSIFY_COOLDOWN_MS - (now - lastClassifyAt)));
  }
  lastClassifyAt = Date.now();

  const ownerAliases = [...OWNER_NICKNAMES].slice(0, 20).map(n => `"${n}"`).join(", ");
  const prompt = `Classify this WhatsApp message for a digital twin memory system. Extract SPECIFIC facts about people mentioned.

Context:
- Sender: ${sender}${isFromMe ? " (OWNER Neo Todak — his messages reveal preferences, decisions, personality)" : ""}
- Chat: ${isGroup ? "Group: " + groupName : "Direct message"}

OWNER IDENTITY: The owner of this digital twin is Neo Todak (Ahmad Fadli, CEO of Todak Studios). The following ALL refer to him: ${ownerAliases}. Whenever you mention him in person_facts, use person="neo" (lowercase, exact). Never split him across multiple person entries.

Message:
"${text.slice(0, 500)}"

RULES:
1. Score 0-10: how useful is this for understanding people's lives, relationships, work, preferences?
   - 0-2: truly empty ("ok", "haha", stickers, forwarded spam)
   - 3-5: has SOME info (schedule, location, mood, casual mention of activities)
   - 6-8: clear facts (work role, family events, plans, opinions, preferences)
   - 9-10: major life events, financial decisions, relationship changes
2. Extract person_facts: for EACH person mentioned, list concrete facts.
   - Each fact MUST be a SPECIFIC, STANDALONE statement. Bad: "Sender of the message", "Is the sender", "Refers to a quote". Good: "Lives in Cyberjaya", "Works as Sales Manager at Todak Studios".
   - If no concrete fact can be extracted, return person_facts: [].
   - "Going to KL tomorrow" → fact about sender's travel
   - "Lan is coming with the kids" → facts about Lan (has kids, traveling)
3. Quality over quantity. A message can have score 3-5 with zero facts — that's fine.

Return ONLY valid JSON:
{"score": <0-10>, "category": "<work|family|social|finance|health|travel|food|opinion|plan|identity|technical|general>", "person_facts": [{"person": "<name>", "facts": ["fact1", "fact2"]}], "about": "<owner|sender|other>"}

If score < 2, return: {"score": <n>, "category": "general", "person_facts": [], "about": "unknown"}`;

  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_KEY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(15000),
    });
    
    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 429) {
        console.log("[twin] rate limited, sleeping 5s...");
        await new Promise(r => setTimeout(r, 5000));
      }
      return { score: 3, category: "general", person_facts: [], about: "unknown" };
    }
    
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const rawText = parts.map(p => p.text || "").join("\n");
    const jsonStr = rawText.replace(/```json?\n?|```/g, "").trim();
    
    try {
      const parsed = JSON.parse(jsonStr);
      // Normalize: ensure person_facts exists
      if (!parsed.person_facts) {
        parsed.person_facts = parsed.fact ? [{ person: sender || "unknown", facts: [parsed.fact] }] : [];
      }
      return parsed;
    } catch {
      // Try to extract from malformed JSON
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          let fixed = jsonMatch[0].replace(/,\s*([\]}])/g, "$1");
          const parsed = JSON.parse(fixed);
          if (!parsed.person_facts) parsed.person_facts = [];
          return parsed;
        } catch {}
      }
      const scoreMatch = jsonStr.match(/"score"\s*:\s*(\d+)/);
      if (scoreMatch) return { score: parseInt(scoreMatch[1]), category: "general", person_facts: [], about: "unknown" };
      return { score: 3, category: "general", person_facts: [], about: "unknown" };
    }
  } catch (e) {
    if (e.message?.includes("429") || e.message?.includes("quota")) {
      console.log("[twin] rate limited, sleeping 5s...");
      await new Promise(r => setTimeout(r, 5000));
    }
    return { score: 2, category: "general", person_facts: [], about: "unknown" };
  }
}

// ── MEMORY WRITER ──

// ── IMPROVED MEMORY WRITER (v2) ──

async function ingestMessage(msg) {
  const { text, chatJid, senderPhone, pushName, isGroup, groupName, isFromMe, classification, timestamp } = msg;

  // Build content string
  const content = isFromMe
    ? `Neo said: "${text.slice(0, 500)}"${isGroup ? " (in group: " + groupName + ")" : ""}`
    : `${pushName || senderPhone} said to Neo: "${text.slice(0, 500)}"${isGroup ? " (in group: " + groupName + ")" : ""}`;

  const chatType = isGroup ? "group" : "dm";
  
  // Build extracted facts summary
  const personFacts = classification.person_facts || [];
  const factsLines = personFacts.map(pf => 
    pf.person + ": " + (pf.facts || []).join("; ")
  ).join("\n");

  const memoryEntry = {
    content: factsLines
      ? `[${chatType}${isGroup ? ": " + groupName : ""}] ${content}\n\nPerson facts:\n${factsLines}`
      : `[${chatType}${isGroup ? ": " + groupName : ""}] ${content}`,
    category: classification.category || "general",
    memory_type: "conversation",
    importance: Math.min(Math.max(Math.round(classification.score / 2), 1), 10),
    source: "wa-primary",
    visibility: classification.category === "finance" || classification.category === "family" ? "private" : "internal",
    subject_id: OWNER_ID,
    metadata: {
      chat_type: chatType,
      chat_jid: chatJid,
      group_name: isGroup ? groupName : null,
      sender_phone: senderPhone,
      sender_name: pushName,
      is_from_owner: isFromMe,
      timestamp: timestamp,
      // v2: store person_facts for enricher compatibility
      person_facts: personFacts.length > 0 ? personFacts : undefined,
      classification_score: classification.score,
    },
  };

  try {
    // Generate 768-d embedding before insert. Failure is non-blocking — we
    // save the row anyway so content is at least keyword-recallable. Without
    // an enricher in place yet, a missed embedding becomes permanent for that
    // row (3,107 such rows already exist from the pre-fix period; will need
    // a one-shot backfill).
    const embedding = await geminiEmbed(memoryEntry.content);
    if (embedding) memoryEntry.embedding = embedding;
    else stats.embedMisses = (stats.embedMisses || 0) + 1;
    await brain.from("memories").insert(memoryEntry);
    if (embedding) stats.embedHits = (stats.embedHits || 0) + 1;
  } catch (e) {
    console.error("[twin] memory save error:", e.message?.slice(0, 80));
  }

  // Save individual facts to people records
  const senderIsOwner = isSenderTheOwner({ senderPhone, pushName, isFromMe });
  for (const pf of personFacts) {
    if (!pf.person || !pf.facts?.length) continue;
    const cleanFacts = pf.facts.filter(f => !isNoiseFact(f));
    if (cleanFacts.length === 0) continue;

    // Owner branch — fact is about Neo (any alias, or message is from owner mentioning self)
    if (isOwnerAlias(pf.person) || (senderIsOwner && pf.person.toLowerCase().trim() === (pushName || "").toLowerCase().trim())) {
      for (const fact of cleanFacts) {
        try {
          await brain.from("facts").insert({
            subject_id: OWNER_ID,
            fact,
            category: classification.category || "general",
            confidence: classification.score / 10,
          });
        } catch { /* duplicate or error */ }
      }
      continue; // don't double-write to a sender row for owner facts
    }

    // Sender branch — fact is about the sender, who is NOT the owner.
    // Lever D (2026-05-07): only attribute facts to senders in DMs. In groups,
    // memories still save (with subject_id=OWNER_ID for context recall) and
    // owner-branch facts about Neo are still extracted, but we no longer let
    // group-broadcast voice pollute other people's identity profiles.
    // Memory: shared_infra_change e97f491e.
    if (!isGroup && pf.person.toLowerCase().trim() === (pushName || "").toLowerCase().trim() && senderPhone && !senderIsOwner) {
      for (const fact of cleanFacts) {
        await saveSenderFact(senderPhone, pushName, fact, classification.category);
      }
    }
  }

  const factCount = personFacts.reduce((sum, pf) => sum + (pf.facts?.length || 0), 0);
  console.log(`[twin] 💾 saved [${classification.category}] score:${classification.score} ${factCount} facts from ${personFacts.length} people${factCount === 0 ? " (no facts)" : ""}`);
  addRecentMessage({ text: text.slice(0, 300), senderPhone, pushName, isGroup, groupName, isFromMe, score: classification.score, category: classification.category, fact: personFacts.length > 0 ? personFacts.map(pf => pf.person + ": " + pf.facts?.join(", ")).join(" | ") : null, timestamp });
}

async function saveSenderFact(phone, pushName, fact, category) {
  // Skip merged dupes when looking for an existing person row, otherwise we'd
  // re-attach facts to a row that's already been consolidated.
  const { data: people } = await brain.from("people")
    .select("id,identifiers,metadata")
    .filter("identifiers::text", "ilike", `%${phone}%`)
    .is("metadata->merged_into", null)
    .limit(1);

  let personId = people?.[0]?.id;

  if (!personId) {
    // Fallback: paginated scan (people > 1000 rows). Filter merged.
    let off = 0;
    while (!personId) {
      const { data: page } = await brain.from("people")
        .select("id,identifiers,metadata")
        .is("metadata->merged_into", null)
        .range(off, off + 999);
      if (!page || page.length === 0) break;
      const match = page.find(p => (p.identifiers || []).some(i => i?.value === phone));
      if (match) { personId = match.id; break; }
      if (page.length < 1000) break;
      off += 1000;
    }
  }

  if (!personId) {
    // Last guard — if pushName matches an owner alias (LID drift), route to OWNER_ID
    // instead of creating yet another Broneotodak dupe.
    if (pushName && OWNER_NICKNAMES.has(pushName.toLowerCase().trim())) {
      personId = OWNER_ID;
      console.log(`[twin] 🔁 LID ${phone} for owner pushName="${pushName}" → routed to OWNER_ID`);
    }
  }

  if (!personId) {
    const { data: created } = await brain.from("people").insert({
      display_name: pushName || phone,
      kind: "user",
      identifiers: [{ type: "phone", value: phone }, { type: "push_name", value: pushName || phone }],
      notes: `Auto-created by twin-ingest from WhatsApp primary`,
      metadata: { source: "wa-primary", first_seen: new Date().toISOString() },
    }).select().single();
    personId = created?.id;
    console.log(`[twin] 👤 new person: ${pushName || phone} (${personId?.slice(0, 8)})`);
  }

  if (personId) {
    try {
      await brain.from("facts").insert({
        subject_id: personId,
        fact,
        category: category || "general",
        confidence: 0.7,
      });
    } catch { /* duplicate, skip */ }
  }
}

// ── GROUP FILTER LOADER ──

async function loadGroupFilters() {
  try {
    // Load from neo-brain settings or a config table
    const { data } = await brain.from("memories")
      .select("content")
      .eq("source", "twin-ingest-config")
      .eq("category", "config")
      .limit(1)
      .maybeSingle();

    if (data?.content) {
      try {
        const config = JSON.parse(data.content);
        if (config.skip_groups) config.skip_groups.forEach(g => SKIP_GROUPS.add(g));
        if (config.important_groups) config.important_groups.forEach(g => IMPORTANT_GROUPS.add(g));
        console.log(`[twin] loaded ${SKIP_GROUPS.size} skip groups, ${IMPORTANT_GROUPS.size} important groups`);
      } catch {}
    }
  } catch (e) {
    console.error("[twin] load group filters error:", e.message);
  }
}

// ── HEARTBEAT ──

async function reportHeartbeat(status = "ok") {
  try {
    await brain.from("agent_heartbeats").upsert({
      agent_name: "twin-ingest",
      status,
      meta: {
        version: "twin-ingest-v1",
        ...stats,
        uptime_sec: Math.round((Date.now() - stats.startedAt) / 1000),
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1e6),
      },
      reported_at: new Date().toISOString(),
    }, { onConflict: "agent_name" });
  } catch {}
}

// ── MAIN ──

console.log("[twin-ingest] starting v1.0.0");
console.log("[twin-ingest] READ-ONLY mode — will NEVER send messages");
console.log("[twin-ingest] target: neo-brain (" + process.env.NEO_BRAIN_URL?.slice(0, 30) + ")");

await loadGroupFilters();
await refreshMonitoredGroups();
setInterval(() => refreshMonitoredGroups().catch(()=>{}), 5 * 60 * 1000);

// Heartbeat every 60s
setInterval(() => reportHeartbeat("ok"), 60_000);

// Start WhatsApp
startDashboard();
await loadOwnerIdentity();
setInterval(loadOwnerIdentity, OWNER_RELOAD_MS);
await startWhatsApp();

process.on("SIGTERM", () => {
  console.log("[twin-ingest] shutting down");
  reportHeartbeat("offline").then(() => process.exit(0));
});
