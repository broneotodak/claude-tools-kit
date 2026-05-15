#!/usr/bin/env node
// redact-memory.js — Phase S.2 Step 3
//
// CLI for safe, idempotent, batch credential redaction across many neo-brain
// memories. Thin wrapper over NeoBrain.redactMemory() (shipped 2026-05-15);
// all safety / re-embed / log writing logic lives in the SDK. This tool just:
//   - parses an input JSON,
//   - resolves the regex literals,
//   - computes newContent per memory,
//   - shows you what would change (--dry),
//   - then calls the SDK in apply mode.
//
// USAGE
//   node tools/redact-memory.js <input.json>            # --apply by default
//   node tools/redact-memory.js --dry <input.json>      # print diffs, no write
//   node tools/redact-memory.js --verbose <input.json>  # full before/after
//   node tools/redact-memory.js --help
//
// INPUT JSON SHAPE
//   [
//     {
//       "memoryId": "<full-uuid>",
//       "replacements": [
//         {
//           "pattern": "sk-ant-api03-[A-Za-z0-9_-]+",   // regex source (no slashes)
//           "flags": "g",                                // optional, defaults "g"
//           "replacement": "→ vault: service=anthropic, type=api_key_legacy_2025_06"
//         },
//         ...
//       ],
//       "newImportance": 6,                              // optional
//       "newVisibility": "internal",                     // optional
//       "reason": "Phase S.2 sweep batch1"               // required
//     },
//     ...
//   ]
//
// EXIT CODES
//   0 = all entries succeeded (or dry-run completed)
//   1 = at least one entry failed (CLI logs which; SDK errors bubble through)
//   2 = fatal (input file bad, env missing, etc.)
//
// Output: per-entry verdict + final summary table.

import { readFileSync } from 'node:fs';
import { NeoBrain } from '@todak/memory';
import { createClient } from '@supabase/supabase-js';

// ── arg parsing ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const HELP = args.includes('--help') || args.includes('-h');
const DRY = args.includes('--dry');
const VERBOSE = args.includes('--verbose');
const inputPath = args.find((a) => !a.startsWith('-'));

if (HELP || !inputPath) {
  console.log(`redact-memory.js — batch credential redaction over neo-brain.

Usage:
  node tools/redact-memory.js <input.json>            # apply (default)
  node tools/redact-memory.js --dry <input.json>      # show diffs, no write
  node tools/redact-memory.js --verbose <input.json>  # full before/after
  node tools/redact-memory.js --help

Input shape: see header of this file.
Writes go through NeoBrain.redactMemory() — safety check + re-embed + log.`);
  process.exit(HELP ? 0 : 2);
}

// ── env (loaded via node --env-file in invocation; rely on process.env) ──
if (!process.env.NEO_BRAIN_URL || !process.env.NEO_BRAIN_SERVICE_ROLE_KEY) {
  console.error('NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY required (use node --env-file=.env)');
  process.exit(2);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY required (SDK re-embeds via Gemini)');
  process.exit(2);
}

// ── load input ──────────────────────────────────────────────────────
let entries;
try {
  entries = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (e) {
  console.error(`failed to parse ${inputPath}: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(entries) || entries.length === 0) {
  console.error('input must be a non-empty JSON array');
  process.exit(2);
}

// validate shape
for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  if (!e || typeof e !== 'object') { console.error(`entry ${i}: not an object`); process.exit(2); }
  if (typeof e.memoryId !== 'string' || !e.memoryId.length) { console.error(`entry ${i}: missing memoryId`); process.exit(2); }
  if (!Array.isArray(e.replacements) || e.replacements.length === 0) { console.error(`entry ${i}: missing replacements[]`); process.exit(2); }
  if (typeof e.reason !== 'string' || !e.reason.length) { console.error(`entry ${i}: missing reason`); process.exit(2); }
  for (let j = 0; j < e.replacements.length; j++) {
    const r = e.replacements[j];
    if (typeof r.pattern !== 'string' || typeof r.replacement !== 'string') {
      console.error(`entry ${i} replacement ${j}: needs pattern (string) + replacement (string)`);
      process.exit(2);
    }
  }
}

// ── clients ─────────────────────────────────────────────────────────
const nb = new NeoBrain({ agent: 'redact-memory-cli' });
const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── helpers ─────────────────────────────────────────────────────────
function buildRegex({ pattern, flags = 'g' }) {
  // Ensure global flag for replaceAll-style behaviour; SDK does the safety check.
  const f = flags.includes('g') ? flags : flags + 'g';
  try {
    return new RegExp(pattern, f);
  } catch (e) {
    throw new Error(`bad regex /${pattern}/${f}: ${e.message}`);
  }
}

function applyReplacements(text, replacements) {
  let out = text;
  for (const r of replacements) {
    const re = buildRegex(r);
    out = out.replace(re, r.replacement);
  }
  return out;
}

function shortDiff(oldT, newT) {
  // Find first divergent index for the preview
  let i = 0;
  while (i < oldT.length && i < newT.length && oldT[i] === newT[i]) i++;
  const lo = Math.max(0, i - 30);
  return {
    head: oldT.slice(0, lo),
    oldFragment: oldT.slice(lo, lo + 140),
    newFragment: newT.slice(lo, lo + 140),
  };
}

// ── main ────────────────────────────────────────────────────────────
const summary = { total: entries.length, succeeded: 0, no_change: 0, failed: 0, errors: [] };
const mode = DRY ? 'DRY-RUN' : 'APPLY';
console.log(`━━ redact-memory · ${mode} · ${entries.length} entries ━━\n`);

for (const e of entries) {
  const id8 = e.memoryId.slice(0, 8);
  try {
    // fetch current
    const { data: cur, error: fetchErr } = await sb.from('memories').select('id, content, importance, visibility').eq('id', e.memoryId).maybeSingle();
    if (fetchErr) throw new Error(`fetch: ${fetchErr.message}`);
    if (!cur) throw new Error(`memory not found`);

    // apply replacements
    const newContent = applyReplacements(cur.content || '', e.replacements);
    if (newContent === cur.content) {
      console.log(`  [${id8}] (no change — replacements didn't match · reason: ${e.reason})`);
      summary.no_change++;
      continue;
    }

    if (VERBOSE) {
      console.log(`  [${id8}] reason: ${e.reason}`);
      console.log(`    BEFORE: ${(cur.content || '').slice(0, 200).replace(/\n/g, ' ')}`);
      console.log(`    AFTER:  ${newContent.slice(0, 200).replace(/\n/g, ' ')}`);
    } else {
      const d = shortDiff(cur.content || '', newContent);
      console.log(`  [${id8}] reason: ${e.reason}`);
      console.log(`    -  ${d.oldFragment.replace(/\n/g, ' ')}`);
      console.log(`    +  ${d.newFragment.replace(/\n/g, ' ')}`);
    }

    if (DRY) {
      summary.succeeded++;
      continue;
    }

    // apply via SDK
    await nb.redactMemory(e.memoryId, {
      newContent,
      newImportance: typeof e.newImportance === 'number' ? e.newImportance : undefined,
      newVisibility: typeof e.newVisibility === 'string' ? e.newVisibility : undefined,
      reason: e.reason,
    });
    console.log(`    ✓ redacted`);
    summary.succeeded++;
  } catch (err) {
    console.error(`  [${id8}] ✗ ${err.message}`);
    summary.failed++;
    summary.errors.push({ memoryId: e.memoryId, error: err.message });
  }
}

console.log(`\n━━ summary (${mode}) ━━`);
console.log(`  total:      ${summary.total}`);
console.log(`  succeeded:  ${summary.succeeded}${DRY ? ' (would redact)' : ''}`);
console.log(`  no_change:  ${summary.no_change}  (replacements didn't match — check patterns)`);
console.log(`  failed:     ${summary.failed}`);
if (summary.errors.length) {
  console.log(`\n  errors:`);
  for (const e of summary.errors) console.log(`    ${e.memoryId.slice(0,8)}: ${e.error}`);
}

process.exit(summary.failed > 0 ? 1 : 0);
