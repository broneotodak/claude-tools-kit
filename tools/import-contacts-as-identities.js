#!/usr/bin/env node
/**
 * Bulk-import every nclaw_contacts row into neo-brain.people as an identity.
 *
 * Design:
 *  - Read all contacts from legacy DB (uzamamymfzhelvkwpvgt.nclaw_contacts, paginated past 1000 cap)
 *  - Read existing people from neo-brain and build a Set of known identifiers (phones, LIDs, group IDs)
 *  - For any contact not yet represented, create a people row with identifiers[] and metadata
 *  - Group contacts become kind=group, user contacts kind=user
 *  - Safe to re-run: dedup by identifier match.
 *
 * Usage:
 *   node tools/import-contacts-as-identities.js --dry-run
 *   node tools/import-contacts-as-identities.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { createClient } = require("@supabase/supabase-js");

const LEGACY_URL = process.env.SUPABASE_URL;
const LEGACY_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BRAIN_URL = process.env.NEO_BRAIN_URL;
const BRAIN_KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
const DRY = process.argv.includes("--dry-run");

for (const [n, v] of Object.entries({ LEGACY_URL, LEGACY_KEY, BRAIN_URL, BRAIN_KEY })) {
  if (!v) { console.error(`env missing: ${n}`); process.exit(1); }
}

const legacy = createClient(LEGACY_URL, LEGACY_KEY);
const brain = createClient(BRAIN_URL, BRAIN_KEY);

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function fetchAllContacts() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await legacy
      .from("nclaw_contacts")
      .select("id, phone, name, push_name, kind, lid, permission, persona_override, notes, last_seen_at, wa_synced_at")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

async function fetchAllPeople() {
  const { data, error } = await brain.from("people").select("id, identifiers");
  if (error) throw new Error(error.message);
  return data || [];
}

function buildKnownSet(people) {
  const s = new Set();
  for (const p of people) {
    for (const ident of (p.identifiers || [])) {
      if (ident?.value) s.add(String(ident.value));
    }
  }
  return s;
}

function buildIdentifiers(c) {
  const ids = [];
  if (c.kind === "group") {
    ids.push({ type: "group_id", value: c.phone });
    if (c.lid) ids.push({ type: "lid", value: c.lid });
  } else {
    if (c.phone) ids.push({ type: "phone", value: c.phone });
    if (c.lid) ids.push({ type: "lid", value: c.lid });
    if (c.push_name) ids.push({ type: "push_name", value: c.push_name });
  }
  return ids;
}

async function main() {
  log(`import start — dry=${DRY}`);
  const [contacts, existingPeople] = await Promise.all([fetchAllContacts(), fetchAllPeople()]);
  log(`source contacts: ${contacts.length}`);
  log(`existing people: ${existingPeople.length}`);

  const known = buildKnownSet(existingPeople);
  log(`known identifiers: ${known.size}`);

  const toInsert = [];
  let skippedAlreadyKnown = 0;
  let skippedNoName = 0;

  for (const c of contacts) {
    const isKnown = [c.phone, c.lid, c.push_name].some(v => v && known.has(v));
    if (isKnown) { skippedAlreadyKnown++; continue; }

    const displayName = c.name || c.push_name || c.phone;
    if (!displayName) { skippedNoName++; continue; }

    const row = {
      display_name: displayName,
      kind: c.kind === "group" ? "group" : "user",
      identifiers: buildIdentifiers(c),
      notes: [
        "auto-imported from nclaw_contacts",
        c.push_name && c.push_name !== c.name ? `push_name: ${c.push_name}` : null,
        c.permission && c.permission !== "readonly" ? `permission: ${c.permission}` : null,
      ].filter(Boolean).join(" · "),
      metadata: {
        imported_from: "nclaw_contacts",
        contact_id: c.id,
        wa_synced_at: c.wa_synced_at,
        has_persona: !!c.persona_override,
      },
    };
    toInsert.push(row);
  }

  log(`to insert: ${toInsert.length} (skipped ${skippedAlreadyKnown} already-known, ${skippedNoName} no-name)`);

  if (DRY) {
    log("sample rows (first 5):");
    toInsert.slice(0, 5).forEach(r => log(`  - ${r.display_name} (${r.kind}) identifiers=${JSON.stringify(r.identifiers)}`));
    return;
  }

  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error } = await brain.from("people").insert(batch);
    if (error) throw new Error(`batch ${i}: ${error.message}`);
    inserted += batch.length;
    log(`  inserted ${inserted}/${toInsert.length}`);
  }
  log(`done — inserted ${inserted}`);
}

main().catch(e => { console.error("fatal:", e.message); process.exit(1); });
