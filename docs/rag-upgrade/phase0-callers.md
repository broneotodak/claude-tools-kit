# Phase 0 · neo-brain Retrieval Caller Audit

**Generated:** 2026-05-15 (Phase 0 of RAG upgrade arc, after the 2026-05-14 memory-hygiene pass that cleared 420 orphan NULL embeddings)
**Status:** READ-ONLY discovery. No code changes in Phase 0.
**Memory state at audit time:** 14,128 rows total, 0 NULL embeddings on knowledge categories.

## Headline finding

**Three different `match_memories*` RPCs are reachable in production paths**, and at least four distinct caller layers exist. The JS SDK and the Python client diverge on which RPC they invoke. Any Phase-1 retrieval upgrade has to consolidate these — or accept that "improving retrieval" means improving N independent code paths.

| RPC variant | Used by | Behaviour |
|---|---|---|
| `match_memories` (vanilla) | JS SDK `NeoBrain.search()`, naca `@naca/tools/recall.js`, naca `lookup-resource.js`, naca-monitor | Returns top-K by cosine similarity across all sources |
| `match_memories_curated` | Python `NeoBrain.search()`, siti-v2 `dispatch-deps.searchMemory`, `claude-startup-context.js` | Excludes WA conversation sources (`wa-primary`, `nclaw_whatsapp_conversation`, `twin-ingest`) — knowledge-only retrieval |
| `match_memories_hnsw` + friends | `optimizations/*` directory only (one-shot HNSW migration scripts) | NOT live in any production path — historical experiment |

## Live retrieval callers (the surface that matters for Phase 1)

| # | File:line | Layer | RPC | Query shape | Filters used |
|---|---|---|---|---|---|
| 1 | `claude-tools-kit/packages/memory/src/client.js:50` | SDK class (`NeoBrain.search`) | `match_memories` | `query_embedding`, `match_count`, `min_similarity` | `visibility_filter`, `p_subject_id`, `source_filter` |
| 2 | `claude-tools-kit/tools/neo_brain_client.py:160` | Python SDK (`NeoBrain.search`) | `match_memories_curated` | `query_embedding`, `match_count`, `min_similarity` | `visibility_filter`, `p_subject_id` · note: `source=` deprecated, ignored |
| 3 | `claude-tools-kit/tools/claude-startup-context.js:111` | Raw `supabase.rpc()` | `match_memories_curated` | `query_embedding`, `match_count`, `min_similarity` | `visibility_filter` |
| 4 | `siti-v2/src/daemon/dispatch-deps.js:439` (`searchMemory`) | Raw `rpc()` helper | `match_memories_curated` | `query_embedding`, `match_count` | (none beyond defaults) |
| 5 | `naca/packages/tools/src/recall.js:38` | Raw `rpc()` helper | `match_memories` | `query_embedding`, `match_count`, `min_similarity` | tier-conditional |
| 6 | `naca/packages/tools/src/lookup-resource.js:80` | Raw `rpc()` helper | `match_memories` | `query_embedding`, `match_count: 15` | (none beyond defaults) |
| 7 | `naca-monitor/*` | (via `@naca/core` rpc helper) | indirect | n/a (read paths only) | n/a |
| 8 | `claude-tools-kit/packages/memory/scripts/{search-demo,verify-connection,smoke}.mjs` | SDK demo scripts | `match_memories` | `k:3-4` | none |

## Historical / one-shot scripts (NOT live)

| File:line | Purpose | Status |
|---|---|---|
| `optimizations/analyze-pgvector-setup.js:114` | Analysis tool | unused since HNSW experiment closed |
| `optimizations/apply-hnsw-indexes.js:148+` | Apply HNSW migration | one-shot, ran 2025-Q4 |
| `optimizations/pgvector-performance-benchmark.js:71+` | Benchmark | invoke manually only |
| `optimizations/update-memory-queries.js` | sed-rewrite tool | one-shot migration helper |

## Non-retrieval callers of the `memories` table (CRUD, listed for completeness)

The audit also surfaced ~30 places that hit `from('memories')` for *non-retrieval* purposes — counts, lookups by id, inserts, updates. These don't affect Phase 1 retrieval quality but are listed here for context:

- **Inserts (write path):** `tools/{save-memory,supervisor-agent,backfill-missing-embeddings}.js`, `siti/server.js`, `_siti-stepb/server.js`, `dispatch-deps.js`, fleet agents
- **Counts/health:** `tools/{check-project-health,neo-brain-quick-stats,cross-session-drift-monitor,stuck-command-monitor}.js`
- **Updates/repair:** `tools/wa-person-merge.js`, `migrate-to-neo-brain.js`
- **Dataset extraction:** `tools/dataset-pipeline/extract.js`
- **Legacy `claude_desktop_memory` table:** referenced in `fixes/fix-machine-names.js` + several `.md` files; pre-2026-04 archive, read-only.

## SDK defaults (the baseline target)

From `packages/memory/src/client.js:40-60`:

```javascript
async search(query, opts = {}) {
  const {
    k = 5,                                              // top-5
    visibility = ["public", "internal", "private"],     // all
    subjectId = null,
    source = null,
    minSimilarity = 0.35,                               // cosine threshold
  } = opts;
  // → match_memories RPC
}
```

`embedText()` uses **`gemini-embedding-001`** at **768 dimensions**, content sliced to **2048 chars** before embed call.

## Architectural observations (notes for Phase 1 planning, NOT changes here)

1. **RPC divergence is real.** The Python and Siti paths use `match_memories_curated` (filters out conversation-capture sources). The JS SDK and `@naca/tools` use plain `match_memories` (sees everything). If a CHAT specialist asks Siti's twin "what did Neo say about X?" via the Python path, it gets curated results — but a parallel call from `@naca/tools/recall.js` gets uncurated. Same user-perceived feature, different results.

2. **Raw `rpc()` bypass of the SDK class is common.** `@naca/tools`, `siti-v2/dispatch-deps`, and `claude-startup-context.js` all skip the `NeoBrain` class and call `rpc('match_memories'...)` directly. They miss the SDK's input validation but more importantly, future SDK improvements (caching, reranking, hybrid keyword+vector, etc.) won't reach them automatically. **Layer 2 of the memory-discipline arc** (`@naca/core.saveKnowledgeMemory`) parallels this for writes — a `@naca/core.semanticRecall` or similar would close the gap on reads.

3. **There's no caching anywhere.** Every search call hits Gemini for embedding + PostgREST for RPC. For Siti where the same group's CHAT specialist may ask similar questions seconds apart, this is wasteful.

4. **`match_memories_curated` source-exclusion list is hardcoded inside the RPC** (Postgres function body, not a column flag). Adding a new conversation-capture source requires a DB migration to update the RPC. Same anti-drift smell as the refactor-v2 "no hardcoded agent-name list" rule — at the RPC level instead of the application level.

5. **No keyword/BM25 fallback.** If a query happens to have weak semantic similarity (rare terminology, acronyms, exact-match needs like agent_command IDs), pure vector search misses. Phase 1 hybrid retrieval would address this.

6. **Top-K seems small.** k=5 default is aggressive for a 14K-row corpus. The naca `lookup-resource.js` uses k=15 already; siti uses defaults. Inconsistent.

## Phase 0 next steps (after this doc)

- Build eval set (30 real questions) — `eval/neo-brain/eval-set-v1.json`
- Run baseline through `NeoBrain.search()` defaults — `eval/neo-brain/run-baseline.js`
- Compute recall@5, recall@10, MRR — `eval/neo-brain/baseline-<date>.json` + `.md`
- Save `shared_infra_change` memory documenting Phase 0 deliverables
- Brief Neo with the numbers + surprises
