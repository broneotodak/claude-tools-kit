# NACA agent eval — Phase 0 baseline (2026-06-03)

Retrospective scoreboard mined from recorded outcomes (`agent_intents`, `agent_commands`). Zero new labelling. Architecture-neutral — re-run after any agent change for a direct A/B. **Not** a quality judgement yet (that is Phase 2); these are *outcome* rates.

## Scoreboard

| Agent | Headline metric | Score | Window |
|---|---|---|---|
| planner-agent | intent decomposition success | **52.7%** (226 done / 203 failed) | 2026-04-22→2026-06-03 |
| dev-agent (authoring) | command completion | **86.5%** (32/37) | 2026-04-22→2026-05-21 |
| dev-agent (plumbing) | command completion | 41.2% | (for contrast) |
| reviewer | verdict produced (of non-skipped) | approve **75%** / req-changes 16.7% | 2026-04-25→2026-05-29 |
| dev-agent (authoring) | **PR landed** (merged) | **33.3%** of 9 resolved | via GitHub |
| reviewer | approve → merged held | 98.2% of 114 resolved | via GitHub |

## planner-agent
- Total intents: 439 — {"done":226,"cancelled":10,"failed":203}
- **Decomposition success: 52.7%** (done / done+failed, cancelled excluded)
- Avg commands per successful intent: 1.07
- Failure breakdown: {"invalid_target_or_payload":159,"other":29,"no_command_produced":1,"network":1}
  - **The dominant failure is `invalid_target_or_payload`** — the planner emits commands to an unknown agent or with a payload that fails registry validation. That is a prompt/grounding problem (and exactly what Phase 1's deterministic decomposition eval will track), *not* model overload.

## dev-agent
- Commands by verb: {"investigate_bug":23,"restart":1,"feature_request":28,"on_main_push":107,"merge_pr":110,"on_pr_merged":40,"close_pr":5}
- **Authoring vs plumbing matters:** the raw all-command rate conflates model work (investigate_bug/feature_request) with git-event plumbing (merge_pr/on_main_push). Segmented:
  - Authoring: 86.5% complete, 14 PRs produced, errors: {"Command failed: git commit -m \"feat(claude-tools-kit): PR #9":1,"Command failed: git fetch origin && git checkout feat/phase6":1,"Command failed: git clone git@github.com:broneotodak/claude-":2,"Command failed: git clone git@github.com:broneotodak/publish":1}
  - Plumbing: 41.2% complete
- **PR landed (merged): 33.3%** of 9 resolved authoring PRs (14 checked) — {"closed_unmerged":6,"merged":3,"gh_error":5}. This is the "fix actually worked" number a managed write→test→fix loop should move.

## reviewer
- review_pr dispatched: 373 — {"cancelled":1,"failed":40,"done":332}
- Verdicts: {"request-changes":30,"comment":15,"approve":135} (approve 75%, request-changes 16.7%)
- **Skipped `already_merged`: 160 (42.9% of dispatches)** — the fleet-origin self-merge races the reviewer, so nearly half its dispatches are no-ops. Decide: gate self-merge on review, or stop dispatching reviewer for fleet-origin PRs.
- Approve → still-merged: 98.2% of 114 resolved (124 checked) — {"merged":112,"gh_error":10,"closed_unmerged":2}.

## Limitations (honest)
- "done/completion" = the agent finished its run, **not** that the output was correct. The GitHub pass (`--github`) is the only "did it actually land" signal here; true quality scoring is Phase 2 (seeded-defect reviewer eval + dev-agent sandbox replay).
- Revert detection is not done in Phase 0 (merged≠never-reverted). Add a revert scan in Phase 1.
- dev-agent/reviewer dispatch wound down after ~2026-05-29 (autonomous-dispatch paused); this baseline is the historical active window. Planner intents continue to today.
- neo-brain RAG already has its own eval (`eval/neo-brain/`, recall@5 ~63.8% hybrid) — fold it into the same monthly cadence rather than duplicating here.

## Next (Phase 1)
- Deterministic **planner decomposition** eval: 20 frozen intents → expected (agent,command)+payload; score routing accuracy + command-validity + hallucination rate (directly attacks the `invalid_target_or_payload` failure).
- **Siti router classification** eval from `siti-v2/test/fixtures/messages.json` (per-intent precision/recall).
