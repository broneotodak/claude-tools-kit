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

## 7. Phase 4 — Cross-references + presence (PARTIAL)

- ✅ Operator MBP heartbeat (Neo MBP via launchd; Imel pending)
- ✅ Operator NAS heartbeat (`nas-ugreen` via systemd user timer + linger)
- ✅ Honest agent detail card (replaced misleading 24h graph after schema reality check)
- ⏳ Live-fetch GitHub README excerpts on `/project` page (gh API + edge cache)
- 🛑 "Currently working" badges — tabled, needs `agent_commands → project` mapping design (§10)
- ⏳ SSE replacing 5s polling — optional, deferred

## 7b. Phase 5 — Native + Observable (NEW, in progress)

Goal: command center becomes the Ubuntu desktop default + NACA agents can read its health programmatically.

- ✅ `/api/health` public endpoint — anon-readable aggregate (status / counts / FCC progress). CORS open. Different audience from `/api/snapshot` (PIN-gated, raw rows).
- ✅ Ubuntu autostart on tr-home — `~/.config/autostart/command-center.desktop` fires `chromium --app=https://command.neotodak.com` on GNOME login. Chromium 147 installed via snap.
- ✅ NACA-agent consumption pattern — see §11 below.
- ⏳ Supervisor rule: alert Neo via Siti when `/api/health` flips to `degraded` for ≥N consecutive polls (per MONITORING_ENFORCEMENT.md — both edges, dry-run, source-validated).
- ⏸️ System tray indicator — deferred polish.

---

## 8. Auth

- **Phase 1 (tr-home dashboard):** tailnet-only by default. PIN env var available but unset.
- **Phase 2+ (command center):** PIN-gated from day one. PIN stored via `upsert_credential` (CTK §4) under service `command-center`, type `pin`. Cookie signing secret stored alongside under type `cookie_secret`. Plaintext never leaves the vault.
- Public read-only mode for demos: behind a separate path like `/public` with redacted fields. Defer to Phase 4.

---

## 9. CTK constraints applying to this build

- §3.5 doc/memory pattern: this spec is the tech doc; decisions go to memory; progress to commits/PRs.
- §5 secrets: every new repo passes the pre-commit checklist before first push.
- §6 monitoring: every health signal we display must be source-validated. Don't repeat the `wa_status` anti-pattern. If a signal is push-based, the pusher ships in the same change.
- §9 multi-session: every Phase boundary that touches `project_registry`, `project_milestones`, `agent_heartbeats`, `agent_commands` is a shared-infra change → pre-flight check + post-deploy `shared_infra_change` memory.

---

## 11. NACA-agent consumption pattern (Phase 5.4)

Fleet-Command-Center is **discoverable by NACA agents** via three paths, in increasing fidelity:

### 11.1 Aggregate health (anonymous, no PIN)

```
GET https://command.neotodak.com/api/health
```

Returns `status` (ok / degraded / down), human-readable `signals[]` if not ok, agent freshness counts, recent command stats, and FCC project progress. CORS open. Cache 30s at edge.

**Polling cadence for agents:**
- Supervisor + planner: every 60s
- Other agents (toolsmith, dev, reviewer): every 5min
- Treat `status=degraded` as a Siti-grade alert
- Treat `status=down` as a Siti-critical alert

### 11.2 Endpoint discovery via `project_registry.metadata`

Any agent can resolve FCC's URLs from neo-brain:

```sql
SELECT metadata->'endpoints' FROM project_registry WHERE project='fleet-command-center';
```

Returns `{health, snapshot, projects, project, agent, activity, public_deck, health_schema}`. Plus `metadata.consumers_hint` (free-text guidance), `metadata.monitorable=true`, `metadata.audience='fleet-wide'`.

This is the **primary discovery surface** — agents shouldn't hardcode URLs. If an endpoint moves, only `project_registry` updates.

### 11.3 Knowledge graph relationships

Seeded 10 `kg_triples` (subject_type=`project`, subject_key=`fleet-command-center`) using the existing predicate vocabulary — no new predicates introduced. Agents use:

```sql
SELECT * FROM kg_lookup('project','fleet-command-center');
```

To find the repo, deploy URL, supabase project, tech stack, status — same shape as every other project in the graph.

### 11.4 Granular fleet state (PIN-gated, full fidelity)

Agents that have the PIN (vault: `service='command-center'`, `type='pin'`) can hit:

```
POST /api/auth { pin } → cookie
GET /api/snapshot → 19+ agents × heartbeats × 50 commands × 30-min sessions
GET /api/agent?name=X → single agent detail
```

Reserved for high-trust agents (e.g. supervisor pulling specific offline agent names for a precise alert). Most agents should NOT need this — `/api/health` aggregate is enough.

---

## 10. Open questions

**Resolved (left here as decision log):**
- ~~Repo name~~ → `broneotodak/neotodak-command`
- ~~Schema option A vs B~~ → Plan A executed (rename + FK + backward-compat view), see §6

**Still open:**
- Operator MBP heartbeat agent: write a new tiny launchd plist or reuse claude-tools-kit's existing scaffolding? (Phase 4)
- Public demo mode (§8): which fields are safe to show without PIN? (Phase 4)
- Long-term: should `project_registry.sop` start pointing to claude-tools-kit/specs/ files automatically once specs are tagged with `project:` frontmatter?
- **Tabled (cross-cutting design):** how do we map `agent_commands` rows to a project so "currently working on X" badges become possible? Options: add `project` column to `agent_commands` (shared infra change), infer from payload (fragile), or new `agent_focus` table. Affects both NACA app's "currently working" UI AND command center Phase 4 cross-refs. Needs a dedicated design conversation before either surface builds toward it.
