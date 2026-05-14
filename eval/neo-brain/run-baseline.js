#!/usr/bin/env node
// run-baseline.js — Phase 0 baseline runner for the neo-brain RAG upgrade arc.
//
// Loads eval-set-v1.json, runs each question through NeoBrain.search() at
// CURRENT SDK DEFAULTS (k=10 so we can compute recall@5 + recall@10 from the
// same run; min_similarity=0.35), records the top-10 IDs returned per question,
// and computes:
//   - recall@5   (for each Q: |expected ∩ top5| / |expected|, then mean)
//   - recall@10
//   - hit@5      (binary — at least one expected in top-5; then mean)
//   - hit@10
//   - MRR        (1 / rank of first expected hit; 0 if not in top-10)
//
// Outputs:
//   - baseline-<date>.json  (full per-question results)
//   - baseline-<date>.md    (human summary)
//
// USAGE
//   node --env-file=.env --no-warnings eval/neo-brain/run-baseline.js
//
// READ-ONLY against neo-brain. No writes.

import { readFileSync, writeFileSync } from 'node:fs';
import { NeoBrain } from '@todak/memory';

const EVAL_PATH = './eval/neo-brain/eval-set-v1.json';
const stamp = new Date().toISOString().slice(0, 10);
const REPORT_JSON = `./eval/neo-brain/baseline-${stamp}.json`;
const REPORT_MD   = `./eval/neo-brain/baseline-${stamp}.md`;

const evalSet = JSON.parse(readFileSync(EVAL_PATH, 'utf8'));
const nb = new NeoBrain({ agent: 'rag-phase0-baseline' });

// Redact common secret shapes before they land in the report.
// Discovered the hard way 2026-05-15 when a memory containing a real
// Anthropic API key (created 2025-06-30 by claude_desktop, importance=10)
// surfaced as a top-5 result for "where do we store API credentials" and
// the pre-commit hook blocked the report from being committed. Keep this
// list in sync with the pre-commit pattern set (.git/hooks/pre-commit).
function redact(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/sk-ant-api03-[A-Za-z0-9_-]+/g, '[REDACTED-ANTHROPIC-KEY]')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED-API-KEY]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED-JWT]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED-AWS-KEY]')
    .replace(/xox[bp]-[A-Za-z0-9-]+/g, '[REDACTED-SLACK-TOKEN]');
}

const SEARCH_OPTS = { k: 10, minSimilarity: 0.35 };  // SDK defaults except k bumped to 10

const results = [];
let n_recall5 = 0, n_recall10 = 0, n_hit5 = 0, n_hit10 = 0, mrr_sum = 0;
let n_questions_with_expected = 0;
let n_zero_expected = 0; // diagnostic cases (expected_ids: [])

console.log(`Loaded ${evalSet.cases.length} eval cases. Running baseline with k=${SEARCH_OPTS.k}, min_similarity=${SEARCH_OPTS.minSimilarity}...\n`);

for (const c of evalSet.cases) {
  let hits;
  try {
    hits = await nb.search(c.question, SEARCH_OPTS);
  } catch (e) {
    results.push({ id: c.id, question: c.question, error: e.message });
    console.error(`  ✗ [${c.id}] search failed: ${e.message}`);
    continue;
  }
  const returnedIds = hits.map(h => h.id);
  const expected = new Set(c.expected_ids);

  // Per-case metrics
  const top5 = returnedIds.slice(0, 5);
  const top10 = returnedIds.slice(0, 10);
  const found5 = top5.filter(id => expected.has(id));
  const found10 = top10.filter(id => expected.has(id));

  let firstRank = null;
  for (let i = 0; i < returnedIds.length; i++) {
    if (expected.has(returnedIds[i])) { firstRank = i + 1; break; }
  }
  const reciprocal = firstRank ? 1 / firstRank : 0;

  const recall5 = expected.size ? found5.length / expected.size : null;
  const recall10 = expected.size ? found10.length / expected.size : null;
  const hit5 = expected.size ? (found5.length > 0 ? 1 : 0) : null;
  const hit10 = expected.size ? (found10.length > 0 ? 1 : 0) : null;

  results.push({
    id: c.id,
    question: c.question,
    category: c.category,
    expected_ids: [...expected],
    returned_top10: returnedIds,
    first_hit_rank: firstRank,
    recall5, recall10, hit5, hit10, mrr_contribution: reciprocal,
    // For diagnostic: show the top-5 with similarity if available — content_preview redacted
    top5_preview: hits.slice(0, 5).map(h => ({ id: h.id, similarity: h.similarity, content_preview: redact((h.content||'').slice(0, 120)) })),
  });

  if (expected.size === 0) {
    n_zero_expected++;
    // diagnostic case (e.g. off-table question) — recall is N/A but report top-1
    console.log(`  · [${c.id}] (diagnostic, 0 expected) → top-1 sim=${hits[0]?.similarity?.toFixed(3) ?? 'n/a'}`);
  } else {
    n_questions_with_expected++;
    n_recall5 += recall5;
    n_recall10 += recall10;
    n_hit5 += hit5;
    n_hit10 += hit10;
    mrr_sum += reciprocal;
    console.log(`  ${firstRank ? '✓' : '✗'} [${c.id}] rank=${firstRank ?? '—'}  r@5=${recall5.toFixed(2)}  r@10=${recall10.toFixed(2)}`);
  }
}

const N = n_questions_with_expected;
const summary = {
  ran_at: new Date().toISOString(),
  eval_set: EVAL_PATH,
  search_opts: SEARCH_OPTS,
  total_cases: evalSet.cases.length,
  cases_with_expected: N,
  diagnostic_cases_no_expected: n_zero_expected,
  metrics: {
    'recall@5':  N ? (n_recall5 / N) : null,
    'recall@10': N ? (n_recall10 / N) : null,
    'hit@5':     N ? (n_hit5 / N) : null,
    'hit@10':    N ? (n_hit10 / N) : null,
    MRR:         N ? (mrr_sum / N) : null,
  },
};

console.log('\n━━ Summary ━━');
console.log(`Cases scored: ${N}  ·  diagnostic cases: ${n_zero_expected}`);
console.log(`recall@5  = ${(summary.metrics['recall@5']*100).toFixed(1)}%`);
console.log(`recall@10 = ${(summary.metrics['recall@10']*100).toFixed(1)}%`);
console.log(`hit@5     = ${(summary.metrics['hit@5']*100).toFixed(1)}%`);
console.log(`hit@10    = ${(summary.metrics['hit@10']*100).toFixed(1)}%`);
console.log(`MRR       = ${summary.metrics.MRR.toFixed(3)}`);

writeFileSync(REPORT_JSON, JSON.stringify({ summary, per_question: results }, null, 2));
console.log(`\nFull JSON → ${REPORT_JSON}`);

// Markdown summary
const md = [];
md.push(`# Phase 0 Baseline · ${stamp}`);
md.push('');
md.push(`**Eval set:** \`${EVAL_PATH}\` · ${evalSet.cases.length} cases (${N} scored, ${n_zero_expected} diagnostic)`);
md.push(`**Search config:** \`NeoBrain.search\` with \`k=${SEARCH_OPTS.k}\`, \`min_similarity=${SEARCH_OPTS.minSimilarity}\` → \`match_memories\` RPC`);
md.push(`**neo-brain state at run:** 14,128 rows · 0 NULL embedding on knowledge categories`);
md.push('');
md.push('## Headline metrics');
md.push('');
md.push('| Metric | Score |');
md.push('|---|---|');
md.push(`| recall@5  | **${(summary.metrics['recall@5']*100).toFixed(1)}%** |`);
md.push(`| recall@10 | ${(summary.metrics['recall@10']*100).toFixed(1)}% |`);
md.push(`| hit@5     | ${(summary.metrics['hit@5']*100).toFixed(1)}% |`);
md.push(`| hit@10    | ${(summary.metrics['hit@10']*100).toFixed(1)}% |`);
md.push(`| MRR       | ${summary.metrics.MRR.toFixed(3)} |`);
md.push('');
md.push('## Per-case results');
md.push('');
md.push('| id | category | first-hit rank | recall@5 | recall@10 | notes |');
md.push('|---|---|---|---|---|---|');
for (const r of results) {
  if (r.error) {
    md.push(`| ${r.id} | (error) | — | — | — | ${r.error} |`);
    continue;
  }
  const expectedSize = r.expected_ids.length;
  const rank = r.first_hit_rank ?? '—';
  const r5 = r.recall5 == null ? '(diag)' : (r.recall5 * 100).toFixed(0) + '%';
  const r10 = r.recall10 == null ? '(diag)' : (r.recall10 * 100).toFixed(0) + '%';
  const note = expectedSize === 0 ? 'diagnostic (no expected)' : `${expectedSize} expected`;
  md.push(`| ${r.id} | ${r.category} | ${rank} | ${r5} | ${r10} | ${note} |`);
}
md.push('');
md.push('## Misses worth investigating');
md.push('');
const misses = results.filter(r => !r.error && r.expected_ids.length > 0 && !r.first_hit_rank);
if (misses.length === 0) {
  md.push('_None — every scored question retrieved at least one expected memory in the top-10._');
} else {
  for (const r of misses) {
    md.push(`### ${r.id} · ${r.question}`);
    md.push('');
    md.push(`Expected IDs: ${r.expected_ids.map(id => '`' + id.slice(0,8) + '`').join(', ')}`);
    md.push('');
    md.push('Actual top-5 (none matched):');
    md.push('');
    for (const t of r.top5_preview) {
      md.push(`- \`${t.id.slice(0,8)}\` (sim=${t.similarity?.toFixed(3) ?? 'n/a'}) — ${t.content_preview}…`);
    }
    md.push('');
  }
}

writeFileSync(REPORT_MD, md.join('\n') + '\n');
console.log(`Markdown   → ${REPORT_MD}`);
