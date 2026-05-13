# CTK — Claude Code Toolkit

Generic toolbox for every Neo Claude Code session and agent. **Does NOT contain NACA code.**

## Tier

`tier_1` (NORMATIVE per `WORKFLOW.md`). Every non-cosmetic change: branch + PR + admin merge. No direct pushes to main.

## What belongs here

- `WORKFLOW.md` — canonical 5-phase work flow (Orient → Plan → Execute → Save → Verify)
- `enforcement/CTK_ENFORCEMENT.md` — SOP for data ops, commits, memory discipline, vault routing
- `packages/memory/` — `@todak/memory` SDK source (neo-brain access)
- `tools/` — generic scripts: `save-memory.js`, `check-latest-activities.js`, monitors (`supervisor-agent.js`, `cross-session-drift-monitor.js`, `stuck-command-monitor.js`, `vps-git-drift-monitor.js`, `pr-decision-dispatcher.js`, `registry-meta-backfill.js`)
- `scripts/` — utility scripts (e.g. `lint-no-hardcoded-agents.sh`)
- `prompts/focus/` — per-project focus briefings for fresh sessions
- `specs/` — generic platform specs not specific to a single product

## What does NOT belong here

- ❌ NACA platform packages (`@naca/{core,tools,router}`) — see `~/Projects/naca/`
- ❌ NACA interfaces (siti-v2, naca-app, naca-mcp-bridge, verifier-agent, planner-agent, etc.) — each in its own repo
- ❌ Project-specific tooling — each project owns its own `tools/` dir
- ❌ Personal credentials — route through neo-brain credential vault (enforcement §4)

## Hard rules

1. **Generic over specific.** Anything tied to one product (NACA, Academy, AskMyLegal, …) belongs in that product's repo, not here.
2. **No hardcoded agent lists.** If any CTK tool needs a list of NACA agents at runtime, derive it from `agent_registry` (neo-brain). See `~/Projects/naca/docs/spec/agent-registry-schema-v1.md` for the canonical meta schema. The `lint-no-hardcoded-agents.sh` script (added 2026-05-13) is the regression guard.
3. **Memory discipline.** Save proactively at milestones via `@todak/memory` SDK (NEVER query neo-brain DB directly). Full discipline in `enforcement/CTK_ENFORCEMENT.md §3`.
4. **Credential vault.** Never hardcode secrets — use neo-brain `credentials` table via `getCredential()` from `@todak/memory`.
5. **No assumptions.** Verify schema and live state before data ops. The 2026-05-13 Siti-on-leave incident is the canonical lesson: hardcoded module knowledge silently drifts from registry truth.

## Workflow

- Node 20+, mostly ESM. Test via `jest` (legacy) or `node --test` (newer scripts).
- Pre-commit secrets check (`enforcement/CTK_ENFORCEMENT.md §5`) runs automatically via the git hook.
- For shared-infra changes (writes to `memories`, `agent_commands`, `agent_registry`, etc.): read `CTK_ENFORCEMENT.md §9` first; save a `shared_infra_change` memory after deploy.

## Pointers

- `WORKFLOW.md` — start here every session.
- `enforcement/CTK_ENFORCEMENT.md` — SOPs for risky operations.
- `prompts/focus/` — focus briefings for specific projects (NACA-PLATFORM-REFACTOR, NACA-APP, SITI-REBUILD, etc.).
- `~/Projects/naca/docs/spec/` — NACA platform specs (refactor v1, refactor v2 / Agent Plug and Play schema).
