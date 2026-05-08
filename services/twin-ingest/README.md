# twin-ingest

Read-only WhatsApp listener for Neo's primary number (`+60177519610`). Ingests messages into neo-brain `memories` for the digital-twin pipeline. Lives behind pm2 on Twin VPS (`5.161.126.222`).

**Tier:** `tier_1` — `tier_1` rules apply per `WORKFLOW.md`. CTK §9 governs all changes (memory writes, schema interactions).

## What it does

| Component | Role |
|---|---|
| `index.js` | Baileys WhatsApp socket listener. Reads every message Neo's account receives or sends. Filters (length / score / archived-group / Lever-A) and routes to neo-brain. Loads owner-identity Sets at startup so LID-fragmented group senders correctly route to OWNER_ID. |
| `dashboard.js` | HTTP server on port 3900 serving the operator dashboard at `http://5.161.126.222:3900`. Tabs: INTELLIGENCE / PEOPLE / FACTS / LIVE FEED / GRAPH / DUPES. Reads neo-brain people + memories + facts. Filters out `metadata.archived_chat=true` memories and `metadata.no_dm_history=true` people. People panel sorts by `metadata.engagement.mutual_dm` (real conversation, not broadcast volume). |

## Live deploy (current flow)

The VPS file is the source of truth at runtime. This CTK directory is a **mirror for governance + history**. To deploy a change:

```bash
# 1. Edit the file in this CTK directory locally.
# 2. node --check services/twin-ingest/<file>.js
# 3. PR + merge to main.
# 4. SSH to Twin VPS and copy the new version, then restart pm2.
ssh root@5.161.126.222
su - neotwin
cd /home/neotwin/twin-ingest
cp index.js index.js.bak.$(date -u +%Y%m%d-%H%M%S)
# Pull the new version (paste, scp, or git clone if/when this dir is git-pulled directly on the VPS)
node --check index.js
pm2 restart twin-ingest
pm2 logs twin-ingest --lines 50 --nostream
```

(Future improvement: replace this with a git-pull on the VPS so deploy = `git pull && pm2 restart`.)

## Required environment (VPS-side `.env`, NOT committed)

```
NEO_BRAIN_URL=
NEO_BRAIN_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
OWNER_PHONE=60177519610
OWNER_ID=00000000-0000-0000-0000-000000000001
LEGACY_DB_URL=                # for monitored-groups lookup (twin_active_state)
LEGACY_DB_SERVICE_ROLE_KEY=
```

## Hard rules (matching `prompts/focus/TWIN-VPS.md`)

1. **NEVER delete `auth-state/`** without backing it up first. Re-pairing requires the backup if it fails.
2. **NEVER skip Linked-Devices detach** before re-pairing.
3. **NEVER auto-send replies** while neo-twin is in shadow soak.
4. **NEVER trust the dashboard counters as live state** (LAST 1H/24H are queried from neo-brain — those are accurate; pm2 process stats are since-startup).

## Filter chain (as of 2026-05-08)

`processMessage()` ordering:
1. Length: `text.length < MIN_LEN` → skip (bypassed for `MONITORED_GROUPS`)
2. Empty text → skip
3. **Lever A (2026-05-07)**: `isGroup && !isFromMe && !isMonitored` → skip (drops 32% of historical volume — group chatter Neo doesn't engage with)
4. `SKIP_GROUPS` Set → skip if hit
5. Gemini classifier (score 0–10)
6. THRESHOLD: `score < 3` → skip (bypassed for `MONITORED_GROUPS`)
7. → `ingestMessage()`

`ingestMessage()` fact attribution:
- Owner branch (Neo-alias mentioned, or sender is owner): facts → `OWNER_ID`
- **Lever D (2026-05-07)**: sender branch ONLY fires when `!isGroup`. Group senders no longer accumulate facts on their people rows.

## Memories on neo-brain that document the design

- `0957d874-4dc5-4296-a734-7f4737b7ecf0` — initial enrichment + Phase A (2026-05-05/06)
- `e25b4b93-28f0-4108-85e9-cb7127acb5f5` — LID dedup + identity-aware ingest (2026-05-06)
- `c2ee63b0-c5ae-4463-85b3-c9112a9b0c70` — manual-curation features + protection (2026-05-06)
- `e97f491e-7bd5-420f-87b5-1876782ed7f0` — wa-primary contamination investigation (2026-05-07)
- `229cb590-fae3-41dd-982c-22e83117493b` — Levers A + D shipped (2026-05-07)
- (forthcoming) — combined backfill + dashboard rewire (2026-05-08)

Search any of those via `nb.search()` for full context.
