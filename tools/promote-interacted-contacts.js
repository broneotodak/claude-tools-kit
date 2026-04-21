#!/usr/bin/env node
/**
 * Smart identity promotion: create `people` rows ONLY for contacts who
 * actually interacted with NClaw (appear in nclaw_messages).
 *
 * Handles phone↔LID duplicates where two nclaw_contacts rows represent
 * the same person (one keyed by phone, one keyed by the same value in lid).
 *
 * Skips any contact whose phone/LID is already an identifier on an
 * existing people row (e.g., Neo, Lan).
 *
 * Safe to re-run: dedupes against existing identifiers.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { createClient } = require("@supabase/supabase-js");

const legacy = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const brain = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY);
const DRY = process.argv.includes("--dry-run");
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function main() {
  // 1. Get distinct phones in message history
  const { data: chats } = await legacy.from("nclaw_messages").select("chat_phone").not("chat_phone", "is", null);
  const { data: senders } = await legacy.from("nclaw_messages").select("from_phone").not("from_phone", "is", null);
  const interacted = new Set([
    ...(chats || []).map(r => r.chat_phone),
    ...(senders || []).map(r => r.from_phone),
  ].filter(Boolean));
  log(`distinct interaction phones: ${interacted.size}`);

  // 2. Fetch matching nclaw_contacts (paginated past PostgREST 1000 cap)
  const allContacts = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await legacy
      .from("nclaw_contacts")
      .select("id, phone, name, push_name, kind, lid, permission, persona_override, notes")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    allContacts.push(...data);
    if (data.length < 1000) break;
  }
  log(`scanned ${allContacts.length} contacts`);
  const matched = allContacts.filter(c =>
    interacted.has(c.phone) || (c.lid && interacted.has(c.lid))
  );
  log(`matched contacts: ${matched.length}`);

  // 3. Merge phone↔LID pairs. Group by canonical signature (name+push_name).
  //    If row A has lid=X and row B has phone=X, they're the same person.
  const byPhone = new Map(matched.map(c => [c.phone, c]));
  const merged = [];
  const consumedIds = new Set();

  for (const c of matched) {
    if (consumedIds.has(c.id)) continue;
    const idents = new Set();
    const nameCandidates = [c.name, c.push_name];
    const pushCandidates = [c.push_name];

    // If this contact has a phone in phone column, add as phone ident
    if (c.phone) idents.add("phone:" + c.phone);
    if (c.lid) idents.add("lid:" + c.lid);
    // push_name is only useful as an identifier for INDIVIDUAL users (not groups — a group's push_name is just
    // whoever is speaking in it, which is noise). Also skip known self push names.
    const SELF_PUSH_NAMES = new Set(["Broneotodak", "Neo Todak"]);
    if (c.kind !== "group" && c.push_name && !SELF_PUSH_NAMES.has(c.push_name)) {
      idents.add("push:" + c.push_name);
    }

    // If this contact's phone LOOKS like a LID (long, not a typical MY/ID phone)
    // and there's another contact with lid=this.phone → merge
    const candidateMate = c.lid ? byPhone.get(c.lid) : null;
    if (candidateMate && candidateMate.id !== c.id) {
      if (candidateMate.phone) idents.add("phone:" + candidateMate.phone);
      if (candidateMate.lid) idents.add("lid:" + candidateMate.lid);
      if (candidateMate.push_name) idents.add("push:" + candidateMate.push_name);
      nameCandidates.push(candidateMate.name, candidateMate.push_name);
      consumedIds.add(candidateMate.id);
    }

    // Reverse: this contact's phone IS a lid value of another contact → merge
    const mateWhereThisIsLid = matched.find(x => x.id !== c.id && x.lid === c.phone);
    if (mateWhereThisIsLid) {
      if (mateWhereThisIsLid.phone) idents.add("phone:" + mateWhereThisIsLid.phone);
      if (mateWhereThisIsLid.lid) idents.add("lid:" + mateWhereThisIsLid.lid);
      if (mateWhereThisIsLid.push_name) idents.add("push:" + mateWhereThisIsLid.push_name);
      nameCandidates.push(mateWhereThisIsLid.name, mateWhereThisIsLid.push_name);
      consumedIds.add(mateWhereThisIsLid.id);
    }

    consumedIds.add(c.id);
    const displayName = nameCandidates.find(Boolean) || c.phone;

    // Dedupe by value: same value can appear as both phone and LID due to WhatsApp LID privacy.
    // Prefer lid > phone > push_name. Emit each value once.
    const typePriority = { lid: 0, phone: 1, push_name: 2 };
    const parsed = [...idents].map(s => {
      const [type, value] = s.split(":");
      return { type: type === "push" ? "push_name" : type, value };
    }).sort((a, b) => (typePriority[a.type] ?? 9) - (typePriority[b.type] ?? 9));
    const seenValues = new Set();
    const dedupedIdents = parsed.filter(i => {
      if (seenValues.has(i.value)) return false;
      seenValues.add(i.value);
      return true;
    });

    merged.push({
      displayName,
      kind: c.kind,
      identifiers: dedupedIdents,
      permission: c.permission,
      contact_ids: [c.id, ...(consumedIds.has(candidateMate?.id) ? [candidateMate?.id] : [])].filter(Boolean),
    });
  }
  log(`merged to: ${merged.length} distinct people`);

  // 4. Skip ones that match existing people identifiers (Neo, Lan, others already in registry)
  const { data: existingPeople } = await brain.from("people").select("id, display_name, identifiers");
  const knownIdents = new Set();
  for (const p of existingPeople || []) {
    for (const id of (p.identifiers || [])) {
      if (id?.value) knownIdents.add(String(id.value));
    }
  }
  log(`existing identifiers in registry: ${knownIdents.size}`);

  const toInsert = [];
  const toMergeIntoExisting = [];
  for (const m of merged) {
    const overlaps = m.identifiers.find(i => knownIdents.has(String(i.value)));
    if (overlaps) {
      toMergeIntoExisting.push({ name: m.displayName, overlapping: overlaps });
      continue;
    }
    toInsert.push({
      display_name: m.displayName,
      kind: m.kind === "group" ? "group" : "user",
      identifiers: m.identifiers,
      notes: "promoted from conversation history — permission: " + m.permission,
      metadata: {
        promoted_from: "nclaw_messages_interactions",
        legacy_contact_ids: m.contact_ids,
      },
    });
  }
  log(`to insert: ${toInsert.length}`);
  log(`would merge into existing (skipped): ${toMergeIntoExisting.length}`);
  toMergeIntoExisting.forEach(m => log(`  skipped: ${m.name} (matches existing identifier ${m.overlapping.value})`));

  if (DRY) {
    log("sample to-insert:");
    toInsert.slice(0, 10).forEach(r => log(`  - ${r.display_name} (${r.kind}) identifiers=${JSON.stringify(r.identifiers)}`));
    return;
  }

  if (toInsert.length > 0) {
    const { data, error } = await brain.from("people").insert(toInsert).select("id, display_name");
    if (error) throw new Error(error.message);
    log(`inserted ${data.length}`);
    data.forEach(d => log(`  + ${d.display_name} (${d.id.slice(0, 8)}...)`));
  }
}

main().catch(e => { console.error("fatal:", e.message); process.exit(1); });
