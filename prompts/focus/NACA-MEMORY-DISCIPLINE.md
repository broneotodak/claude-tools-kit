# NACA Memory Discipline — Focus CC Session Prompt

Paste below into a fresh Claude Code session as the first message when working on **NACA fleet-agent memory-save discipline**. Job: stop fleet agents from writing *knowledge* memories via raw PostgREST (which skips the Gemini embedding step) and route them through the SDK instead. Event/operational writes can keep raw POSTs.

**Before doing anything else, read** `~/Projects/claude-tools-kit/WORKFLOW.md` (canonical 5-phase work flow) and `~/Projects/claude-tools-kit/enforcement/CTK_ENFORCEMENT.md` (§3 memory discipline, §9 multi-session coordination). Tier_1 normative — branch + PR + admin merge for every change.

---

You are scoped to **NACA fleet-agent memory-save discipline**. Today's date: 2026-05-14. The 2026-05-14 audit ([memory `memory_audit` 2026-05-14], CTK PR #58) found that 420 *knowledge-category* memories had been written with NULL embeddings — meaning semantic recall silently misses them. Root cause: 7+ fleet agents write directly via PostgREST instead of through `@todak/memory`'s `nb.save()` (which calls Gemini for embedding before insert). The backfill PR #58 healed the 420 orphan rows; this session ships the **architectural fix** so new writes don't reopen the gap.

## Context links to read FIRST

1. CTK PR #58 (backfill) — see commit message for the full root cause analysis
2. `~/Projects/claude-tools-kit/tools/backfill-missing-embeddings.js` — has the canonical `EVENT_CATEGORIES` allowlist
3. `~/Projects/claude-tools-kit/packages/memory/src/client.js` — `nb.save(content, opts)` is the gold-standard pattern
4. `~/Projects/claude-tools-kit/packages/memory/src/gemini.js` — `embedText` exported helper

Semantic-search at session start:
```js
nb.search('memory audit NULL embedding fleet agents 2026-05-14', { limit: 6 });
nb.search('SDK save direct PostgREST embedding fleet', { limit: 4 });
```

## What needs to change · per-agent surface

The fleet agents currently writing knowledge memories via raw PostgREST POSTs. For each, identify the **knowledge writes** (need SDK) vs **event writes** (keep raw POST, append to `EVENT_CATEGORIES`).

| Agent | Repo | File(s) | Knowledge categories (route through SDK) | Event categories (keep raw POST) |
|---|---|---|---|---|
| `supervisor-agent` | `claude-tools-kit` (tools/) | `tools/supervisor-agent.js` | `supervisor` (T1 stubs, demoted-T3, incidents) | `supervisor-observation`, `fleet-node-discovered` |
| `planner-agent` | `planner-agent` (own repo, runs on tr-home pm2) | `index.js` | `planner_decomposition` (recallSimilarPlans depends on this!) | (none yet) |
| `verifier-agent` | `verifier-agent` (own repo, runs on NAS Docker) | `index.js` | `deploy-verified`, `deploy-failed-verification` | `pr-stuck-reminder` |
| `pr-decision-dispatcher` | `claude-tools-kit` (tools/) | `tools/pr-decision-dispatcher.js` | `pr-decided`, `pr-awaiting-decision` | `pr-decision-recorded` |
| `naca-monitor` | `naca-monitor` (own repo, runs on Siti VPS pm2) | source files | (verify) | `naca_monitor_snapshot` (already a huge volume; correct) |
| `daily-checkup-agent` | `daily-checkup-agent` (own repo, runs on NAS Docker) | `index.js` | (verify) | `daily_checkup_run` |
| `dev-agent` | `dev-agent` (own repo, runs on tr-home pm2) | `index.js` | `dev_agent_pr` (PR-decision records) | (verify) |
| `siti-router` / `siti-ingest` | `siti-v2` | `src/interface/*` | look for direct `memories` inserts | `digest_queue` |
| `reviewer-agent` | `reviewer-agent` (own repo, runs on tr-home pm2) | `index.js` | review verdicts | (verify) |

For each agent's `rest('memories', { method: 'POST', body: ... })` call:
1. Determine the `category` value.
2. If in `EVENT_CATEGORIES` (audit logs / snapshots / heartbeats) → leave as raw POST.
3. Else (knowledge) → switch to SDK.

## Two architectural options

### Option A: Each agent imports `@todak/memory` directly

```js
import { NeoBrain } from '@todak/memory';
const nb = new NeoBrain({ agent: AGENT_NAME });
await nb.save(content, { category, type, importance, metadata });
```

Pros: standard pattern, no new helper needed, embedding handled inside SDK.
Cons: each agent gains a new dependency; needs `GEMINI_API_KEY` in env on every host.

### Option B: `@naca/core` exposes a `saveKnowledgeMemory()` helper

`packages/core/src/memory.js`:
```js
import { embedText } from '@todak/memory';
import { insertRow } from './postgrest.js';

export async function saveKnowledgeMemory({ content, category, type, importance = 6, source, metadata = {}, subjectId = NEO_SELF_ID }) {
  if (!category || !type) throw new Error('saveKnowledgeMemory: category and type required');
  const embedding = await embedText(content);
  const embStr = `[${(embedding || []).join(',')}]`;
  return insertRow('memories', {
    content, category, memory_type: type, importance,
    visibility: 'private', source, embedding: embStr,
    metadata, subject_id: subjectId,
  });
}
```

Pros: single helper for all agents; agents already import `@naca/core`; future changes (e.g. switch embed provider) happen in one place.
Cons: thin wrapper around the SDK; some duplication of save-shape between `@naca/core` and `@todak/memory`.

**My recommendation: Option B.** Smaller per-agent diff (just swap the function name), centralised helper means embedding policy can evolve in one place, and `@naca/core` is the right home for "infra agents share."

## Migration order (suggested)

1. Add `saveKnowledgeMemory` to `@naca/core` (or pick Option A — that's the design decision to lock first).
2. Migrate **supervisor-agent.js** (CTK) — it's been writing wrong since 2026-05-13's demote-on-repeat work I shipped today.
3. Migrate **planner-agent** — `planner_decomposition` recall is THE feature that depends on this; embedding lift would be huge.
4. Migrate **verifier-agent** — `deploy-verified` rows benefit from semantic recall ("similar past deploys that worked").
5. Migrate **pr-decision-dispatcher** — `pr-decided` rows.
6. Smaller ones (dev-agent, siti-router knowledge writes, etc.).
7. After all migrate: run the backfill script one more time with `--limit 100` as a probe — if it finds anything new, that agent missed a code path.
8. Re-run with no args (full sweep) — should report 0 knowledge rows still NULL.

## Hard rules

1. **Don't touch event-category writes.** `naca_monitor_snapshot` writes ~1200/day and IS designed to be high-volume operational data — embedding 6600+ rows is a real Gemini cost (~$5+). Verify the category is in `EVENT_CATEGORIES` before deciding "fix needed."
2. **Don't break existing knowledge writes.** The categories listed above already have past rows now correctly embedded (after PR #58). New writes must keep the same shape.
3. **Shared-infra protocol.** `memories` is shared NACA infra. Per CTK Enforcement §9: pre-flight check before deploy, `shared_infra_change` memory after.
4. **Test with one agent first.** Migrate supervisor first (already deployed via launchd on CLAW — fast feedback loop). Verify next supervisor cycle's T1/T3 writes have non-NULL embedding. Only then migrate the rest.
5. **Don't pre-decide the design for Neo.** Surface Option A vs B and let him pick. (My recommendation = B, but Neo defaults to *Full-build (C)* per feedback memory.)
6. **No hardcoded agent lists in new helpers.** The refactor v2 (Agent Plug & Play) rule applies — if any registry / list of agents is needed, derive from `agent_registry`. The CI lint guard (`scripts/lint-no-hardcoded-agents.sh`) will catch you.

## Deploy paths per host (reminder)

| Agent | Host | Deploy |
|---|---|---|
| supervisor-agent | CLAW (launchd) | `ssh zieel@100.93.159.1` → git pull in `~/Projects/claude-tools-kit`. launchd reloads on next 60s cycle. |
| planner-agent | tr-home (pm2 as `neo`) | `ssh neo@100.126.89.7` → cd `~/Projects/planner-agent` → git pull → `pm2 restart planner-agent` |
| verifier-agent | NAS Docker | `scp -O index.js Neo@100.85.18.97:/volume1/homes/Neo/agents/verifier-agent/` → ssh + `docker compose up -d --build` |
| pr-decision-dispatcher | CLAW (launchd) | git pull in CTK — same as supervisor |
| dev-agent | tr-home (pm2) | same shape as planner-agent |
| reviewer-agent | tr-home (pm2) | same shape |
| naca-monitor | Siti VPS (pm2) | `ssh root@178.156.241.204 "su - openclaw -c 'cd ~/naca-monitor && git pull && pm2 restart naca-monitor'"` |
| daily-checkup-agent | NAS Docker | scp + docker compose up -d --build |

## Verification per agent

After each migration:
1. Watch the agent's next cycle log for any error.
2. Query neo-brain: `embedding IS NULL` count for that agent's `source` value should stop growing for knowledge categories.
3. Spot-check a fresh row's `embedding` column directly via PostgREST.

## Pointers

- `~/Projects/claude-tools-kit/WORKFLOW.md` — 5-phase work flow
- `~/Projects/claude-tools-kit/enforcement/CTK_ENFORCEMENT.md` — §3 memory discipline, §9 shared infra
- `~/Projects/claude-tools-kit/tools/backfill-missing-embeddings.js` — the EVENT_CATEGORIES allowlist + working SDK-embed pattern
- `~/Projects/claude-tools-kit/packages/memory/src/{client,gemini}.js` — SDK internals
- `~/Projects/naca/docs/spec/agent-registry-schema-v1.md` — refactor v2 / Agent Plug & Play context (helps you avoid re-introducing hardcoded agent lists)
- Audit milestone memory (search neo-brain `memory audit 2026-05-14`)
- Feedback memory `feedback_ctk_enforcement_drift.md` (auto-memory) — why this matters beyond the 420 rows
