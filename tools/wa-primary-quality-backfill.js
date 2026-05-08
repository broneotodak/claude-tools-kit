#!/usr/bin/env node

/**
 * wa-primary quality backfill — three things in one scan:
 *
 *   1. SOFT-MARK ARCHIVED GROUP MEMORIES
 *      memories.metadata.archived_chat = true for rows where:
 *        - source = 'wa-primary'
 *        - chat_type = 'group'
 *        - is_from_owner != true
 *        - chat_jid NOT IN active-group set
 *      Active set = (groups where Neo has sent at least once) ∪ (monitored groups
 *      from legacy twin_active_state).
 *      Phase 6 + dashboard + enricher should filter on this flag.
 *
 *   2. CLASSIFY GROUP-ONLY PEOPLE
 *      people.metadata.no_dm_history = true for non-self, non-merged rows whose
 *      phone identifiers never appear as sender_phone in a DM memory AND whose
 *      identifiers never appear as a chat_jid in a Neo-sent DM. These rows have
 *      facts/personality derived purely from group-broadcast voice.
 *
 *   3. COMPUTE DM ENGAGEMENT METRICS
 *      people.metadata.engagement = {
 *        dm_in: <messages they sent Neo>,
 *        dm_out: <messages Neo sent them>,
 *        total_dm: dm_in + dm_out,
 *        last_dm_at: <ISO timestamp>,
 *        computed_at: <ISO>,
 *      }
 *      Replaces the misleading people.message_count signal (which is just the
 *      per-enricher-run sample size capped at 300). The dashboard graph + people
 *      sort should read total_dm instead.
 *
 * READ-ONLY on memories. Writes only to memories.metadata.archived_chat (no
 * row deletion) and people.metadata.{no_dm_history,engagement}.
 *
 * Usage:
 *   node wa-primary-quality-backfill.js --dry-run
 *   node wa-primary-quality-backfill.js --execute
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const CTK_ROOT = path.resolve(import.meta.dirname, '..');
loadEnvFile(path.join(CTK_ROOT, '.env'));

const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const legacy = (process.env.LEGACY_DB_URL && process.env.LEGACY_DB_SERVICE_ROLE_KEY)
  ? createClient(process.env.LEGACY_DB_URL, process.env.LEGACY_DB_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const NEO_SELF_ID = '00000000-0000-0000-0000-000000000001';
const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes('--execute');

async function main() {
  console.log(`\n=== wa-primary quality backfill — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} ===\n`);

  // --- Phase 1: pull all wa-primary memories ---
  console.log('Step 1: Loading wa-primary memories...');
  const memories = [];
  let off = 0;
  while (true) {
    const { data, error } = await sb.from('memories')
      .select('id, metadata, created_at')
      .eq('source', 'wa-primary')
      .range(off, off + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    memories.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`  Loaded ${memories.length} wa-primary memories.\n`);

  // --- Phase 2: derive active-groups set + DM engagement maps ---
  console.log('Step 2: Computing active-groups + DM engagement maps...');
  const neoSendingGroups = new Set();          // chat_jids where Neo has sent at least once
  const dmSenderPhones = new Set();            // phones that sent at least one DM to Neo
  const dmRecipientJids = new Set();           // chat_jids Neo has sent DMs to (i.e., DM-recipients)
  const dmEngagementByPhone = {};              // phone → { dm_in, dm_out, last_dm_at }

  function bumpEngagement(phone, direction, ts) {
    if (!phone) return;
    if (!dmEngagementByPhone[phone]) dmEngagementByPhone[phone] = { dm_in: 0, dm_out: 0, last_dm_at: null };
    const e = dmEngagementByPhone[phone];
    e[direction]++;
    if (!e.last_dm_at || ts > e.last_dm_at) e.last_dm_at = ts;
  }

  for (const m of memories) {
    const meta = m.metadata || {};
    const ct = meta.chat_type;
    const isOwner = meta.is_from_owner === true;
    const senderPhone = meta.sender_phone;
    const chatJid = meta.chat_jid;

    if (ct === 'group') {
      if (isOwner && chatJid) neoSendingGroups.add(chatJid);
    } else if (ct === 'dm') {
      if (isOwner) {
        // Neo sent → recipient is the chat_jid (in DM, chat_jid = the other party's @s.whatsapp.net)
        if (chatJid) {
          const phone = chatJid.split('@')[0];
          dmRecipientJids.add(chatJid);
          bumpEngagement(phone, 'dm_out', m.created_at);
        }
      } else {
        // Incoming DM → senderPhone is the source
        if (senderPhone) {
          dmSenderPhones.add(senderPhone);
          bumpEngagement(senderPhone, 'dm_in', m.created_at);
        }
      }
    }
  }
  console.log(`  Groups where Neo has sent: ${neoSendingGroups.size}`);
  console.log(`  Distinct DM senders: ${dmSenderPhones.size}`);
  console.log(`  Distinct DM recipients (Neo sent to): ${dmRecipientJids.size}`);

  // Pull monitored groups from legacy DB (orchestrator reply path)
  const monitoredGroups = new Set();
  if (legacy) {
    try {
      const { data } = await legacy.from('twin_active_state')
        .select('target_jid,target_kind,status')
        .eq('status', 'active');
      for (const r of data || []) {
        if (r.target_kind === 'group' && r.target_jid) monitoredGroups.add(r.target_jid);
      }
    } catch (e) {
      console.log(`  ⚠ Could not load monitored_groups from legacy DB: ${e.message}`);
    }
  }
  console.log(`  Monitored groups (orchestrator reply path): ${monitoredGroups.size}`);

  // Active group set: union of (Neo-sending) and (monitored)
  const activeGroups = new Set([...neoSendingGroups, ...monitoredGroups]);
  console.log(`  Active group set: ${activeGroups.size}\n`);

  // --- Phase 3: archive plan for memories ---
  console.log('Step 3: Computing archive plan for group memories...');
  const toArchive = [];
  let alreadyArchived = 0;
  for (const m of memories) {
    const meta = m.metadata || {};
    if (meta.chat_type !== 'group') continue;
    if (meta.is_from_owner === true) continue;
    if (meta.chat_jid && activeGroups.has(meta.chat_jid)) continue;
    if (meta.archived_chat === true) { alreadyArchived++; continue; }
    toArchive.push(m);
  }
  console.log(`  Already archived: ${alreadyArchived}`);
  console.log(`  Will archive: ${toArchive.length} group memories\n`);

  // --- Phase 4: pull all non-merged, non-self people ---
  console.log('Step 4: Loading people rows...');
  const people = [];
  off = 0;
  while (true) {
    const { data, error } = await sb.from('people')
      .select('id, display_name, identifiers, metadata')
      .is('metadata->merged_into', null)
      .neq('kind', 'self')
      .range(off, off + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    people.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`  Loaded ${people.length} non-merged non-self people.\n`);

  // --- Phase 5: classify each person + compute engagement ---
  console.log('Step 5: Classifying people + computing engagement...');
  const peopleUpdates = [];
  let groupOnly = 0, withDmHistory = 0, noPhone = 0;
  for (const p of people) {
    const phones = (p.identifiers || []).filter(i => i?.type === 'phone' && i.value).map(i => String(i.value));
    if (phones.length === 0) {
      noPhone++;
      continue;
    }

    let dm_in = 0, dm_out = 0, last_dm_at = null;
    let engaged = false;
    for (const phone of phones) {
      // DM-in: sender_phone match
      if (dmSenderPhones.has(phone)) engaged = true;
      // DM-out: chat_jid (which is phone@s.whatsapp.net) match — Neo sent to this person
      const jidPhone = phone + '@s.whatsapp.net';
      if (dmRecipientJids.has(jidPhone)) engaged = true;

      const e = dmEngagementByPhone[phone];
      if (e) {
        dm_in += e.dm_in;
        dm_out += e.dm_out;
        if (e.last_dm_at && (!last_dm_at || e.last_dm_at > last_dm_at)) last_dm_at = e.last_dm_at;
      }
    }

    const total_dm = dm_in + dm_out;
    const noHistory = !engaged;
    if (noHistory) groupOnly++; else withDmHistory++;

    const newMeta = { ...(p.metadata || {}) };
    let changed = false;

    if (noHistory && newMeta.no_dm_history !== true) { newMeta.no_dm_history = true; changed = true; }
    else if (!noHistory && newMeta.no_dm_history === true) { delete newMeta.no_dm_history; changed = true; }

    const newEngagement = {
      dm_in, dm_out, total_dm,
      last_dm_at,
      computed_at: new Date().toISOString(),
    };
    const oldEng = newMeta.engagement || {};
    if (oldEng.total_dm !== total_dm || oldEng.dm_in !== dm_in || oldEng.dm_out !== dm_out || oldEng.last_dm_at !== last_dm_at) {
      newMeta.engagement = newEngagement;
      changed = true;
    }

    if (changed) peopleUpdates.push({ id: p.id, display_name: p.display_name, metadata: newMeta, total_dm, no_dm_history: noHistory });
  }

  console.log(`  group-only (will mark no_dm_history=true): ${groupOnly}`);
  console.log(`  with DM history: ${withDmHistory}`);
  console.log(`  no phone identifier (skipped): ${noPhone}`);
  console.log(`  total people updates queued: ${peopleUpdates.length}\n`);

  // Sample of top engaged + sample of group-only
  const topEngaged = peopleUpdates.filter(u => !u.no_dm_history && u.total_dm > 0).sort((a, b) => b.total_dm - a.total_dm).slice(0, 10);
  console.log('Top 10 by DM engagement:');
  for (const u of topEngaged) console.log(`  ${u.display_name?.padEnd(30)} | total_dm: ${u.total_dm}`);
  const groupOnlySample = peopleUpdates.filter(u => u.no_dm_history).slice(0, 10);
  console.log('\nSample of group-only (no DM history):');
  for (const u of groupOnlySample) console.log(`  ${u.display_name?.padEnd(30)}`);

  // --- DRY RUN exit ---
  if (DRY_RUN) {
    console.log('\n⚠ DRY RUN — nothing written. Pass --execute to apply.');
    return;
  }

  // --- Phase 6: APPLY ---
  // 6a. Archive memories
  console.log(`\nStep 6a: Soft-marking ${toArchive.length} memories with metadata.archived_chat=true ...`);
  let mOk = 0, mFail = 0;
  for (const m of toArchive) {
    const meta = { ...(m.metadata || {}), archived_chat: true, archived_chat_at: new Date().toISOString(), archived_chat_reason: 'wa-primary-quality-backfill' };
    const { error } = await sb.from('memories').update({ metadata: meta }).eq('id', m.id);
    if (error) { mFail++; if (mFail < 5) console.log(`    ✗ ${m.id}: ${error.message}`); }
    else mOk++;
    if (mOk % 500 === 0 && mOk > 0) console.log(`    archived ${mOk}/${toArchive.length}`);
  }
  console.log(`  ✓ archived ${mOk}, failed ${mFail}`);

  // 6b. Update people
  console.log(`\nStep 6b: Updating ${peopleUpdates.length} people rows...`);
  let pOk = 0, pFail = 0;
  const now = new Date().toISOString();
  for (const u of peopleUpdates) {
    const { error } = await sb.from('people').update({ metadata: u.metadata, updated_at: now }).eq('id', u.id);
    if (error) { pFail++; if (pFail < 5) console.log(`    ✗ ${u.display_name}: ${error.message}`); }
    else pOk++;
    if (pOk % 500 === 0 && pOk > 0) console.log(`    updated ${pOk}/${peopleUpdates.length}`);
  }
  console.log(`  ✓ updated ${pOk}, failed ${pFail}`);

  console.log('\n=== DONE ===');
}

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

main().catch(e => { console.error(`\n❌ Fatal: ${e.message}\n${e.stack}`); process.exit(1); });
