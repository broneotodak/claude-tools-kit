#!/usr/bin/env node
// Prepare WA-primary slice → chat-format JSONL for Qwen 2.5 Instruct fine-tuning.
//
// Strategy:
//   1. Read by-source/wa-primary.jsonl
//   2. Group rows by chat_id (sender_phone for DMs, group_name for groups)
//   3. Sort each chat by timestamp
//   4. For each Neo message (is_from_owner=true), find the most recent non-Neo
//      message in the same chat within a time window → form (user → assistant) pair
//   5. Strip the "[dm]/[group: X] X said: ..." wrapper, keep raw message body
//   6. Emit {"messages":[{"role":"system",...},{"role":"user",...},{"role":"assistant",...}]}
//
// Usage:
//   node prepare-training.js                # full dataset
//   node prepare-training.js --sample 50    # sanity test on 50 pairs
//   node prepare-training.js --in PATH      # custom input path
//   node prepare-training.js --out PATH     # custom output path

import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

// ─── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { sample: null, in: null, out: null, maxGapMinutes: 60 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--sample') a.sample = Number(argv[++i]);
    else if (k === '--in') a.in = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--max-gap-minutes') a.maxGapMinutes = Number(argv[++i]);
    else if (k === '--help' || k === '-h') { printHelp(); process.exit(0); }
    else { console.error('Unknown flag:', k); process.exit(2); }
  }
  return a;
}
function printHelp() {
  console.log(`Usage: node prepare-training.js [flags]
  --sample N            emit only N pairs (sanity test)
  --in PATH             input wa-primary.jsonl (default: latest extraction)
  --out PATH            output JSONL (default: ~/datasets/neo-corpus/training/<date>/train.jsonl)
  --max-gap-minutes N   max minutes between user msg and Neo reply (default: 60)`);
}

// ─── PARSING HELPERS ──────────────────────────────────────────────────────────
// Strip "[dm] X said: \"...\"" or "[group: NAME] X said to Neo: \"...\"" wrapper.
// Also strips trailing enrichment blocks ("Person facts:", "Topic:", etc.) added by
// upstream importers so we keep only the raw message body.
function stripWrapper(content) {
  if (!content) return '';
  // Remove leading [dm] or [group: NAME]
  let s = content.replace(/^\[(?:dm|group:[^\]]+)\]\s+/, '');
  // Remove "X said[ to Y][ in GROUP]: " prefix
  s = s.replace(/^[^:]+ said(?: to [^:]+)?(?: in [^:]+)?:\s+/, '');
  // Drop trailing enrichment blocks (importer-appended summaries)
  s = s.split(/\n\n(?:Person facts|People facts|Topic|Summary|Context|Tags|Mentions|Entities):/i)[0];
  // Strip surrounding quotes if present
  s = s.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
  return s.trim();
}

function chatIdOf(row) {
  const m = row.metadata || {};
  if (m.chat_type === 'group' && m.group_name) return 'group::' + m.group_name;
  if (m.chat_type === 'dm' && m.sender_phone) {
    // For DMs: use the OTHER party's phone (when Neo sends, sender is Neo, but the chat is with the other party)
    // We don't have a "chat_id" field but DMs are scoped to one external party.
    // Heuristic: when is_from_owner=true, the chat_id can't be derived from sender; we mark
    // this row's chat_id as "dm::unknown_in_session" — but we do better by using a
    // co-occurrence approach below. For grouping purposes, use sender_phone for incoming
    // and a placeholder for outgoing.
    return m.is_from_owner ? null : 'dm::' + m.sender_phone;
  }
  return null;
}

// Better strategy for DMs: build an *interleaved* timeline per (any) DM partner.
// We can pair an outgoing Neo msg with an incoming msg if they're CLOSE in time
// AND there's no other group/incoming between them. We approximate by:
//   - Treat ALL DM rows as one stream sorted by ts
//   - For each Neo DM message, scan backwards in the same (rolling) DM window for
//     the most recent INCOMING DM message within --max-gap-minutes
// This is imperfect (you might be replying to one person while another DMs you)
// but for thousands of pairs the noise averages out for voice training.

// ─── MAIN ─────────────────────────────────────────────────────────────────────
function defaultIn() {
  const root = join(homedir(), 'datasets', 'neo-corpus');
  const dirs = readdirSync(root).filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  return join(root, dirs[dirs.length - 1], 'by-source', 'wa-primary.jsonl');
}

function defaultOut() {
  const today = new Date().toISOString().slice(0, 10);
  return join(homedir(), 'datasets', 'neo-corpus', 'training', today, 'train.jsonl');
}

const SYSTEM_PROMPT = "You are Neo Todak (Ahmad Fadli Bin Ahmad Dahlan), Malaysian, casual BM-EN code-switching style. Reply in your natural WhatsApp tone.";

async function main() {
  const opts = parseArgs(process.argv);
  const inPath = opts.in ? resolve(opts.in) : defaultIn();
  const outPath = opts.out ? resolve(opts.out) : defaultOut();
  const maxGapMs = opts.maxGapMinutes * 60 * 1000;

  console.log('# Preparing training data');
  console.log('  in :', inPath);
  console.log('  out:', outPath);
  console.log('  max gap:', opts.maxGapMinutes, 'min');
  console.log('  sample:', opts.sample ?? 'all');

  const lines = readFileSync(inPath, 'utf8').trim().split('\n');
  const rows = lines.map(l => JSON.parse(l));
  console.log(`  loaded: ${rows.length} rows`);

  // Sort all rows by timestamp
  rows.sort((a, b) => new Date(a.ts) - new Date(b.ts));

  // Build per-chat timelines
  const groupChats = new Map();   // group_name → [rows]
  const dmChats = new Map();      // sender_phone (other party) → [rows]
  const dmRollingTimeline = [];   // for the DM heuristic: all DM rows in time order

  for (const r of rows) {
    const m = r.metadata || {};
    if (m.chat_type === 'group' && m.group_name) {
      if (!groupChats.has(m.group_name)) groupChats.set(m.group_name, []);
      groupChats.get(m.group_name).push(r);
    } else if (m.chat_type === 'dm') {
      dmRollingTimeline.push(r);
      // Index by sender_phone only for INCOMING (otherwise we don't know which DM partner Neo replied to)
      if (!m.is_from_owner && m.sender_phone) {
        if (!dmChats.has(m.sender_phone)) dmChats.set(m.sender_phone, []);
        dmChats.get(m.sender_phone).push(r);
      }
    }
  }

  console.log(`  groups: ${groupChats.size}, dm partners (incoming): ${dmChats.size}`);

  // ─── PAIR BUILDING ────────────────────────────────────────────────────────
  const pairs = [];

  // (a) GROUP CHATS: walk each group's timeline, pair each Neo msg with the
  // most recent prior non-Neo msg in the SAME group within max gap.
  for (const [groupName, gRows] of groupChats) {
    let lastIncoming = null;
    for (const r of gRows) {
      const isNeo = r.metadata?.is_from_owner === true;
      if (!isNeo) {
        lastIncoming = r;
        continue;
      }
      if (!lastIncoming) continue;
      const gap = new Date(r.ts) - new Date(lastIncoming.ts);
      if (gap > maxGapMs) { lastIncoming = null; continue; }
      const userBody = stripWrapper(lastIncoming.content);
      const neoBody = stripWrapper(r.content);
      if (!userBody || !neoBody) continue;
      const senderName = lastIncoming.metadata?.sender_name || 'someone';
      pairs.push({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `[group: ${groupName}] ${senderName}: ${userBody}` },
          { role: 'assistant', content: neoBody }
        ],
        meta: { chat_type: 'group', group_name: groupName, ts: r.ts }
      });
      // Note: don't reset lastIncoming — Neo's reply doesn't make the prior msg stale yet
    }
  }

  // (b) DM CHATS: harder because Neo's outgoing isn't tagged with the partner.
  // Use the rolling timeline: for each Neo DM, find the most recent INCOMING DM
  // (any partner) within max gap. Multiple partners interleaved adds noise but
  // for 1,694 Neo msgs it'll average out. Acceptable for voice training.
  let lastDmIncoming = null;
  for (const r of dmRollingTimeline) {
    const isNeo = r.metadata?.is_from_owner === true;
    if (!isNeo) {
      lastDmIncoming = r;
      continue;
    }
    if (!lastDmIncoming) continue;
    const gap = new Date(r.ts) - new Date(lastDmIncoming.ts);
    if (gap > maxGapMs) { lastDmIncoming = null; continue; }
    const userBody = stripWrapper(lastDmIncoming.content);
    const neoBody = stripWrapper(r.content);
    if (!userBody || !neoBody) continue;
    const senderName = lastDmIncoming.metadata?.sender_name || 'someone';
    pairs.push({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `[DM from ${senderName}] ${userBody}` },
        { role: 'assistant', content: neoBody }
      ],
      meta: { chat_type: 'dm', sender_phone: lastDmIncoming.metadata?.sender_phone, ts: r.ts }
    });
  }

  console.log(`\n  pairs built: ${pairs.length}`);

  // Quality filters
  const beforeFilter = pairs.length;
  const filtered = pairs.filter(p => {
    const u = p.messages[1].content;
    const a = p.messages[2].content;
    // Drop trivially short assistant replies
    if (a.trim().length < 3) return false;
    // Drop if user content is just a phone-tag placeholder
    if (/^\[group:[^\]]+\] [^:]+: @\d+$/.test(u)) return false;
    // Drop if assistant is just an emoji/sticker reaction (under 5 chars and no letters)
    if (a.trim().length < 6 && !/[a-zA-Z]/.test(a)) return false;
    return true;
  });
  console.log(`  after filter: ${filtered.length} (dropped ${beforeFilter - filtered.length})`);

  // Sample if requested
  let final = filtered;
  if (opts.sample) {
    // Randomized sample for diversity
    const shuffled = [...filtered].sort(() => Math.random() - 0.5);
    final = shuffled.slice(0, opts.sample);
    console.log(`  sampled: ${final.length}`);
  }

  // Write output
  mkdirSync(dirname(outPath), { recursive: true });
  const outLines = final.map(p => JSON.stringify({ messages: p.messages })).join('\n') + '\n';
  writeFileSync(outPath, outLines, 'utf8');
  const size = statSync(outPath).size;

  // Distribution stats
  const dmCount = final.filter(p => p.meta?.chat_type === 'dm').length;
  const groupCount = final.filter(p => p.meta?.chat_type === 'group').length;
  const avgUserLen = Math.round(final.reduce((s, p) => s + p.messages[1].content.length, 0) / final.length);
  const avgNeoLen = Math.round(final.reduce((s, p) => s + p.messages[2].content.length, 0) / final.length);

  console.log(`\n# Output written`);
  console.log(`  path     : ${outPath}`);
  console.log(`  size     : ${(size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  pairs    : ${final.length}`);
  console.log(`  dm/group : ${dmCount}/${groupCount}`);
  console.log(`  avg len  : user=${avgUserLen} chars, neo=${avgNeoLen} chars`);
  console.log(`\n# Sanity samples (first 3)`);
  for (let i = 0; i < Math.min(3, final.length); i++) {
    const p = final[i];
    console.log(`--- pair #${i}`);
    console.log(`  USER : ${p.messages[1].content.slice(0, 120)}${p.messages[1].content.length > 120 ? '…' : ''}`);
    console.log(`  NEO  : ${p.messages[2].content.slice(0, 120)}${p.messages[2].content.length > 120 ? '…' : ''}`);
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
