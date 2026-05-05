# Todak Academy Focus CC Session Prompt

Paste below into a fresh Claude Code session as the first message when working on the Todak Academy project. After this, the session knows the cutover state, who has what access, what NOT to break, and the specific shape of "live publishing" for this project (which is a *cutover migration*, not a soft launch).

**Before doing anything else, read `~/Projects/claude-tools-kit/WORKFLOW.md`** (canonical 5-phase work flow). Todak Academy is `tier_1` in `project_registry.tier` — NORMATIVE rules apply, especially around customer-facing changes (parents, students, school staff are real users).

---

You are scoped to **Todak Academy** — Neo's React/Supabase student-portal rewrite of the original Laravel system at `todakacademy.edu.my`. The session's mission is to take the v2 from "feature-complete on academy.neotodak.com" to "live on todakacademy.edu.my, fully replacing the old system" without disrupting parents/students who are actively using the old portal during the day.

## What this is

A **production cutover migration**. Two systems run in parallel right now; one will be retired. Order of operations matters because real families depend on the old portal.

## The two systems

| | Old (incumbent) | New (target) |
|---|---|---|
| **Domain** | `todakacademy.edu.my` (live, parents/students on it) | `academy.neotodak.com` (current home of the v2 build) |
| **Stack** | Laravel 10, MySQL (likely), BillPlz payments | React 18 + TypeScript + Vite + Supabase + MUI |
| **Repo** | `~/Projects/todak-academy-portal` (only 2 commits — a snapshot, NOT the live origin) | `broneotodak/todak-academy-v2` |
| **Hosting** | unknown origin behind Cloudflare proxy (172.67.x / 104.21.x) | Netlify auto-deploy on push to main |
| **Access** | Neo does NOT have direct admin access — see "Pele" in Digitech handover memory; needs coordination | Neo owns the Supabase project (`hgdlmgqduruejlouesll`) |
| **Database** | MySQL/MariaDB (Laravel default) — unmigrated | Supabase Postgres at `hgdlmgqduruejlouesll` — fresh |
| **Pages built** | full legacy portal (production) | 17 pages already shipped |
| **Roadmap remaining** | n/a (legacy) | e-invoice (Phase 3), hostel (Phase 4) — POST-cutover |

## Cutover plan — high level

The cutover is a 4-stage operation. Don't skip stages. Don't compress them into one night unless a stage's verification can also be done that night.

### Stage 1 — Inventory + access
- Identify exact origin server for `todakacademy.edu.my` (Cloudflare hides it). Need DNS/Cloudflare account access — Neo's, or via "Pele" (per Apr 23 Digitech handover memory).
- Get a fresh MySQL dump from the Laravel system. Schema + data.
- Inventory current data volumes: students, parents, payments, invoices, attendance records, results, etc.
- Confirm with Taufik + Kai which fields/tables are operationally live vs vestigial.

### Stage 2 — Schema mapping + migration script
- Map Laravel/MySQL schema → Supabase Postgres schema. The v2 schema in `hgdlmgqduruejlouesll` may not perfectly match the legacy schema.
- Write a migration script (Node or Python) that reads the MySQL dump, transforms fields, and inserts into Supabase. Idempotent. Dry-run capable.
- Test the migration in a Supabase staging branch (NOT main) first.
- Reconcile counts: every row in old → either migrated or explicitly skipped with reason.

### Stage 3 — Provision new infrastructure (if needed)
Neo's WhatsApp message (2026-05-05): "*nanti aku akan setupkan 1 VPS untuk run korang punya project*" — implies a VPS is being provisioned to host the new system. But the v2 is already on Netlify (auto-deploy from main). Decide:
- Stay on Netlify (zero new infra) and just point DNS at it, OR
- Move to a dedicated VPS for control / Cloudflare-tunnel reasons / .edu.my SSL handling
- Confirm with Neo before provisioning anything new.

### Stage 4 — DNS cutover (the actual flip)
- **Window**: late night MYT to minimize disruption to parents/students. Confirm exact night with Taufik.
- **Sequence**:
  1. Migrate latest data deltas (anything that landed in legacy since the dry run)
  2. Put legacy in maintenance / read-only mode
  3. Flip DNS: `todakacademy.edu.my` A/CNAME records → new origin
  4. Wait for DNS propagation; verify from multiple networks
  5. Test critical user flows: login, view grades, pay invoice, view attendance
  6. Announce in `TA System Developer` group when verified
- **Rollback path**: revert DNS to legacy origin. Keep the legacy origin warm for 7 days minimum post-cutover.

## Live layout (right now, pre-cutover)

| What | Where |
|---|---|
| New v2 repo | `~/Projects/todak-academy-v2` |
| Stale Laravel snapshot (DO NOT TOUCH for v2 work) | `~/Projects/todak-academy-portal` |
| Current v2 deploy URL | https://academy.neotodak.com (Netlify auto from main) |
| Target v2 deploy URL post-cutover | https://todakacademy.edu.my |
| Supabase project ref | `hgdlmgqduruejlouesll` (use the supabase MCP for this project) |
| Legacy Cloudflare DNS | rayne.ns.cloudflare.com / luke.ns.cloudflare.com |
| Legacy origin IP | UNKNOWN (hidden behind CF — must obtain access) |
| Tier in `project_registry` | tier_1 (NORMATIVE) |

⚠️ **Two registry rows exist for this project** — `academy-rewrite` and `todak-academy-v2`. Same repo, same deploy_url. Should be deduped in a separate cleanup PR. Flag, don't fix mid-cutover.

## Stakeholders

| Person | Role | How to reach |
|---|---|---|
| **Neo** (you) | Operator, decision-maker, single point of approval | this session |
| **Taufik** (Todak Acad) | Academy team rep on cutover decisions | `TA System Developer` WhatsApp group via Siti |
| **Kai** (`@237335782420649`) | Academy team dev — can request changes via Siti, approval routes through Neo (per 2026-04-29 memory) | via Siti |
| **"Pele"** (per 2026-04-23 Digitech handover memory) | Holder of the legacy DB / server access | Neo needs to coordinate access |

## Hard rules — DO NOT violate

1. **NEVER DNS-flip without Neo explicitly authorizing the cutover window.** This affects parents/students. Single biggest blast radius in this project.
2. **NEVER apply Supabase schema changes to the v2 prod project (`hgdlmgqduruejlouesll`) without operator confirmation.** Use a Supabase branch or staging migration first. The migration script lands in prod *only* after Stage 2 dry-run passes.
3. **NEVER bypass Kai → Siti → Neo approval flow** for Kai-originated change requests. Approval gates are part of how the team trusts this rewrite.
4. **NEVER push directly to main on `todak-academy-v2`** — anomaly auto-revert PR will fire. Branch + PR + reviewer + admin merge.
5. **NEVER scope-creep into e-invoice (Phase 3) or hostel (Phase 4) during the cutover.** Both are POST-launch work.
6. **NEVER touch `~/Projects/todak-academy-portal`** for v2 work — it's a stale Laravel snapshot.
7. **For any production change during the cutover window, write a `shared_infra_change` memory the same hour.** Future debugging depends on this audit trail.

## First-90-seconds debug entry points

- **"What's deployed right now?"** — `git log --oneline -5` in `~/Projects/todak-academy-v2` + `curl -sS -o /dev/null -w "%{http_code}\n" https://academy.neotodak.com`. Most-recent build hash should match HEAD.
- **"Did the migration script run cleanly?"** — query Supabase `hgdlmgqduruejlouesll` for the row counts of the migrated tables. Compare against the source dump's counts. Differences MUST be explainable.
- **"Site went down right after cutover."** — first check DNS resolution from multiple resolvers (`dig +trace todakacademy.edu.my`). If DNS hasn't propagated, wait. If it has propagated to the new origin and the origin is failing, ROLLBACK DNS first, debug second.
- **"Parent says they can't log in."** — likely a row that didn't migrate, or a password-hash format mismatch (Laravel bcrypt vs Supabase auth). Reconcile against the source dump.
- **"Where does the .edu.my SSL cert come from?"** — depends on Stage 3 decision. Cloudflare-fronted = CF cert. Bare Netlify = Let's Encrypt automated. Neo VPS = depends on his TLS setup.

## Memory discipline (when shipping anything during cutover)

- **Category**: `shared_infra_change` for prod-affecting changes (DB migration, DNS flip, schema apply). Also `project_todak_academy_v2` for milestones (pre-flight passed, dry-run passed, cutover scheduled, cutover executed, day-1 soak clean).
- **Scope**: `ops` for cutover ops; `knowledge` for any team-facing doc updates.
- **Importance**: 9 for the DNS flip itself. 8 for major migration-script runs. 6-7 for routine pre-flight verifications.
- **Always include**: pre-state, exact commands run, expected post-state, verification step, rollback command. Especially the rollback — every step needs a documented undo path.

## Pointers

- `~/Projects/claude-tools-kit/WORKFLOW.md` — canonical work flow
- `~/Projects/claude-tools-kit/REVAMP-V1.0.0.md` — current operation context (NACA-side)
- neo-brain memories worth recalling at session start:
  - `project_academy_rewrite`
  - any memory tagged `Digitech Handover` (for legacy access context — "Pele")
  - `feedback_credentials_vault_first` (for any cred handling during the migration)
  - `feedback_naca_siti_no_assumptions` (verify before assuming legacy state)

## Tone

Customer-facing live system. Real families on the receiving end. Match seriousness to consequence. **Don't ship features. Ship readiness.**
