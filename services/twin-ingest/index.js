import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { createHash, createHmac, randomUUID } from "node:crypto";
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

// ── MEDIA CAPTURE (NAS-MinIO + neo-brain.media + memory link) ──
//
// Mirrors siti-ingest's media pipeline so Neo's primary WA history (groups
// + DMs Siti isn't in) gets persisted with rich semantic context. Without
// this, every attachment Neo received was invisible to siti-v2's
// list_media / recall / resend_media. Added 2026-05-09.
//
// Coverage: inbound + outbound media in any chat twin-ingest sees. Each
// captured item gets:
//   1. bytes uploaded to NAS-MinIO (image/audio/video/document)
//   2. neo-brain.media row (kind, storage_url, mime, source_ref)
//   3. neo-brain.memories row with rich-context content + media_id linked
//      + 768-d Gemini embedding for pgvector semantic search
//
// Rich context = sender + chat label + caption + filename + reply-to +
// recent-thread-snippet, so Neo can ask "the PDF Lan sent in Strategic
// Council" and recall finds it semantically.

const MEDIA_KINDS_PERSISTABLE_TWIN = new Set(["image", "audio", "video", "document"]);

let minioCfg = null;
async function loadMinioCfg() {
  if (minioCfg) return minioCfg;
  try {
    const { data, error } = await brain.rpc("get_credential", {
      p_owner_id: "00000000-0000-0000-0000-000000000001",
      p_service: "minio-nas",
      p_credential_type: "sdk_service_account",
      p_environment: "production",
    });
    if (error) throw error;
    const row = data?.[0];
    if (!row?.credential_value) throw new Error("minio creds not found in vault");
    const parsed = typeof row.credential_value === "string"
      ? JSON.parse(row.credential_value)
      : row.credential_value;
    minioCfg = parsed;
    console.log(`[twin-media] minio ready: ${minioCfg.endpoint} bucket=${minioCfg.bucket}`);
    return minioCfg;
  } catch (e) {
    console.error("[twin-media] loadMinioCfg failed:", e.message?.slice(0, 200));
    return null;
  }
}

// SigV4 signing — mirrors siti-ingest/server.js. Same byte-for-byte AWS
// canonical request format so MinIO accepts both services' uploads.
function _s3SigningKey(secret, dateStamp, region) {
  const kDate = createHmac("sha256", "AWS4" + secret).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update("s3").digest();
  return createHmac("sha256", kService).update("aws4_request").digest();
}
async function s3Put(key, body, contentType) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const objectUrl = (minioCfg.pathStyle === false)
    ? `${minioCfg.endpoint.replace("://", `://${minioCfg.bucket}.`)}/${encodeURI(key)}`
    : `${minioCfg.endpoint.replace(/\/$/, "")}/${minioCfg.bucket}/${encodeURI(key)}`;
  const u = new URL(objectUrl);
  const amzDate = new Date().toISOString().replace(/[:-]/g, "").replace(/\..{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(buf).digest("hex");
  const headers = {
    host: u.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    "content-type": contentType || "application/octet-stream",
  };
  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((h) => `${h}:${String(headers[h]).trim()}\n`).join("");
  const signedHeaders = sortedNames.join(";");
  const canonicalRequest = ["PUT", u.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${minioCfg.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope,
    createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const signingKey = _s3SigningKey(minioCfg.secretAccessKey, dateStamp, minioCfg.region);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${minioCfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const r = await fetch(objectUrl, { method: "PUT", body: buf, headers });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`s3 put ${r.status}: ${t.slice(0, 200)}`);
  }
  return { url: objectUrl, bytes: buf.length };
}

async function saveMediaToNas({ kind, buffer, mimeType, caption = null, sourceRef = {} }) {
  if (!minioCfg || !buffer || !buffer.length) return null;
  if (!MEDIA_KINDS_PERSISTABLE_TWIN.has(kind)) return null;
  try {
    const ext = (mimeType || "").split("/")[1]?.split(";")[0]?.replace(/[^a-z0-9]/gi, "") || "bin";
    const now = new Date();
    const key = `${kind}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
    const uploaded = await s3Put(key, buffer, mimeType);
    const { data, error } = await brain.from("media").insert({
      kind,
      storage_url: uploaded.url,
      storage_provider: "s3",
      mime_type: mimeType || null,
      bytes: uploaded.bytes,
      caption,
      source: "twin-ingest",
      source_ref: sourceRef,
      subject_id: OWNER_ID,
    }).select("id,storage_url").single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error("[twin-media] saveMediaToNas failed:", e.message?.slice(0, 200));
    return null;
  }
}

// Detect baileys media-message variants. Returns null when no media; else
// { kind, mime, caption, filename, quotedBody, durationSeconds }.
function extractMediaInfo(msg) {
  const m = msg.message;
  if (!m) return null;
  const ctx = (sub) => sub?.contextInfo?.quotedMessage;
  const quotedBodyFor = (sub) => {
    const q = ctx(sub);
    if (!q) return null;
    return q.conversation || q.extendedTextMessage?.text
      || q.imageMessage?.caption || q.videoMessage?.caption
      || q.documentMessage?.fileName || null;
  };
  if (m.imageMessage) return {
    kind: "image",
    mime: m.imageMessage.mimetype || "image/jpeg",
    caption: m.imageMessage.caption || null,
    filename: null,
    quotedBody: quotedBodyFor(m.imageMessage),
  };
  if (m.audioMessage) return {
    kind: "audio",
    mime: m.audioMessage.mimetype || "audio/ogg",
    caption: null,
    filename: null,
    quotedBody: quotedBodyFor(m.audioMessage),
    durationSeconds: m.audioMessage.seconds || null,
  };
  if (m.videoMessage) return {
    kind: "video",
    mime: m.videoMessage.mimetype || "video/mp4",
    caption: m.videoMessage.caption || null,
    filename: null,
    quotedBody: quotedBodyFor(m.videoMessage),
    durationSeconds: m.videoMessage.seconds || null,
  };
  if (m.documentMessage) return {
    kind: "document",
    mime: m.documentMessage.mimetype || "application/octet-stream",
    caption: m.documentMessage.caption || null,
    filename: m.documentMessage.fileName || null,
    quotedBody: quotedBodyFor(m.documentMessage),
  };
  // Sticker, contact, location, document-with-caption variants — ignore for now.
  return null;
}

// Recent-message ring per chat — keeps last N text msgs so media capture
// can include thread context in the embedded content. ~50 active chats
// at any time, 5 msgs each = ~250 small strings in memory. Acceptable.
const RECENT_MSG_LIMIT = 5;
const recentMessageRing = new Map(); // chatJid -> [{ from, text, ts }]
function pushRecentMessage(chatJid, from, text, ts) {
  if (!chatJid || !text) return;
  const arr = recentMessageRing.get(chatJid) || [];
  arr.push({ from, text: String(text).slice(0, 200), ts });
  while (arr.length > RECENT_MSG_LIMIT) arr.shift();
  recentMessageRing.set(chatJid, arr);
}
function getRecentThread(chatJid, limit = 2) {
  const arr = recentMessageRing.get(chatJid) || [];
  return arr.slice(-limit);
}

// Quick people lookup for sender display names. 60s cache to avoid
// hammering the DB. Lookup by phone, then by lid format.
const senderNameCache = new Map(); // phone -> { name, ts }
const SENDER_CACHE_MS = 60_000;
async function resolveSenderName(senderPhone) {
  if (!senderPhone) return null;
  const cached = senderNameCache.get(senderPhone);
  if (cached && Date.now() - cached.ts < SENDER_CACHE_MS) return cached.name;
  try {
    const { data } = await brain
      .from("people")
      .select("display_name,full_name,push_name")
      .eq("phone", senderPhone)
      .limit(1)
      .maybeSingle();
    const name = data?.display_name || data?.full_name || data?.push_name || null;
    senderNameCache.set(senderPhone, { name, ts: Date.now() });
    return name;
  } catch {
    return null;
  }
}

// Capture + persist a media item. Called from processMessage when
// extractMediaInfo returns non-null. Best-effort: any failure logs
// and returns; never blocks the text-side processing.
async function processMediaCapture(msg, sock, mediaInfo) {
  if (!minioCfg) return;

  const jid = msg.key.remoteJid || "";
  const isGroup = jid.endsWith("@g.us");
  const senderJid = isGroup ? (msg.key.participant || "") : jid;
  const senderPhone = senderJid.split("@")[0];
  const isFromMe = !!msg.key.fromMe;
  const pushName = msg.pushName || "";

  // Group name (best-effort)
  let groupName = "";
  if (isGroup) {
    try { groupName = (await sock.groupMetadata(jid))?.subject || ""; } catch { groupName = "unknown group"; }
  }

  // Download bytes
  let buffer;
  try {
    buffer = await downloadMediaMessage(msg, "buffer", {});
  } catch (e) {
    console.error(`[twin-media] download fail (${mediaInfo.kind}): ${e.message?.slice(0, 120)}`);
    return;
  }
  if (!buffer || buffer.length === 0) return;

  // Sender name (display_name from people table)
  const senderName = isFromMe ? "Neo" : (await resolveSenderName(senderPhone) || pushName || senderPhone);
  const direction = isFromMe ? "outbound" : "inbound";
  const chatLabel = isGroup ? `group "${groupName || "(unknown)"}"` : `DM with ${senderName}`;

  // Build rich context content (also gets embedded for pgvector search)
  const lines = [
    `[${mediaInfo.kind}] ${direction} in ${chatLabel}, sent by ${senderName}`,
  ];
  if (mediaInfo.caption) lines.push(`Caption: ${String(mediaInfo.caption).slice(0, 400)}`);
  if (mediaInfo.filename) lines.push(`Filename: ${mediaInfo.filename}`);
  if (mediaInfo.quotedBody) lines.push(`Reply to: ${String(mediaInfo.quotedBody).slice(0, 250)}`);
  if (typeof mediaInfo.durationSeconds === "number") lines.push(`Duration: ${mediaInfo.durationSeconds}s`);
  const recent = getRecentThread(jid, 2);
  if (recent.length) {
    const ctxStr = recent.map((m) => `${m.from}: ${m.text}`).join(" | ");
    lines.push(`Recent thread: ${ctxStr.slice(0, 280)}`);
  }
  const content = lines.join("\n");

  const embedding = await geminiEmbed(content);

  // Upload bytes + insert media row
  const mediaRow = await saveMediaToNas({
    kind: mediaInfo.kind,
    buffer,
    mimeType: mediaInfo.mime,
    caption: mediaInfo.caption,
    sourceRef: {
      via: "twin-ingest",
      wa_message_id: msg.key.id,
      chat_jid: jid,
      from_phone: senderPhone,
      push_name: pushName,
      sender_name: senderName,
      is_group: isGroup,
      group_name: groupName || null,
      direction,
      original_filename: mediaInfo.filename || null,
    },
  });
  if (!mediaRow?.id) return;

  // Insert memory row — separate source ('wa-primary-media') so it's
  // distinct from text wa-primary captures and from siti-outbound-media.
  try {
    await brain.from("memories").insert({
      content,
      embedding,
      source: "wa-primary-media",
      importance: 4,
      metadata: {
        chat_jid: jid,
        chat_type: isGroup ? "group" : "dm",
        group_name: groupName || null,
        sender_phone: senderPhone,
        sender_name: senderName,
        push_name: pushName,
        is_from_owner: isFromMe,
        direction,
        has_media: true,
        media_id: mediaRow.id,
        media_type: mediaInfo.kind,
        media_storage_url: mediaRow.storage_url,
        media_mime: mediaInfo.mime || null,
        original_filename: mediaInfo.filename || null,
        wa_message_id: msg.key.id,
        timestamp: msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString(),
      },
    });
    stats.mediaPersisted = (stats.mediaPersisted || 0) + 1;
    console.log(`[twin-media] ✓ ${mediaInfo.kind} ${direction} from ${senderName} in ${chatLabel} (media.id=${mediaRow.id.slice(0, 8)}…, bytes=${buffer.length})`);
  } catch (e) {
    console.error("[twin-media] memory insert err:", e.message?.slice(0, 200));
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

  // Push to recent-message ring BEFORE media handling so capture sees
  // surrounding thread context. Only push when text is meaningful.
  if (text && text.length >= 3) {
    const fromLabel = msg.key.fromMe ? "Neo" : (msg.pushName || (isGroup ? msg.key.participant : jid).split("@")[0]);
    pushRecentMessage(jid, fromLabel, text, msg.messageTimestamp);
  }

  // Media capture runs INDEPENDENTLY of the text-quality gate. An image
  // with no caption still has value (sender + chat + thread context),
  // so we capture even when text is empty/trivial. Don't await here —
  // fire-and-forget so the text path stays fast for non-media messages.
  const mediaInfo = extractMediaInfo(msg);
  if (mediaInfo) {
    processMediaCapture(msg, sock, mediaInfo).catch((e) =>
      console.error(`[twin-media] capture exception: ${e.message?.slice(0, 120)}`)
    );
  }

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

  const waEntry = {
    content: factsLines
      ? `[${chatType}${isGroup ? ": " + groupName : ""}] ${content}\n\nPerson facts:\n${factsLines}`
      : `[${chatType}${isGroup ? ": " + groupName : ""}] ${content}`,
    category: classification.category || "general",
    memory_type: "conversation",
    importance: Math.min(Math.max(Math.round(classification.score / 2), 1), 10),
    source: "wa-primary",
    visibility: classification.category === "finance" || classification.category === "family" ? "private" : "internal",
    subject_id: OWNER_ID,
    // Denormalized WA columns (wa_messages schema, Phase 2 of
    // memory-table-separation spec).
    chat_jid: chatJid,
    sender_phone: senderPhone,
    push_name: pushName,
    is_group: isGroup,
    is_from_self: isFromMe,
    // Catchall kept for forwards-compat with dashboard/orchestrator readers
    // that still consume metadata fields (chat_type, group_name, etc.)
    metadata: {
      chat_type: chatType,
      group_name: isGroup ? groupName : null,
      sender_name: pushName,
      is_from_owner: isFromMe,
      timestamp: timestamp,
      person_facts: personFacts.length > 0 ? personFacts : undefined,
      classification_score: classification.score,
    },
  };

  try {
    // Generate 768-d embedding before insert. Failure is non-blocking — we
    // save the row anyway so content is at least keyword-recallable.
    const embedding = await geminiEmbed(waEntry.content);
    if (embedding) waEntry.embedding = embedding;
    else stats.embedMisses = (stats.embedMisses || 0) + 1;
    await brain.from("wa_messages").insert(waEntry);
    if (embedding) stats.embedHits = (stats.embedHits || 0) + 1;
  } catch (e) {
    console.error("[twin] wa_messages save error:", e.message?.slice(0, 80));
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

// Load MinIO creds for media capture. Failure here doesn't block startup —
// twin-ingest still does text capture even if NAS is unreachable; media
// just gets silently skipped (logged) until the next config reload.
await loadMinioCfg();

await startWhatsApp();

process.on("SIGTERM", () => {
  console.log("[twin-ingest] shutting down");
  reportHeartbeat("offline").then(() => process.exit(0));
});
