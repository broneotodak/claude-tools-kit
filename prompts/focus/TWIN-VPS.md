# Twin-VPS Focus CC Session Prompt

Paste below into a fresh Claude Code session as the first message when working on **Twin VPS** — the dedicated Hetzner box that hosts the digital-twin pipeline (twin-ingest + neo-twin auto-reply, both running off Neo's primary WhatsApp number).

**Before doing anything else, read `~/Projects/claude-tools-kit/WORKFLOW.md`** (canonical 5-phase work flow). Twin VPS hosts `tier_1` agents — NORMATIVE rules apply, especially around Baileys session state and pgVector writes.

---

You are scoped to **Twin VPS** — a small dedicated Hetzner instance on its own tailnet that listens to Neo's primary WhatsApp number (+60177519610), ingests messages into neo-brain `wa_messages` (source=`wa-primary`), and (Phase 6) drafts auto-replies via a two-tier LLM pipeline. **High-risk box** because it's authenticated against Neo's personal WhatsApp account.

**Code repo for everything on this VPS:** [`broneotodak/neo-twin`](https://github.com/broneotodak/neo-twin) — extracted from CTK on 2026-05-13 (CTK PR #46 spec). Deploy = `cd /home/neotwin/repo && git pull --rebase && pm2 restart twin-ingest neo-twin-orchestrator`.

## Live layout

| What | Where |
|---|---|
| Public IP | `5.161.126.222` |
| Tailnet IP | `100.120.79.126` |
| SSH | `ssh root@5.161.126.222` (or via tailnet) |
| Linux user for the pipeline | `neotwin` |
| Process manager | pm2 (under `neotwin` user) |
| `agent_registry` rows | `twin-ingest` (type=ingest, pm2), `neo-twin` (type=llm-driven, two-tier pipeline) |
| Listening WhatsApp | Neo's primary phone: **+60177519610** (NOT Siti's number) |
| WhatsApp library | `@whiskeysockets/baileys` (via pairing → Linked Devices) |

## What runs here

| Service | What | Why high-risk |
|---|---|---|
| **twin-ingest** | Listens to primary WA → Whisper ASR for voice notes → Gemini embedding → writes `wa_messages(source='wa-primary')` + persists media to NAS-MinIO. | If Baileys session corrupts, the entire memory ingestion stops silently. The pm2 process can stay "alive" while no messages get persisted. |
| **neo-twin-orchestrator** | Phase 6 two-tier auto-replier (Tier 1 Haiku for casual replies, Tier 2 qwen2.5:32b on tr-home for high-stakes). Currently in **shadow soak** — drafts are saved but not auto-sent. | Sending wrong replies as Neo would damage real relationships. Shadow mode is the safety. |

Source code paths on the VPS (post-extraction 2026-05-13):
- `/home/neotwin/repo/` — git clone of `broneotodak/neo-twin` (read-only deploy key in `~/.ssh/id_ed25519_neo_twin`)
- `/home/neotwin/repo/services/twin-ingest/` — twin-ingest service
- `/home/neotwin/repo/services/orchestrator/` — neo-twin-orchestrator
- Auth state for Baileys: `/home/neotwin/repo/services/twin-ingest/auth-state/` (sensitive — contains session keys; `index.js` uses `useMultiFileAuthState("./auth-state")`)
- Dashboard (status surface): port `3900`
- Old paths `/home/neotwin/twin-ingest.old.20260513/` + `/home/neotwin/neo-twin.old.20260513/` preserved for 1-week rollback window; delete after 2026-05-20.

## Deploy flow

```bash
# 1. Edit in broneotodak/neo-twin (not CTK!), PR, merge as normal.
# 2. SSH in, pull, restart.
ssh neotwin@5.161.126.222   # tailnet ssh works too
cd /home/neotwin/repo && git pull --rebase
pm2 restart twin-ingest neo-twin-orchestrator

# 3. Tail logs to verify clean startup.
pm2 logs twin-ingest --lines 50 --nostream
pm2 logs neo-twin-orchestrator --lines 30 --nostream
```

## Hard rules — DO NOT violate

1. **NEVER delete `/home/neotwin/repo/services/twin-ingest/auth-state/` without backing it up first.** If re-pairing fails, the backup is the only path back to the existing session. Backup pattern: `cp -r auth-state auth-state.backup.$(date -u +%Y%m%d-%H%M%S)`.
2. **NEVER skip the WhatsApp Linked Devices detach** before re-pairing. Stale Linked Devices entries cause phantom sessions, MessageCounterError loops, and silent degradation. Always: open WhatsApp on +60177519610 → Settings → Linked Devices → log out the Twin VPS entry → THEN re-pair.
3. **NEVER auto-send replies** while neo-twin is in shadow soak. Drafts go to neo-brain for Neo's review. The "send as Neo" toggle only flips after explicit operator approval and a soak window with clean draft quality.
4. **NEVER assume the dashboard at :3900 reflects live state.** It currently shows **cumulative counters since-startup**, not "live in the last hour." The pipeline can be silently dead while the dashboard says "1273 messages received" — that 1273 is from before things broke. Truth is in `neo-brain.memories WHERE source='wa-primary' ORDER BY created_at DESC LIMIT 5`.
5. **NEVER modify Baileys version without backing up auth + saving an `infra-snapshot` memory.** Baileys protocol changes can invalidate session keys.

## First-90-seconds debug entry points

- **"Why no recent wa-primary rows?"** — query `neo-brain.wa_messages WHERE source='wa-primary' ORDER BY created_at DESC LIMIT 5`. If the most recent is >2h old, the pipeline is silently dead. Check `pm2 logs twin-ingest --lines 100` for `MessageCounterError`, `Key used already`, `init queries — Timed Out` — these are Baileys session-degradation signals.
- **"Process is up but doing nothing"** — pm2 status shows `online` doesn't mean it's processing. Look at the timestamp of the last legitimate log line. `tail -f` for 5 minutes; if no message events arrive, the WhatsApp socket is dead.
- **"Dashboard says healthy but DB has no recent rows"** — known-bad signal pattern. Trust the DB, not the dashboard. The dashboard counters bug is filed; fix is to make them rolling-window not since-startup.
- **"Need to re-pair"** — ALWAYS in this order: (1) backup `auth-state/`, (2) detach Linked Device on the phone, (3) stop pm2, (4) `rm -rf auth-state/`, (5) start pm2 to surface QR, (6) Neo scans QR, (7) verify first message lands in neo-brain. **Note**: `dashboard.js` at :3900 has no QR view yet — QR currently only renders in `pm2 logs twin-ingest`. Adding `/qr` endpoint to dashboard is a known follow-up.

## Memory discipline (when shipping a Twin VPS fix)

- **Category**: `shared_infra_change` (per CTK §9 — anything affecting the `wa_messages` write path is shared infra). Plus `project_neo_twin` for Phase 6 shadow soak progress notes.
- **Scope**: `ops` for fixing pipeline issues; `fleet` for architectural decisions about the twin pipeline.
- **Importance**: 8+ for any auth/pairing change (high blast radius — wrong key state could permanently lock out the session). 7 for routine deploys.
- **Always include**: what was happening before the fix, exact commands run (so rollback is possible), the verification step that confirmed the fix.

## Pointers

- `~/Projects/claude-tools-kit/WORKFLOW.md` — canonical work flow
- `~/Projects/claude-tools-kit/REVAMP-V1.0.0.md` — current operation context
- neo-brain memory: `project_neo_twin_vps`, `project_phase6_step9_shadow_soak`, `feedback_twin_ingest_baileys_degraded` (the active incident)
- Companion node: nothing — Twin VPS is single-purpose; treat it as isolated

## Tone

Same as everywhere. Confirm before any destructive action on the auth state. The blast radius of breaking Twin VPS = losing memory pipeline + risk of wrong-reply-as-Neo if shadow soak gates are bypassed. **High-care zone.**
