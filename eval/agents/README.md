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

## Phase 1 — revert scan (`run-revert-scan.js`, built 2026-06-04)

The correctness signal Phase 0 lacked: of everything the fleet *shipped* (merged), what fraction later got **reverted** vs **stuck**. Mines `agent_commands` for dev-agent authored PRs (`investigate_bug`/`feature_request` → `result.pr_url`) — the precise set the fleet shipped — and cross-refs each against revert signals in its repo (revert-titled PRs + git-revert commits over the last 200 default-branch commits), matched by merge-commit SHA, PR number, or quoted title.

```
node --env-file=.env --no-warnings eval/agents/run-revert-scan.js
```

READ-ONLY (neo-brain GET + `gh` GET). Output: `results/revert-scan-<date>.{json,md}`. **Headline = STUCK rate** (merged & not reverted). This is the historical baseline for the dev-agent fix pipeline; re-run after re-activating Siti→dev-agent (Agent SDK engine) to A/B whether shipped fixes stick more often. Caveat: a high stuck-rate is necessary-but-not-sufficient (an unnoticed bad change still counts as "stuck") — pair with the dev-agent sandbox eval.

First run (2026-06-04): 14 authoring PRs → 5 merged → 1 reverted → **80% stuck / 20% revert**. The one revert (siti #61, undone by #62) broke the siti↔siti-router identity boundary — the kind of context-dependent mistake the Agent SDK engine + grounding should reduce.

## Roadmap

- **Phase 1** — deterministic replay evals (no judge): ✅ planner decomposition (`planner-agent/eval/`), ✅ revert scan (above). Siti router classification (from `siti-v2/test/fixtures/messages.json`) built but unbanked.
- **Phase 2** — quality evals: ✅ dev-agent sandbox replay (`dev-agent/eval/run-sandbox-fix.js` — seeded bug → fix → run repo tests). Seeded-defect reviewer eval is moot — reviewer-agent retired (replaced by claude-code-action).

Fold the existing `eval/neo-brain/` RAG eval into the same monthly cadence rather than duplicating it here.
