#!/usr/bin/env node

/**
 * WA Fact Enricher — consolidates `facts` table rows into structured `people` profiles.
 *
 * Reads from the live `facts` table (populated by twin-ingest live + wa-chat-importer batch).
 * Aggregates by `subject_id`, sends each person's fact corpus to Gemini for consolidation,
 * writes back to people columns (bio/traits/facts/relationship/nicknames/languages).
 *
 * Differs from wa-person-enricher.js: that one reads from wa-chat-importer memories only.
 * This one is source-agnostic — works for any people row that has facts attached, including
 * the 2,972 stub people created by live ingest.
 *
 * Usage:
 *   node wa-fact-enricher.js --dry-run --limit 20
 *   node wa-fact-enricher.js --limit 20             # live, top 20 by fact count
 *   node wa-fact-enricher.js --person <uuid>        # single person by id
 *   node wa-fact-enricher.js --min-facts 5          # threshold (default 5)
 *   node wa-fact-enricher.js --skip-extracted       # only people with no last_profile_extraction
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
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
const NEO_SELF_ID = '00000000-0000-0000-0000-000000000001';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const SKIP_EXTRACTED = argv.includes('--skip-extracted');
const LIMIT = parseInt(getArg('--limit')) || 20;
const MIN_FACTS = parseInt(getArg('--min-facts')) || 5;
const SINGLE_ID = getArg('--person');

const NOISE_FACTS = new Set([
  'sender of the message',
  'sender of the message.',
  'is the sender',
  'is the sender of the message',
]);

// LID-dedup bug: Neo himself appears as many duplicate `kind=user` rows under
// different WhatsApp LIDs. Until that's fixed (separate task), skip any row
// whose display_name matches a Neo alias so we don't write inconsistent profiles.
const NEO_ALIASES = new Set([
  'broneotodak',
  'brozaid10camp',
  'neo',
  'neo todak',
  'ahmad fadli',
  'ahmad fadli bin ahmad dahlan',
]);

function isNeoAlias(name) {
  return name && NEO_ALIASES.has(name.toLowerCase().trim());
}

async function main() {
  console.log(`\n=== wa-fact-enricher → neo-brain people ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | limit=${LIMIT} | min_facts=${MIN_FACTS}${SKIP_EXTRACTED ? ' | skip-extracted' : ''}\n`);

  const candidates = SINGLE_ID
    ? [{ id: SINGLE_ID, fact_count: null }]
    : await pickCandidates();

  console.log(`Selected ${candidates.length} candidates.\n`);

  const results = { enriched: 0, skipped: 0, failed: 0 };

  for (const cand of candidates) {
    const person = await loadPerson(cand.id);
    if (!person) {
      console.log(`  ⚠ ${cand.id.slice(0, 8)} — person row missing`);
      results.skipped++;
      continue;
    }

    if (person.id === NEO_SELF_ID || person.kind === 'self' || isNeoAlias(person.display_name)) {
      console.log(`  ⏭ ${person.display_name} — Neo alias / self, skipping (LID dedup pending)`);
      results.skipped++;
      continue;
    }

    if (SKIP_EXTRACTED && person.last_profile_extraction) {
      console.log(`  ⏭ ${person.display_name} — already extracted ${person.last_profile_extraction.slice(0, 10)}`);
      results.skipped++;
      continue;
    }

    const facts = await loadFactsForPerson(person.id);
    const cleanFacts = dedupeAndDenoise(facts);

    if (cleanFacts.length < MIN_FACTS) {
      console.log(`  ⏭ ${person.display_name} — only ${cleanFacts.length} clean facts (raw ${facts.length})`);
      results.skipped++;
      continue;
    }

    console.log(`\n━━━ ${person.display_name} (${person.kind}, ${person.id.slice(0, 8)}) ━━━`);
    console.log(`  ${cleanFacts.length} clean facts (raw ${facts.length}, dropped ${facts.length - cleanFacts.length})`);

    const profile = await consolidate(person, cleanFacts);
    if (!profile) {
      console.log(`  ❌ Gemini failed`);
      results.failed++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ── Gemini output ──`);
      console.log(`  bio: ${profile.bio || '(none)'}`);
      console.log(`  relationship: ${profile.relationship || '(none)'}`);
      console.log(`  full_name: ${profile.full_name || '(none)'}`);
      console.log(`  nicknames: ${(profile.nicknames || []).join(', ') || '(none)'}`);
      console.log(`  languages: ${(profile.languages || []).join(', ') || '(none)'}`);
      console.log(`  traits (${(profile.traits || []).length}):`);
      for (const t of (profile.traits || []).slice(0, 8)) console.log(`    • ${t}`);
      console.log(`  facts (${(profile.facts || []).length}):`);
      for (const f of (profile.facts || []).slice(0, 10)) console.log(`    • ${f}`);
      results.enriched++;
    } else {
      const patch = buildPatch(person, profile, cleanFacts.length);
      const curated = person.metadata?.curated_fields || [];
      const { error } = await sb.from('people').update(patch).eq('id', person.id);
      if (error) {
        console.log(`  ❌ Update error: ${error.message}`);
        results.failed++;
      } else {
        const writtenKeys = Object.keys(patch).filter(k => k !== 'updated_at' && k !== 'last_profile_extraction');
        console.log(`  ✅ Wrote: ${writtenKeys.join(', ') || '(meta only)'}${curated.length ? ` | 🔒 curated (skipped): ${curated.join(', ')}` : ''}`);
        results.enriched++;
      }
    }

    await sleep(1800); // Gemini RPM throttle
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Enriched: ${results.enriched}`);
  console.log(`Skipped:  ${results.skipped}`);
  console.log(`Failed:   ${results.failed}`);
  if (DRY_RUN) console.log(`\n⚠ DRY RUN — nothing written.`);
}

async function pickCandidates() {
  // Paginate facts.subject_id, count by id
  console.log('Aggregating facts table by subject_id...');
  const counts = {};
  let off = 0;
  while (true) {
    const { data, error } = await sb.from('facts').select('subject_id').range(off, off + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const f of data) if (f.subject_id) counts[f.subject_id] = (counts[f.subject_id] || 0) + 1;
    if (data.length < 1000) break;
    off += 1000;
  }

  let entries = Object.entries(counts).filter(([id, n]) => id !== NEO_SELF_ID && n >= MIN_FACTS);
  entries.sort((a, b) => b[1] - a[1]);
  console.log(`  ${entries.length} subjects above min_facts=${MIN_FACTS}`);

  // Enrich with display_name + last_profile_extraction so we can filter
  // Neo-aliases (LID dupes) and optionally already-extracted rows up-front.
  const pool = entries.slice(0, LIMIT * 5).map(([id, n]) => ({ id, fact_count: n }));
  if (pool.length > 0) {
    const { data: rows } = await sb
      .from('people')
      .select('id,display_name,kind,last_profile_extraction')
      .in('id', pool.map(p => p.id));
    const byId = Object.fromEntries((rows || []).map(r => [r.id, r]));
    let neoSkipped = 0;
    let extractedSkipped = 0;
    const filtered = [];
    for (const c of pool) {
      const r = byId[c.id];
      if (!r) continue;
      if (r.kind === 'self' || isNeoAlias(r.display_name)) { neoSkipped++; continue; }
      if (SKIP_EXTRACTED && r.last_profile_extraction) { extractedSkipped++; continue; }
      filtered.push({ ...c, display_name: r.display_name });
    }
    if (neoSkipped) console.log(`  Skipped ${neoSkipped} Neo-alias / self rows (LID dedup pending)`);
    if (extractedSkipped) console.log(`  Skipped ${extractedSkipped} already-extracted rows`);
    return filtered.slice(0, LIMIT);
  }

  return pool.slice(0, LIMIT);
}

async function loadPerson(id) {
  const { data } = await sb
    .from('people')
    .select('id,display_name,full_name,push_name,kind,bio,traits,facts,relationship,nicknames,languages,last_profile_extraction,message_count,phone,identifiers,notes,metadata')
    .eq('id', id)
    .maybeSingle();
  return data;
}

async function loadFactsForPerson(personId) {
  const all = [];
  let off = 0;
  while (true) {
    const { data, error } = await sb
      .from('facts')
      .select('fact,category,confidence,created_at')
      .eq('subject_id', personId)
      .order('created_at', { ascending: false })
      .range(off, off + 999);
    if (error) break;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  return all;
}

function dedupeAndDenoise(facts) {
  const seen = new Set();
  const out = [];
  for (const f of facts) {
    const text = (f.fact || '').trim();
    if (!text) continue;
    const norm = text.toLowerCase();
    if (NOISE_FACTS.has(norm)) continue;
    if (text.length < 8) continue; // "ok", "haha", placeholder shards
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(text);
  }
  // Cap to most-recent-300 to bound prompt size & cost
  return out.slice(0, 300);
}

async function consolidate(person, facts) {
  const factList = facts.map((f, i) => `${i + 1}. ${f}`).join('\n');

  // Curated fields = user-set ground truth from the dashboard EDIT form.
  // These MUST be respected by the consolidation; downstream buildPatch will
  // also refuse to overwrite curated keys.
  const curated = new Set(person.metadata?.curated_fields || []);
  const groundTruthLines = [];
  if (curated.has('relationship') && person.relationship) groundTruthLines.push(`relationship = "${person.relationship}"`);
  if (curated.has('full_name') && person.full_name) groundTruthLines.push(`full_name = "${person.full_name}"`);
  if (curated.has('bio') && person.bio) groundTruthLines.push(`bio = "${person.bio}"`);
  if (curated.has('nicknames') && person.nicknames?.length) groundTruthLines.push(`nicknames = [${person.nicknames.map(n => `"${n}"`).join(', ')}]`);
  if (curated.has('display_name') && person.display_name) groundTruthLines.push(`display_name = "${person.display_name}"`);
  const groundTruthBlock = groundTruthLines.length > 0
    ? `\nGROUND TRUTH (user-set, MUST be honored — never contradict, never overwrite, harmonize all output around these):\n${groundTruthLines.map(l => '  - ' + l).join('\n')}\n`
    : '';

  const prompt = `You are consolidating raw observations about a person into a structured profile for Neo Todak's (Ahmad Fadli, CEO of Todak Studios) digital twin memory system.

PERSON: "${person.display_name}"
Current relationship tag: ${person.relationship || 'unknown'}
Current bio: ${person.bio || 'none'}
Push name (WhatsApp): ${person.push_name || 'none'}
Phone: ${person.phone || (person.identifiers || []).find(i => i?.type === 'phone')?.value || 'none'}
${groundTruthBlock}
RAW FACTS (${facts.length} unique, most-recent first):
${factList}

INSTRUCTIONS:
1. Read carefully. Extract UNIQUE, CONCRETE details. Many raw facts are repetitive or vague — discard those.
2. Prioritize SPECIFIC over generic:
   GOOD: "Works as Sales Manager at Todak Studios", "Has 2 kids named X and Y", "Lives in Cyberjaya", "Neo's younger brother"
   BAD: "Active in group chats", "Responsive person", "Sends voice notes"
3. For family: include exact relationship to Neo, location, occupation, kids' names, life events.
4. For colleagues: include role at Todak (or other employer), department, key projects.
5. NEVER invent facts. Every output fact must be supported by raw input.
6. If raw facts are mostly noise/generic, return short outputs — do not pad.

RESPOND IN JSON ONLY:
{
  "bio": "2-3 sentence bio focusing on WHO they are and their specific relationship to Neo. Be concrete. null if insufficient data.",
  "full_name": "real full name if discoverable, otherwise null",
  "relationship": "best friend|friend|colleague|employee|family|business partner|acquaintance|client|null",
  "traits": ["max 8 personality traits observed from actual behavior"],
  "facts": ["max 15 SPECIFIC, CONCRETE facts — names, dates, places, roles, events"],
  "nicknames": ["aliases, short names, WA display name variants"],
  "languages": ["ms", "en", etc — only languages actually observed in their messages"]
}`;

  try {
    const resp = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1500,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!resp.ok) {
      console.log(`  ⚠ Gemini ${resp.status}: ${(await resp.text()).slice(0, 150)}`);
      return null;
    }
    const data = await resp.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return repairAndParseJSON(match[0]);
  } catch (e) {
    console.log(`  ⚠ Gemini error: ${e.message}`);
    return null;
  }
}

function buildPatch(person, profile, factCount) {
  const patch = {
    last_profile_extraction: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // User-curated fields are sacrosanct — never overwrite. Enforced here as
  // defense-in-depth even if Gemini ignored the GROUND TRUTH block above.
  const curated = new Set(person.metadata?.curated_fields || []);
  const protect = (k) => curated.has(k);

  if (!protect('bio') && profile.bio && (!person.bio || profile.bio.length > person.bio.length)) {
    patch.bio = profile.bio;
  }
  if (!protect('full_name') && profile.full_name && !person.full_name) patch.full_name = profile.full_name;
  if (!protect('traits') && Array.isArray(profile.traits) && profile.traits.length > 0) patch.traits = profile.traits;
  if (!protect('facts') && Array.isArray(profile.facts) && profile.facts.length > 0) patch.facts = profile.facts;
  if (!protect('languages') && Array.isArray(profile.languages) && profile.languages.length > 0) patch.languages = profile.languages;

  if (!protect('relationship') && profile.relationship && profile.relationship !== person.relationship) {
    const generic = [null, '', 'acquaintance', 'unknown'];
    if (generic.includes(person.relationship)) patch.relationship = profile.relationship;
  }

  if (!protect('nicknames') && Array.isArray(profile.nicknames) && profile.nicknames.length > 0) {
    const existing = new Set((person.nicknames || []).map(n => n.toLowerCase()));
    const additions = profile.nicknames.filter(n => n && !existing.has(n.toLowerCase()));
    if (additions.length > 0) patch.nicknames = [...(person.nicknames || []), ...additions];
  }

  if (factCount && (!person.message_count || factCount > person.message_count)) {
    patch.message_count = factCount;
  }

  return patch;
}

function repairAndParseJSON(s) {
  try { return JSON.parse(s); } catch {}
  let fixed = s.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(fixed); } catch {}
  fixed = fixed.replace(/\/\/.*$/gm, '');
  try { return JSON.parse(fixed); } catch {}
  return null;
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(`\n❌ Fatal: ${e.message}\n${e.stack}`); process.exit(1); });
