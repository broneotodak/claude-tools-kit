#!/usr/bin/env node

/**
 * WA Person Merge — dedupe LID-fragmented person rows in neo-brain.
 *
 * twin-ingest creates a fresh `kind=user` people row every time it sees a new
 * LID, even if that LID belongs to an already-known person. Result: 520+
 * "Broneotodak" rows (Neo himself across every group), 2-4 dupe rows for many
 * other contacts.
 *
 * This tool merges dupes into a canonical row by:
 *   1. UPDATE facts SET subject_id = canonical
 *   2. UPDATE memories SET subject_id = canonical
 *   3. Replace dupe ids inside memories.related_people arrays
 *   4. Union dupes' identifiers / nicknames / push_names into canonical
 *   5. Soft-mark dupe row: kind='merged', metadata.merged_into=canonical_id
 *
 * Usage:
 *   node wa-person-merge.js --mode neo --dry-run
 *   node wa-person-merge.js --mode neo --execute
 *   node wa-person-merge.js --mode same-name --dry-run --limit 10
 *
 * Modes:
 *   neo        — merge all rows whose display_name matches Neo aliases into kind=self
 *   same-name  — for each repeated display_name (excluding Neo aliases), merge all
 *                rows into the one with most facts; keep that as canonical
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const CTK_ROOT = path.resolve(import.meta.dirname, '..');
loadEnvFile(path.join(CTK_ROOT, '.env'));

const sb = createClient(
  process.env.NEO_BRAIN_URL,
  process.env.NEO_BRAIN_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const NEO_SELF_ID = '00000000-0000-0000-0000-000000000001';
const NEO_OWNER_PHONE = '60177519610';
const NEO_ALIASES = [
  'broneotodak', 'brozaid10camp', 'neo', 'neo todak',
  'ahmad fadli', 'ahmad fadli bin ahmad dahlan',
  'fadli', 'bro neo', 'boss neo',
];

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes('--execute');
const MODE = getArg('--mode') || 'neo';
const LIMIT = parseInt(getArg('--limit')) || null;

async function main() {
  console.log(`\n=== wa-person-merge → mode=${MODE} ${DRY_RUN ? '(DRY RUN)' : '(LIVE EXECUTE)'} ===\n`);

  if (MODE === 'neo') {
    await mergeNeoAliases();
  } else if (MODE === 'same-name') {
    await mergeSameName();
  } else {
    console.error(`Unknown mode: ${MODE}. Use --mode neo or --mode same-name`);
    process.exit(2);
  }
}

async function mergeNeoAliases() {
  // Load canonical Neo (kind=self)
  const { data: selfRows } = await sb.from('people').select('*').eq('kind', 'self');
  if (!selfRows || selfRows.length === 0) {
    console.error('No kind=self row found. Aborting.');
    process.exit(2);
  }
  if (selfRows.length > 1) {
    console.error(`Multiple kind=self rows found (${selfRows.length}). Manual resolution needed.`);
    process.exit(2);
  }
  const canonical = selfRows[0];
  console.log(`Canonical: ${canonical.id}`);
  console.log(`  display_name: ${canonical.display_name}`);
  console.log(`  current nicknames: ${JSON.stringify(canonical.nicknames || [])}`);
  console.log(`  current identifiers: ${(canonical.identifiers || []).length} entries`);

  // Find all alias rows (display_name match, OR phone matches Neo's known phone)
  const orFilter = NEO_ALIASES.map(a => `display_name.ilike.${a}`).join(',');
  let { data: candidates } = await sb
    .from('people')
    .select('id,display_name,kind,phone,lid,push_name,identifiers,nicknames,bio,traits,facts,relationship,languages')
    .or(orFilter);

  candidates = (candidates || []).filter(p => p.id !== canonical.id && p.kind !== 'self' && p.kind !== 'merged');

  if (LIMIT) candidates = candidates.slice(0, LIMIT);
  console.log(`\nFound ${candidates.length} dupe rows to merge into canonical.\n`);

  if (candidates.length === 0) return;

  await mergeIntoCanonical(canonical, candidates, {
    addNicknames: ['Neo', 'Fadli', 'Bro Neo', 'Boss Neo', 'Broneotodak', 'Brozaid10camp'],
  });
}

async function mergeSameName() {
  // Find repeat display_names (excluding Neo aliases — those go through neo mode)
  console.log('Scanning for same-name dupes...');

  // Page through all people
  const all = [];
  let off = 0;
  while (true) {
    const { data, error } = await sb
      .from('people')
      .select('id,display_name,kind')
      .neq('kind', 'merged')
      .neq('kind', 'self')
      .range(off, off + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }

  // Group by lowercased display_name; skip Neo aliases (handled by --mode neo)
  const groups = {};
  for (const p of all) {
    if (!p.display_name) continue;
    const key = p.display_name.toLowerCase().trim();
    if (NEO_ALIASES.includes(key)) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }
  const dupGroups = Object.entries(groups).filter(([, rows]) => rows.length > 1);
  console.log(`Found ${dupGroups.length} display_names with >1 row.\n`);

  let processed = 0;
  for (const [name, rows] of dupGroups.sort((a, b) => b[1].length - a[1].length)) {
    if (LIMIT && processed >= LIMIT) break;
    processed++;

    // Pick canonical: most facts → has bio → oldest. Fetch fact counts + bio for all rows.
    const enriched = [];
    for (const r of rows) {
      const { data: full } = await sb
        .from('people')
        .select('id,display_name,kind,phone,lid,push_name,identifiers,nicknames,bio,traits,facts,relationship,languages,last_profile_extraction,created_at')
        .eq('id', r.id)
        .maybeSingle();
      if (!full) continue;
      const { count: factCount } = await sb.from('facts').select('id', { count: 'exact', head: true }).eq('subject_id', full.id);
      enriched.push({ ...full, _fact_count: factCount || 0 });
    }
    enriched.sort((a, b) => {
      if (b._fact_count !== a._fact_count) return b._fact_count - a._fact_count;
      if (!!b.bio !== !!a.bio) return (!!b.bio) - (!!a.bio);
      return new Date(a.created_at) - new Date(b.created_at);
    });
    const canonical = enriched[0];
    const dupes = enriched.slice(1);

    console.log(`\n─── "${name}" (${enriched.length} rows) ───`);
    console.log(`  Canonical: ${canonical.id.slice(0, 8)} (facts=${canonical._fact_count}, bio=${canonical.bio ? 'Y' : '-'})`);
    for (const d of dupes) console.log(`  Dupe:      ${d.id.slice(0, 8)} (facts=${d._fact_count})`);

    await mergeIntoCanonical(canonical, dupes, {});
  }
}

async function mergeIntoCanonical(canonical, dupes, opts = {}) {
  const dupeIds = dupes.map(d => d.id);
  if (dupeIds.length === 0) return;

  // PostgREST URL gets long with many UUIDs — batch all .in() ops to 80 ids per call.
  const BATCH = 80;
  const batches = chunk(dupeIds, BATCH);

  // 1. Count what will move (sum across batches)
  let factCount = 0;
  let memCount = 0;
  for (const batch of batches) {
    const { count: fc, error: fe } = await sb.from('facts').select('id', { count: 'exact', head: true }).in('subject_id', batch);
    if (fe) { console.error(`  ❌ count facts: ${fe.message}`); return; }
    factCount += fc || 0;
    const { count: mc, error: me } = await sb.from('memories').select('id', { count: 'exact', head: true }).in('subject_id', batch);
    if (me) { console.error(`  ❌ count memories: ${me.message}`); return; }
    memCount += mc || 0;
  }

  console.log(`  Plan: migrate ${factCount} facts, ${memCount} memories.subject_id, then mark ${dupeIds.length} dupes as kind=merged`);

  // 2. Plan identifier/nickname union
  const newIdentifiers = unionIdentifiers(canonical.identifiers || [], dupes, opts.addNicknames || []);
  const newNicknames = unionNicknames(canonical.nicknames || [], dupes, opts.addNicknames || []);
  const addedIds = newIdentifiers.length - (canonical.identifiers || []).length;
  const addedNicks = newNicknames.length - (canonical.nicknames || []).length;
  console.log(`  Plan: union identifiers (+${addedIds}) and nicknames (+${addedNicks})`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] not modifying.`);
    return;
  }

  // 3. EXECUTE in order
  // 3a. Migrate facts.subject_id (batched)
  if (factCount > 0) {
    let migrated = 0;
    for (const batch of batches) {
      const { error } = await sb.from('facts').update({ subject_id: canonical.id }).in('subject_id', batch);
      if (error) { console.error(`  ❌ facts update batch: ${error.message}`); return; }
      migrated += batch.length;
    }
    console.log(`  ✓ migrated ${factCount} facts (across ${batches.length} batches)`);
  }

  // 3b. Migrate memories.subject_id (batched)
  if (memCount > 0) {
    for (const batch of batches) {
      const { error } = await sb.from('memories').update({ subject_id: canonical.id }).in('subject_id', batch);
      if (error) { console.error(`  ❌ memories update batch: ${error.message}`); return; }
    }
    console.log(`  ✓ migrated ${memCount} memories.subject_id`);
  }

  // 3c. Patch memories.related_people arrays (one row at a time, only where needed)
  await migrateRelatedPeople(dupeIds, canonical.id);

  // 3d. Update canonical with merged identifiers + nicknames
  if (addedIds > 0 || addedNicks > 0) {
    const patch = { updated_at: new Date().toISOString() };
    if (addedIds > 0) patch.identifiers = newIdentifiers;
    if (addedNicks > 0) patch.nicknames = newNicknames;
    const { error } = await sb.from('people').update(patch).eq('id', canonical.id);
    if (error) console.error(`  ⚠ canonical update failed: ${error.message}`);
    else console.log(`  ✓ canonical updated (+${addedIds} identifiers, +${addedNicks} nicknames)`);
  }

  // 3e. Soft-mark dupes via metadata.merged_into (people.kind has a CHECK
  // constraint that disallows 'merged'; keep kind unchanged, downstream
  // readers filter on metadata->>merged_into).
  const mergedAt = new Date().toISOString();
  let marked = 0;
  for (const d of dupes) {
    const { error } = await sb.from('people').update({
      metadata: { ...(d.metadata || {}), merged_into: canonical.id, merged_at: mergedAt, merge_source: 'wa-person-merge' },
      updated_at: mergedAt,
    }).eq('id', d.id);
    if (error) console.error(`  ⚠ mark merged failed for ${d.id.slice(0, 8)}: ${error.message}`);
    else marked++;
  }
  console.log(`  ✓ soft-marked ${marked}/${dupes.length} dupe rows via metadata.merged_into`);
}

async function migrateRelatedPeople(dupeIds, canonicalId) {
  // Batch the dupeIds into chunks for the .overlaps() call (URL length limit)
  const BATCH = 80;
  const batches = chunk(dupeIds, BATCH);
  const dupeSet = new Set(dupeIds);
  let touched = 0;

  for (const batch of batches) {
    let off = 0;
    while (true) {
      const { data, error } = await sb
        .from('memories')
        .select('id,related_people')
        .overlaps('related_people', batch)
        .range(off, off + 499);
      if (error) { console.error(`  ⚠ related_people scan: ${error.message}`); break; }
      if (!data || data.length === 0) break;
      for (const m of data) {
        const arr = m.related_people || [];
        const updated = [...new Set(arr.map(id => dupeSet.has(id) ? canonicalId : id))];
        const { error: ue } = await sb.from('memories').update({ related_people: updated }).eq('id', m.id);
        if (!ue) touched++;
      }
      if (data.length < 500) break;
      off += 500;
    }
  }
  if (touched > 0) console.log(`  ✓ rewrote ${touched} memories.related_people arrays`);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function unionIdentifiers(existing, dupes, addNicknames) {
  const seen = new Set(existing.map(serializeId));
  const out = [...existing];
  const push = (id) => { const k = serializeId(id); if (!seen.has(k)) { seen.add(k); out.push(id); } };

  for (const d of dupes) {
    if (d.phone) push({ type: 'phone', value: d.phone });
    if (d.lid) push({ type: 'lid', value: d.lid });
    if (d.push_name) push({ type: 'push_name', value: d.push_name });
    for (const i of d.identifiers || []) if (i?.type && i?.value) push(i);
  }
  for (const n of addNicknames) push({ type: 'nickname', value: n });
  return out;
}
function serializeId(i) { return `${i.type}:${(i.value || '').toString().toLowerCase()}`; }

function unionNicknames(existing, dupes, extras) {
  const set = new Set((existing || []).map(s => s.toLowerCase()));
  const out = [...(existing || [])];
  const add = (s) => { if (!s) return; const k = s.toLowerCase(); if (!set.has(k)) { set.add(k); out.push(s); } };
  for (const d of dupes) {
    if (d.push_name) add(d.push_name);
    for (const n of d.nicknames || []) add(n);
  }
  for (const e of extras) add(e);
  return out;
}

function getArg(flag) {
  const i = argv.indexOf(flag);
  return i === -1 || i >= argv.length - 1 ? null : argv[i + 1];
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
