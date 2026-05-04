#!/usr/bin/env node
/**
 * Twin Auto-Reply Watcher v3
 *
 * Polls wacli for new incoming WhatsApp messages.
 * For whitelisted contacts, generates AI replies via /api/twin-reply using Neo's digital twin memory.
 *
 * Modes per contact:
 *   - auto: AI reply sent immediately via local wacli (no approval needed)
 *   - draft: Notification sent to CLAW with approve/edit/skip links
 *
 * v3 changes: Full auto-reply mode, proper mark-sent with auth, no unnecessary notifications.
 * v2 changes: Fixed wacli output parsing, global toggle, no duplicate sync.
 *
 * Usage:
 *   node scripts/twin-watcher.js
 *   POLL_INTERVAL=30 node scripts/twin-watcher.js
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// neo-brain creds for heartbeat publishing — read from the same .env shared
// with claw-heartbeat.js. If absent, heartbeat is silently skipped (the rest
// of twin-watcher continues unaffected).
let NEO_BRAIN_URL = '', NEO_BRAIN_KEY = '';
try {
  const _e = fs.readFileSync(path.join(process.env.HOME, '.openclaw/secrets/neo-brain.env'), 'utf8');
  for (const line of _e.split('\n')) {
    const i = line.indexOf('='); if (i < 0 || line.trimStart().startsWith('#')) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    if (k === 'NEO_BRAIN_URL') NEO_BRAIN_URL = v;
    if (k === 'NEO_BRAIN_SERVICE_ROLE_KEY') NEO_BRAIN_KEY = v;
  }
} catch { /* heartbeat will silently skip */ }

// twin-watcher is CommonJS but the lib is ESM — bridge via dynamic import.
let _emitHeartbeat = null;
async function emitHb(status, meta) {
  if (!NEO_BRAIN_URL || !NEO_BRAIN_KEY) return;
  try {
    if (!_emitHeartbeat) {
      const mod = await import(path.join(__dirname, '..', '..', 'lib', 'heartbeat.mjs'));
      _emitHeartbeat = mod.emitHeartbeat;
    }
    await _emitHeartbeat({ agentName: 'twin-autoreply', status, meta, brainUrl: NEO_BRAIN_URL, serviceKey: NEO_BRAIN_KEY });
  } catch (err) {
    console.error('[twin-watcher] heartbeat fail:', err.message);
  }
}

// ==================== Config ====================

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '45') * 1000;
const TWIN_API_URL = process.env.TWIN_API_URL || 'https://clauden.neotodak.com/api/twin-reply';
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || (() => {
  try {
    return fs.readFileSync(path.join(process.env.HOME, '.openclaw/secrets/openclaw-api.key'), 'utf8').trim();
  } catch { return ''; }
})();

// CLAW wacli-service API (handles sync lock properly)
const CLAW_HOST = '100.93.159.1';
const CLAW_WACLI_PORT = 3898;
const CLAW_WACLI_TOKEN = '3B098C6C-BC98-4B66-A373-4DBE9FDE62B8';
const NEO_JID = '60177519610@s.whatsapp.net';

// Whitelist from API
let WHITELIST = new Map(); // jid -> { name, mode }
let lastWhitelistFetch = 0;

// Global toggle state
let globalEnabled = true;
let lastToggleCheck = 0;

const BLACKLIST = new Set([
  'status@broadcast',
  '6281111150379@s.whatsapp.net',  // Indo Bank Neo (CLAW) — NEVER auto-reply
]);

// State tracking
const STATE_FILE = path.join(process.env.HOME, '.twin-watcher-state.json');
let lastMessageTimestamps = {};

// ==================== Helpers ====================

function log(msg) {
  const ts = new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
  console.log(`[${ts}] ${msg}`);
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      lastMessageTimestamps = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      log(`Loaded state: tracking ${Object.keys(lastMessageTimestamps).length} chats`);
    }
  } catch { lastMessageTimestamps = {}; }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(lastMessageTimestamps, null, 2));
  } catch (e) { log(`Warning: could not save state: ${e.message}`); }
}

function wacliCmd(args) {
  try {
    const result = execSync(`/opt/homebrew/bin/wacli ${args}`, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim();
  } catch (e) {
    if (e.message && e.message.includes('store is locked')) return null;
    log(`wacli error: ${e.message.substring(0, 200)}`);
    return null;
  }
}

// Kill ALL existing wacli sync processes (not just ours)
function killAllSync() {
  try {
    execSync('pkill -f "wacli sync" 2>/dev/null || true', { timeout: 5000, stdio: 'pipe' });
    execSync('sleep 3'); // wait for lock file release
  } catch { /* no sync running */ }
}

function startSync() {
  // Check if sync is already running
  try {
    const ps = execSync('pgrep -f "wacli sync"', { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    if (ps.trim()) return;
  } catch { /* no sync running */ }

  const proc = spawn('/opt/homebrew/bin/wacli', ['sync', '--follow'], {
    stdio: 'ignore',
    detached: true
  });
  proc.unref();
}

// Pause sync, run wacli commands, resume sync
function withSyncPaused(fn) {
  killAllSync();
  try {
    return fn();
  } finally {
    startSync();
  }
}

// ==================== Global Toggle ====================

async function checkGlobalToggle() {
  // Check every 30 seconds
  if (Date.now() - lastToggleCheck < 30 * 1000) return;

  try {
    const res = await fetch(`${TWIN_API_URL}?action=global-status`, {
      headers: { 'Authorization': `Bearer ${OPENCLAW_API_KEY}` }
    });
    if (res.ok) {
      const data = await res.json();
      const wasEnabled = globalEnabled;
      globalEnabled = data.enabled !== false; // default on if no setting
      lastToggleCheck = Date.now();
      if (wasEnabled !== globalEnabled) {
        log(`Global toggle: ${globalEnabled ? 'ON' : 'OFF'}`);
      }
    }
  } catch { /* keep current state */ }
}

// ==================== Whitelist & Contact Sync ====================

async function refreshWhitelist() {
  if (Date.now() - lastWhitelistFetch < 5 * 60 * 1000 && WHITELIST.size > 0) return;

  try {
    const res = await fetch(`${TWIN_API_URL}?action=whitelist`, {
      headers: { 'Authorization': `Bearer ${OPENCLAW_API_KEY}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.contacts)) {
      WHITELIST = new Map(data.contacts.map(c => [c.jid, { name: c.name, mode: c.mode }]));
      lastWhitelistFetch = Date.now();
      log(`Whitelist refreshed: ${WHITELIST.size} contacts`);
    }
  } catch (e) {
    log(`Whitelist fetch error: ${e.message}`);
  }
}

let lastContactSync = 0;

async function syncContacts() {
  if (Date.now() - lastContactSync < 30 * 60 * 1000) return;

  try {
    const output = wacliCmd('chats list');
    if (!output) return;

    const contacts = [];
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.startsWith('KIND') || line.includes('status@broadcast')) continue;

      // Format: KIND  NAME  JID  LAST
      // Parse by finding JID pattern (contains @)
      const jidMatch = line.match(/(\S+@(?:s\.whatsapp\.net|g\.us|lid|broadcast))/);
      if (!jidMatch) continue;
      const jid = jidMatch[1];

      // KIND is the first word
      const kind = line.trim().split(/\s+/)[0];

      // Name is between KIND and JID
      const kindEnd = line.indexOf(kind) + kind.length;
      const jidStart = line.indexOf(jid);
      let name = line.substring(kindEnd, jidStart).trim();
      if (!name || name === jid) continue;

      // Timestamp is after JID
      const tsMatch = line.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
      const lastActive = tsMatch ? tsMatch[0] : null;

      contacts.push({ jid, name, kind, last_active: lastActive });
    }

    if (contacts.length === 0) return;

    const res = await fetch(TWIN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_API_KEY}`
      },
      body: JSON.stringify({ _action: 'sync-contacts', contacts })
    });

    if (res.ok) {
      lastContactSync = Date.now();
      log(`Synced ${contacts.length} contacts to API`);
    }
  } catch (e) {
    log(`Contact sync error: ${e.message}`);
  }
}

// ==================== Core Logic ====================

function getRecentChats() {
  const output = wacliCmd('chats list --limit 20');
  if (!output) return [];

  const chats = [];
  const lines = output.split('\n');

  for (const line of lines) {
    if (line.startsWith('KIND') || !line.trim()) continue;

    // Format: KIND  NAME  JID  LAST
    const jidMatch = line.match(/(\S+@(?:s\.whatsapp\.net|g\.us|lid|broadcast))/);
    if (!jidMatch) continue;
    const jid = jidMatch[1];

    // KIND is the first word
    const kind = line.trim().split(/\s+/)[0];

    // Name is between KIND and JID
    const kindEnd = line.indexOf(kind) + kind.length;
    const jidStart = line.indexOf(jid);
    const name = line.substring(kindEnd, jidStart).trim();

    chats.push({ jid, name, kind });
  }
  return chats;
}

function getMessages(chatJid, limit = 5) {
  const output = wacliCmd(`messages list --chat "${chatJid}" --limit ${limit}`);
  if (!output) return [];

  const messages = [];
  const lines = output.split('\n');

  for (const line of lines) {
    if (line.startsWith('TIME') || !line.trim()) continue;
    // Format: TIME  CHAT  FROM  ID  TEXT
    // Parse by columns — FROM tells us who sent it
    messages.push(line.trim());
  }
  return messages;
}

function parseLastIncomingMessage(messages) {
  // Walk backward to find latest incoming message (FROM !== "me")
  // wacli format: TIME  CHAT  FROM  ID  TEXT
  for (let i = messages.length - 1; i >= 0; i--) {
    const line = messages[i];

    // Try to extract the FROM field
    // Format: "2026-03-22 00:44:09  Sathia  190962852724873@l…  2A67F49ED…  Esok sy dtg"
    // The FROM field comes after CHAT name — we detect "me" specifically

    // Split by 2+ spaces
    const parts = line.split(/\s{2,}/);
    // parts[0] = timestamp, parts[1] = CHAT/name, parts[2] = FROM, parts[3] = ID, parts[4] = TEXT
    if (parts.length < 5) continue;

    const from = parts[2].trim();
    const text = parts.slice(4).join('  ').trim();

    if (from === 'me') continue; // skip our own messages

    return {
      text,
      from,
      raw: line,
      isIncoming: true
    };
  }
  return null;
}

function buildConversationHistory(messages) {
  // Convert raw wacli messages to readable format
  const history = [];
  for (const line of messages) {
    const parts = line.split(/\s{2,}/);
    if (parts.length < 5) continue;
    const from = parts[2].trim();
    const text = parts.slice(4).join('  ').trim();
    history.push(`${from === 'me' ? 'Neo' : from}: ${text}`);
  }
  return history;
}

async function generateDraft(senderJid, senderName, chatJid, chatName, inboundMessage, conversationHistory) {
  try {
    const res = await fetch(TWIN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_API_KEY}`
      },
      body: JSON.stringify({
        sender_jid: senderJid,
        sender_name: senderName,
        chat_jid: chatJid,
        chat_name: chatName,
        inbound_message: inboundMessage,
        conversation_history: conversationHistory
      })
    });

    if (!res.ok) {
      const err = await res.text();
      log(`Draft generation failed: ${err.substring(0, 200)}`);
      return null;
    }

    return await res.json();
  } catch (e) {
    log(`Draft generation error: ${e.message}`);
    return null;
  }
}

async function notifyViaClaw(senderName, inboundMessage, draftReply, links) {
  const msg = [
    `💬 *${senderName}*: ${inboundMessage.substring(0, 200)}`,
    ``,
    `🤖 *Draft reply:*`,
    draftReply.substring(0, 300),
    ``,
    `✅ ${links.send}`,
    `✏️ ${links.edit}`,
    `❌ ${links.skip}`
  ].join('\n');

  try {
    // Write payload to temp file, SCP to CLAW, curl from there
    // This avoids all shell escaping issues
    const payload = JSON.stringify({ to: NEO_JID, kind: 'text', message: msg });
    const tmpFile = '/tmp/twin-notify.json';
    const remoteTmp = '/tmp/twin-notify.json';

    fs.writeFileSync(tmpFile, payload);

    // SCP the payload file to CLAW
    execSync(`scp -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${tmpFile} zieel@${CLAW_HOST}:${remoteTmp}`, {
      timeout: 10000, stdio: 'pipe'
    });

    // curl on CLAW using the file
    const result = execSync(
      `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no zieel@${CLAW_HOST} 'curl -s -X POST http://127.0.0.1:${CLAW_WACLI_PORT}/send -H "Authorization: Bearer ${CLAW_WACLI_TOKEN}" -H "Content-Type: application/json" -d @${remoteTmp}'`,
      { timeout: 15000, stdio: 'pipe', encoding: 'utf8' }
    );

    log(`Notification sent to Neo via CLAW wacli-service: ${result.substring(0, 80)}`);
    return true;
  } catch (e) {
    log(`CLAW notification failed: ${e.message.substring(0, 200)}`);

    // Fallback: macOS notification with approve link
    try {
      const safeMsg = inboundMessage.substring(0, 50).replace(/["`$]/g, '');
      const safeName = senderName.replace(/["`$]/g, '');
      execSync(`terminal-notifier -title "Twin Reply: ${safeName}" -message "${safeMsg}" -sound default -open "${links.send}"`, {
        timeout: 5000, stdio: 'pipe'
      });
      log('Fallback: macOS notification sent');
    } catch { /* silent */ }
    return false;
  }
}

async function checkAndSendApproved() {
  try {
    const res = await fetch(`${TWIN_API_URL}?action=approved`, {
      headers: { 'Authorization': `Bearer ${OPENCLAW_API_KEY}` }
    });

    if (!res.ok) return;
    const data = await res.json();
    const drafts = data.drafts;
    if (!Array.isArray(drafts) || drafts.length === 0) return;

    for (const draft of drafts) {
      const replyText = draft.sent_reply || draft.draft_reply;
      if (!replyText || !draft.chat_jid) continue;

      log(`Sending approved reply to ${draft.sender_name} (${draft.chat_jid})...`);

      // Kill sync, send message, restart sync
      killAllSync();

      const escaped = replyText.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
      const sendResult = wacliCmd(`send text --to "${draft.chat_jid}" --message "${escaped}"`);

      if (sendResult !== null) {
        log(`✅ Sent reply to ${draft.sender_name}: "${replyText.substring(0, 60)}..."`);

        // Mark as actually sent via the API
        await fetch(`${TWIN_API_URL}?action=mark-sent&id=${draft.id}`, {
          headers: { 'Authorization': `Bearer ${OPENCLAW_API_KEY}` }
        });
      } else {
        log(`❌ Failed to send reply to ${draft.sender_name}`);
      }

      // Restart sync
      startSync();

      // Small delay between sends
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (e) {
    log(`Check approved error: ${e.message}`);
  }
}

// ==================== Main Poll Loop ====================

async function poll() {
  // Check global toggle
  await checkGlobalToggle();

  if (!globalEnabled) {
    // Still check for approved drafts (Neo might have toggled off but has pending approvals)
    await checkAndSendApproved();
    return;
  }

  // Refresh whitelist (HTTP only, no wacli lock needed)
  await refreshWhitelist();

  // Pause sync to run wacli commands, then resume
  // This is needed because wacli sync --follow holds the store lock
  log('Pausing sync for poll...');
  killAllSync();

  try {
    // Check for approved drafts to send
    await checkAndSendApproved();

    // Sync contacts periodically
    await syncContacts();

    // Get recent chats and check for new messages
    const chats = getRecentChats();
    const wlMatched = chats.filter(c => WHITELIST.has(c.jid));
    log(`Found ${chats.length} recent chats (${wlMatched.length} whitelisted: ${wlMatched.map(c => c.name).join(', ') || 'none'})`);
    if (wlMatched.length < 3) {
      // Debug: show top 5 chat JIDs to diagnose matching issues
      log(`DEBUG top chats: ${chats.slice(0, 5).map(c => `${c.name}=${c.jid}`).join(' | ')}`);
      log(`DEBUG whitelist: ${Array.from(WHITELIST.keys()).join(', ')}`);
    }

    for (const chat of chats) {
      if (BLACKLIST.has(chat.jid)) continue;

      // Only process whitelisted DM contacts (skip groups for now)
      if (WHITELIST.size === 0 || !WHITELIST.has(chat.jid)) continue;

      // Skip groups unless explicitly whitelisted
      if (chat.kind === 'group') continue;

      const messages = getMessages(chat.jid, 8);
      if (messages.length === 0) continue;

      // Find last incoming message
      const incoming = parseLastIncomingMessage(messages);
      if (!incoming) continue;

      const msgKey = `${chat.jid}:${incoming.text}`;

      // Skip if we've already processed this
      if (lastMessageTimestamps[chat.jid] === msgKey) continue;

      const contact = WHITELIST.get(chat.jid);
      const senderName = contact?.name || chat.name;
      log(`📨 New message from ${senderName}: ${incoming.text.substring(0, 100)}`);

      // Build conversation history
      const history = buildConversationHistory(messages);

      const result = await generateDraft(
        chat.jid,
        senderName,
        chat.jid,
        chat.name,
        incoming.text,
        history.slice(0, -1) // all but the last (which is the incoming msg)
      );

      if (result && result.ok) {
        log(`🤖 Draft: "${result.draft_reply.substring(0, 80)}..."`);

        // Check mode — auto or draft
        if (contact?.mode === 'auto') {
          // Auto-send via LOCAL wacli (sends from Neo's primary WhatsApp)
          // CLAW wacli-service sends from Indo Bank Neo — WRONG number for replies
          log(`⚡ Auto-mode for ${senderName}, sending via local wacli...`);
          const escaped = result.draft_reply.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
          const sendResult = wacliCmd(`send text --to "${chat.jid}" --message "${escaped}"`);
          if (sendResult !== null) {
            log(`✅ Auto-sent to ${senderName}: "${result.draft_reply.substring(0, 60)}..."`);
            // Mark draft as sent in Supabase (with auth)
            await fetch(`${TWIN_API_URL}?action=mark-sent&id=${result.draft_id}`, {
              headers: { 'Authorization': `Bearer ${OPENCLAW_API_KEY}` }
            });
          } else {
            log(`❌ Failed to auto-send to ${senderName} (wacli locked or error)`);
          }
        } else {
          // Draft mode — send notification for approval
          await notifyViaClaw(senderName, incoming.text, result.draft_reply, result.links);
        }

        // Mark as processed
        lastMessageTimestamps[chat.jid] = msgKey;
        saveState();
      }
    }
  } finally {
    // Always restart sync after polling
    startSync();
  }
}

// ==================== Startup ====================

async function main() {
  log('=== Twin Auto-Reply Watcher v3 ===');
  log(`Poll interval: ${POLL_INTERVAL / 1000}s`);
  log(`API: ${TWIN_API_URL}`);
  log('');

  if (!OPENCLAW_API_KEY) {
    log('ERROR: No OPENCLAW_API_KEY found. Check ~/.openclaw/secrets/openclaw-api.key');
    process.exit(1);
  }

  loadState();

  // Ensure wacli sync is running (don't start duplicate)
  startSync();

  // Initial poll
  await poll();

  // Heartbeat — emit one beat per minute alongside the poll loop.
  await emitHb('ok', { whitelist_size: WHITELIST.size, global_enabled: globalEnabled, version: 'twin-watcher-v3' });
  setInterval(() => emitHb('ok', { whitelist_size: WHITELIST.size, global_enabled: globalEnabled, version: 'twin-watcher-v3' }), 60_000);

  // Continue polling
  setInterval(async () => {
    try {
      await poll();
    } catch (e) {
      log(`Poll error: ${e.message}`);
    }
  }, POLL_INTERVAL);

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('Shutting down...');
    saveState();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('Shutting down...');
    saveState();
    process.exit(0);
  });
}

main().catch(e => {
  log(`Fatal: ${e.message}`);
  process.exit(1);
});
