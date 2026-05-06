#!/usr/bin/env node
// One-shot migration: legacyDB.nclaw_contacts → neo-brain.contacts
//
// Renames the table from nclaw_contacts to contacts (clearer name; old name
// was Siti-era jargon). Backfills contacts.person_id by matching phone or
// lid against the existing neo-brain.people rows where possible.
//
// Idempotent — safe to re-run. Uses upsert on (phone, kind) / (jid, kind)
// unique indexes so re-running doesn't duplicate.
//
// Usage:
//   node --env-file=<env> tools/migrate-nclaw-contacts-to-neo-brain.mjs --dry-run
//   node --env-file=<env> tools/migrate-nclaw-contacts-to-neo-brain.mjs

import 'dotenv/config';

// LegacyDB env (where nclaw_contacts lives)
const LEGACY_URL = process.env.LEGACY_URL || process.env.SUPABASE_URL;
const LEGACY_KEY = process.env.LEGACY_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
// Neo-brain env (where contacts lands)
const NEO_BRAIN_URL = process.env.NEO_BRAIN_URL;
const NEO_BRAIN_KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;

if (!LEGACY_URL || !LEGACY_KEY || !NEO_BRAIN_URL || !NEO_BRAIN_KEY) {
  console.error('error: need LEGACY_URL+LEGACY_KEY (legacyDB) and NEO_BRAIN_URL+NEO_BRAIN_SERVICE_ROLE_KEY env vars');
  console.error('       (legacyDB env can also fall back to SUPABASE_URL+SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(2);
}

function parseFlags(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = true;
  return out;
}

const flags = parseFlags(process.argv);
const dry = !!flags['dry-run'];

function makeRest(base, key) {
  const REST = base.replace(/\/$/, '') + '/rest/v1';
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  return {
    async select(table, query) {
      const r = await fetch(`${REST}/${table}?${query}`, { headers });
      if (!r.ok) throw new Error(`${table} select ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.json();
    },
    async upsert(table, rows, onConflict) {
      const url = `${REST}/${table}?on_conflict=${onConflict}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(rows),
      });
      if (!r.ok) throw new Error(`${table} upsert ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.json();
    },
  };
}

const legacy = makeRest(LEGACY_URL, LEGACY_KEY);
const brain = makeRest(NEO_BRAIN_URL, NEO_BRAIN_KEY);

async function fetchAllPaged(api, table, params, pageSize = 1000) {
  const out = [];
  let offset = 0;
  while (true) {
    const q = new URLSearchParams(params);
    q.set('limit', String(pageSize));
    q.set('offset', String(offset));
    const rows = await api.select(table, q.toString());
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function main() {
  console.log('[migrate] step 1 — read legacyDB.nclaw_contacts');
  const legacyRows = await fetchAllPaged(legacy, 'nclaw_contacts', { select: '*', order: 'created_at.asc' });
  console.log(`[migrate] ${legacyRows.length} legacy rows`);

  console.log('[migrate] step 2 — pull neo-brain.people (phone + lid only, for backfill)');
  const peopleRows = await fetchAllPaged(brain, 'people', { select: 'id,phone,lid' }, 1000);
  console.log(`[migrate] ${peopleRows.length} people rows`);

  // Build phone + lid lookups
  const byPhone = new Map();
  const byLid = new Map();
  for (const p of peopleRows) {
    if (p.phone) byPhone.set(String(p.phone), p.id);
    if (p.lid) byLid.set(String(p.lid), p.id);
  }
  console.log(`[migrate] lookup: ${byPhone.size} by phone, ${byLid.size} by lid`);

  // Compose migration rows
  let backfilled = 0;
  const targets = legacyRows.map((r) => {
    let person_id = null;
    if (r.phone && byPhone.has(String(r.phone))) {
      person_id = byPhone.get(String(r.phone));
    } else if (r.lid && byLid.has(String(r.lid))) {
      person_id = byLid.get(String(r.lid));
    }
    if (person_id) backfilled++;
    return {
      // id intentionally not copied — let neo-brain assign new uuid (legacy ids may collide)
      person_id,
      phone: r.phone || null,
      jid: r.jid || null,
      lid: r.lid || null,
      name: r.name || null,
      push_name: r.push_name || null,
      kind: r.kind || 'user',
      permission: r.permission || 'readonly',
      persona_override: r.persona_override || null,
      auto_reply_enabled: r.auto_reply_enabled === false ? false : true,
      reply_mode: r.reply_mode || 'auto',
      project_scope: r.project_scope || [],
      notes: r.notes || null,
      last_seen_at: r.last_seen_at || null,
      wa_synced_at: r.wa_synced_at || null,
      created_at: r.created_at || null,
      updated_at: r.updated_at || null,
    };
  });

  console.log(`[migrate] composed ${targets.length} target rows · ${backfilled} with person_id linked`);

  // Distinct count by permission for sanity-check
  const byPerm = {};
  for (const t of targets) byPerm[t.permission] = (byPerm[t.permission] || 0) + 1;
  console.log('[migrate] permission distribution:', byPerm);

  if (dry) {
    console.log('[migrate] dry-run — no writes');
    console.log('[migrate] sample (first 3):');
    console.log(JSON.stringify(targets.slice(0, 3), null, 2));
    return;
  }

  console.log('[migrate] step 3 — upsert into neo-brain.contacts');
  // Upsert in batches via the (phone, kind) unique index when phone exists,
  // otherwise (jid, kind). Easiest: batch insert with merge-duplicates on
  // (phone, kind) — rows without phone fall through to (jid, kind) via a
  // second pass.
  const withPhone = targets.filter((t) => t.phone);
  const withoutPhone = targets.filter((t) => !t.phone);

  let upserted = 0;
  for (let i = 0; i < withPhone.length; i += 500) {
    const batch = withPhone.slice(i, i + 500);
    const out = await brain.upsert('contacts', batch, 'phone,kind');
    upserted += out.length;
    if (i % 1000 === 0) console.log(`  with-phone ... ${upserted}/${withPhone.length}`);
  }
  console.log(`[migrate] phone-keyed upsert done: ${upserted}/${withPhone.length}`);

  let upserted2 = 0;
  for (let i = 0; i < withoutPhone.length; i += 500) {
    const batch = withoutPhone.slice(i, i + 500);
    if (batch.every((t) => t.jid)) {
      const out = await brain.upsert('contacts', batch, 'jid,kind');
      upserted2 += out.length;
    } else {
      // Mixed null jid + null phone — rare; insert plain (will create new rows)
      const out = await brain.upsert('contacts', batch.filter((t) => t.jid), 'jid,kind');
      upserted2 += out.length;
      console.log(`  ! ${batch.length - out.length} rows had no phone AND no jid — skipped`);
    }
  }
  console.log(`[migrate] jid-keyed upsert done: ${upserted2}/${withoutPhone.length}`);

  console.log(`[migrate] DONE · total upserted: ${upserted + upserted2}`);
}

main().catch((err) => {
  console.error('[migrate] fatal:', err.stack || err.message);
  process.exit(1);
});
