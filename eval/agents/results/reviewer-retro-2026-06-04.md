# Reviewer retrospective eval (2026-06-04)

Did the reviewer's verdicts hold up? Mines 162 distinct reviewed PRs (latest verdict each) vs their GitHub outcome. The signal Phase 0 couldn't give: **approval correctness** (approved-and-held vs approved-then-reverted). Read-only.

## Headline
- **Approval correctness: 99.2%** — of approved PRs that merged, 119 held vs **1 reverted** (false approves).
- request-changes: 2/22 respected (not merged), **20 overridden** (merged anyway).

## approve verdicts
- total 125 → merged 120 (held 119 / reverted 1), closed-unmerged 5, unresolved 0
- **False approves (approved → reverted):** broneotodak/siti#3

## Notes / honesty
- Revert detection is BEST-EFFORT: matches PRs reverted by a "Revert …(#N)" PR. Misses reverts via raw commit or without a #N reference — so false-approve count is a LOWER BOUND.
- request-changes "overridden" can be a legitimate operator override, not necessarily a reviewer false-positive — treat as a signal to inspect, not a verdict.
- In an auto-merge fleet most approves merge fast; this eval is about what happened AFTER the merge, which is the real quality question.
