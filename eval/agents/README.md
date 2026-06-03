# NACA agent eval — `eval/agents/`

Behavioural-eval harness for the **self-managed reasoning agents** (planner, dev-agent, reviewer). Sibling to `eval/neo-brain/` (the RAG eval). Architecture-neutral: it scores recorded *outcomes*, so the same run re-executed after any agent change (e.g. a Claude-Agent-SDK migration of dev-agent) is a direct A/B.

## Phase 0 — retrospective baseline (this dir, built 2026-06-03)

Mines outcomes that **already happened** — zero new labelling, read-only:

- `agent_intents` → planner: raw intent → decomposition success/failure + failure buckets
- `agent_commands` (dev-agent, reviewer) → command completion (segmented authoring vs plumbing), reviewer verdict mix + the `already_merged` no-op rate
- *(optional)* `--github` → cross-refs the recorded `pr_url` against GitHub to turn "agent finished" into **"PR actually merged"** (dev-agent) and "approve → still-merged" (reviewer)

### Run

```
node --env-file=.env --no-warnings eval/agents/run-baseline.js            # DB-only (fully reproducible)
node --env-file=.env --no-warnings eval/agents/run-baseline.js --github   # + GitHub landed-rate (best-effort)
```

Needs `NEO_BRAIN_URL` + `NEO_BRAIN_SERVICE_ROLE_KEY` (read-only). `--github` needs an authed `gh`. Output: `results/agents-baseline-<date>.{json,md}` — the `.md` is the scoreboard. Secrets are redacted before write (same ruleset as the pre-commit hook, incl. `ccc_sk_`).

### Metric definitions

- **planner decomposition success** = `done / (done + failed)` intents (cancelled excluded). Failure buckets categorise the `error` text; `invalid_target_or_payload` = emitted a command to an unknown agent / payload that failed registry validation.
- **dev-agent completion** = `done / (done + failed)` commands, **segmented**: authoring (`investigate_bug`,`feature_request`) vs plumbing (`merge_pr`,`on_main_push`,`on_pr_merged`,`close_pr`). The raw all-command rate is misleading — always read the segments.
- **dev-agent PR landed** = `merged / resolved` authoring PRs (`--github`). `resolved` = merged+closed+open (excludes `not_found`/`gh_error`). This is the closest "fix actually worked" signal in Phase 0.
- **reviewer** = verdict distribution (approve/request-changes/comment) over verdict-bearing rows; `skipped_already_merged` = dispatches that were no-ops because the PR self-merged first.

### Honest limitations

- "done/completion" = the agent *finished its run*, not that the output was correct. Real quality scoring is Phase 2.
- `--github` is single-attempt/best-effort; `gh_error` PRs are excluded from the rate (shown in the dist for transparency), so landed-rates carry ±gh_error noise. DB-only numbers are fully reproducible.
- `approve → merged` is near-tautological in an auto-merge fleet (approval leads to merge); it is **not** a measure of approval *correctness*. That needs revert detection (Phase 1).
- dev-agent/reviewer dispatch wound down ~2026-05-29 (autonomous-dispatch paused); this is the historical active window. Planner intents continue to today.

## Roadmap

- **Phase 1** — deterministic replay evals (no judge): planner decomposition (20 frozen intents → expected agent/command/payload; routing accuracy + command-validity + hallucination rate) and Siti router classification (from `siti-v2/test/fixtures/messages.json`). Add a revert scan.
- **Phase 2** — quality evals: seeded-defect reviewer eval (planted bugs = ground truth) and dev-agent sandbox replay (frozen bug → fix → run repo tests).

Fold the existing `eval/neo-brain/` RAG eval into the same monthly cadence rather than duplicating it here.
