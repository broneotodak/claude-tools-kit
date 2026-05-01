#!/usr/bin/env node
// Dataset extraction pipeline — reads neo-brain memories table READ-ONLY,
// writes versioned JSONL slices to ~/datasets/neo-corpus/YYYY-MM-DD/.
//
// Guardrails (per NACA session sign-off 2026-05-01):
//   - READ-ONLY on neo-brain (no inserts, no updates, no markers)
//   - Reuses memories.source enum verbatim (no forked vocabulary)
//   - private + internal stay local; only --push-hf publishes (and filters to public)
//
// Usage examples:
//   node extract.js --dry-run
//   node extract.js                                  (default: visibility=internal,private; slice=all)
//   node extract.js --since-days 7
//   node extract.js --visibility public --slice by-source
//   node extract.js --out ~/datasets/neo-corpus/test

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

// ─── CLI ARG PARSING ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { sinceDays: null, visibility: ['internal', 'private'], slice: 'all', dryRun: false, pushHf: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--since-days') a.sinceDays = Number(argv[++i]);
    else if (k === '--visibility') a.visibility = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--slice') a.slice = argv[++i];
    else if (k === '--push-hf') a.pushHf = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--help' || k === '-h') { printHelp(); process.exit(0); }
    else { console.error('Unknown flag:', k); process.exit(2); }
  }
  if (!['all', 'by-source', 'by-actor', 'by-domain'].includes(a.slice)) {
    console.error('Invalid --slice (expected: all|by-source|by-actor|by-domain)');
    process.exit(2);
  }
  return a;
}
function printHelp() {
  console.log(`Usage: node extract.js [flags]
  --dry-run               count rows only, no files written
  --since-days N          only rows created in last N days (default: all)
  --visibility LIST       comma-list: public,internal,private (default: internal,private)
  --slice WHICH           all | by-source | by-actor | by-domain (default: all)
  --out PATH              output dir (default: ~/datasets/neo-corpus/YYYY-MM-DD)
  --push-hf REPO          (not implemented in v1) publish public-only slices to HF`);
}

// ─── ACTOR + DOMAIN MAPPINGS ──────────────────────────────────────────────────
// Per NACA guardrail: source enum is verbatim. Actor is a derived label.
const NEO_AUTHORED_SOURCES = new Set(['wa-primary', 'manual', 'wa-chat-importer']);
function deriveActor(source) {
  if (NEO_AUTHORED_SOURCES.has(source)) return 'neo';
  return 'agent:' + (source || 'unknown');
}

const DOMAIN_BUCKETS = {
  technical: new Set(['technical_solution', 'bug_fix', 'technical_discovery', 'technical_analysis', 'critical_bug', 'critical_error']),
  milestones: new Set(['project_milestone', 'milestone', 'project_completion', 'project_decision', 'project_start', 'project_summary', 'deployment']),
  conversation: new Set(['conversation', 'conversation_progress', 'conversation_start', 'conversation_end', 'conversation_summary', 'session_summary', 'session_start', 'work_session', 'context_switch']),
  activity: new Set(['activity', 'task', 'task_completion', 'task_progress', 'event'])
};
function deriveDomain(memoryType) {
  for (const [bucket, set] of Object.entries(DOMAIN_BUCKETS)) {
    if (set.has(memoryType)) return bucket;
  }
  return 'other';
}

// ─── CANONICAL TRANSFORM ──────────────────────────────────────────────────────
// Map a memories row → JSONL record. Strips embedding + tsv (DB-specific, regenerable).
function canonicalize(row) {
  return {
    id: row.id,
    content: row.content,
    source: row.source,                       // verbatim per guardrail
    actor: deriveActor(row.source),
    memory_type: row.memory_type,
    domain: deriveDomain(row.memory_type),
    category: row.category,
    visibility: row.visibility,
    importance: row.importance,
    ts: row.created_at,
    subject_id: row.subject_id,
    related_people: row.related_people,
    source_ref: row.source_ref,
    metadata: row.metadata
  };
}

// ─── SLICE ROUTING ────────────────────────────────────────────────────────────
function sanitize(name) {
  return String(name || 'unknown').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}
function slicesFor(record, sliceMode) {
  const out = [];
  if (sliceMode === 'all' || sliceMode === 'by-source') {
    out.push('by-source/' + sanitize(record.source) + '.jsonl');
  }
  if (sliceMode === 'all' || sliceMode === 'by-actor') {
    if (record.actor === 'neo') out.push('by-actor/neo.jsonl');
    else out.push('by-actor/' + sanitize(record.actor) + '.jsonl');
  }
  if (sliceMode === 'all' || sliceMode === 'by-domain') {
    out.push('by-domain/' + record.domain + '.jsonl');
  }
  return out;
}

// ─── EXTRACTION ───────────────────────────────────────────────────────────────
async function pageThroughMemories(sb, { sinceDays, visibility }) {
  const PAGE = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    let q = sb.from('memories')
      .select('id,content,source,memory_type,category,visibility,importance,subject_id,related_people,source_ref,metadata,created_at')
      .eq('archived', false);
    if (visibility && visibility.length) q = q.in('visibility', visibility);
    if (sinceDays != null && Number.isFinite(sinceDays)) {
      const cutoff = new Date(Date.now() - sinceDays * 86400_000).toISOString();
      q = q.gte('created_at', cutoff);
    }
    const { data, error } = await q.order('created_at', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error('memories read failed: ' + error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// ─── MANIFEST ─────────────────────────────────────────────────────────────────
function sha256OfFile(path) {
  const { readFileSync } = require('node:fs');
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);
  if (!process.env.NEO_BRAIN_URL || !process.env.NEO_BRAIN_SERVICE_ROLE_KEY) {
    console.error('Missing NEO_BRAIN_URL or NEO_BRAIN_SERVICE_ROLE_KEY in env');
    process.exit(1);
  }
  if (opts.pushHf) {
    console.error('--push-hf not implemented in v1. Aborting.');
    process.exit(2);
  }

  const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY);

  console.log('# Dataset extraction — neo-corpus');
  console.log('  visibility :', opts.visibility.join(','));
  console.log('  since-days :', opts.sinceDays ?? 'all');
  console.log('  slice mode :', opts.slice);
  console.log('  dry run    :', opts.dryRun);

  console.log('\n→ Reading memories table...');
  const t0 = Date.now();
  const rows = await pageThroughMemories(sb, opts);
  console.log(`  read ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Aggregate distributions for the manifest, even in dry-run
  const sourceDist = {}, visDist = {}, typeDist = {}, actorDist = {}, domainDist = {};
  const slicesAccum = {};  // path → array of canonical records
  for (const row of rows) {
    const rec = canonicalize(row);
    sourceDist[rec.source] = (sourceDist[rec.source] || 0) + 1;
    visDist[rec.visibility] = (visDist[rec.visibility] || 0) + 1;
    typeDist[rec.memory_type] = (typeDist[rec.memory_type] || 0) + 1;
    actorDist[rec.actor] = (actorDist[rec.actor] || 0) + 1;
    domainDist[rec.domain] = (domainDist[rec.domain] || 0) + 1;
    if (opts.dryRun) continue;
    for (const path of slicesFor(rec, opts.slice)) {
      (slicesAccum[path] = slicesAccum[path] || []).push(rec);
    }
  }

  console.log('\n# Distributions');
  console.log('  by source :', Object.entries(sourceDist).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('  by actor  :', Object.entries(actorDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('  by domain :', Object.entries(domainDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('  by visib. :', Object.entries(visDist).map(([k, v]) => `${k}=${v}`).join(', '));

  if (opts.dryRun) {
    console.log('\n[dry-run] no files written. Done.');
    return;
  }

  // Resolve output dir
  const today = new Date().toISOString().slice(0, 10);
  const outDir = opts.out ? resolve(opts.out) : join(homedir(), 'datasets', 'neo-corpus', today);
  console.log(`\n→ Writing to ${outDir}`);

  const sliceStats = {};
  for (const [relPath, recs] of Object.entries(slicesAccum)) {
    const fullPath = join(outDir, relPath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    const lines = recs.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(fullPath, lines, 'utf8');
    const size = statSync(fullPath).size;
    sliceStats[relPath] = { rows: recs.length, bytes: size };
  }

  // sha256 per slice (separate pass — readFileSync via dynamic import to keep top imports tidy)
  const { readFileSync } = await import('node:fs');
  for (const relPath of Object.keys(sliceStats)) {
    const buf = readFileSync(join(outDir, relPath));
    sliceStats[relPath].sha256 = createHash('sha256').update(buf).digest('hex');
  }

  // Manifest
  const manifest = {
    extracted_at: new Date().toISOString(),
    extraction_version: '1.0',
    pipeline: 'claude-tools-kit/tools/dataset-pipeline/extract.js',
    filters: { since_days: opts.sinceDays, visibility: opts.visibility, slice: opts.slice },
    totals: { rows_read: rows.length, slices_written: Object.keys(sliceStats).length },
    slices: sliceStats,
    distributions: { source: sourceDist, actor: actorDist, domain: domainDist, visibility: visDist },
    guardrails: ['read-only-on-neo-brain', 'source-enum-reuse', 'no-write-back', 'visibility-respecting']
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const totalBytes = Object.values(sliceStats).reduce((s, x) => s + x.bytes, 0);
  console.log(`\n# Summary`);
  console.log(`  slices written : ${Object.keys(sliceStats).length}`);
  console.log(`  rows total     : ${rows.length}`);
  console.log(`  total size     : ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  manifest       : ${join(outDir, 'manifest.json')}`);
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
