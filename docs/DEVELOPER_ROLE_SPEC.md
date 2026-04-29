# Developer Role + Project Scope — Spec

**Status:** PARTIAL · 2026-04-29 · NACA half shipped, Siti gate work pending
**Scope:** Cross-cutting — Siti runtime + NACA UX + Siti-DB schema

> **Update 2026-04-29 (afternoon):**
> - Schema applied to `uzamamymfzhelvkwpvgt` (Siti's legacy DB — `nclaw_contacts` lives there, NOT on neo-brain `xsunmervpyrplzarebva`). The earlier note in this doc that said "neo-brain" was wrong.
> - `broneotodak/siti#33` merged + deployed: PATCH `/api/contacts/:id` now accepts `project_scope`.
> - `broneotodak/naca-app#1` merged + deployed: SITI tab UI shows `developer` and `readonly` in the dropdown, plus the project_scope text field when developer is selected.
> - **Pending — owned by Siti session:** `submit_planner_task` line 2521 still excludes `developer`, plus the auto-classifier path investigation (the path that let Hanis through). Until those land, even contacts marked `developer:project-X` will be rejected by `submit_planner_task`. The data side is ready; the gate side isn't.

## Why we need this

Two recent incidents proved the current allowlist is too coarse:

1. **2026-04-28 (Kai)** — TODAK Academy logo request from a non-allowlisted contact made admin in a WhatsApp group. Soft-override of the allowlist via WhatsApp group admin status. (Neo, retrospectively: "I broke my own rules.")
2. **2026-04-29 (Hanis)** — Tagged Siti for a Cursor guide task; planner accepted, dispatched to dev-agent. Hanis isn't on the allowlist either.

Pattern: trusted contributors with project-specific authority (Academy ops team, Lan's circle, etc.) need a way to request changes scoped to their project, **without** Neo bypassing the gate by promoting them to WhatsApp group admin.

## Current state in code (verified 2026-04-29)

`nclaw_contacts.permission` already has these values: `owner | admin | developer | readonly | blocked`

`developer` is **half-built**:

| Site | File:Line | Behavior | Gap |
|---|---|---|---|
| `canApprove` (PR approval reply) | `siti/server.js:4172` | Includes developer ✓ | OK |
| `canSubmitIntent` (DM regex intent) | `siti/server.js:4213` | Includes developer ✓ | Only fires in DMs, not groups |
| `submit_planner_task` tool | `siti/server.js:2521` | **Excludes developer** ✗ | Hard gate, owner/admin only |
| Auto-classifier (group → intent) | `siti/server.js:?` | TBD — needs investigation | This is the Hanis path |
| `project_scope` concept | nowhere | Doesn't exist | All elevated roles are global |

The gap that matters most: a contact set to `developer` today still gets rejected by the explicit `submit_planner_task` tool. And nothing checks scope-by-project anywhere.

## Schema change

```sql
-- Single migration on neo-brain (xsunmervpyrplzarebva)
ALTER TABLE nclaw_contacts
  ADD COLUMN project_scope text[] NOT NULL DEFAULT '{}';

-- For audit + future per-project approval routing
COMMENT ON COLUMN nclaw_contacts.project_scope IS
  'List of project codes this contact is authorized to request changes for. Only meaningful for permission=developer; ignored for owner/admin (full access) and readonly/blocked (no access). Project codes match submit_planner_task.project field and verifier-agent PROJECT_DEPLOY_MAP keys.';
```

Project codes follow existing convention used by `submit_planner_task.project` and verifier-agent's `PROJECT_DEPLOY_MAP`:

```
todak-academy-v2 · presentation · naca-app · iammuslim-com · siti
broneotodak.com · claude-tools-kit · dev-agent · planner-agent · ...
```

## Gate logic — semantics

| Permission | Can submit_planner_task? | Can canApprove? | project_scope checked? |
|---|---|---|---|
| `owner` | yes (any project) | yes | no — full access |
| `admin` | yes (any project) | yes | no — full access |
| `developer` | **only if `args.project ∈ project_scope`** | yes (own scope only — TBD) | yes |
| `readonly` | no | no | n/a |
| `blocked` | no | no | n/a |

**Open decision (flag for Siti session):** should `developer` be allowed to approve PRs for ANY project, or only their scoped projects? Recommended: scoped only — tighter principle of least privilege. Easy to implement in `canApprove` by adding the same project check.

## Implementation

### Siti (`/home/openclaw/siti/server.js`) — owned by Siti session

**Site 1: `submit_planner_task` tool (line 2521)**

```js
// BEFORE:
if (!["owner", "admin"].includes(contact.permission)) {
  return { error: "permission denied: owner/admin only" };
}

// AFTER:
const project = String(args.project || "").trim() || "general";
const allowed = (() => {
  if (contact.permission === "owner" || contact.permission === "admin") return true;
  if (contact.permission === "developer") {
    return Array.isArray(contact.project_scope) && contact.project_scope.includes(project);
  }
  return false;
})();
if (!allowed) {
  return { error: `permission denied: developer needs project_scope including '${project}'` };
}
```

**Site 2: auto-classifier path (line TBD)**

Action item for Siti session: locate the auto-classifier code path that dispatches without going through `submit_planner_task` (this is what let Hanis's request reach planner). Apply the same project_scope check there. Probably needs a way to figure out the project from the message context (group_id → project mapping? text classification?).

**Site 3 (optional, recommended): `canApprove`**

Tighten so developer can only approve PRs in their scope:

```js
const canApprove = (() => {
  if (contact.permission === "owner" || contact.permission === "admin") return true;
  if (contact.permission === "developer") {
    // Look up the awaiting-decision memory's metadata.project, check scope
    // (this requires the dispatcher to surface the project — likely already does)
    return /* project ∈ contact.project_scope */;
  }
  return false;
})();
```

Skip if too complex for v1 — keep developer's approve power global initially, tighten later.

### NACA backend (`/home/openclaw/naca-app/backend/server.js`) — owned by NACA session

```
GET   /api/contacts                       # existing — extend response with project_scope
PATCH /api/contacts/:id/permissions       # NEW
        body: { permission, project_scope }
        validates: permission in known set, project_scope is text[]
        writes: nclaw_contacts.permission + project_scope
```

PATCH is gated on Neo's NACA auth (already in place). Audit log via existing memory write or new dedicated audit row.

### NACA app (Flutter `lib/screens/siti_screen.dart` or contacts panel) — owned by NACA session

In SITI tab → Contacts panel → per-contact row, add an inline permission editor:

- Permission dropdown: `owner / admin / developer / readonly / blocked`
- If permission === `developer`, show a multi-select chip picker for `project_scope`
  - Source list: from a small NACA backend endpoint `GET /api/projects/known` (returns the deploy map keys + active naca_milestones phase_codes)

Out of scope for v1:
- Bulk grant
- Project-default policies (e.g., all Academy team gets `developer:todak-academy-v2` automatically)
- Time-bounded access
- Audit log of role changes (relies on git/memory trail for now)

## Migration plan

1. Apply schema migration on neo-brain (one ALTER TABLE)
2. Backfill `project_scope = '{}'` for all existing rows (DEFAULT handles this on add)
3. **Siti session**: update gate sites 1 + 2 (+ optionally 3), redeploy via the normal PR flow
4. **NACA session**: ship API endpoint + UI panel, redeploy via the normal PR flow
5. Neo manually grants:
   - `developer:todak-academy-v2` to Kai
   - `developer:siti` to Hanis (if appropriate)
   - any other project-trusted contacts
6. Verify end-to-end:
   - Kai's next academy request → goes through cleanly
   - Kai tries a non-academy change → rejected with clear "developer needs project_scope including 'X'" message
   - Hanis tries a Siti-internal change → goes through (he's scoped to siti)
   - Random group member tries to tag Siti for a task → rejected (no developer role)

## Open questions for Neo

1. **Should developer's `canApprove` also be project-scoped?** (Recommended yes — tighter PoLP, one extra check)
2. **Project source-of-truth?** Hardcoded in Siti? Read from `naca_milestones` distinct phase_codes? Read from a new `projects` table? (Recommended: small `projects` table with `{code, display_name, repo_url, deploy_url, owner_person_id}` — single source for everything; verifier-agent's PROJECT_DEPLOY_MAP could read from it too)
3. **Group → project auto-detection for the auto-classifier path?** (Recommended: extend `nclaw_contacts.metadata` to include `default_project` for groups that map to a single project, e.g., the TA System Developer group → `todak-academy-v2`)

## References

- Auto-memory `project_developer_role_allowlist.md` — earlier backlog note
- Auto-memory `feedback_naca_siti_no_assumptions.md` — verify state before changes
- `siti/server.js:2521` — `submit_planner_task` permission check (the hard gate)
- `siti/server.js:4172, 4213` — existing developer-aware checks
- `verifier-agent/index.js:PROJECT_DEPLOY_MAP` — current project code list (5 mapped + 8 NO_DEPLOY)
- Recovery PR `broneotodak/todak-academy-v2#9` — Kai's incident
- Hanis's Cursor-guide request 2026-04-29 12:01 MYT — auto-classifier path

## Session split (so the work doesn't collide)

| Sub-task | Owner | Blocking? |
|---|---|---|
| Schema migration (1 ALTER TABLE) | NACA (this session) | Blocks both implementations — do first |
| Spec sign-off | Neo | Blocks all implementations |
| Siti gate updates (sites 1+2+3) | Siti session | Independent of NACA work after spec sign-off |
| NACA backend PATCH endpoint | NACA session | Independent of Siti work after spec sign-off |
| NACA app UI panel | NACA session | Depends on backend endpoint |
| `projects` table (if approved) | Either — recommended NACA session | Loose dependency — can defer |
| End-to-end test with real contacts | Neo + both sessions | Last |
