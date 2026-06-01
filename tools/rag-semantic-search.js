#!/usr/bin/env node
'use strict';

/**
 * RAG Semantic Search (neo-brain) — thin CLI over the @todak/memory SDK hybrid search.
 *
 * Repointed 2026-06-01: this previously embedded queries with OpenAI ada-002 and hit the FROZEN
 * legacy archive's `search_memories` RPC via SUPABASE_URL — returning stale results that LOOKED
 * live and quietly misled every caller. It now uses NeoBrain.search() → Gemini embeddings +
 * match_memories_hybrid_v2 against the live brain (NEO_BRAIN_URL / memories).
 */

require('dotenv').config();

function printHelp() {
  console.log(`
RAG Semantic Search (neo-brain)

Semantic + lexical hybrid search over the LIVE neo-brain memory store.

Usage: node rag-semantic-search.js [options] <query>

Options:
  --limit, -l      Number of results (default: 5)
  --threshold, -t  Min similarity 0-1 (default: 0.3 — hybrid RRF, lower than old cosine)
  --context, -c    Also print a plain context block for pasting into a prompt

Examples:
  node rag-semantic-search.js "what are Neo's active projects?"
  node rag-semantic-search.js -t 0.25 -l 10 "todak digitech migration status"
`);
}

(async () => {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) { printHelp(); process.exit(0); }

  const opts = { limit: 5, threshold: 0.3, context: false };
  const queryParts = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--limit' || a === '-l') opts.limit = parseInt(args[++i], 10) || opts.limit;
    else if (a === '--threshold' || a === '-t') opts.threshold = parseFloat(args[++i]);
    else if (a === '--context' || a === '-c') opts.context = true;
    else queryParts.push(a);
  }
  const query = queryParts.join(' ').trim();
  if (!query) { printHelp(); process.exit(0); }

  console.log('🔍 RAG Semantic Search (neo-brain)\n');
  console.log(`Query: "${query}"`);
  console.log(`Min similarity: ${opts.threshold} · limit: ${opts.limit}\n`);

  let NeoBrain;
  try {
    ({ NeoBrain } = await import('../packages/memory/src/index.js'));
  } catch (e) {
    console.error('❌ Could not load @todak/memory SDK:', e.message);
    process.exit(1);
  }

  let hits;
  try {
    const brain = new NeoBrain({ agent: 'rag-semantic-search-cli' });
    hits = await brain.search(query, { k: opts.limit, minSimilarity: opts.threshold });
  } catch (e) {
    console.error('❌ Search failed:', e.message);
    process.exit(1);
  }

  if (!hits || hits.length === 0) {
    console.log('❌ No similar memories found.');
    console.log('\n💡 Try a lower threshold (-t 0.2) or different keywords.');
    return;
  }

  console.log(`✅ Found ${hits.length} memories:\n`);
  hits.forEach((m, i) => {
    const date = m.created_at ? new Date(m.created_at).toISOString().slice(0, 10) : '?';
    const sim = m.similarity != null ? `${(m.similarity * 100).toFixed(1)}% sim` : (m.rrf_score != null ? `rrf ${m.rrf_score.toFixed(3)}` : '');
    console.log(`${i + 1}. [${sim}] ${m.category || '?'} · imp ${m.importance ?? '?'}/10 · ${date}`);
    console.log(`   ${(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 220)}\n`);
  });

  if (opts.context) {
    console.log('\n=== Context ===\n');
    hits.forEach((m) => console.log(`[${m.category || 'General'}] ${m.content}\n`));
    console.log('=== End Context ===');
  }
})();
