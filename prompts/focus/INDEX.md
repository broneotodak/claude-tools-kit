# Focus Prompts — Index

Per-host briefing prompts for fresh Claude Code sessions. Paste the relevant focus prompt into a new CC session as the first message and the session walks in already knowing the host's layout, deploy flow, debug entry points, and hard rules.

These pair with `~/Projects/claude-tools-kit/WORKFLOW.md` (the canonical 5-phase work flow). The focus prompts are the *host-specific quirks* layer on top of the universal workflow.

## When to use which

| Working on … | Paste this |
|---|---|
| Siti — the WhatsApp bot pipeline (server.js, parseVerdict, scope tagging, digest, etc.) | [`SITI.md`](SITI.md) |
| The NACA app itself — Flutter client, sound, bundle id, SITI tab, deploy via GitHub Actions / VPS / native | [`NACA-APP.md`](NACA-APP.md) |
| CLAW (Imelda's MBA at home) — pr-decision-dispatcher, supervisor-agent, gateway, plaud-ingest, all launchd jobs | [`CLAW.md`](CLAW.md) |
| tr-home (Threadripper desktop) — FCC dashboard sidecar, Ollama, future Phase 6 local LLM serving | [`TR-HOME.md`](TR-HOME.md) |
| NAS-Ugreen — heartbeat publisher, MinIO media store, n8n, business docs, Tailscale exit-node | [`NAS-UGREEN.md`](NAS-UGREEN.md) |
| Slave-MBP (Imel's MBA repurposed) — browser-agent (UI posting) + publisher-agent (API posting), TikTok/IG/LinkedIn flow | [`SLAVE-MBP.md`](SLAVE-MBP.md) |
| Twin VPS — twin-ingest (memory pipeline off Neo's primary WhatsApp) + neo-twin (Phase 6 two-tier auto-reply, shadow soak). HIGH-RISK: Baileys session state. | [`TWIN-VPS.md`](TWIN-VPS.md) |

## Hosts that don't have focus prompts (yet)

- **Hetzner Siti VPS** itself — the agents that run there (siti, planner-agent, dev-agent, reviewer-agent, verifier-agent, toolsmith-agent, timekeeper-agent, naca-backend, poster-agent) are mostly covered by `SITI.md` for siti-specific work, or each agent's source repo + system prompt for the others. If we end up doing VPS-wide ops repeatedly, add `prompts/focus/HETZNER-VPS.md`.
- **Twin VPS** (5.161.126.222 / 100.120.79.126) — hosts `twin-ingest` + `neo-twin`. Add `TWIN-VPS.md` if we revisit Phase 6 Step 9 in earnest.
- **naca-pi** (Raspberry Pi 4 8GB, security recon node) — `tier_3` per the registry. Add `NACA-PI.md` if/when the security-agent project graduates from sandbox.
- **xiaozhi-dog** (ESP32-S3 voice device) — currently `tier_3`. Hardware notes live in memory `project_dog_v2_xiaozhi` for now.

## How to use

1. Open a fresh Claude Code session on Neo's Mac (the agent SDK or the Claude Code CLI, doesn't matter).
2. Pick the focus prompt for whatever host you're about to work on.
3. Paste **the section after the front-matter** (everything below the `---` separator) into the session as the first message.
4. The session is now scoped — it knows the layout, deploys, debug entries, hard rules.
5. Continue the conversation as normal — ship work via the WORKFLOW.md 5-phase flow.

Each focus prompt is self-contained: it pulls everything the session needs without you having to remember which memories to recall. If a focus prompt is missing critical info, edit it and PR — focus prompts are living docs.

## Update discipline

When something changes about a host (new service deploys, port changes, key rotation, deploy method shift):

1. Update the relevant focus prompt in this directory
2. Save a memory tagged with the host's reference category (`reference_<host>`) so semantic search finds the new info
3. Bump the doc version note at the bottom if it's a structural change

Stale focus prompts are worse than no focus prompts — they confidently mislead. Treat them like CLAUDE.md files.

## Pairs with

- `~/Projects/claude-tools-kit/WORKFLOW.md` — universal work flow (5 phases)
- `~/Projects/claude-tools-kit/REVAMP-V1.0.0.md` — the operation context for the fix-and-improvement push
- `~/Projects/claude-tools-kit/enforcement/CTK_ENFORCEMENT.md` — shared-infra coordination rules (CTK §9)
- `~/.claude/CLAUDE.md` — global rules
