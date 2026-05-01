# CTK Enforcement — SOP for every Claude Code instance

This file lives in git so VPS agents and remote CC instances inherit the same rules. **Loaded on demand**, not at session start. Read it before: data operations, commits to a new repo, monitoring/alert work, or storing user-supplied credentials.

Last consolidation: 2026-04-26 (slimmed from 276 lines; trigger lookups and capability marketing removed — modern Opus picks tools by judgment).

---

## 1. Core Discipline

- **No assumptions.** Verify with code, schema, samples, or git — never reason from "it should be."
- **Find the root cause.** A hardcoded patch IS the bug. If you can't reach the root in this session, surface it; don't paper over it.
- **Read existing tools before writing new ones.** Check `~/Projects/claude-tools-kit/tools/` and the project's own `scripts/` first.
- **Test before deploy, verify before claiming done.** A passing typecheck is not a passing feature.
- **Don't ignore "save progress" requests.** See section 3.

If you violate any of these: stop, acknowledge, correct, and save the correction to memory so the next session inherits the lesson.

### 1.1 Diagnostic discipline (added 2026-04-26)

When investigating "why isn't X happening?", walk the full data scope before narrowing:

1. **Inventory first** — list the universe (all rows, all groups, all configs) before filtering by hypothesis.
2. **Cross-reference second** — compare what's expected (config/schema) vs what's actually present.
3. **Filter last** — only narrow once you've established what the universe contains.

Filter-first reasoning ("does Roslan exist? no → he must not be in the group") hides every case your hypothesis didn't predict. The bug you find is rarely the bug you assumed.

**Originating incident** (2026-04-26): During a Siti debugging session, Roslan/AbgLord/Rokiah returned 0 messages from a `pushName ILIKE` search. Claim made: *"Siti must not be in that group."* One query against `nclaw_contacts` would have shown Siti IS in "Todak Fantasy ADMIN" with admin permission. The actual bug was wacli dropping messages despite the bot's group membership — a fundamentally different problem with a different fix path. Filter-first reasoning hid the real failure mode and wasted user trust.

---

## 2. Database Discipline

| DB | Project Ref | Purpose |
|---|---|---|
| **neo-brain** (PRIMARY memory) | `xsunmervpyrplzarebva` | Memory backend since 2026-04-19. Use `@todak/memory` SDK. |
| Memory pgVector (LEGACY) | `uzamamymfzhelvkwpvgt` | Old `claude_desktop_memory` — read-only archive. No new write consumers. |
| THR / ATLAS | `ftbtsxlujsnobujwekwx` | Shared HR + Asset DB |
| Academy | `hgdlmgqduruejlouesll` | Todak Academy portal |
| AskMyLegal | `yvxpggnbvuwgwsmsubtr` | Legal AI (planning) |
| Musclehub | `jxcddfejjqqynekbpdxh` | Archived |

**NEVER mix these.** The DB names are random — model can't infer which to use.

**NEVER use `psql` with `PGPASSWORD`.** Use the SDK or `tools/run-sql-migration.js`.

**Before any data operation:**
1. Preview 5 sample rows: `SELECT * FROM table LIMIT 5;`
2. Count what will change: `SELECT COUNT(*) FROM table WHERE <condition>;`
3. Then proceed.

Bulk operations without preview have caused real damage (THR 2025-07-15: 27 employees assigned to wrong organizations, 138 with scrambled names — root cause was assuming employee-ID prefixes mapped to specific orgs).

---

## 3. Memory Discipline

**Primary path: neo-brain via SDK**, not direct queries.

- JS: `import { NeoBrain } from '@todak/memory'` — package at `~/Projects/claude-tools-kit/packages/memory/`
- Python: `from neo_brain_client import NeoBrain` — `tools/neo_brain_client.py`
- Env: `NEO_BRAIN_URL`, `NEO_BRAIN_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` (in `~/Projects/claude-tools-kit/.env`)
- **Always pass `agent: 'instance-name'`** when constructing `NeoBrain` — appears in `memory_writes_log` for audit
- Default `visibility: 'private'`. Tag `'public'` only for content meant to be retrievable in shared contexts.
- Neo's self-id: `00000000-0000-0000-0000-000000000001`

**CLI (dual-writes legacy for compat):**
```bash
node ~/Projects/claude-tools-kit/tools/save-memory.js "Category" "Title" "Content" 6
```

**When to save proactively** (don't wait for "save progress"):
- A migration completes (data moved, schema changed)
- A production deploy succeeds (push → CI green → user confirms it works)
- A non-trivial feature lands (new tool, endpoint, UI tab)
- A bug fix the user flagged as concerning or important
- A long workstream changes direction ("now let's do X")
- The user signs off ("sleep", "afk", "bye")

If ≥5 significant changes since the last save: just save and mention it in one line. No ceremony.

**Don't write a fill-in-the-blank template.** Capture what was accomplished, key decisions, problems solved, next steps. Length follows substance.

### 3.5 Doc/Memory Pattern (added 2026-04-26)

Don't duplicate progress notes between memory and code. Each goes to its natural home:

- **Tech specs** (architecture, schemas, API contracts) → repo: HTML deck or per-project README
- **Decisions / context** (why X over Y, who approved, when to revisit) → neo-brain memory
- **Progress notes** (what landed in this PR) → commit body or PR description, NOT a separate memory entry

If tempted to duplicate: write the spec in repo, link to it from memory. Future-you reading code goes to repo; future-you searching for context goes to memory. Same write in two places means both rot at different rates.

---

## 4. Credential Vault (added 2026-04-24)

When the user shares a credential (password, API key, token, SSH key, PIN), store it in neo-brain `credentials` via the `upsert_credential` RPC — **never** in memory files, `.env` files, or source. The plaintext is encrypted in Supabase Vault; only the `vault_secret_id` pointer sits in the row.

**Store:**
```sql
SELECT upsert_credential(
  p_owner_id := '00000000-0000-0000-0000-000000000001'::uuid,  -- NEO_SELF_ID
  p_service := '<lowercase-slug>',     -- 'tdcc', 'netlify', 'openai'
  p_credential_type := '<kind>',       -- 'password', 'api_key', 'ssh_key', 'pin', 'service_role'
  p_value := '<plaintext>',
  p_description := '<context>',
  p_environment := 'production',
  p_metadata := jsonb_build_object('url', '...', 'username', '...', 'saved_by', 'claude-code-session')
);
```

**Read:**
```sql
SELECT credential_value FROM get_credential(
  p_owner_id := '00000000-0000-0000-0000-000000000001'::uuid,
  p_service := '<slug>',
  p_credential_type := '<kind>'
);
```

**In memory files**, reference by lookup key only — e.g. `"password stored in neo-brain credentials: service='tdcc', type='password'"`. NEVER write plaintext to disk.

**Why:** plaintext in memory files gets replicated into pgVector embeddings and across machines on sync. Vault routing keeps the vector layer secret-free.

---

## 5. Pre-Commit Secrets (added 2026-04-25)

**Before the FIRST `git commit` on any new repo**, verify:

1. `.gitignore` covers: `node_modules/`, `.env`, `.env.*`, `*.key`, `*.token`, `secrets/`, session/auth state files, `*.bak`, `*.log`
2. `git status --ignored` confirms secrets show as ignored, not staged
3. `git diff --cached | grep -iE 'API_KEY|SECRET|TOKEN|PASSWORD'` is empty
4. Stage explicit files (`git add server.js package.json …`), never `git add .`

**Migrating an existing dirty repo:** start fresh in a parallel clean tree (git init → rsync minus secrets → push to new repo → delete old). Don't filter-repo unless commit history must be preserved — fresh start is simpler.

**Originating incident** (2026-04-25): Siti's `nclaw-dashboard` initial commit included `.env` with Supabase service_role + Anthropic + OpenAI + Gemini + ElevenLabs + Telnyx + neo-brain service_role keys. Repo was private and sole collaborator was Neo so the leak was contained — but had to migrate to a clean `broneotodak/siti` repo and delete the old one.

---

## 6. Monitoring Discipline

Full procedure: **`MONITORING_ENFORCEMENT.md`** in this folder. Read it before any alert, supervisor rule, push monitor, dashboard health card, or auto-action.

The short version:
1. Read the source code that produces the signal
2. Synthetic-test both edges (good→bad AND bad→good)
3. If push monitor: wire the pusher in the same change
4. Dry-run ≥24h before any auto-action

**Originating incident** (2026-04-25): supervisor rules built around `agent_heartbeats.meta.wa_status` — a raw baileys event-type string, not real health. 49 false fires overnight. 75% of dashboard red lights were noise.

A monitor that exists is not a monitor that works.

---

## 7. Tool Index

Universal tools at `~/Projects/claude-tools-kit/tools/`:

| Tool | Use |
|---|---|
| `save-memory.js` | Save to neo-brain (dual-writes legacy for compat) |
| `check-memory-health.js` | Memory diagnostics |
| `run-sql-migration.js` | SQL runner with preview & rollback |
| `safe-data-migration.js` | Safe wrapper for bulk ops |
| `ctk-enforcer.js` | Interactive validation (legacy — modern Opus rarely needs this) |
| `machine-detection.js` | Standardized machine names |
| `db-introspect.js` | Schema explorer |
| `neo-brain-quick-stats.js` | Live counts for startup banner |
| `check-latest-activities.js` | Recent activity / context recovery |

Project-specific configs: `~/Projects/claude-tools-kit/projects/<name>/config.json`.

---

## 8. Working with Other CC Instances

These rules also govern: dev-agents on Siti VPS, scheduled remote CC agents, future Digitech fleet, NACA agents, the TDCC instance for Kamiera (when adopted). Each instance must:

- Pull this repo so `enforcement/` stays in sync
- Pass a unique `agent:` label when writing to neo-brain
- Respect the same DB-discipline + secrets-discipline rules

If you find this file out of sync with reality, fix it here (single source) — don't fork it locally.

---

## 9. Multi-Session Coordination (added 2026-05-01)

When MULTIPLE Claude Code sessions are working in parallel on the NACA fleet, they can ship code that races in production. Today's bug pattern: Session A built poster-agent, Session B built timekeeper-agent — neither tested alongside the other, and on first production run they raced for the same `scheduled_actions` rows. 3 daily-content posts stuck pending for 1+ hour; Siti hallucinated success when asked "is it posted yet?".

**SHARED INFRA — coordinate before touching:**

Tables: `scheduled_actions`, `agent_commands`, `agent_intents`, `agent_heartbeats`, `content_drafts`, `memories`, `nclaw_contacts`, `gam_audit`.

Code paths: any RPC poller (timekeeper, poster-agent, dev-agent, planner-agent, supervisor, verifier, toolsmith), webhook-relay, NACA gam gateway, retrieveTwinMemories callers, Siti tool handlers.

**Pre-flight checklist before editing shared infra:**

1. Search neo-brain for recent shared-infra changes:
   ```js
   await brain.from('memories')
     .select('content,created_at,metadata')
     .eq('source', 'claude_code')
     .eq('category', 'shared_infra_change')
     .gte('created_at', new Date(Date.now() - 7 * 86400e3).toISOString());
   ```
2. Check `agent_heartbeats` — confirm no agent restarted in last 60 min (signal of active parallel work).
3. If ambiguous: post a 3-line "intent" note in conversation: *"about to modify TABLE/AGENT — anything in flight I should know?"* and let Neo flag conflicts.

**Post-deploy: leave a discoverable changelog.** After shipping changes that touch shared infra, save a memory note:

```bash
node ~/Projects/claude-tools-kit/tools/save-memory.js \
  "shared_infra_change" \
  "<short title>" \
  "<what changed, why, what consumers/producers are affected>" \
  6
```

Tag `category: shared_infra_change` so future sessions can search-filter. List affected tables and agents in the body.

**Conflict mid-session.** If you notice another session's recent change conflicts with your plan: **stop**, read the other session's most recent shared_infra_change memory, ask Neo whether to merge or sequence — don't ship in parallel without explicit reconciliation.

**Safety net.** `tools/stuck-command-monitor.js` runs on CLAW cron every 5 min and alerts Neo via Siti `/api/send` when `agent_commands` are stuck `pending > 10min` or `running > 15min`. This catches cross-session races in <5 min instead of 1+ hour. Don't rely on the monitor as a substitute for pre-flight discipline — it's the last line, not the first.

**Originating incident** (2026-05-01): Siti claimed "approved → posting to tiktok, linkedin, instagram in ~10s" but timekeeper-agent claimed all 3 SAs before poster-agent could fire them. Commands sat pending 1+hr. When Neo asked "is it posted yet?", Siti's pure-semantic memory recall surfaced an unrelated old success (academy logo PR done Apr 28) and presented it as if THIS draft posted — pure hallucination from cross-domain noise. Full evidence: neo-brain memory `065d6128-84e3-4b47-9d4a-e80fb7e0160a`.
