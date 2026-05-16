#!/usr/bin/env node
// run-hybrid-sweep.js — Phase 1b of the neo-brain RAG upgrade arc.
//
// Evaluates match_memories_hybrid_v2 (RRF fusion of a cosine ranker + a
// ts_rank lexical ranker) against the Phase 0 eval set, sweeping:
//   - min_similarity — the cosine gate on the semantic candidate pool
//                      (lexical matches below it are still rescued in)
//   - rrf_k          — the RRF smoothing constant
//   - semantic_weight / lexical_weight — per-ranker RRF weights
//
// The legacy match_memories_hybrid is NOT swept — its source_w multiplier is
// conclusively broken (boosts the largest source by volume; penalty branches
// match zero rows) and it scored a flat 31% vs the 56.9% vanilla baseline.
//
// Each question is embedded ONCE (Gemini); embeddings are reused across every
// config. A vanilla match_memories run is the apples-to-apples control.
//
// Outputs eval/neo-brain/hybrid-sweep-<date>.{json,md}. READ-ONLY on neo-brain.
//
// USAGE
//   node --env-file=.env --no-warnings eval/neo-brain/run-hybrid-sweep.js

import { readFileSync, writeFileSync } from 'node:fs';
import { NeoBrain } from '@todak/memory';
import { embedText } from '../../packages/memory/src/gemini.js';

const EVAL_PATH = './eval/neo-brain/eval-set-v1.json';
const stamp = new Date().toISOString().slice(0, 10);
const REPORT_JSON = `./eval/neo-brain/hybrid-sweep-${stamp}.json`;
const REPORT_MD = `./eval/neo-brain/hybrid-sweep-${stamp}.md`;

const K = 10;
const VIS = ['public', 'internal', 'private'];

// Sweep grid -----------------------------------------------------------
const MIN_SIMS = [0.25, 0.3];
const RRF_KS = [30, 60];
const WEIGHT_PAIRS = [
  { sw: 1.0, lw: 1.0 },
  { sw: 2.0, lw: 1.0 },
  { sw: 3.0, lw: 1.0 },
  { sw: 1.0, lw: 0.5 },
];

const evalSet = JSON.parse(readFileSync(EVAL_PATH, 'utf8'));
const nb = new NeoBrain({ agent: 'rag-phase1b-hybrid-sweep' });

console.log(`Embedding ${evalSet.cases.length} questions...`);
const embByCase = new Map();
for (const c of evalSet.cases) {
  embByCase.set(c.id, await embedText(c.question, { apiKey: nb.geminiApiKey }));
}

function scoreRun(returnedIdsByCase) {
  let r5 = 0, r10 = 0, h5 = 0, h10 = 0, mrr = 0, n = 0;
  for (const c of evalSet.cases) {
    const expected = new Set(c.expected_ids);
    if (expected.size === 0) continue;
    n++;
    const ids = returnedIdsByCase.get(c.id) || [];
    const f5 = ids.slice(0, 5).filter((id) => expected.has(id)).length;
    const f10 = ids.slice(0, 10).filter((id) => expected.has(id)).length;
    let rank = 0;
    for (let i = 0; i < ids.length; i++) {
      if (expected.has(ids[i])) { rank = i + 1; break; }
    }
    r5 += f5 / expected.size;
    r10 += f10 / expected.size;
    h5 += f5 > 0 ? 1 : 0;
    h10 += f10 > 0 ? 1 : 0;
    mrr += rank ? 1 / rank : 0;
  }
  return { 'recall@5': r5 / n, 'recall@10': r10 / n, 'hit@5': h5 / n, 'hit@10': h10 / n, MRR: mrr / n, n };
}

async function runVanilla(minSim) {
  const byCase = new Map();
  for (const c of evalSet.cases) {
    const { data, error } = await nb.sb.rpc('match_memories', {
      query_embedding: embByCase.get(c.id),
      match_count: K, min_similarity: minSim, visibility_filter: VIS,
      p_subject_id: null, source_filter: null,
    });
    if (error) throw new Error(`match_memories: ${error.message}`);
    byCase.set(c.id, (data || []).map((r) => r.id));
  }
  return byCase;
}

async function runHybridV2(minSim, rrfK, sw, lw) {
  const byCase = new Map();
  for (const c of evalSet.cases) {
    const { data, error } = await nb.sb.rpc('match_memories_hybrid_v2', {
      query_embedding: embByCase.get(c.id),
      query_text: c.question,
      match_count: K, min_similarity: minSim, visibility_filter: VIS,
      source_exclude: null, rrf_k: rrfK, semantic_weight: sw, lexical_weight: lw,
    });
    if (error) throw new Error(`match_memories_hybrid_v2: ${error.message}`);
    byCase.set(c.id, (data || []).map((r) => r.id));
  }
  return byCase;
}

const runs = [];

console.log('\nControl: vanilla match_memories @ min_sim=0.35');
const ctrl = scoreRun(await runVanilla(0.35));
runs.push({ kind: 'vanilla', min_sim: 0.35, rrf_k: null, sw: null, lw: null, metrics: ctrl });
console.log(`  recall@5=${(ctrl['recall@5'] * 100).toFixed(1)}%  recall@10=${(ctrl['recall@10'] * 100).toFixed(1)}%  MRR=${ctrl.MRR.toFixed(3)}`);

for (const minSim of MIN_SIMS) {
  for (const rrfK of RRF_KS) {
    for (const { sw, lw } of WEIGHT_PAIRS) {
      const m = scoreRun(await runHybridV2(minSim, rrfK, sw, lw));
      runs.push({ kind: 'hybrid_v2', min_sim: minSim, rrf_k: rrfK, sw, lw, metrics: m });
      console.log(
        `  v2 min_sim=${minSim} k=${rrfK} sw=${sw} lw=${lw}  ` +
          `recall@5=${(m['recall@5'] * 100).toFixed(1)}%  recall@10=${(m['recall@10'] * 100).toFixed(1)}%  MRR=${m.MRR.toFixed(3)}`,
      );
    }
  }
}

const sorted = [...runs].sort((a, b) => b.metrics['recall@5'] - a.metrics['recall@5'] || b.metrics.MRR - a.metrics.MRR);
const best = sorted[0];

writeFileSync(REPORT_JSON, JSON.stringify({ ran_at: new Date().toISOString(), eval_set: EVAL_PATH, k: K, runs, best }, null, 2));

const md = [];
md.push(`# Phase 1b · Hybrid (RRF) retrieval sweep · ${stamp}`);
md.push('');
md.push(`Eval set: \`${EVAL_PATH}\` · ${ctrl.n} scored questions · k=${K}`);
md.push(`RPC swept: \`match_memories_hybrid_v2\` (RRF fusion). Control: \`match_memories\` @ min_sim=0.35.`);
md.push('');
md.push('| config | min_sim | rrf_k | sw / lw | recall@5 | recall@10 | hit@5 | MRR |');
md.push('|---|---|---|---|---|---|---|---|');
for (const r of sorted) {
  const cfg = r.kind === 'vanilla' ? 'vanilla (control)' : 'hybrid_v2';
  const wl = r.kind === 'vanilla' ? '—' : `${r.sw} / ${r.lw}`;
  const rk = r.rrf_k ?? '—';
  md.push(
    `| ${cfg} | ${r.min_sim} | ${rk} | ${wl} | ${(r.metrics['recall@5'] * 100).toFixed(1)}% | ` +
      `${(r.metrics['recall@10'] * 100).toFixed(1)}% | ${(r.metrics['hit@5'] * 100).toFixed(1)}% | ${r.metrics.MRR.toFixed(3)} |`,
  );
}
md.push('');
const delta = (best.metrics['recall@5'] - ctrl['recall@5']) * 100;
md.push(
  `**Best recall@5:** ${(best.metrics['recall@5'] * 100).toFixed(1)}% — ` +
    `${best.kind}${best.kind === 'hybrid_v2' ? ` (min_sim=${best.min_sim}, rrf_k=${best.rrf_k}, sw=${best.sw}, lw=${best.lw})` : ''} ` +
    `· ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp vs vanilla control.`,
);
writeFileSync(REPORT_MD, md.join('\n') + '\n');

console.log(`\n━━ Best: ${best.kind} recall@5=${(best.metrics['recall@5'] * 100).toFixed(1)}% (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp vs vanilla) ━━`);
console.log(`JSON → ${REPORT_JSON}`);
console.log(`MD   → ${REPORT_MD}`);
