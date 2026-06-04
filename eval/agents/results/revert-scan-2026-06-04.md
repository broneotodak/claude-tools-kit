# NACA agent eval — revert scan (2026-06-04)

The fleet's **correctness** signal that Phase 0 was missing: of everything the fleet *shipped* (merged), what fraction later got **reverted** vs **stuck**. In an auto-merge fleet "approve → merged" is near-tautological; this is the number that says whether the autonomous merge pipeline is net-positive.

**Universe:** dev-agent authored PRs (investigate_bug/feature_request) recorded in agent_commands · window 2026-04-22→2026-05-21

## Headline

| Metric | Value |
|---|---|
| Fleet authoring PRs | 14 |
| ...merged | 5 |
| ...later reverted | **1** |
| **STUCK rate (merged & not reverted)** | **80%** |
| revert rate | 20% |
| unresolved on GitHub (gh_error) | 0 |

## Per repo

| Repo | fleet merged | fleet reverted | revert rate | total reverts in repo |
|---|---|---|---|---|
| broneotodak/todak-academy-v2 | 1 | 0 | 0% | 0 |
| broneotodak/THR | 0 | 0 | —% | 0 |
| broneotodak/siti | 2 | 1 | 50% | 1 |
| broneotodak/naca-app | 1 | 0 | 0% | 1 |
| broneotodak/claude-tools-kit | 1 | 0 | 0% | 0 |
| broneotodak/verifier-agent | 0 | 0 | —% | 0 |

## Reverted fleet PRs

- https://github.com/broneotodak/siti/pull/61 — _fix(nclaw-dashboard): Agent 'siti-router' on siti-vps is reporting process_stale: heartbeat is 453s stale (threshold 360s). A Tier-1 restart was already attempted or is not applicable for this symptom_ (matched by pr_number, investigate_bug)

## Limitations (honest)
- Universe is dev-agent authored PRs in agent_commands — the precise set the fleet shipped. claude-code-action PRs (the retired-reviewer replacement) are NOT in agent_commands and are a known gap; extend by classifying merged PRs by Co-Authored-By trailer.
- Revert detection scans revert-titled PRs + the last 200 default-branch commits per repo. A revert older than 200 commits back, or one that neither names the SHA/PR# nor quotes the title, is missed (under-counts).
- autonomous dispatch wound down ~2026-05-29; this is the historical active window.
- A high stuck-rate here is **necessary but not sufficient** for trusting the pipeline: a bad change that nobody noticed/reverted still counts as "stuck". Pair with the dev-agent sandbox eval (does the fix actually pass tests) for the full picture.

## How to use this
- This is the **historical baseline** for the dev-agent fix pipeline. Re-run after re-activating the Siti→dev-agent pipeline (with the Agent SDK engine) to A/B whether the new engine's shipped fixes stick more often.
