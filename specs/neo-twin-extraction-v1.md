# Neo-twin Extraction — Spec v1.0

**Status:** Approved 2026-05-12. Open questions resolved (see §11). Execute after Phase 2/3 memory-table-separation deploy lands.
**Goal:** Move all neo-twin runtime code out of `claude-tools-kit` into a standalone `broneotodak/neo-twin` repo. Same pattern that pulled NACA out of `siti-v2`.
**Why now:** Today's memory-table-separation work surfaced architectural drift — neo-twin product code lives inside CTK (Neo's *generic* Claude Code toolkit). Fresh CC sessions opening CTK can't tell what's tooling vs what's a product backend. With the WhatsApp pipeline being actively reshaped (Phase 2/3), it's the natural moment to clean the repo boundary too.

---

## 1. The conflict this fixes

CTK's own CLAUDE.md is explicit: *"Generic Claude Code toolkit. Mission: tooling any Neo project uses."*

Today CTK contains:

| Path | What it actually is |
|---|---|
| `services/twin-ingest/` | neo-twin product backend — Baileys WhatsApp listener for Neo's primary phone, runs on Twin VPS pm2 |
| `tools/neo-twin/orchestrator.mjs` | neo-twin auto-reply orchestrator — Phase 6 Step 9, two-tier LLM, runs on Twin VPS pm2 |
| `specs/neo-twin-v2.md` | neo-twin tech spec |
| `tools/wa-primary-quality-backfill.js` | One-shot tool that operates on neo-twin's data |

None of those are "generic Claude Code tooling." They're product code for one specific product (neo-twin / digital twin / tr-home LLM fine-tune target). A future session asking "what does CTK do?" should get *one* clean answer, not a mix of generic SDK + one product's runtime.

Beyond aesthetics, there's a real coordination problem: every neo-twin deploy currently requires SSH'ing into Twin VPS and manually copying files because the VPS doesn't `git pull` from a "twin-ingest repo" — it pulls a single file at a time from CTK. After extraction, the VPS can simply `git pull origin main` on a `broneotodak/neo-twin` checkout. Same model as Siti VPS pulling from `broneotodak/siti`.

---

## 2. Conceptual boundary that survives the extraction

After this spec is executed, the WhatsApp-pipeline landscape looks like this:

| Product | Repo | Records WA from | Purpose |
|---|---|---|---|
| **neo-twin** | `broneotodak/neo-twin` (new) | Neo's primary phone (60177519610) | Train LLM(s) to speak as Neo; summarize life context; auto-reply in chosen groups as Neo |
| **Siti** | `broneotodak/siti-v2` + `broneotodak/naca` | Siti's number (60126714634) | Help Neo do work; persona is Siti, not Neo; voice + WA + tools |
| **siti-ingest** | `broneotodak/siti` (legacy, narrow) | Siti's number — the listener half only | Receive WA messages → write `wa_messages` (source=`siti-wa`) |

They share *infrastructure* — `wa_messages` table, `@todak/memory` SDK, heartbeat lib, the Tailnet, Gemini, NAS-MinIO — but not *purpose*. Today's table-separation work made the data boundary clean; this spec makes the repo boundary clean.

Why this matters for future sessions: a CC session opening `broneotodak/neo-twin/CLAUDE.md` immediately reads "this is the twin product." A session opening `broneotodak/siti-v2/CLAUDE.md` reads "this is Siti's WhatsApp interface." No confusion about whose persona, whose VPS, whose data.

---

## 3. Target repo structure

```
broneotodak/neo-twin            ← NEW (MIT license, like NACA)
  README.md                     ← public-facing pitch (Neo's digital twin)
  LICENSE
  CLAUDE.md                     ← strict guardrails (tier_1, Twin VPS deploy rules)
  package.json                  ← workspace root if we go monorepo, else top-level
  pnpm-workspace.yaml           ← if monorepo

  services/
    twin-ingest/                ← was: CTK/services/twin-ingest/
      index.js
      dashboard.js
      package.json              ← already standalone
      package-lock.json
      .gitignore
      README.md
    orchestrator/               ← was: CTK/tools/neo-twin/
      orchestrator.mjs
      package.json
      README.md

  lib/
    heartbeat.mjs               ← vendored copy from CTK/lib/heartbeat.mjs
                                ← Phase B (later): replace with @todak/heartbeat package

  tools/
    wa-primary-quality-backfill.js  ← was: CTK/tools/wa-primary-quality-backfill.js
    (future) wa-chat-importer.js, wa-person-extractor.js, wa-person-enricher.js
    (when they land — they're WIP in another CC session right now)

  docs/
    spec/
      neo-twin-v2.md            ← was: CTK/specs/neo-twin-v2.md
      memory-table-separation-impact.md  ← NEW: how this repo participates in the wa_messages story
    archive/
      (any historical docs worth preserving)

  prompts/
    focus/
      NEO-TWIN.md               ← session briefing for fresh CC sessions
```

CTK after extraction shrinks back to:

```
claude-tools-kit
  packages/memory/              ← @todak/memory SDK (unchanged)
  lib/heartbeat.mjs             ← stays (siti-v2, naca-app, other agents use it)
  tools/                        ← generic CC tooling, save-memory.js, etc.
  prompts/focus/                ← per-project focus prompts (incl. pointer to neo-twin)
  enforcement/                  ← CTK rules
  specs/fleet-command-center.md ← stays (FCC isn't neo-twin)
```

---

## 4. File-by-file migration

### Move (delete from CTK, add to broneotodak/neo-twin)

| From CTK path | To neo-twin path | Notes |
|---|---|---|
| `services/twin-ingest/index.js` | `services/twin-ingest/index.js` | No code change in the move; the imports stay relative |
| `services/twin-ingest/dashboard.js` | `services/twin-ingest/dashboard.js` | Same |
| `services/twin-ingest/package.json` | `services/twin-ingest/package.json` | Bump version 1.0.0 → 1.1.0 (post-Phase-2 wa_messages flip) |
| `services/twin-ingest/package-lock.json` | `services/twin-ingest/package-lock.json` | Carry forward |
| `services/twin-ingest/README.md` | `services/twin-ingest/README.md` | Update deploy section to reflect new git-pull flow |
| `services/twin-ingest/.gitignore` | `services/twin-ingest/.gitignore` | Carry |
| `tools/neo-twin/orchestrator.mjs` | `services/orchestrator/orchestrator.mjs` | Move + rename dir (was `neo-twin`, now `orchestrator` to disambiguate from repo name) |
| `tools/neo-twin/package.json` | `services/orchestrator/package.json` | Same |
| `tools/neo-twin/README.md` | `services/orchestrator/README.md` | Same |
| `specs/neo-twin-v2.md` | `docs/spec/neo-twin-v2.md` | Move spec into the product repo where it belongs |
| `tools/wa-primary-quality-backfill.js` | `tools/wa-primary-quality-backfill.js` | Move |

### Vendor (copy, not move — CTK keeps its copy)

| From CTK | To neo-twin | Why |
|---|---|---|
| `lib/heartbeat.mjs` | `lib/heartbeat.mjs` | Other CTK consumers (siti-v2's old code, naca-app agents, etc.) still depend on it. Vendoring avoids needing to publish `@todak/heartbeat` immediately. Phase B can promote this to a workspace package and replace both copies with the published version. |

### Update import path

After the orchestrator moves to `services/orchestrator/orchestrator.mjs`, its import from `../../lib/heartbeat.mjs` becomes `../../lib/heartbeat.mjs` — same relative depth, no change needed. Lucky.

### Leave in CTK (don't touch)

- `packages/memory/` — `@todak/memory` SDK, used everywhere
- `lib/heartbeat.mjs` — also used by other agents
- `tools/save-memory.js`, `check-latest-activities.js`, `neo_brain_client.py`, `claude-startup-context.js`, etc. — generic CC tooling
- `specs/fleet-command-center.md` — FCC is its own concern
- `enforcement/`, `prompts/focus/` — CTK governance

### WIP files in another CC session — **do NOT touch in this PR**

The other CC session has untracked files in CTK (per `git status`):
- `tools/wa-chat-importer.js`
- `tools/wa-person-enricher.js`
- `tools/wa-person-extractor.js`
- `tools/backfill-nclaw-contacts-to-people.mjs`

These ARE conceptually neo-twin tools and SHOULD eventually live in `broneotodak/neo-twin/tools/`. But they're not committed yet. **Out of scope for this PR.** Once they land on CTK main, a follow-up migration PR moves them. Documenting here so they don't get lost.

---

## 5. Twin VPS deploy choreography

Twin VPS layout today (`5.161.126.222`, user `neotwin`):

```
/home/neotwin/twin-ingest/      ← copy of CTK/services/twin-ingest/, deployed by scp+restart
/home/neotwin/neo-twin/         ← copy of CTK/tools/neo-twin/ (orchestrator)
```

Two separate dirs, deployed by manual file copy. Both pm2 processes (`twin-ingest`, `neo-twin-orchestrator`) run from those dirs.

Target Twin VPS layout:

```
/home/neotwin/repo/             ← git clone of broneotodak/neo-twin (per decision §11.5)
  services/twin-ingest/         ← pm2 starts from here
  services/orchestrator/        ← pm2 starts from here
  lib/heartbeat.mjs
/home/neotwin/twin-ingest.old.YYYYMMDD/    ← preserved 1 week
/home/neotwin/neo-twin.old.YYYYMMDD/       ← preserved 1 week
```

One repo. Git-pull deploy. Same pm2 process names so monitors don't need updating. Old dirs kept for rollback (§5 Phase C cleanup removes them).

### Phase A — Bring up the new repo without disrupting prod (no downtime)

1. Create `broneotodak/neo-twin` on GitHub (MIT, empty).
2. Local: `git clone` empty repo, copy files per §4 migration list, commit as initial scaffolding.
3. Push to GitHub.
4. SSH Twin VPS, `git clone broneotodak/neo-twin /home/neotwin/repo`. Run `pnpm install` at repo root (monorepo).
5. Verify clone has identical code as the running dirs (diff against `/home/neotwin/twin-ingest/` and `/home/neotwin/neo-twin/`).
6. Open PR on CTK with the *deletions* (the file removals from CTK). DO NOT merge yet.

At this point: prod still runs the old dirs. New repo is staged on the VPS but not active. CTK PR is open but not merged.

### Phase B — Cutover (during the same window as Phase 2/3 deploy if convenient)

1. `pm2 stop twin-ingest neo-twin-orchestrator` — both pause briefly.
2. Rename: `mv /home/neotwin/twin-ingest /home/neotwin/twin-ingest.old.$(date +%Y%m%d)`.
   Rename: `mv /home/neotwin/neo-twin /home/neotwin/neo-twin.old.$(date +%Y%m%d)`.
3. No rename of the new clone — `/home/neotwin/repo/` is the canonical path (decision §11.5).
4. Update pm2 ecosystem (or `pm2 delete` + `pm2 start`) to point at:
   - `/home/neotwin/repo/services/twin-ingest/index.js` (process: twin-ingest)
   - `/home/neotwin/repo/services/orchestrator/orchestrator.mjs` (process: neo-twin-orchestrator)
5. `pm2 save` so the new paths persist across reboots.
6. Sanity-check the dashboard at `5.161.126.222:3900` comes up.
7. Sanity-check twin-ingest writes a row to `wa_messages` (send Neo's primary phone a test message).
8. Merge the CTK PR (file removals). Now CTK is clean.

### Phase C — Cleanup (after 1 week of stable operation)

1. `rm -rf /home/neotwin/twin-ingest.old.* /home/neotwin/neo-twin.old.*`
2. Save `shared_infra_change` memory documenting completion.

---

## 6. Why this spec doesn't conflict with the in-flight Phase 2/3 PRs

The Phase 2 PRs (siti-v2 #63, CTK #45, siti #59, naca #17) all modify files **in their current locations**. They land first, get deployed, prod stabilizes on `wa_messages`. Then *this* extraction spec runs:

- The CTK PR #45 changes that touched `services/twin-ingest/index.js` etc. are at v1.1.0 by the time we extract — the new repo carries those changes forward.
- twin-ingest is already paused on Twin VPS (memory `e00ba3a0`) — re-starting it during Phase 2 deploy with the new code is the same operation whether the code lives in CTK or neo-twin repo.
- After Phase 3 migration drops the WA rows out of `memories`, all consumers are reading `wa_messages` — none of them care which repo the writer lives in.

Dependencies:
- **Phase 2 deploy must land FIRST** (writers + readers point at `wa_messages`).
- **Phase 3 migration must land FIRST** (historical rows moved, knowledge bucket clean).
- THEN: this extraction can execute without coordination with Siti, NACA, or any other session.

---

## 7. Boundary rules for the new `broneotodak/neo-twin` repo

The new repo's CLAUDE.md should encode:

1. **Identity:** "This is **neo-twin** — Neo's digital twin product. Captures Neo's primary-phone WA, summarizes context, drafts replies *as Neo*, and provides training data for tr-home LLM fine-tuning. NOT Siti. NOT NACA platform."
2. **Persona:** "All LLM outputs in this repo speak as Neo. Lowercase, BM-dominant, casual, particles ('la', 'kot', 'eh'). NEVER use Siti's tone or persona. If a feature needs Siti's voice, it belongs in siti-v2, not here."
3. **Data:** "Reads `wa_messages` (source=`wa-primary`) and writes `wa_messages` + `facts`/`personal_facts` + neo-brain.media. Use `@todak/memory` SDK, never raw SQL."
4. **Boundary with Siti:** "If you find yourself touching anything in `wa_messages` with `source='siti-wa'`, STOP. That's Siti's lane. neo-twin only reads/writes `source='wa-primary'`."
5. **VPS:** "Runs on Twin VPS (`5.161.126.222`, user `neotwin`). Deploy = git pull + pm2 restart. Same playbook as `services/twin-ingest/README.md`."
6. **Tier:** `tier_1` per WORKFLOW.md. CTK §9 governs any changes that write to shared neo-brain tables. Branch + PR + reviewer + admin merge for every change.

A focus prompt at `claude-tools-kit/prompts/focus/NEO-TWIN.md` should point new CC sessions at this repo and the boundary rules. Pinned next to the existing focus prompts.

---

## 8. Risks + rollback

| Risk | Mitigation |
|---|---|
| pm2 ecosystem fails to find new paths | Test with `pm2 startOrReload` against the new ecosystem file before deleting old dirs. Keep `.old.*` dirs for 1 week. |
| `npm install` produces different lock state on Twin VPS | Carry `package-lock.json` forward; `npm ci` instead of `npm install` for reproducibility |
| Heartbeat-lib drift between CTK copy and neo-twin vendored copy | Document the vendor relationship in both; Phase B promotion to `@todak/heartbeat` package is the long-term fix. |
| Other CC session's WIP tools (wa-chat-importer etc.) get orphaned mid-extraction | Out of scope for this PR. Document them as Phase D follow-up. |
| Twin VPS dashboard URL `5.161.126.222:3900` changes | It doesn't. Same code, same port, same hostname. Only the on-disk path changes. |
| Rollback after cutover | `mv /home/neotwin/neo-twin /home/neotwin/neo-twin-bad && mv /home/neotwin/twin-ingest.old.* /home/neotwin/twin-ingest && pm2 restart twin-ingest`. Old dirs are kept for 1 week per §5 Phase C. |

---

## 9. Pre-flight (CTK §9 shared-infra)

Before Phase A:
- [ ] Phase 2 deploy of memory-table-separation has landed and is stable for >24h
- [ ] Phase 3 migration has completed; `SELECT COUNT(*) FROM memories WHERE source IN (...) = 0`
- [ ] Twin VPS dashboard (`:3900`) is back online and showing fresh data from `wa_messages`
- [ ] No active CC session is editing CTK files in `services/twin-ingest/` or `tools/neo-twin/`
- [ ] Other CC session's WIP WA-tools (wa-chat-importer etc.) have either landed or been confirmed parked

After each phase:
- [ ] Save `shared_infra_change` memory with phase summary
- [ ] Verify dashboard + twin-ingest write path with a real WA message
- [ ] Verify orchestrator pulls candidates from `wa_messages` correctly

---

## 10. Acceptance criteria (whole spec)

- [ ] `broneotodak/neo-twin` repo exists on GitHub, MIT-licensed, with the file layout in §3
- [ ] CLAUDE.md in new repo encodes the boundary rules from §7
- [ ] Twin VPS runs both `twin-ingest` and `neo-twin-orchestrator` pm2 processes from `/home/neotwin/neo-twin/services/*/`
- [ ] Old dirs (`/home/neotwin/twin-ingest`, `/home/neotwin/neo-twin`) renamed to `.old.*` and kept ≥1 week
- [ ] CTK PR removes `services/twin-ingest/`, `tools/neo-twin/`, `tools/wa-primary-quality-backfill.js`, `specs/neo-twin-v2.md`
- [ ] CTK CLAUDE.md updated: "twin-ingest and neo-twin orchestrator have been extracted to `broneotodak/neo-twin`. Anything WA-pipeline-related goes there, not here."
- [ ] `prompts/focus/NEO-TWIN.md` exists in CTK pointing fresh sessions at the new repo
- [ ] Fleet monitors (Uptime Kuma push monitors for twin-ingest, plaud, etc.) continue working — they monitor process state, not file paths
- [ ] `shared_infra_change` memory saved for each Phase (A, B, C)

---

## 11. Locked decisions (Neo, 2026-05-12)

1. **Repo name:** `broneotodak/neo-twin`.
2. **License:** MIT — same pattern as NACA. Door stays open.
3. **Monorepo:** `pnpm-workspace.yaml` with `services/*` as workspace packages. Consistent with NACA.
4. **Phase 6 dataset pipeline:** **Leave separate.** It's a different project that just happens to use neo-twin data. Not part of this extraction. Keep in CTK (or wherever it currently lives) until it gets its own home decision.
5. **VPS path:** Clone the new repo to `/home/neotwin/repo/` (not `/home/neotwin/neo-twin/`). Avoids collision with the existing `/home/neotwin/neo-twin/` dir (which will be renamed `.old.YYYYMMDD` during cutover). Final pm2 process targets become `/home/neotwin/repo/services/twin-ingest/index.js` and `/home/neotwin/repo/services/orchestrator/orchestrator.mjs`.
6. **Timing:** Execute right after Phase 3 migration lands. Not batched with other follow-ups.

## 12. NACA impact assessment (verified 2026-05-12)

Concern raised: would this extraction affect the in-flight NACA architecture work?

**Answer:** No. NACA platform-refactor-v1 is **complete** as of 2026-05-11 — all 11 phases shipped (memory `87ee36ad` documents Phase 8 completion; naca-app PR #24 finalised "11/11 phases shipped"). Subsequent NACA work is in different sprints (naca-monitor, naca-app feature work) and doesn't touch CTK twin-ingest paths.

Grep across `broneotodak/naca`, `broneotodak/naca-app`, `broneotodak/naca-mcp-bridge`, `broneotodak/naca-monitor` found exactly three references to twin-ingest/neo-twin:

| Location | Type | Affected by extraction? |
|---|---|---|
| `naca/packages/tools/src/check-agent-status.js:25` | Docstring example listing agent names | No — process name stays `twin-ingest` |
| `naca/packages/tools/src/lookup-resource.js:119, 231` | `NOISE_SOURCES` string set (data labels) | No — source labels in `wa_messages` table, not code paths |
| `naca-app/README.md:22` | Prose listing fleet agents | No — documentation, no dependency |

Zero code-path coupling. The two products share only the data plane (`wa_messages` table). This extraction *applies the NACA pattern consistently* — it doesn't fight it.

Post-extraction follow-up: update `naca/docs/spec/memory-table-separation-v1.md` to reflect new paths (`claude-tools-kit/services/twin-ingest/…` → `neo-twin/services/twin-ingest/…`). One-line search-and-replace edits.
