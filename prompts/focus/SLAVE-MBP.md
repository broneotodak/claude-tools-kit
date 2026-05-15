# SLAVE-MBP Focus CC Session Prompt

Paste below into a fresh Claude Code session as the first message when working on **Slave-MBP** — Imel's MacBook Air, the fleet's **"Creative Fleet"** node: creative-content generation + browser-driven posting + API-driven posting + url fetching for auth-walled hosts.

**Before doing anything else, read `~/Projects/claude-tools-kit/WORKFLOW.md`** (canonical 5-phase work flow). The agents that live here (content-creator + browser-agent + publisher-agent) are `tier_1` per the registry → NORMATIVE rules apply.

---

You are scoped to **Slave-MBP** — Imel's MBA, M-series, the fleet's **Creative Fleet** node: it both *creates* media and *publishes* it.

**Architecture history:** The 2026-04-29 "Studio / Publisher split" (CLAW = media-gen Studio, Slave = Publisher) was **superseded 2026-05-15**. That split was only partially realized — CLAW never got a registered media-gen agent, just kept an anonymous `daily-content.sh` shell script. The creative fleet has since consolidated on Slave-MBP: the new `content-creator` agent (`broneotodak/naca-content-creator`) lives here alongside `browser-agent` + `publisher-agent`. CLAW now runs only worker/monitor/infra agents; its `daily-content.sh` is kept as a **fallback/reference only** until naca-content-creator v1.0. Ollama dropped from the fleet entirely.

## Live layout

| What | Where |
|---|---|
| Box | Imel's MacBook Air (M-series) |
| Process manager | PM2 (`pm2_slave_mbp`) |
| Tailnet IP | `100.93.211.9` |
| SSH cmd | `ssh slave@100.93.211.9` (or just `ssh slave@` from a known host) |
| Local user | `slave` |
| Browser | Chromium (Playwright-installed), separate **automation** profile from any human-Chrome on the same machine |
| Content-creator repo | `broneotodak/naca-content-creator` |
| Browser-agent repo | `broneotodak/browser-agent` |
| Publisher-agent repo | `broneotodak/publisher-agent` |
| `agent_registry` rows | `content-creator`, `browser-agent`, `publisher-agent` (all tier_1, deploy_method `pm2_slave_mbp`) |

## What runs here

| Service | Pattern | Purpose |
|---|---|---|
| **`content-creator`** | Queue listener + CLI + (planned) MCP | Creative-content generation (image / video / music / SFX) via pluggable tool plugins (Higgsfield, ElevenLabs, Gemini, …). Multi-trigger: cron, WA via Siti, scheduled_actions, MCP. Replaces CLAW's legacy `daily-content.sh`. Spec: `naca-content-creator/docs/spec/v1.md`. As of 2026-05-15 status `offline` — building toward v1.0. |
| **`browser-agent`** | Pattern C: queue listener + HTTP server | UI-driven posting (TikTok / Instagram / Threads / IG) + URL fetcher fallback for auth-walled hosts (LinkedIn / X / TikTok / IG / Threads) + YouTube transcript via yt-dlp |
| **`publisher-agent`** | API-driven | LinkedIn UGC API + other API-only platforms |
| **NAS read/write access** | SSH key on slave-mbp authorized for NAS | content-creator writes generated media to NAS MinIO; browser/publisher read from it. Path `/volume1/Todak Studios/naca/`. |

The pair is the **only** path for Meta-blocked platforms (Instagram blocked broneotodak's API access, forcing the browser-driven pivot — that's what triggered Phase 4c "Browser Reach").

## Recent shipped work (2026-04-30)

Phase 4c "Browser Reach" — 10/11 items DONE:
- Slave MBP foundation (Playwright + Chromium installed)
- browser-agent skeleton (queue listener + HTTP server)
- URL fetcher tool (Siti capability boost)
- Per-platform posting via UI: TikTok ✓ Instagram ✓ LinkedIn ✓
- Daily-content cron: Gemini → Higgsfield → Kling → ElevenLabs music → NAS
- Inline-playable WhatsApp video preview (wacli send_video + Siti `/api/send_video`)
- Siti `read_url` fallback to browser-agent for auth-walled hosts
- YouTube transcript via yt-dlp (Siti `read_youtube` tool)
- NAS as canonical media store + SSH-key fleet (mac/CLAW/slave → `/volume1/Todak Studios/naca/`)
- Multi-platform approval flow: APPROVE in WA → TikTok + LinkedIn + Instagram autopost

Outstanding (1 item):
- Session decay detection + re-login alerts (browser sessions expire; need monitoring)

## Deploy flow

```bash
# 1. Edit locally
cd ~/Projects/browser-agent     # or publisher-agent
# … make changes ...

# 2. PR + merge
git push + gh pr create + gh pr merge --squash --admin

# 3. Pull + restart on slave
ssh slave@100.93.211.9 "cd browser-agent && git pull --rebase && pm2 restart browser-agent"
# or
ssh slave@100.93.211.9 "cd publisher-agent && git pull --rebase && pm2 restart publisher-agent"

# 4. Tail logs
ssh slave@100.93.211.9 "pm2 logs browser-agent --lines 50 --nostream"

# 5. Verify heartbeat
node ~/Projects/claude-tools-kit/tools/check-project-health.js browser-agent
```

For **content posting tests**:

```bash
# Post via browser-agent's HTTP API (test-only — production goes via agent_commands queue)
curl -X POST http://100.93.211.9:<port>/post -H 'content-type: application/json' \
  -d '{"channel":"tiktok","caption":"test","media_paths":["/path/to/media.mp4"]}'
```

## Hard rules — DO NOT violate

1. **Never use a human-active Chrome profile for automation.** Browser-agent has its own dedicated Chromium profile so password-paste / cookies / session don't collide with Imel's human use. Mixing them = stolen sessions, banned accounts.
2. **Never commit social-media session cookies.** They live on disk in the browser profile. Don't tar them up + push.
3. **Never auto-post without `agent_commands` flow.** Production posts go through `scheduled_actions` → `agent_command(command='post_content', to_agent='poster-agent' OR 'browser-agent')` → operator approval if it's a `content_drafts` row. Bypassing this means no audit trail.
4. **Don't restart browser-agent during a posting run.** Half-posted content is the worst kind. Drain queue first or wait for idle window.
5. **Don't break the SSH-key pairing to NAS.** Browser/publisher agents read media from `Neo@100.85.18.97:/volume1/Todak Studios/naca/`. If the key auth breaks, posts have no media.
6. **Don't run Ollama here.** Decision 2026-04-29: Ollama is dropped from the fleet entirely — tr-home owns local LLM, slave-mbp owns posting only.

## First-90-seconds debug entry points

- **"Browser-agent missed a post"**: `pm2 logs browser-agent`. Look for queue claim → action result. If the agent is up but skipped, check `agent_commands` for the row's status.
- **"Publisher-agent LinkedIn UGC fails"**: token expiry. LinkedIn UGC API tokens rotate; check `~/.publisher-agent/secrets/` (or wherever the token is stored). Refresh via the LinkedIn OAuth flow.
- **"TikTok / Instagram session expired"**: known weakness — Phase 4c outstanding item. Re-login via the dedicated automation Chrome profile. Don't paste cookies from a human Chrome.
- **"Heartbeat stale"**: PM2 process probably crashed. `pm2 list`, `pm2 logs`, `pm2 restart`.
- **"Media not found"**: SSH-key to NAS broken OR path drifted. Verify: `ssh slave@ "ssh Neo@100.85.18.97 'ls /volume1/Todak\\ Studios/naca/'"`.
- **"yt-dlp transcript fails"**: yt-dlp version drift; YouTube changes anti-bot constantly. Update: `ssh slave@ "pip install -U yt-dlp"`.

## Memory discipline

- **Category**: `reference_slave_mbp` for layout, `project_browser_agent` / `project_publisher_agent` for service-specific work, `project_studio_publisher_split` for architectural context, `shared_infra_change` for any change affecting how Siti / poster-agent route to slave-mbp.
- **Scope**: `ops` for posting flow, `knowledge` for browser-automation patterns, `fleet` for infrastructure changes.
- **Importance**: 7 for service work, 8+ for posting-pipeline architectural changes (these touch the multi-platform approval flow).

## Pointers

- `~/Projects/claude-tools-kit/WORKFLOW.md` — canonical work flow
- neo-brain: `reference_slave_mbp`, `project_studio_publisher_split`, `project_browser_agent`, `project_publisher_agent`, `project_naca_phase4c_browser_reach`
- Companion node: CLAW (worker/monitor/infra — see `prompts/focus/CLAW.md`). CLAW keeps `daily-content.sh` as a fallback only; the creative fleet is here.
- New-agent build: `broneotodak/naca-content-creator` — spec `docs/spec/v1.md`, migration issues #1–#6

## Tone

Same as Neo's everywhere — terse, signal-first. Slave-MBP touches social media accounts; treat any change to posting flow as production. When in doubt about whether a code change might mis-post, dry-run with a test caption first.
