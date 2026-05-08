#!/usr/bin/env node

/**
 * THR Name Resolver — match neo-brain people rows to Todak HR (THR) employees
 * by phone number, write THR's canonical full_name to neo-brain.
 *
 * STRICT READ-ONLY on THR: this tool reads from a local JSON dump
 * (.thr-employees-dump.json at repo root) that was extracted via the supabase
 * MCP. It NEVER writes to THR. All writes go to neo-brain.
 *
 * To refresh the dump: run the extractor (see ops note in commit msg) and
 * regenerate the JSON. Tool always uses the local dump for matching.
 *
 * Curation-aware: skips any person whose metadata.curated_fields includes
 * 'full_name', so manual edits via the dashboard EDIT form aren't overwritten.
 *
 * Usage:
 *   node thr-name-resolver.js --dry-run            # preview matches (default)
 *   node thr-name-resolver.js --execute            # live, write full_name
 *   node thr-name-resolver.js --limit 20 --dry-run # cap candidates
 *   node thr-name-resolver.js --include-position   # also write metadata.todak with employee_no/org/position
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const CTK_ROOT = path.resolve(import.meta.dirname, '..');
loadEnvFile(path.join(CTK_ROOT, '.env'));

const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes('--execute');
const INCLUDE_POSITION = argv.includes('--include-position');
const LIMIT = parseInt(getArg('--limit')) || 0; // 0 = no cap
const DUMP_PATH = path.join(CTK_ROOT, '.thr-employees-dump.json');

async function main() {
  console.log(`\n=== thr-name-resolver — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} ${INCLUDE_POSITION ? '(+position metadata)' : ''} ===\n`);

  if (!fs.existsSync(DUMP_PATH)) {
    console.error(`THR dump not found at ${DUMP_PATH}.`);
    console.error(`Refresh it via: supabase MCP execute_sql against thr_employees, then save to that path.`);
    process.exit(2);
  }
  const thrRows = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8'));
  console.log(`Loaded ${thrRows.length} THR rows from dump.`);

  // Build phone → THR record map. Active rows preferred over inactive on collision.
  const thrByPhone = {};
  for (const r of thrRows) {
    const candidates = [r.mobile_raw, r.work_raw].filter(Boolean);
    for (const raw of candidates) {
      const norm = normalizePhone(raw);
      if (!norm) continue;
      const existing = thrByPhone[norm];
      if (!existing || (!existing.active_status && r.active_status)) {
        thrByPhone[norm] = r;
      }
    }
  }
  console.log(`Indexed ${Object.keys(thrByPhone).length} unique normalized phone numbers.\n`);

  // Pull all candidate neo-brain people rows
  const people = [];
  let off = 0;
  while (true) {
    const { data, error } = await sb
      .from('people')
      .select('id,display_name,full_name,kind,identifiers,metadata')
      .is('metadata->merged_into', null)
      .neq('kind', 'self')
      .range(off, off + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    people.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`Loaded ${people.length} active neo-brain people rows.`);

  // Match
  const matches = [];
  let skippedCurated = 0;
  let skippedNoPhone = 0;
  for (const p of people) {
    const curated = new Set(p.metadata?.curated_fields || []);
    if (curated.has('full_name')) { skippedCurated++; continue; }
    const phoneIds = (p.identifiers || []).filter(i => i?.type === 'phone' && i.value);
    if (phoneIds.length === 0) { skippedNoPhone++; continue; }

    let hit = null;
    let matchedNorm = null;
    for (const i of phoneIds) {
      const norm = normalizePhone(i.value);
      if (!norm) continue;
      if (thrByPhone[norm]) { hit = thrByPhone[norm]; matchedNorm = norm; break; }
    }
    if (!hit) continue;

    matches.push({
      person_id: p.id,
      display_name: p.display_name,
      current_full_name: p.full_name,
      thr_full_name: hit.full_name,
      thr_nickname: hit.nickname,
      thr_employee_no: hit.employee_no,
      thr_organization: hit.organization_name,
      thr_position: hit.position_title,
      matched_phone: matchedNorm,
      thr_active: !!hit.active_status,
      will_change_full_name: hit.full_name && hit.full_name !== p.full_name,
    });
  }

  console.log(`Skipped: ${skippedCurated} (full_name curated), ${skippedNoPhone} (no phone identifier)`);
  console.log(`THR phone matches: ${matches.length}\n`);

  // Bucket matches into "would write" vs "already correct" vs "no name change but pos enrichment"
  const willChange = matches.filter(m => m.will_change_full_name);
  const alreadySame = matches.filter(m => !m.will_change_full_name);
  console.log(`  would update full_name: ${willChange.length}`);
  console.log(`  full_name already matches THR: ${alreadySame.length}\n`);

  console.log('--- Sample of matches that would write full_name (top 20) ---');
  const preview = LIMIT ? willChange.slice(0, LIMIT) : willChange.slice(0, 20);
  for (const m of preview) {
    const arrow = m.current_full_name ? `"${m.current_full_name}" → "${m.thr_full_name}"` : `(empty) → "${m.thr_full_name}"`;
    const tag = m.thr_active ? '' : ' [INACTIVE]';
    console.log(`  ${m.display_name.padEnd(30)} | ${arrow} | ${m.thr_position?.slice(0,30) || '-'} @ ${m.thr_organization?.slice(0,30) || '-'}${tag}`);
  }

  if (DRY_RUN) {
    console.log(`\n⚠ DRY RUN — nothing written. Pass --execute to write.`);
    return;
  }

  // Apply writes
  const toApply = LIMIT ? willChange.slice(0, LIMIT) : willChange;
  console.log(`\nApplying ${toApply.length} updates to neo-brain.people...`);
  let ok = 0, fail = 0;
  const now = new Date().toISOString();
  for (const m of toApply) {
    const patch = { full_name: m.thr_full_name, updated_at: now };
    if (INCLUDE_POSITION) {
      // Reload metadata to merge non-destructively
      const { data: cur } = await sb.from('people').select('metadata').eq('id', m.person_id).single();
      const meta = cur?.metadata || {};
      patch.metadata = {
        ...meta,
        todak: {
          employee_no: m.thr_employee_no,
          organization: m.thr_organization,
          position: m.thr_position,
          active: m.thr_active,
          synced_at: now,
        },
      };
    }
    const { error } = await sb.from('people').update(patch).eq('id', m.person_id);
    if (error) { console.log(`  ✗ ${m.display_name}: ${error.message}`); fail++; }
    else ok++;
  }
  console.log(`\n=== RESULT ===`);
  console.log(`updated: ${ok} | failed: ${fail}`);
}

/**
 * Normalize a Malaysian/Indonesian phone string to neo-brain's storage format
 * (digits-only, country code prefixed). Returns null if the input is unusable.
 *
 *   "017-7519610"     → "60177519610"   (MY mobile, leading 0 → 60)
 *   "012-3072191"     → "60123072191"
 *   "+60177519610"    → "60177519610"
 *   "60177519610"     → "60177519610"   (already correct)
 *   "01111011111"     → "601111011111"  (MY 011 carrier)
 *   "081-220964566"   → "81220964566"   (Indonesian — leading 0 stripped to leave country digits if 11+)
 *
 * Edge cases:
 *   ""                → null
 *   "012" (too short) → null
 *   non-digits only   → null
 */
function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let d = raw.replace(/\D+/g, '');
  if (!d) return null;
  if (d.length < 8) return null; // too short to be a real number
  // Already 60/+60 prefixed
  if (d.startsWith('60') && d.length >= 10) return d;
  // Malaysian: leading 0 + 10 or 11 digits → replace 0 with 60
  if (d.startsWith('0') && (d.length === 10 || d.length === 11)) return '60' + d.slice(1);
  // Already country-code-y (8-13 digit numbers) — keep as-is
  return d;
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
