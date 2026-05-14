// Verifies every expected_id in eval-set-v1.json against neo-brain. For each
// id, takes the first 8 chars as the prefix (those came from audit output and
// are trustworthy) and resolves to the full UUID. Updates the JSON in place.
// Reports any prefix that has no live memory (likely a fabricated extension
// or a memory that got archived).

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PATH = './eval/neo-brain/eval-set-v1.json';
const evalSet = JSON.parse(readFileSync(PATH, 'utf8'));

let touched = 0;
let missing = [];

for (const c of evalSet.cases) {
  const resolved = [];
  for (const id of c.expected_ids) {
    const prefix = id.slice(0, 8);
    // UUID columns don't accept ilike — match via hex range. Any UUID whose
    // first 8 hex chars equal `prefix` falls between `prefix-0...0` and
    // `prefix-f...f` (UUIDs compare by 16-byte binary == lexical hex).
    const lo = `${prefix}-0000-0000-0000-000000000000`;
    const hi = `${prefix}-ffff-ffff-ffff-ffffffffffff`;
    const { data, error } = await sb
      .from('memories')
      .select('id, content')
      .gte('id', lo)
      .lte('id', hi)
      .limit(3);
    if (error) {
      console.error(`  [${c.id}] query error for ${prefix}: ${error.message}`);
      resolved.push(id);
      continue;
    }
    if (!data || data.length === 0) {
      console.warn(`  ⚠️  [${c.id}] no memory matches prefix '${prefix}' — DROPPING`);
      missing.push({ case: c.id, prefix, original: id });
      continue;
    }
    if (data.length > 1) {
      console.warn(`  ⚠️  [${c.id}] prefix '${prefix}' matched ${data.length} memories — using first; consider lengthening the prefix`);
    }
    const real = data[0].id;
    if (real !== id) {
      touched++;
      resolved.push(real);
    } else {
      resolved.push(real);
    }
  }
  c.expected_ids = resolved;
}

writeFileSync(PATH, JSON.stringify(evalSet, null, 2));
console.log(`\nDone. ${touched} ID(s) updated to full UUIDs.`);
console.log(`${missing.length} ID(s) dropped (no matching memory).`);
if (missing.length) {
  console.log('\nDropped:');
  for (const m of missing) console.log(`  ${m.case}: ${m.prefix} (original ${m.original})`);
}
