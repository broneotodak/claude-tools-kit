# @todak/detectors

Shared fleet-health detectors. Single source of truth for checks that multiple agents need to run identically.

## Why this package exists

The same detector logic used to live in two repos with separate copies:
- `naca-monitor/src/checks/orphan-prs.js` — writes the unified fleet snapshot
- `daily-checkup-agent/index.js` (inlined) — builds the 09:00 MYT WA digest

On 2026-05-28 the copies drifted: `naca-monitor` got a GitHub-reconcile guard in PR #5 (2026-05-24), `daily-checkup-agent` did not — and a Lane B-merged PR (naca#45) was flagged as "stale" 27h after merge. The fix (daily-checkup-agent#6) brought the two copies back into sync, but the structural drift risk remained.

This package extracts the canonical detector so future fixes happen in one place.

## What's in here

| Export | Purpose |
|---|---|
| `checkOrphanPRs({ brain, ... })` | Finds `pr-awaiting-decision` rows >6h old without a matching `pr-decision-recorded`, reconciles against GitHub to skip Lane B / admin merges, dedups by URL |
| `prGithubState(prUrl, opts)` | Returns `"MERGED" \| "CLOSED" \| "OPEN" \| null` for a PR URL. Fail-open on missing token / network |

## Consumption pattern

Currently vendored into each consumer (no npm publish). Canonical source is here at `packages/detectors/src/`. Consumers carry a synced copy at `vendor/@todak/detectors/` and import from there.

To sync a consumer: copy `packages/detectors/src/*` into the consumer's `vendor/@todak/detectors/` directory and commit. The vendored copy is a snapshot — edit the canonical here first.

This pattern was chosen because:
- `@todak/memory` is not published to npm — no precedent for an external registry.
- `file:../claude-tools-kit/packages/detectors` would break at deploy time (claude-tools-kit is not cloned at a consistent path on Siti VPS / NAS Docker).
- Vendoring keeps deploys self-contained and the canonical-source intent explicit.

Drift detection: a CI check can `diff` the canonical source against each consumer's vendored copy. (Not implemented yet — open follow-up if drift becomes a problem before consolidation matures.)

## Smoke test

```bash
GITHUB_TOKEN=<token> node scripts/smoke.js
```

Exercises `prGithubState` against four live cases and `checkOrphanPRs` against a mock brain (no DB needed).
