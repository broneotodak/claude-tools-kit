# Focus — NACA Platform Refactor (start here, fresh session)

You're picking up a **major architectural refactor** that was scoped and locked in on 2026-05-11. **Read the spec first**, then act. Don't improvise — this is a multi-PR effort with a clear sequence.

## 1. Required reads (in order)

1. **THE SPEC** — `~/Projects/naca/docs/spec/platform-refactor-v1.md`
   (Also on GitHub: https://github.com/broneotodak/naca/blob/main/docs/spec/platform-refactor-v1.md)
   This is the locked plan. Architecture, naming dictionary, 7-phase plan, drift safeguards, acceptance criteria.

2. **The platform repo's CLAUDE.md** — `~/Projects/naca/CLAUDE.md`
   Hard rules about what belongs in NACA vs CTK vs interfaces. Read before adding any file.

3. **CTK workflow** — `~/Projects/claude-tools-kit/WORKFLOW.md`
   tier_1 normative rules. Every PR goes through branch + reviewer-agent + admin merge.

4. **Memory** — recall `shared_infra_change` `1b9be30d-7c78-4527-85fb-2c1a4cadcde2` via `@todak/memory` SDK for the canonical snapshot.

## 2. What's already done (Phase 0)

- ✅ `broneotodak/naca` repo created (private, MIT)
- ✅ README, LICENSE, CLAUDE.md, spec all committed
- ✅ April 22 planning docs archived to `docs/archive/`
- ✅ `pre-refactor` tag on siti-v2 main (commit `18d0142`, PR #56) — rollback anchor
- ✅ shared_infra_change memory saved (id `1b9be30d`)

## 3. What you're about to do — Phase 1: Monorepo scaffold

Goal: empty packages exist, ready to receive code. NO logic moved yet.

Steps:

1. Branch off `naca` main: `feat/phase-1-monorepo-scaffold`
2. Add root `package.json` with `"private": true`
3. Add `pnpm-workspace.yaml` listing `packages/*`
4. Create empty package dirs:
   - `packages/core/{src/,test/,package.json,README.md,CLAUDE.md}`
   - `packages/tools/{src/,test/,package.json,README.md,CLAUDE.md}`
   - `packages/router/{src/,test/,package.json,README.md,CLAUDE.md}`
5. Each package's `package.json`:
   - `name`: `@naca/core` / `@naca/tools` / `@naca/router`
   - `version`: `0.0.1`
   - `type`: `module`
   - `main`: `./src/index.js`
   - `engines`: `{"node": ">=20"}`
6. Each `src/index.js` exports a single stub: `export const __packageReady = true;`
7. Each package's CLAUDE.md states explicitly what does/doesn't belong (mirror the root CLAUDE.md style)
8. Root `package.json` test script: `"test": "node --test 'packages/*/test/**/*.test.js'"`
9. One trivial test per package to confirm the test runner sees the workspace
10. Commit + open PR + reviewer brief + WA approve

## 4. What NOT to do in Phase 1

- ❌ Don't copy tools/router/core code yet — that's Phase 2/3/4
- ❌ Don't touch siti-v2 — it stays unchanged this phase
- ❌ Don't publish to a registry — file-deps work fine for now
- ❌ Don't add new tools or features — pure structural change

## 5. Key constraints (all phases)

| Rule | Why |
|---|---|
| siti-v2 must keep working between every phase | No big-bang; deployer auto-restarts on each merge |
| Each phase = ONE mergeable PR | Easy rollback per phase |
| No Siti-specific logic in any `@naca/*` package | Platform must work for any user — see CLAUDE.md hard rules |
| Credentials access ONLY via `@naca/core/vault.getCredential` | Audit + cache + future RLS — never read env / call neo-brain directly from tools |
| Tier metadata stays on tool, filtering happens at registry | Don't bury tier logic inside tool bodies |
| `@todak/memory` stays in CTK | It's a separate SDK that predates NACA |

## 6. Verification before merging Phase 1

- [ ] `pnpm install` (or `npm install --workspaces`) at root succeeds
- [ ] `pnpm test` runs and finds all 3 packages' tests
- [ ] CI green (if added)
- [ ] siti-v2 untouched (just `git status` confirm clean)
- [ ] PR description references this spec by URL

## 7. After Phase 1 lands

Phase 2 starts: extract `@naca/tools` from siti-v2. The spec has full instructions (section 5 of the spec doc).

## 8. Stuck? Debug routes

- **State unclear?** Read the spec, then check siti-v2 `main` HEAD vs the `pre-refactor` tag — anything beyond the tag was post-scoping work and should be safe to ignore.
- **Drift detected?** A package has Siti-specific code in it → reject the PR. Each package's CLAUDE.md is the test.
- **Auto-deploy issue?** deployer-agent only watches siti-v2 PRs currently — naca repo merges don't auto-deploy anywhere (packages are libraries, not services).
- **Confused about a name?** The spec's section 1 has the naming dictionary. NACA ≠ CTK ≠ Siti.

## 9. Save your progress

After each phase ships:
1. Commit + push the PR (deployer-agent picks it up if it affects a configured service)
2. Save `shared_infra_change` memory describing what landed
3. Update Phase status in the spec doc itself (mark checkbox done)
4. Update naca-overview.html / naca.neotodak.com/documentations (Phase 6 builds this)

---

**TL;DR for the impatient:** Read the spec at `~/Projects/naca/docs/spec/platform-refactor-v1.md`. Phase 1 is monorepo scaffold (empty packages, no code moved). Don't touch siti-v2. Branch, PR, ship. Then Phase 2.
