# Major Revamp NACA — Fix & Improvement v1.0.0

**Started**: 2026-05-04
**Owner**: Neo (broneotodak) · driving sessions: Claude Code on Neo's Mac
**Status**: 🚧 in progress · Step 1 done, Steps 2–7 pending
**One-line mission**: From organic chaos → canonical workflow + verifiable health, without scrapping working infra or losing memories.

---

## Why this exists

Over the last week, mostly from Neo's frustration patterns:

1. **Siti getting overwhelmed** — personal recall ("remember the Pi 4") was pulling PR briefs into context. Mixed scopes, no partition. (Layer A scope tagging just landed in siti#40.)
2. **Notification spam** — every PR merge triggered ~5 messages (dev-agent + planner narration ×N + CI/CD ×N). (Layer B digest mode just landed in siti#41.)
3. **Each agent's system prompt is bespoke** — reviewer, planner, dev-agent, verifier all have different historical patches. No shared discipline.
4. **No canonical "starting work on a project" flow** — every CC session and every agent guesses based on cwd or keywords. Drift inevitable.
5. **Fleet load imbalance** — Siti VPS runs 10 agents while tr-home (Threadripper, idle) runs 1. CLAW MBA carries 3, NAS hosts 1. No discipline for placement.
6. **Unfix list grows faster than it shrinks** — person-sync 10d offline, neo-twin no heartbeat, xiaozhi-dog no monitor, etc.

**Plumbing is fine. Discipline is missing.** This revamp adds the discipline layer on top of working infra. No data loss, no live-service downtime.

---

## Definition of Done

We're done when, on a random Tuesday morning:

1. ☐ Open a fresh CC session, paste the focus prompt for whatever host, work without re-explaining
2. ☐ Ask Siti "how's the fleet?" and get a coherent one-glance answer
3. ☐ Trust that any merged PR was actually deployed and is actually running
4. ☐ Get one digest message per hour, max — actionable items real-time only (Layer B already gets us partway)
5. ☐ Search neo-brain and only see relevant scope (Layer A already gets us partway)
6. ☐ See `naca_milestones` and trust it reflects reality

Today's score: roughly **3 of 6**. Target end-of-revamp: **6 of 6**.

---

## Baseline snapshot

Captured **2026-05-04T04:36:58Z**. Used as the rollback reference point — if any step degrades these numbers, investigate before continuing.

```
FLEET (21 agents)
  live   (<5m)   : 17
  stale  (<60m)  : 0
  offline(>60m)  : 2
  no-heartbeat   : 2

MEMORY (top categories, 1000-row sample)
  claude_code_session    633
  ClaudeN                266
  ARS                     37
  Academy Project         15
  business                15
  ClassroomNeo            12
  Agentic Centre           9
  claude-tools-kit         5

SCOPE TAGGING (last 7d, 1000-row sample)
  ops          0
  knowledge    0
  personal     2
  untagged   998   ← will grow organically after Layer A; consider backfill in Step 6

MILESTONES (naca_milestones)
  phases: 10 done · 3 partial · 2 new
  items : 94 done · 3 partial · 3 new · 21 todo

HEALTH CHECKS
  stuck commands (>10m, pending/claimed/running)  : 0  ✓
  orphan pr-awaiting-decision (>6h, no recorded)  : 0  ✓ (after CTK#11 manual unblock)
```

Live unfix list (separate from snapshot — these need fixing in Step 6):

- `person-sync` offline ≥10d (Siti VPS)
- `backup-sync` offline ≥7h (CLAW)
- `neo-twin` no heartbeat at all (Twin VPS)
- `xiaozhi-dog` no monitor for "device offline"
- siti `hold-guard` fix (commit `bc91bcc`) lost in yesterday's squash
- App icon still Lan's CCC icon (cosmetic)
- SITI tab still hardcodes `'VPS 178.156.241.204:3800'` as a display string (cosmetic, stale)

---

## The 7 Steps

### Step 1 — Snapshot ☑ DONE (2026-05-04)

Baseline captured (above). Saved to neo-brain memory tagged `revamp_baseline`. No infra changes.

### Step 2 — Write the canonical `WORKFLOW.md` ☑ DONE (2026-05-04)

**Single source of truth** for every CC session and every agent. Lives at `claude-tools-kit/WORKFLOW.md`. Referenced from `~/.claude/CLAUDE.md` (auto-loads in every session) and from each agent's system prompt.

Covers:
- 5-phase project flow: Orient → Plan → Execute → Save → Verify
- Memory discipline: when to save, what scope, what category, what importance, what tag
- PR/merge/deploy flow: copy-pastable shell commands
- Multi-session coordination: existing CTK §9, integrated
- Health-check protocol: which queries surface what kinds of breakage

**Acceptance**:
- `WORKFLOW.md` exists, peer-reviewed by Neo, committed to main
- `~/.claude/CLAUDE.md` references it
- Reviewer-agent / planner-agent / dev-agent system prompts reference it

**Estimate**: ~2 hours.

### Step 3 — Health check tooling ☑ DONE (2026-05-04)

Build `tools/check-project-health.js <project>` that runs the verify steps and prints a pass/fail report. Reuses the queries from this baseline doc + the orphan-PR / stuck-command queries.

Should answer in <30s:
- Are this project's agents alive?
- Has this project saved memories recently? (Stale = signal nothing happening OR signal something broken silently.)
- Are there stuck commands targeting this project?
- Does `naca_milestones` for this project match recent commits / merged PRs?
- Does the project's presentation page exist + match the milestone state?

**Acceptance**: script runs, output is readable, runs as a cron job once trusted.

**Estimate**: ~2 hours.

### Step 4 — Per-host focus prompts ☑ DONE (2026-05-04)

Six focus docs at `claude-tools-kit/prompts/focus/`:
- `SITI.md` (move yesterday's `SITI-FOCUS-SESSION-PROMPT.md` here)
- `TR-HOME.md`
- `NAS-UGREEN.md`
- `CLAW.md`
- `SLAVE-MBP.md`
- `NACA-APP.md`

Plus `INDEX.md` listing them. Each one: live layout, what runs there, deploy flow, debug entry points, hard rules, what NOT to touch, memory categories to save into.

**Acceptance**: every fleet host that hosts ≥1 agent has a focus prompt. Pasting it into a new CC session = full context.

**Estimate**: ~3 hours.

### Step 5 — Agent system prompt rewrite ☑ DONE structurally (2026-05-04). Per-agent migration ongoing.

Each long-running agent (reviewer, planner, dev-agent, verifier, dispatcher, supervisor, toolsmith) gets its system prompt rewritten from a single template. Template structure:

1. Read `WORKFLOW.md` first (reference, not full inline copy)
2. Your role-specific section (what THIS agent does)
3. Capabilities (which tools, which DBs, which endpoints)
4. Constraints (what NOT to do — destructive ops, push-to-main, hallucinated success on failed gh, etc.)
5. Escalation: when to ping Neo via Siti

**Acceptance**: every agent's system prompt follows the same template. Changing the workflow once → every agent picks it up.

**Estimate**: ~4 hours.

### Step 6 — Selective scrap & migrate (the unfix list) ☐ in progress (3/9 closed 2026-05-04)

Each unfix item gets its own PR. Each updates `WORKFLOW.md` if a new pattern emerges. Listed in priority order:

1. `siti` hold-guard fix (cherry-pick lost commit `bc91bcc`) — small, ships first
2. `neo-twin` heartbeat publisher — diagnose why it never fired
3. `person-sync` 10d offline — diagnose, fix or kill
4. `backup-sync` 7h offline — fix CLAW rclone
5. `xiaozhi-dog` monitor — add a "device-offline" alert
6. App icon swap (cosmetic; needs an icon master from Neo)
7. SITI tab hardcoded display string (cosmetic)
8. Hardcoded paths (`178.156.241.204:3800` everywhere) → migrate to `agent_registry.host` lookup
9. Scope-tag backfill: classify the 998 untagged memories from the last 7d (optional — depends on whether Layer A's organic adoption is enough)

**Acceptance**: all 9 closed (or explicitly deferred with reason).

**Estimate**: variable. Spread across days, each independently shippable.

### Step 7 — Soak (1 week) ☐

Run with the new discipline. **No new phases, no feature work.** Watch what breaks. Fix what surfaces. End-of-soak: re-run baseline snapshot, compare.

**Acceptance**:
- All 6 "Definition of Done" criteria green
- No new items added to the unfix list during soak (or if added, with root-cause documented)
- Health-check script: green for ≥5 consecutive days

**Estimate**: 7 calendar days. ~30min/day actively responding to surfaced issues.

---

## Risks & Rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Workflow doc too prescriptive → friction | Tier rules: normative for shared infra (CTK §9), recommended for cosmetic local | Soften wording per-section in soak week |
| Agent prompt rewrite breaks an agent | One agent at a time, test in isolation, keep `*.bak` of prior prompt | Restore from `.bak` |
| Health-check false positives → alarm fatigue | Tune thresholds during soak (start strict, loosen) | Comment out noisy checks |
| Scope backfill mis-tags → recall regression | Backfill is opt-in (Step 6 item 9). Compare recall hit rate before/after. | Reset `metadata.scope` to null on affected rows |
| Other CC sessions running concurrently → revert war | Per Neo's choice today: only this session active during the revamp | n/a |

---

## Status log (append-only)

- **2026-05-04T04:37Z** — Step 1 complete. Baseline snapshot captured. Doc created. Memory `revamp_baseline` saved with pointer to this file.
- **2026-05-04T05:10Z** — Pre-Step-2 project audit complete. 28 existing `project_registry` rows verified with Neo + classified. 9 missing fleet agents (reviewer/planner/dev/verifier/dispatcher/supervisor/browser/publisher/poster) backfilled. Migration `project_registry_add_tier_column` applied — `tier` column live with check constraint. Final distribution: tier_1=20 · tier_2=8 · tier_3=6 · decommissioned=2 · transferred=1. WORKFLOW.md (Step 2) will query `project_registry.tier` instead of hardcoded lists.
- **2026-05-04T05:13Z** — Step 2 complete. `WORKFLOW.md` v1.0 written and merged (claude-tools-kit#14). 5 phases (Orient → Plan → Execute → Save → Verify) with copy-pastable shell, tier rules table, 10 hard rules, common-scenario shortcuts. `~/.claude/CLAUDE.md` updated locally to reference the doc as session-start reading. Step 5 will wire each NACA agent's system prompt to it. Score now ~4/6 on Definition of Done.
- **2026-05-04T05:31Z** — Step 3 complete. `tools/check-project-health.js` shipped (claude-tools-kit#16). One-shot fleet-wide + project-specific health check. Exit codes 0/2/1 for cron. Smoke-tested: surfaces today's actual unfix items (person-sync 11d offline, backup-sync 10h, scope-adoption 0%) — real signal, not synthetic. Score now ~4.5/6 (criterion #2 — "Ask fleet status, get coherent answer" — partially satisfied; full answer needs Siti integration in a later step). Steps 4 + 5 + 6 + 7 remaining.
- **2026-05-04T06:36Z** — Step 4 complete. Six per-host focus prompts + INDEX shipped at `prompts/focus/` (claude-tools-kit#18). 755 lines, ~100–160 each. Hosts covered: Siti (moved + tightened), NACA-app, CLAW (launchd jobs), tr-home (Threadripper / Phase 6 target), NAS-Ugreen (heartbeat + MinIO + Tailscale), Slave-MBP (browser-agent + publisher-agent). Each one captures host-specific gotchas (e.g. NAS SSH user is capital `Neo`, CLAW uses launchd not pm2, tr-home is sensitive to apt upgrades). Step 5 (agent system prompt rewrite) can now reference these instead of duplicating host context per-agent. Score now ~5/6 — criterion #1 ("open fresh session, paste prompt, work without re-explaining") fully satisfied.
- **2026-05-04T06:44Z** — Step 5 structurally complete. Canonical `AGENT-PROMPT-TEMPLATE.md` shipped at `prompts/agents/` (claude-tools-kit#20). 5-section shape (Standing rules / Role / Capabilities / Constraints / Escalation) + role-specific output format preserved. **reviewer-agent migrated to the template as the canonical example** (broneotodak/reviewer-agent#3, deployed PID 601464). Migration is now passive: planner/dev-agent/verifier/dispatcher/supervisor/toolsmith/siti will move to the template as they're touched (Step 6 unfix list will hit several of them). Three-layer prompt structure now complete: WORKFLOW.md (universal) + prompts/focus/ (host) + prompts/agents/ (role). Score remains ~5/6; passive migration means full Step 5 maturation lands over the next sprint, not in one event.
- **2026-05-04T06:54Z** — Step 6 partial — 3 of 9 unfix items closed in one push. (1) **siti hold-guard restored** (broneotodak/siti#42) — re-applies lost commit `bc91bcc` so `hold pr #N` no longer silently cancels needs_review/content_drafts rows. Deployed PID 601628. (2) **person-sync decommissioned** — pm2 process deleted, agent_registry status='archived', role_description updated with reason. Replaced by yesterday's `backfill-nclaw-contacts-to-people.mjs`; legacy DB it polled returns Cloudflare 522. (3) **backup-sync false-positive resolved** (claude-tools-kit#22) — was actually healthy (daily 03:00 MYT cron, errors=0). The health-check tool was misreading scheduled jobs as offline. Tool is now cadence-aware (reads `agent_registry.meta.always_running` + `meta.cadence`); also filters archived agents. Result: `Heartbeats [PASS] 17 live · 1 scheduled-ok · 0 offline` (was `[WARN] offline: person-sync, backup-sync`). Score now ~5.5/6 — criterion #6 ("see naca_milestones and trust it reflects reality") + criterion #2 ("ask fleet status, get coherent answer") both meaningfully closer. Remaining unfix items (6): neo-twin heartbeat, xiaozhi-dog monitor, app icon swap, SITI tab hardcoded display string, hardcoded path migration, scope-tag backfill — all queued for next session(s).
