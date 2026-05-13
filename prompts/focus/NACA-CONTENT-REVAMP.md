# NACA Content Revamp — Focus CC Session Prompt

Paste below into a fresh Claude Code session as the first message when working on **NACA daily-content pipeline revamp** — the multi-fleet, multi-CLI flow that generates one daily social-media draft per morning, gates it through Neo's approval in the NACA app, and posts it across TikTok / Instagram / LinkedIn / Threads / X.

**Before doing anything else, read `~/Projects/claude-tools-kit/WORKFLOW.md`** (canonical 5-phase work flow). Most touched repos are `tier_1` — NORMATIVE rules apply.

**Shared-infra warning:** this work writes to `content_drafts` + `scheduled_actions` + `agent_commands`. Per `~/Projects/claude-tools-kit/enforcement/CTK_ENFORCEMENT.md §9` — run the multi-session pre-flight check before deploying, save a `shared_infra_change` memory after.

---

You are scoped to the **NACA daily-content pipeline revamp**. The pipeline shipped end-to-end on 2026-04-30 (memory `7dd97fe0`) and Phase 5c (CLAW command routing) completed 2026-04-28 (memory `ceaafe27`). Two known issues observed 2026-05-10 (memory `6984d1d1`) are the **revamp targets**:

1. **Image gen quality** — old CLAW machine pipeline (Higgsfield Soul + Kling) produces drafts with **a hardcoded "Penang" theme bias** (source unknown; likely in prompt template or seed-image library). Switch to **Higgsfield CLI** which is already deployed on Siti VPS and is persona-aware (Soul references available, much better quality).
2. **Wasted gen credits** — Neo manually rejects most Penang-themed drafts; each rejection costs API + human review time. Fix the bias source so approval rate goes up.

Today's date context: refactor v2 (Agent Plug & Play) shipped 2026-05-13 — every NACA module now reads agent/project lists from `agent_registry`. **Do not add any new hardcoded agent-name array to any module.** If a new content-flow component needs a list of agents, derive it from registry. The lint guard `claude-tools-kit/scripts/lint-no-hardcoded-agents.sh` will fail your PR otherwise.

## Live multi-fleet topology

This pipeline spans **5 hosts** and **multiple CLIs**. Knowing where each piece runs is half the battle.

| Stage | Host | Process | Code lives in |
|---|---|---|---|
| Cron trigger (07:00 MYT) | **CLAW** (Neo's Mac, `100.93.159.1`) | system crontab → `~/.openclaw/skills/daily-quotes/daily-content.sh` | `claude-tools-kit/tools/openclaw-skills/` (mirror) + live on CLAW disk |
| Scene + caption text gen | **CLAW** | Gemini 2.5 Flash via `genai-cli` (with 7-template fallback) | same script |
| Image generation | **CLAW** (current) → **Siti VPS** (target) | Higgsfield Soul (current local CLI) → Higgsfield CLI on Siti VPS (target) | persona-aware CLI deployed at `/home/openclaw/higgsfield-cli/` on Siti VPS |
| Image-to-video | **CLAW** | Kling 3.0 (10s silent cinematic) — may also move to Higgsfield video | same script |
| BGM | **CLAW** | ElevenLabs music API | `notify-siti.sh` helpers |
| Media archive | **NAS Ugreen** (`100.85.18.97`) | MinIO at `/volume1/Todak Studios/naca/content/YYYY/MM/DD/STAMP.mp4` | NAS-side, scp/SSH-key fleet |
| Draft row creation | **neo-brain** (Supabase `xsunmervpyrplzarebva`) | `create_content_draft` bash fn → PostgREST | `~/.openclaw/skills/lib/notify-siti.sh` on CLAW |
| WhatsApp ping ("Draft ready") | **Siti VPS** (`178.156.241.204`) | `naca-backend` → Siti `/api/send_video` → wacli | `naca-app/backend/server.js` + `siti-ingest` on Siti VPS |
| Neo's approval UI | **naca-app** (Flutter) | SCHED → DRAFTS tab | `~/Projects/naca-app/lib/screens/schedule_screen.dart` |
| Approval → scheduled_action | **Siti VPS** | `naca-backend` POST `/api/content-drafts/:id/approve` | `naca-app/backend/server.js` |
| Action firing | **NAS Docker** | timekeeper polls `scheduled_actions` every 30s | `~/Projects/timekeeper-agent/` (Docker on NAS) |
| Post execution (LinkedIn/IG/Threads/X) | **CLAW** | `claw-command-worker` (launchd) → python scripts in `~/.openclaw/skills/daily-quotes/<channel>-post.py` | scripts live on CLAW disk |
| Post execution (TikTok — UI only) | **Slave-MBP** (Imel's MBA, `100.93.211.9`) | `browser-agent` (pm2) → Playwright drives TikTok Studio | `~/Projects/browser-agent/` (deploys via scp to Slave) |
| Success/failure DM | **Siti VPS** | `claw-command-worker` writes `agent_commands(to_agent='siti', command='send_whatsapp_notification')` → `outbound-bridge.js` (siti-router) forwards to Neo's WhatsApp | `~/Projects/siti-v2/src/interface/outbound-bridge.js` |

**Lane note:** Siti interface work (router, dispatcher, specialists) and twin-product work each have their own CC sessions. Do NOT touch `siti-v2/src/router/` or `siti-v2/src/dispatcher/` unless you're explicitly fixing how an `agent_commands` row turns into a sent message. The outbound bridge is fine to read; don't reshape it.

## What runs where (process inventory)

```
CLAW (Mac, launchd + system crontab):
  - system crontab 0 7 * * * → daily-content.sh         (THE TRIGGER)
  - launchd ai.openclaw.claw-command-worker             (post execution + Siti notify)
  - launchd ai.openclaw.supervisor                      (monitoring; will alert if claw-mac heartbeat goes stale)

Siti VPS (Hetzner, pm2 under openclaw):
  - siti-router    (outbound bridge — sends WA on Neo's behalf)
  - siti-ingest    (inbound WA via wacli)
  - naca-backend   (HTTP API for naca-app + content_drafts endpoints)
  - higgsfield-cli (target image-gen surface; persona-aware Soul refs)

NAS Ugreen (Docker):
  - timekeeper-agent  (polls scheduled_actions, dispatches agent_command)
  - verifier-agent    (post-deploy verification; reads project_registry)
  - poster-agent      (legacy — kept running but redundant for content posting since Phase 5c)

Slave-MBP (pm2 under slave):
  - browser-agent     (Playwright for TikTok UI posting)
  - publisher-agent   (LinkedIn UGC API — partial; CLAW worker also handles some)
```

## Key databases & tables (neo-brain)

| Table | Read | Write | Purpose |
|---|---|---|---|
| `content_drafts` | naca-app, NACA workflow | CLAW (`create_content_draft`), naca-backend (approve/reject) | one row per generated draft; status FSM `pending_approval → approved \| rejected \| superseded \| expired` |
| `scheduled_actions` | timekeeper | naca-backend (on approve), claw-command-worker | one row per channel × approved-draft; fires at `fire_at` |
| `agent_commands` | claw-command-worker (it's the claimer), siti-router (outbound) | naca-backend, claw-command-worker (Siti notifications) | command queue; `to_agent='siti'` rows go through outbound-bridge |
| `agent_registry` | every NACA module after refactor v2 | (rarely; via SDK) | the phonebook — `meta.runtime`, `meta.host`, `meta.outbound_label`, etc. |
| `memories` | semantic recall + auditing | `@todak/memory` SDK | shipped milestones, incidents, decisions |

`content_drafts` schema (key columns):
```
id uuid, source text, caption text, scene text, action text,
media_paths jsonb (array of {store: 'nas'|'local', path: '...'}),
status text, scheduled_action_id uuid, channels text[],
created_at, scheduled_for, approved_at, rejected_at, reject_reason
```

## Revamp scope (this session's job)

Two concrete tasks per memory `6984d1d1`:

### Task A: Switch image gen from CLAW-local pipeline to Higgsfield CLI on Siti VPS

Current state: `~/.openclaw/skills/daily-quotes/create-video.sh` (or `create-video-simple.sh`) on CLAW runs the local Higgsfield Soul image step. The Higgsfield CLI deployed on Siti VPS is **persona-aware** (knows Neo's Soul references) and produces much better quality. Pattern already used by `generate_image` tool in `siti-v2/packages/tools/` (now `@naca/tools`).

Implementation path (proposed; verify before executing):
1. Read the current image-gen call site in CLAW's content script (`grep -rn 'higgsfield\|soul\|cf_image_gen' ~/.openclaw/skills/`).
2. Replace local-CLI call with HTTP to Siti VPS's higgsfield-cli endpoint (find the right one — likely an internal port on `100.79.179.67` or a `naca-mcp-bridge-http` tool).
3. Forward the persona/Soul reference selection (defaults to Neo's primary Soul, but allow per-day variation).
4. Keep media download → NAS archive path identical (this isn't broken).
5. Verify: trigger one manual run, confirm a draft row appears with new-pipeline media, confirm `media_paths[0].store='nas'`.

### Task B: Find and remove the "Penang" theme bias

Likely sources (investigate in order):
1. Prompt template — `~/.openclaw/skills/daily-quotes/daily-content.sh` or whatever feeds Gemini. Look for hardcoded location strings.
2. The 7-template fallback list (per memory `7dd97fe0`) — one or more templates may bake in Penang.
3. Seed-image library — if the image step uses reference images of Penang scenes, that biases visual output.
4. Persona/Soul reference itself — Neo's Soul might have a Penang-flavoured set of training images.

Fix should be a single replacement: location-neutral or parameterised (e.g. randomise from a small approved-locations list, or pull from time-of-year context).

## Hard rules

1. **Do not unpause the old `siti` pm2 process.** It's intentionally stopped (since 2026-05-05) for the duration of the rebuild. The content pipeline does not need it — `siti-router` + `siti-ingest` are the live surfaces. (See `siti-v2/CLAUDE.md`.)
2. **No hardcoded agent-name lists in any new code.** Refactor v2 / Agent Plug & Play shipped 2026-05-13. Read `~/Projects/naca/docs/spec/agent-registry-schema-v1.md` if unsure how to model per-agent config. Run `~/Projects/claude-tools-kit/scripts/lint-no-hardcoded-agents.sh <repo>` before opening any PR.
3. **`content_drafts` + `scheduled_actions` are shared NACA infra.** Per CTK Enforcement §9: pre-flight check before, `shared_infra_change` memory after. The Apr 28 schema is locked — adding columns is fine, repurposing existing columns is not.
4. **Don't bypass the approval gate.** Drafts go to NACA app SCHED → DRAFTS for Neo's review. Never auto-approve. Never post directly without writing a draft. The single-tap APPROVE is the contract.
5. **Test locally before deploying to CLAW.** The cron only fires once a day. A bad deploy kills tomorrow's draft. Manual test via `bash ~/.openclaw/skills/daily-quotes/daily-content.sh` after editing.
6. **Verify deploys actually work.** Watch the next 07:00 MYT fire; confirm a draft row appears in `content_drafts`. Don't declare done from a passing `--check`.

## Deploy paths per host

| Host | Method |
|---|---|
| CLAW (Mac) | SSH `zieel@100.93.159.1`; edit `~/.openclaw/skills/daily-quotes/*` directly OR commit to a mirror in CTK and rsync. No pm2 — these are scripts. |
| Siti VPS | `ssh root@178.156.241.204 "su - openclaw -c 'cd ~/naca-backend && git pull && pm2 restart naca-backend'"` (for backend changes). Higgsfield CLI on Siti VPS: check `/home/openclaw/higgsfield-cli/` for its deploy convention. |
| Slave-MBP | `scp -O index.js slave@100.93.211.9:~/Projects/browser-agent/` + `ssh slave@ 'pm2 restart browser-agent'` |
| NAS Ugreen | `scp -O index.js Neo@100.85.18.97:/volume1/homes/Neo/agents/timekeeper-agent/` + `ssh Neo@ "cd <path> && docker compose up -d --build"` |
| naca-backend | git push → on Siti VPS: `cd ~/naca-app/backend && git pull && pm2 restart naca-backend` |
| naca-app web | `git push origin main` → GitHub Actions builds Flutter web → SCP to VPS — auto-deploys on push |

## Debug entry points

- **Tomorrow's draft didn't appear?** Check CLAW system cron logs: `tail -100 ~/.openclaw/logs/daily-content.log` (path may vary; `crontab -l` for the exact line). Then check `content_drafts` for any row at all today.
- **Draft appeared but media broken?** Look at `content_drafts.media_paths[0]` — verify NAS file exists via `ssh Neo@100.85.18.97 "ls -la <path>"`.
- **Approved but never posted?** Check `scheduled_actions` row for the channel — `status` should go pending → claimed → done. If stuck claimed, timekeeper or claw-command-worker is the suspect.
- **Posted but Neo didn't get DM?** Check `agent_commands(to_agent='siti', command='send_whatsapp_notification')` for the success notification row. `outbound-bridge` consumes within 10s.
- **Higgsfield CLI 500s?** Check `/home/openclaw/higgsfield-cli/` logs on Siti VPS.

## Pointers

- `~/Projects/claude-tools-kit/WORKFLOW.md` — 5-phase work flow
- `~/Projects/claude-tools-kit/enforcement/CTK_ENFORCEMENT.md` — §9 multi-session, §3 memory discipline
- `~/Projects/naca/docs/spec/agent-registry-schema-v1.md` — Agent Plug & Play schema (refactor v2)
- `~/Projects/claude-tools-kit/prompts/focus/SLAVE-MBP.md` — browser-agent + publisher-agent context
- `~/Projects/claude-tools-kit/prompts/focus/SITI-REBUILD.md` — siti-router + outbound-bridge context
- `~/Projects/claude-tools-kit/prompts/focus/CLAW.md` — claw-command-worker + launchd setup
- `~/Projects/claude-tools-kit/prompts/focus/NAS-UGREEN.md` — MinIO media archive + Docker agents
- Existing project memory: search neo-brain for `project_naca_content_revamp_higgsfield` (id `6984d1d1`)
- Phase 5c shipping memory: `ceaafe27` (E2E pipeline architecture)
- First-fully-autonomous-cycle memory: `7dd97fe0` (Apr 30 verified end-to-end)

## Recent context to pull semantic-search at session start

Run these queries via `@todak/memory` SDK in your first cycle:
```js
nb.search('NACA daily content pipeline higgsfield poster publisher', { limit: 6 });
nb.search('content_drafts schema scheduled_actions approval', { limit: 4 });
nb.search('Higgsfield CLI Soul persona reference', { limit: 4 });
```
Synthesise. Then start work via the 5-phase flow.
