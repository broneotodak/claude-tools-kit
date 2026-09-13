# Codex continuity with CTK

Codex sessions previously stayed in local history unless the agent explicitly saved
a memory. This adapter recalls shared history at startup/prompt submission, archives
visible chat after a turn, and provides verified handoff saves. It does not put every
past message into the model's context at once.

## What goes where

- **neo-brain:** private, credential-redacted conversation chunks (`reference_codex_transcript`, importance 2) and deliberate milestone/handoff notes (`session_handoff`, importance 6). Historical chat quotations are not truth.
- **neo-kb:** verified durable decisions, architecture and instructions, updated by the agent in the normal KB worktree/PR flow. Never full chat dumps.
- **Local:** existing Codex history, plus a private outbox and receipts in `$CODEX_HOME/ctk`. Saved receipts retain IDs instead of a second plaintext chat copy.
- **Vault:** secrets. Credential patterns, configured secret values, password/token assignments, bearer headers and credential URLs are redacted before the outbox or embeddings. Pattern detection cannot identify every unlabeled password; do not paste credentials into chat.

Capture includes user text, assistant commentary and final answers. It excludes
reasoning, tool calls/results, system/developer messages, environment injections,
compaction replay and binary media. Each session is captured when used, or when
`capture` is explicitly invoked inside it. Other historical sessions are not
batch-imported automatically. Local transcripts must remain available until captured.

## Install on each machine

Requires Node 22.13+ (read-only `node:sqlite`), Codex hooks support, installed CTK
dependencies, and a private runtime env with `NEO_BRAIN_URL`,
`NEO_BRAIN_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`. Keys are read at runtime, never
copied into hook definitions or source. From a tested, committed checkout:

    node tools/codex-memory/install.mjs --ctk-root /path/to/claude-tools-kit --env-file /path/to/runtime.env --kb-root /path/to/neo-kb --codex-bin /absolute/path/to/codex --node-bin /stable/path/to/node --agent codex-machine-label

Use the stable Node entry point (for example, Homebrew's bin symlink), so package
cleanup does not remove a versioned Cellar path referenced by the hooks.

Installation copies a versioned runtime under `~/.codex/ctk/releases/<commit>`, reuses
the CTK dependency directory, backs up affected files with private permissions,
merges six lifecycle hooks and adds a managed section to global `AGENTS.md`.
Existing unrelated hooks, instructions, model, permissions and footer are preserved.
Keep the CTK dependencies available at the configured path.

**Open `/hooks` in Codex and review/trust the six CTK Brain hooks.** Codex skips
untrusted/changed definitions. Reopen/resume to load global instructions. Installation
does not grant trust. No daemon, LaunchAgent, cron, server, heartbeat or City observer
is installed or re-enabled. Other machines need their own installation and trust.

## Lifecycle and failures

| Trigger | Work |
| --- | --- |
| SessionStart / UserPromptSubmit | Local capture, bounded shared recall, local pending excerpts. Semantic no-match/null/error falls back to recent SDK handoffs. |
| Stop / PreCompact | Background capture and bounded drain; completion notice reports saved/verified or pending. |
| SessionEnd / Interrupt | Local transcript pointer only (three-second native limit); next active session retries. |

There is no idle timer: pending writes retry on a future turn or explicit `sync`.
If a background hook is cancelled, its queue/pointer survives. Failures use exponential
backoff (30 seconds to one hour) and stop that drain. Three concurrent writes maximum,
one drain process, no unbounded retry loop. A deleted transcript that was never
captured cannot be recovered.

The new SDK helper `saveVerifiedMemory` uses deterministic memory UUIDs, requires
a valid 768-dimensional embedding, reads back exact content/private visibility/vector/
source, and verifies an audit row. A lost response retries the same primary key.
Missing audits are repaired without duplicate memories. Legacy `save()` is unchanged.
No schema changes.

Codex rollout JSONL is not a stable interface. Supported: `response_item/message`
with user/assistant text, tested against CLI 0.153.4. Missing/mismatched session
headers, truncated appends and parse failures retain the checkpoint and report an
error. Check capture after upgrading Codex.

## Agent commands

The installer prints the versioned CLI command and adds it to global instructions.
Commands use `CODEX_THREAD_ID` (or `CODEX_SESSION_ID`); never the most recent other chat.

    node --no-warnings tools/codex-memory/cli.mjs focus --cwd /actual/worktree --task "Fix session memory" --files "tools/codex-memory"
    node --no-warnings tools/codex-memory/cli.mjs status
    node --no-warnings tools/codex-memory/cli.mjs capture --seconds 300
    node --no-warnings tools/codex-memory/cli.mjs sync --retry-now --seconds 300
    node --no-warnings tools/codex-memory/cli.mjs handoff --file /private/path/handoff.md
    node --no-warnings tools/codex-memory/cli.mjs recall "latest NACA City handoff"

Focus tracks actual worktree/repo/branch/task/files. It attempts `thread/name/set`
only through an **existing local control socket**. With no socket,
`titleUpdated:false` is honest: hook notices and CLI status show the information,
while the native footer keeps its session context. A tool's workdir does not change
Codex's native cwd. No private SQLite edits, extra session or daemon startup are
used to fake a live footer. This is not Claude's arbitrary statusline command.

## Validation and removal

    node --test --no-warnings tools/codex-memory/core.test.mjs packages/memory/test/verified.test.mjs
    node --test --no-warnings packages/memory/test/*.test.mjs

Baseline issue at `6dbcddc`: the credential-rule test expects 23 custom rules, while
the existing ruleset contains 24. This adapter does not alter the rules. The SDK
redaction integration test is opt-in; offline tests do not contact the brain.

To remove only this integration, run the installed `tools/codex-memory/remove.mjs`
then restart Codex. Other hooks/settings, queued data and saved memories remain.
Private backups live under `~/.codex/ctk/backups/`.

Official lifecycle/trust reference: https://learn.chatgpt.com/docs/hooks
