# CTK Orchestration — Operator Guide

The CTK orchestration layer runs tools with **safety-first defaults**:
- **THR** → *strict sequential* (security + acceptance gates, no parallel)
- **Non-THR** → *hybrid/parallel* with bounded concurrency

## What's Included
- `strict_runner.mjs` — THR-only sequential runner (fail-closed)
- `parallel_runner.mjs` — Non-THR hybrid/parallel runner (semaphore bound)
- `adapters.mjs` — Runs module/CLI tools, normalized result shape
- `acceptance.mjs` — Role-specific acceptance gates
- `security.mjs` — Counters-only checks (PII/secrets/size)
- `token_wrapper.mjs` — Optional LLM token telemetry (opt-in)
- `hitl.mjs` — Human-in-the-loop phase pauses
- `cli.mjs` — CLI entrypoint
- `projects/` — Example configs (`THR`, `analytics`)

## Quick Start

### THR (strict sequential)
```bash
# Dry run (recommended)
node orchestration/cli.mjs orchestrate --project THR --dry-run

# Real run requires explicit approval:
CTK_APPROVED=1 node orchestration/cli.mjs orchestrate --project THR
```

### Analytics (hybrid/parallel)
```bash
# Parallel phases with max 3 workers
CTK_MAX_PARALLEL=3 node orchestration/cli.mjs orchestrate --project analytics --dry-run

# With HITL approval gates
CTK_HITL=1 node orchestration/cli.mjs orchestrate --project analytics
```

## Environment Variables
- `CTK_PROJECT` — Override project detection (THR auto-detected from cwd)
- `CTK_APPROVED=1` — **Required** for THR non-dry-run execution
- `CTK_HITL=1` — Enable human approval at phase boundaries
- `CTK_LLM_WRAP=1` — Enable token telemetry (disabled in parallel phases)
- `CTK_MAX_PARALLEL=3` — Max concurrent workers in parallel phases
- `CTK_TOOL_TIMEOUT_MS=120000` — Tool execution timeout (2 min default)
- `CTK_STRICT_MODE=1` — Auto-set for THR

## Safety Features
1. **Environment Allowlist** — Only PATH/HOME/SHELL/CTK_* passed to tools
2. **Symlink Refusal** — Won't execute symlinked tools
3. **Stdout Redaction** — Never exposes raw stdout in artifacts (preview only)
4. **Acceptance Gates** — Each role must pass criteria (e.g., `testsPassed===true`)
5. **THR Immutable Mode** — Cannot override sequential/strict for THR
6. **Timeout Protection** — Tools killed after timeout (SIGTERM→SIGKILL)

## Configuration Format
```json
{
  "project": "analytics",
  "mode": "hybrid",
  "phases": [
    {"name": "foundation", "mode": "sequential", "agents": ["sql"]},
    {"name": "implementation", "mode": "parallel", "agents": ["memory", "validation"]}
  ]
}
```

## Troubleshooting
- **"THR runs require CTK_APPROVED=1"** → Set `CTK_APPROVED=1` or use `--dry-run`
- **"Tool timeout after 120000ms"** → Increase `CTK_TOOL_TIMEOUT_MS`
- **"Refused symlink/non-file tool"** → Tool path is symlink (security block)
- **"No tool registered for role"** → Check `registry.mjs` for available roles

## Run History
Metrics saved to `run_history/*.json` (git-ignored). Contains:
- Run ID, timestamps, tool calls
- Token counts (if CTK_LLM_WRAP=1)
- No raw outputs or sensitive data