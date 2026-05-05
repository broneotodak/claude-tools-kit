# Siti Rebuild Focus CC Session Prompt

Paste below into a fresh Claude Code session as the first message when working on the **Siti rebuild** — the multi-week architectural project to replace the current monolithic Siti agent with a **Router + Specialists** architecture. Different from `SITI.md` (which is for working on the currently-paused agent in maintenance mode) — this prompt is for **building the replacement**.

**Before doing anything else, read `~/Projects/claude-tools-kit/WORKFLOW.md`** (canonical 5-phase work flow). Siti is `tier_1` in `project_registry.tier` — NORMATIVE rules apply. Plus read `~/Projects/claude-tools-kit/enforcement/CTK_ENFORCEMENT.md §9` (multi-session coordination) — this is shared-infra work, neo-brain memories table, agent_commands queue, and Siti's WhatsApp number all in scope.

---

You are scoped to the **Siti rebuild project**. Goal: replace the current 7000-line monolithic agent with a Router + Specialists architecture that scales without compounding complexity. The pattern you build here will be reused for every future WhatsApp agent (Academy, Studios, etc.).

## What's in motion right now

Siti is on **extended leave** since 2026-05-05. Don't unpause her. Live state on Siti VPS:

| pm2 process | State | Purpose |
|---|---|---|
| `siti` | **STOPPED** | The monolith, paused for the rebuild. Source code intact at `/home/openclaw/siti/server.js`. Don't restart. |
| `siti-ingest` | **online** | Listens on Siti's WA number (+60126714634). Saves all inbound to `nclaw_whatsapp_conversation` with embedding. Sends throttled BM/EN auto-reply to non-Neo DMs explaining the leave. ~150 lines, zero npm deps. **Keep it running** — it's accumulating the leave-window corpus. |
| `nclaw-wacli` | child of siti-ingest | Same Go binary. Don't restart unless cutting over to new Siti. |

`agent_registry`:
- `siti.meta.heartbeat_exempt = true` with `leave_started_at`
- `siti-ingest` row `status=active`, publishing heartbeats every 60s

## Why this rebuild exists (read once, internalize)

The audit on 2026-05-05 surfaced 8 structural issues. Top 3:

1. **Memory siloing**: `retrieveTwinMemories` excludes `wa-primary` etc. Siti can't see Neo's primary phone. Cross-agent visibility is broken by design.
2. **handleIncoming is one 700-line function** doing 8 distinct intent types in a single LLM call against a huge prompt with 44 tools. Each fix risks breaking another path.
3. **Recent context bleeding**: 15-msg history is undifferentiated. LLM treats Neo's earlier dictation as ground-truth context for unrelated later questions (today's "contractor explanation" incident).

The rebuild fixes all three by **decomposing**. Bandaids will be tempting; resist.

## The architecture (commit to this shape)

```
Inbound msg
    ↓
[1] Router (fast classifier — small LLM tiebreak OR pure rules)
      Emits ONE of 8 intent types based on:
      - The verb pattern in the message
      - Quote-reply context (evt.quotedId / evt.quotedBody — capture path
        landed today via siti PR #44+#45 + nclaw-wacli edit)
      - Sender permission tier (owner / admin / developer / contact)
      - Channel (DM vs group)
    ↓
[2] Specialist handler per intent — one of:
      VERDICT     → deterministic. Match verdict word + scope by quoted_msg_id.
                    Hit content_drafts or pr-awaiting-decision. NO LLM.
      TASK        → tiny LLM call. Extract task description. Fire submit_planner_task.
      CHAT        → focused LLM call. Tighter prompt. 5–10 filtered tools (NOT 44).
                    This is the only LLM-heavy specialist.
      MEDIA       → tool-only. Image analysis, voice transcription. No chat.
      GROUP_OP    → tool-only. summarize_group_chat / list_group_members.
      REMINDER    → tool-only. schedule_reminder.
      MEMORY_OP   → tool-only. search_twin_memory / save_twin_memory.
      IGNORE      → no reply. Group msg with no @-mention, etc.
    ↓
[3] Each handler returns a reply (or none) + emits memory writes
```

**Key design decisions**:

- **Most intents don't need an LLM.** VERDICT, REMINDER, GROUP_OP, MEDIA, MEMORY_OP are all deterministic given proper inputs. Only CHAT (and partially TASK) need LLM reasoning.
- **CHAT specialist gets a small, focused prompt** + 5–10 tools max. Not 44.
- **Router uses quote-reply context as primary signal.** When `evt.quotedId` is set, that's the strongest disambiguation — no need for LLM-based classification.
- **Future fine-tuned LLM (Phase 6 tr-home work) plugs in as the CHAT specialist's model** later. Config swap, not refactor.

## Week-by-week plan (3 weeks · adjust as needed)

### Week 1 — Build the Router (parallel-log mode)
- New `siti-router/` directory in the siti repo (or new repo if cleaner).
- Implements rule-based classifier: regex + permission lookup + quote-reply check.
- LLM-tiebreak path for ambiguous cases (when rules say "could be CHAT or TASK").
- **Run in parallel-log mode**: hook into siti-ingest's event stream as a non-acting observer. Log "what the router would have classified as" for every inbound. Validate against actual user intent (manual review of 50–100 logged events).
- **Don't act on router decisions yet.** This week is purely about classification accuracy.

### Week 2 — Extract deterministic specialists
- VERDICT, REMINDER, GROUP_OP, MEDIA, MEMORY_OP, IGNORE.
- Each is a small module (~50–150 lines).
- Integrate with siti-ingest as a dispatcher: router classifies → specialist handles → reply emitted.
- **Cutover for these 6 intent types**: siti-ingest gains specialist responses for these. CHAT-bound messages still get the leave auto-reply for now.
- Validation: any message that previously would have used the LLM but is now handled deterministically should have produced a correct response. Log + spot-check.

### Week 3 — CHAT specialist (the LLM-heavy one)
- Focused system prompt (target: <1500 chars vs current ~6000).
- Filtered tool injection: only 5–10 most relevant tools per message context.
- Tighter retrieval scope: per-contact recall + person profile + group context. Drop the kitchen-sink approach.
- **Cutover to full new Siti**: siti-ingest stops, new siti starts. All 8 intent types covered.
- Soak window: watch incident rate. Should be dramatically lower than current.

### Week 4 (buffer)
- Triage anything that surfaces during soak.
- Save a `shared_infra_change` memory of the rebuild outcome.
- Update `prompts/focus/SITI.md` to reflect the new architecture.
- Plan the next replication (Academy, Studios) using the same template.

## Hard rules — DO NOT violate

1. **NEVER unpause the old `siti` pm2 process** during the rebuild. It's intentionally stopped. The rebuild ships separately and replaces it via cutover. Old siti stays as a fallback that we don't re-engage.
2. **NEVER stop or modify `siti-ingest`** unless you're doing the final cutover. It's the data pipeline; if it goes down, the leave-window corpus has gaps.
3. **NEVER add a new tool, intent type, persona feature, or capability that wasn't in the original 8-intent decomposition** without explicit operator (Neo) approval. Every "while I'm here, let me also add X" is what created the original mess. Resist.
4. **NEVER bypass quote-reply scoping for verdicts.** PR #44+#45 establish that pattern. Anything new that takes user intent must use `evt.quotedId` / `metadata.quoted_msg_id` for disambiguation.
5. **NEVER hardcode infrastructure facts in prompts.** Today's intro-leak incident proved this. Server IPs, dashboard URLs, project_refs, model SKUs — they belong in env / config or behind a tool, not in the system prompt.
6. **NEVER read or write to memories without going through neo-brain SDK or a documented helper.** Per global CLAUDE.md, raw SQL is forbidden on neo-brain. Use `claude-tools-kit/lib/heartbeat.mjs` style fetch+REST helpers if needed.
7. **For shared-infra changes** (writing to memories, agent_commands, agent_registry, content_drafts, pr-awaiting-decision metadata): run the CTK §9 pre-flight check + write a `shared_infra_change` memory with the change record. Same hour. Mandatory.

## Constraints — what's available now

- **Codebase**: `~/Projects/siti/` — main branch is the (paused) old Siti. `siti-ingest/` subdirectory is the live leave-mode listener. New router + specialists go alongside, OR in a new repo `broneotodak/siti-v2` if you prefer fresh history. Recommend siti-v2 repo for clean separation; old siti repo stays for archive / reference.
- **wacli**: `/home/openclaw/nclaw-wacli/` on Siti VPS (Go binary). Forwards `evt.quotedBody` (added today). Don't modify unless absolutely required — file is currently NOT git-tracked, edits-in-place. Bigger fix: get nclaw-wacli into a real git repo first if you need to change it.
- **Memory**: neo-brain Supabase project `xsunmervpyrplzarebva`. Tables you'll touch: `memories` (with embedding via Gemini `gemini-embedding-001`, 768 dims), `agent_heartbeats`, `agent_commands`, `agent_registry`, `content_drafts`, `pr-awaiting-decision` rows in memories.
- **Models**: Gemini 2.5 Flash + OpenAI gpt-4o-mini (current). Future: local fine-tuned LLM on tr-home (Phase 6, separate project — Step 9 Shadow Soak ongoing). Plan for the swap but don't depend on it.
- **Test environment**: there's no staging Siti currently. Test against a separate test number, OR use the parallel-log mode in week 1 to validate without affecting production.

## Stakeholders

- **Neo** — single operator, single decision-maker. All architectural calls route through him.
- **Kak Riz, Kang N, others** — real Siti users currently receiving the leave auto-reply. They'll be on the receiving end of the new Siti. Not stakeholders for design but ARE stakeholders for behavior change.
- **Lan** — knows the original CCC fork lineage (since Siti's WA bridge code descends from it). Not actively involved unless infra questions surface.

## Cross-references — read these neo-brain memories early

- `93bf76ca` (today, 2026-05-05): the leave-start `shared_infra_change` memory. Full context of why we paused.
- `befc9797` (today): the deploy of PR #44 (quote-reply scoping for draft approval) and PR #45 (wacli quotedBody).
- `09446e10` (today): nclaw-wacli main.go changes + Siti's quote-reply consumer side.
- `feedback_naca_siti_no_assumptions`: the standing rule — verify Siti's actual state before changing anything.
- `feedback_verdict_sharded_implementations`: history of how verdict-matching logic split across 3 files and broke once. Avoid recreating that.
- `feedback_knowledge_vs_state_queries`: semantic search for knowledge, deterministic DB lookup for state. The router classifier should respect this — state queries go to deterministic specialists, not the LLM.
- `siti_architecture` (multiple): the snapshot of the current/old Siti from 2026-05-03+. Reference for what to AVOID copying.

## Memory discipline (when shipping anything during the rebuild)

- **Category**: `shared_infra_change` for any prod-affecting change (DB schema, deploy, agent_registry update). `project_siti_v2` for milestone notes (router shipped, specialist N extracted, etc.).
- **Scope**: `ops` for cutover ops; `fleet` for architectural decisions affecting future agents.
- **Importance**: 9 for the final cutover (high blast radius — Siti is back online for real users). 8 for major specialists shipping. 6–7 for routine module extractions.
- **Always include**: the design choice + alternatives considered + why we picked this. Future-you will thank you.

## First-90-seconds debug entry points

- **"Where's the new Siti running?"** — wherever you set up. Probably siti-v2 repo cloned on the VPS, started under a new pm2 name. Old `siti` stays stopped.
- **"Is siti-ingest still alive?"** — `pm2 list` should show it online; `agent_heartbeats.siti-ingest` row should be <60s old.
- **"Did messages stop landing?"** — `SELECT MAX(created_at) FROM memories WHERE source='nclaw_whatsapp_conversation' AND metadata->>'during_leave'='true'` — should be recent.
- **"Router says X but specialist did Y"** — that's the parallel-log validation surfacing a mismatch. Log line + raw evt should be enough to reproduce.

## Tone

This is methodical work, not heroic work. The point is to NOT be in fire-fighting mode. If you find yourself tempted to "just patch this one thing real quick" — that's the impulse that built the mess. Resist. PR each module. Test each module. Cutover only when soak says it's safe.

Three weeks is a real budget, not a goal. Take longer if needed. Quality bar matters more than calendar bar — Siti is load-bearing for Neo's daily work, and once she's back, she needs to stay reliable.
