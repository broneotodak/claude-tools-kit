# Fleet Command Center — Tech Spec

**Status:** draft, Phase 1 building now (2026-05-03)
**Author session:** Neo MBP CC (Opus 4.7 1M), 2026-05-03
**Reviewer:** Neo

---

## 1. Goal

A unified operational view of every Todak/Neo project + every fleet agent + every active CC session. Replaces the current scattered sources (neo-brain memories, GitHub READMEs, presentation.neotodak.com decks, CTK docs) with one always-up dashboard that links them all together — and shows real-time signals: which agent / VPS / CC session / operator MBP is currently working on what.

This is split from the smaller "tr-home box dashboard" because:
- The fleet view must survive tr-home going down (home wifi/power blip mustn't blind us to the rest of the fleet).
- tr-home is a GPU box; the command center is a web app.
- Demoing the command center publicly later is easier from Netlify than from a home tailnet box.

The two surfaces cross-link: clicking `tr-home` in the fleet view drills into the box dashboard.

---

## 2. Architecture

```
                ┌─────────────────────────────────────────────────────┐
                │  command.neotodak.com (Netlify)                     │
                │   ├─ Static SPA (HTML + JS, no framework needed)    │
                │   ├─ Netlify Functions for service-role neo-brain   │
                │   │   queries (anon-key + RLS too brittle for V1)   │
                │   ├─ 5s polling, optional SSE later                 │
                │   └─ PIN-gated cookie auth (parity w/ presentation) │
                └─────────────────────────────────────────────────────┘
                                       │
                                       │ HTTPS, service-role via fns
                                       ▼
                ┌─────────────────────────────────────────────────────┐
                │  neo-brain (xsunmervpyrplzarebva)                   │
                │   ├─ project_registry      (existing, needs backfill)│
                │   ├─ project_milestones    (Phase 3 — see §6)        │
                │   ├─ agent_registry        (existing)                │
                │   ├─ agent_heartbeats      (existing)                │
                │   ├─ agent_commands        (existing — running work) │
                │   ├─ memory_writes_log     (existing — CC presence)  │
                │   └─ session_presence      (Phase 4 — see §7)        │
                └─────────────────────────────────────────────────────┘
                                       ▲
                                       │ writes
                                       │
   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
   │ Siti VPS agents │  │ Twin VPS agents │  │ tr-home, CLAW,  │
   │                 │  │                 │  │ Slave MBP, etc. │
   └─────────────────┘  └─────────────────┘  └─────────────────┘

   ┌─────────────────────────────────────────────────────┐
   │  tr-home:3500 (dashboard sidecar — separate spec)   │
   │   ├─ Box health, Ollama stats, twin_drafts callers  │
   │   └─ Linked from command.neotodak.com               │
   └─────────────────────────────────────────────────────┘
```

---

## 3. Data sources (all already exist)

| Signal | Table | Producer | Freshness |
|---|---|---|---|
| Project list | `project_registry` | manual + agents | as-edited |
| Milestone tree | `project_milestones` (P3) | manual + agents | as-edited |
| Fleet agents | `agent_registry` | one-time registration | static |
| Agent pulse | `agent_heartbeats` | each agent every 60s | 60s |
| Active commands | `agent_commands` | inter-agent RPC | seconds |
| CC session writes | `memory_writes_log.written_by` | every memory write | seconds |
| Operator MBP pulse | (gap — Phase 4) | new heartbeat from MBPs | 60s |

---

## 4. Phase 1 — tr-home box dashboard + fleet snapshot bonus (in progress 2026-05-03)

Already speced separately. One bonus panel on tr-home:3500: a "Fleet Snapshot" strip showing `agent_registry` joined with most-recent `agent_heartbeats`, status pills (active / stale / offline). Validates the join pattern that Phase 2 will reuse.

Deliverable: `broneotodak/tr-home-dashboard` repo, deployed as systemd unit on tr-home.

---

## 5. Phase 2 — Fleet Command Center skeleton ✅ SHIPPED 2026-05-03

**Scope:** read-only fleet view, no project/milestone work yet.

**Pages (live):**
- `/` — Overview: agents grid (registry × latest heartbeat), recent commands feed (last 50), recent CC sessions (last 30 min by `memory_writes_log.written_by`)
- `/agent/?name=X` — single agent detail: 24h heartbeat history (10-min bucket graph) + commands sent/received

**Stack:** Netlify static + Netlify Functions. Single fat `/api/snapshot` endpoint for overview (one fetch, three datasets), `/api/agent/:name` for detail. PIN cookie auth (HMAC-signed, 7-day TTL). Service-role key in Netlify env, never to browser.

**Repo:** `broneotodak/neotodak-command`
**Site:** `https://command.neotodak.com` (custom domain on Netlify-managed DNS — `neotodak.com` zone is hosted by Netlify, so the CNAME was created automatically when the custom domain was registered)
**Netlify project ID:** `0e2cb2ae-21c7-4dc0-ac5f-712998cacefc`
**PIN/COOKIE_SECRET:** vaulted in neo-brain credentials under `service='command-center'`

**Verified end-to-end in production:** PIN gate (401 wrong, 200 right + Set-Cookie), snapshot returns live data (19 agents/15 active/50 commands/N sessions/tr-home freshness=active).

---

## 6. Phase 3 — Projects + Milestones ✅ SHIPPED 2026-05-03

**Schema decision: Plan A.** `naca_milestones` renamed to `project_milestones`, added `project` FK to `project_registry`, all 108 existing rows populated with `'naca-app'`. Backward-compat view `naca_milestones` (security_invoker=on) preserves the presentation deck.

Pre-flight grep results: zero code queries on Twin VPS, zero on naca-app, only one real caller — `presentation/naca-overview.html:902`. The view + identical anon RLS policies (renamed `project_milestones_anon_read`) keep that working unchanged. Verified post-deploy with anon-key REST query and live HTML fetch.

**Backfill:** 27 rows in `project_registry` (26 active + 1 archived). Added 19 new entries from MEMORY.md inventory; the 8 pre-existing kept as-is.

**Pages live:**
- `/projects` — list, milestone progress bars (phases done / in-progress / total), stack pills, repo links, deploy URLs
- `/project?slug=X` — registry row + metadata + full phase tree from `project_milestones`, status pills per phase + per step

**APIs live:**
- `/api/projects` — registry × milestone counts (single fat endpoint)
- `/api/project?slug=X` — single project + grouped phase tree

**Bugs fixed in same shipment:** Netlify path-style `:placeholder` substitution into query targets returned literal `:slug` — switched all path-param APIs to query-style. Trailing-slash auto-strip conflicted with glob redirects — switched to no-slash + explicit redirects.

**Smoke test:** `scripts/smoke.mjs` extended to 25 checks across 5 endpoints; all pass.

**Cross-links (deferred to Phase 4):** `meta.deck_url`, `meta.spec_url`, `meta.ctk_constraints` not yet wired into the UI but the metadata column accepts them.

---

## 7. Phase 4 — Cross-references + presence

- Live-fetch GitHub README excerpts (via gh API, cached 5min in `kv_cache` neo-brain table or in Netlify edge cache).
- Embed presentation.neotodak.com deck URLs.
- "Currently working" badges: join `agent_commands.status='running'` + recent `memory_writes_log.written_by` → display per-project lights.
- Operator MBP heartbeat: tiny launchd plist on each MBP that pushes to `agent_heartbeats` every 60s. (Neo MBP, Imel MBA, anyone else.)
- Optional: SSE replacing 5s polling.

---

## 8. Auth

- **Phase 1 (tr-home dashboard):** tailnet-only by default. PIN env var available but unset.
- **Phase 2+ (command center):** PIN-gated from day one. Reuse the `404282` family or generate a fresh one and store via `upsert_credential` (CTK §4) under service `command-center`.
- Public read-only mode for demos: behind a separate path like `/public` with redacted fields. Defer to Phase 4.

---

## 9. CTK constraints applying to this build

- §3.5 doc/memory pattern: this spec is the tech doc; decisions go to memory; progress to commits/PRs.
- §5 secrets: every new repo passes the pre-commit checklist before first push.
- §6 monitoring: every health signal we display must be source-validated. Don't repeat the `wa_status` anti-pattern. If a signal is push-based, the pusher ships in the same change.
- §9 multi-session: every Phase boundary that touches `project_registry`, `project_milestones`, `agent_heartbeats`, `agent_commands` is a shared-infra change → pre-flight check + post-deploy `shared_infra_change` memory.

---

## 10. Open questions

- Repo name for the command center: `neotodak-command`, `fleet-command`, `command-center`?
- Schema option A vs B for milestones (§6) — decide before Phase 3 starts.
- Operator MBP heartbeat agent: write a new tiny launchd plist or reuse claude-tools-kit's existing scaffolding?
- Public demo mode (§8): which fields are safe to show without PIN?
- Long-term: should `project_registry.sop` start pointing to claude-tools-kit/specs/ files automatically once specs are tagged with `project:` frontmatter?
