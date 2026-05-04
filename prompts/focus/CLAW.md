# CLAW Focus CC Session Prompt

Paste below into a fresh Claude Code session as the first message when working on **CLAW** — the always-on MacBook Air at home that hosts the supervisor-agent, pr-decision-dispatcher, browser/Chromium, and the launchd-based fleet jobs.

**Before doing anything else, read `~/Projects/claude-tools-kit/WORKFLOW.md`** (canonical 5-phase work flow). CLAW hosts multiple `tier_1` agents → NORMATIVE rules apply for any change that affects them.

---

You are scoped to **CLAW** — Imelda's MacBook Air at Neo's home, kept always-on. It's the orchestration hub for jobs that need to live outside the Hetzner VPS (browser automation that Hetzner can't run, and the pr-decision-dispatcher which intentionally lives off-VPS for blast-radius isolation).

## Live layout

| What | Where |
|---|---|
| Machine | Imelda's MacBook Air (NOT Mac Mini — old memory had this wrong) |
| OS | macOS 26.3.1 |
| Node | 25.8.0 |
| Process manager | **macOS launchd** (NOT PM2 — none of the agents here use PM2) |
| SSH | `ssh zieel@100.93.159.1` (Tailscale) |
| MCP bridge | port 3899 |
| Tailnet IP | `100.93.159.1` |
| Local user | `zieel` |
| CTK clone | `~/Projects/claude-tools-kit/` (re-cloned from main on Apr 21 — `.git` had been stripped earlier) |
| Env file | `~/Projects/claude-tools-kit/.env` (has `NEO_BRAIN_*`, `GEMINI_API_KEY`, `MACHINE_NAME=CLAW`) |
| Secrets dir | `~/.openclaw/secrets/neo-brain.env` (real service-role key, not placeholder) |

## What runs here

12 launchd jobs registered (`launchctl list | grep ai.openclaw.`). The ones that matter most:

| Service | Purpose |
|---|---|
| **`ai.openclaw.pr-decision-dispatcher`** | Watches Neo's WA replies + `pr-awaiting-decision` memories every 30s → dispatches `merge_pr` / `close_pr` to dev-agent |
| **`ai.openclaw.supervisor-agent`** | Fleet SRE — drift, stuck-command, credential-leak monitoring across all VPS + CLAW agents |
| `ai.openclaw.gateway` | Browser-automation gateway with Chrome debug port 9222 |
| `ai.openclaw.router` | port 3901 — request routing |
| `ai.openclaw.reminder-service` | port 3903 |
| `ai.openclaw.plaud-ingest` | port 3904 — Plaud voice notes → memory |
| `ai.openclaw.report-parser` | end-of-day report builder |
| `ai.openclaw.forex-signal-ingest` | forex pipeline |
| `ai.openclaw.paper-trade-alerts` | paper trade notifications |
| `ai.openclaw.command-relay` | bridge to other fleet members |
| `ai.openclaw.whatsapp-router-sidecar` | WA router companion |
| `ai.openclaw.ollama-env` | local LLM env |

Currently STOPPED (intentional or stale): `socmed-comments`, `wacli-service`, `health-check`, `web-automation`, `browser-standalone`.

## Deploy flow (changing CLAW-side code)

```bash
# 1. Edit locally on Mac (or whatever working machine)
cd ~/Projects/claude-tools-kit
# … make changes ...

# 2. PR + merge as normal (WORKFLOW.md Phase 3)
git checkout -b fix/<slug>
git commit + push + gh pr create + gh pr merge --squash --admin

# 3. Pull on CLAW
ssh zieel@100.93.159.1 "cd ~/Projects/claude-tools-kit && git pull --rebase"

# 4. Reload the affected launchd job
ssh zieel@100.93.159.1 "launchctl unload ~/Library/LaunchAgents/ai.openclaw.<service>.plist && launchctl load ~/Library/LaunchAgents/ai.openclaw.<service>.plist"

# 5. Verify it's running
ssh zieel@100.93.159.1 "launchctl list | grep ai.openclaw.<service>"

# 6. Tail logs — depends on the service. plist file shows StandardOutPath.
ssh zieel@100.93.159.1 "tail -f ~/Library/Logs/openclaw/<service>.log"
```

## Hard rules — DO NOT violate

1. **Never run PM2 here.** All services use launchd. Mixing managers creates ghost processes.
2. **Never kill `claude` PID 87026** (or any long-running CC session PID). Investigation Apr 10 confirmed: this is a CLAW Claude Code session — kept alive intentionally for context retention. Per memory tagged `CLAW`.
3. **Never push directly to `main` from CLAW** — same anomaly-revert risk as anywhere else.
4. **Always update `~/Projects/claude-tools-kit/.env` AND `~/.openclaw/secrets/neo-brain.env`** when rotating service-role keys. Both are read by different services. Drift between them = silent auth failures.
5. **Don't load arbitrary plist files into launchd** — verify the `.plist` syntax (`plutil -lint`) before `launchctl load`. A broken plist disables that service silently and the launchd error log won't always say why.
6. **Don't move `~/Projects/claude-tools-kit/`** — many launchd jobs reference absolute paths.

## First-90-seconds debug entry points

- **"PR approval not dispatching"**: pr-decision-dispatcher lives here, not VPS. Check `launchctl list | grep pr-decision-dispatcher`. Logs at `~/Library/Logs/openclaw/pr-decision-dispatcher.log`. Verify it can reach neo-brain: `node ~/Projects/claude-tools-kit/tools/save-memory.js test test test 1`.
- **"Supervisor agent silent"**: `launchctl list | grep supervisor-agent`. Check the launchd respawn count — `launchctl list -15 ai.openclaw.supervisor-agent`. Exit codes can be misleading (old crashes; service may have respawned). Best signal is `agent_heartbeats` row freshness.
- **"Browser-agent gateway dead"**: `gateway` launchd job runs Chrome with debug port 9222. Verify `lsof -i:9222` finds Chrome. The gateway and a Chromium subprocess are the pair.
- **"Heartbeat from CLAW stopped"**: each agent publishes its own heartbeat. If heartbeats from `supervisor` / `pr-decision-dispatcher` go stale, that's the agent failing. If ALL CLAW heartbeats stop, it's a Tailscale or network issue.
- **"Plaud voice notes not landing in memory"**: `plaud-ingest` on port 3904. Logs + n8n upstream both worth checking. Plaud-ingest is the only CLAW service that writes legacy `claude_desktop_memory` directly (per Apr 21 audit) — narrow exception, leave it.

## Memory discipline (when shipping a CLAW-side fix)

- **Category**: `reference_claw` for layout / "where things live"; `project_<service>` for service-specific work; `shared_infra_change` for ANY change that affects shared infra (CTK §9 mandatory).
- **Scope**: `ops` for service / agent / dispatch work; `knowledge` for architecture; rarely `personal` here.
- **Importance**: 7 for service changes (high blast radius — fleet depends on CLAW); 8+ for architecture or post-incident learnings.
- **CTK §9 pre-flight check**: required for any shared-infra change. Read `~/Projects/claude-tools-kit/enforcement/CTK_ENFORCEMENT.md` first.

## Pointers

- `~/Projects/claude-tools-kit/WORKFLOW.md` — canonical 5-phase work flow
- `~/Projects/claude-tools-kit/enforcement/CTK_ENFORCEMENT.md` §9 — multi-session coordination (mandatory for shared infra)
- `~/Projects/claude-tools-kit/REVAMP-V1.0.0.md` — current operation context
- neo-brain: search `reference_claw`, `feedback_claw_bridge`, `project_claw_*`

## Tone

Same as Neo's everywhere: terse, direct, signal-first. CLAW hosts the dispatcher — when in doubt about whether a PR-action change is safe, defer or dry-run it. The dispatcher's blast radius is the entire merge pipeline.
