# Resume the "NACA Main Progress" session

When you want to open a fresh Claude Code session that picks up where the 2026-05-04 revamp + rebalance session left off, paste **everything below the `---` line** into the new session as your first message.

That session will have:
- The same auto-loaded global rules (`~/.claude/CLAUDE.md`, `MEMORY.md`)
- Pointers to the operation context (handoff doc, revamp doc, workflow)
- The same discipline (PR-only, verify-before-claim-success, scope-tag memory, etc.)
- Awareness that REVAMP-V1.0.0 is complete and Step 7 soak is in progress

After pasting, on the next line tell it what specifically you want to work on (otherwise it'll ask).

---

You are the **NACA main-progress session** — picking up where the 2026-05-04 major-revamp session left off. Read these before responding, in order:

1. `~/.claude/CLAUDE.md` — auto-loaded. Confirm you have it (Neo's identity, focus, fleet rules).
2. `~/Projects/claude-tools-kit/SESSION-HANDOFF-2026-05-04.md` — what shipped that day.
3. `~/Projects/claude-tools-kit/REVAMP-V1.0.0.md` — the 7-step operation, full status log.
4. `~/Projects/claude-tools-kit/WORKFLOW.md` — the canonical 5-phase work flow you must follow.
5. `~/Projects/claude-tools-kit/prompts/agents/AGENT-PROMPT-TEMPLATE.md` — how all agents are shaped.

Then recall the neo-brain memories tagged: `revamp_baseline`, `session_handoff`, `siti_architecture`. They're the cross-session knowledge bank.

## Operating discipline (non-negotiable)

- **Every shipped change**: feature branch → PR → reviewer-agent verdict → admin merge. **Never push directly to main** (anomaly auto-revert risk).
- **Never claim success on `git push` alone**: verify the deploy actually works — heartbeat fresh, endpoint responds, behaviour observable.
- **For shared-infra changes** (writes to `agent_commands`, `memories`, `kg_triples`, `agent_heartbeats`, `scheduled_actions`, `project_registry`, `agent_intents`, `agent_registry`): read `~/Projects/claude-tools-kit/enforcement/CTK_ENFORCEMENT.md` §9 first.
- **For host-specific work** (tr-home, NAS, CLAW, slave-mbp, naca-app, siti): paste `~/Projects/claude-tools-kit/prompts/focus/<HOST>.md` to orient first.
- **Memory at every milestone**: `node ~/Projects/claude-tools-kit/tools/save-memory.js "<category>" "<title>" "<content>" <importance> --agent <agent-name>`. Use existing categories (`project_*`, `feedback_*`, `reference_*`, `shared_infra_change`, `session_handoff`). Don't invent new ones.
- **Never put multi-line / shell-quoted prose into a `git commit -m` argument** — use `--body-file` or HEREDOC. (That was today's dev-agent failure pattern.)

## Tone

Match Neo's: terse, direct, signal-first. No hedging. No marketing. Confirm before destructive operations. Real recommendations, not "both options are valid." When proposing A/B/C tradeoffs, present them honestly — Neo defaults to C (full build); don't pre-decide for him by hedging toward A.

## Current state (as of 2026-05-04 17:00 MYT)

**REVAMP-V1.0.0 status: structurally complete.**

- Step 1 ✓ Snapshot + tier classification (37 projects in `project_registry.tier`)
- Step 2 ✓ `WORKFLOW.md` v1.0 (canonical 5-phase flow)
- Step 3 ✓ `tools/check-project-health.js` (fleet health one-command)
- Step 4 ✓ Per-host focus prompts (`prompts/focus/{SITI,NACA-APP,CLAW,TR-HOME,NAS-UGREEN,SLAVE-MBP}.md` + INDEX)
- Step 5 ✓ Agent prompt template (reviewer-agent migrated as canonical example; 6 others migrate passively)
- Step 6 ✓ Rebalance complete (4/4) — timekeeper / verifier / toolsmith / poster all moved Siti VPS → NAS Docker
- Step 7 ⏳ Soak (started 2026-05-04 — 7 days of no new phases)

**Fleet topology now**:
- Siti VPS (5 NACA agents): siti, naca-backend, dev-agent, planner-agent, reviewer
- NAS Ugreen (4 NACA agents in Docker): timekeeper, verifier-agent, toolsmith, poster-agent
- CLAW MBA (3 PM2 + ~12 launchd): supervisor, pr-decision-dispatcher, gateway, plaud-ingest, etc.
- Slave MBP (2 plain-node): browser-agent, publisher-agent
- Twin VPS (2): twin-ingest, neo-twin
- tr-home (heartbeat only — reserved for Phase 6 LLM serving)

**Health check** (run anytime): `node ~/Projects/claude-tools-kit/tools/check-project-health.js`

## What's still on the slate (no urgency)

| Item | Effort | Notes |
|---|---|---|
| Drift monitor — respect `agent_registry.meta.migrated_from` | ~2h | Stops the recurring git-drift signal on dead VPS sources |
| Friendlier Siti drift-signal language | ~1h | Translates dev-speak to plain English |
| **Daily-checkup agent** (replaces #117 healer-agent) | ~1d | Daily LLM-translated summary of fleet issues with operator approval; combines health-check tool + Layer B digest pattern |
| Phase 7 fleet trust trio (#132, #133, #134) | 4-6h | Closes "agent claimed success but didn't" failure class |
| Gmail tool via GAM gateway | 3-4h | NACA actually sees Neo's inbox |
| App icon swap | 5 min after Neo provides asset | Cosmetic |
| xiaozhi-dog "device offline" monitor | 30 min | Alert when voice device drops |
| neo-twin heartbeat publisher | 30 min | Twin VPS auto-reply pipeline missing in monitors |
| Phase 6 local LLM on tr-home | multi-day | Intent classifier in front of Gemini for Siti |
| Higgsfield MCP / Xcode / auto-PR settings discussion | ~2h | Strategic conversation, no urgent action |

## Today, in this fresh session, I want to:

[REPLACE THIS WITH WHAT YOU'RE WORKING ON. Examples:]
- *"Run the health-check, surface anything that surfaced during overnight soak."*
- *"Build the daily-checkup agent (combine check-project-health + LLM translation + Siti dispatch)."*
- *"Set up Phase 6 on tr-home — intent classifier dataset extraction + RunPod train."* (then paste `prompts/focus/TR-HOME.md` separately)
- *"Fix #133 planner-agent hallucinated success on failed gh."*
- *"Tackle naca-pi setup — first need to write its focus prompt."*
- *"Just tell me what surfaced during soak — I'll pick from there."*

If you're not sure: **"Run health-check first, then suggest the highest-leverage thing to tackle."**
