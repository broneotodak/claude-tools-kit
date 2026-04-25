# CTK Enforcement Rules — SOP for every Claude Code instance

This folder contains **rules of behavior** that apply to every Claude Code
instance Neo runs — MacBook (local), Siti VPS, NACA VPS, neo-twin VPS, CLAW MBA,
future Digitech fleet, future remote agents. They are not optional and not
project-scoped.

## Why this exists

Originally these rules lived in `~/.claude/` on Neo's MBP only. That meant a
dev-agent on Siti VPS, or a remote scheduled CC agent, did not inherit them.
After the 2026-04-25 monitoring incident — where I built supervisor-agent rules
on a heartbeat field whose semantics I never validated, generating 49 false
positives in 8 hours — Neo's instruction was: *"please do commit, because at
least it's our SOP for every CC we have, local or VPS or online."*

So these are now under git, and every agent / CC instance should pull them.

## Files

| File | What it covers |
|---|---|
| [`CTK_ENFORCEMENT.md`](./CTK_ENFORCEMENT.md) | Master CTK rules — DB discipline, no PGPASSWORD, save-memory pattern, parallel execution, monitoring discipline pointer |
| [`MONITORING_ENFORCEMENT.md`](./MONITORING_ENFORCEMENT.md) | The monitoring-validation procedure. Read before adding any alert / heartbeat field consumer / push monitor / supervisor rule. |

## How a new machine adopts these rules

```bash
# 1. Clone CTK
git clone https://github.com/broneotodak/claude-tools-kit ~/Projects/claude-tools-kit

# 2. Symlink (so future updates flow without re-copying)
mkdir -p ~/.claude
ln -sf ~/Projects/claude-tools-kit/enforcement/CTK_ENFORCEMENT.md      ~/.claude/CTK_ENFORCEMENT.md
ln -sf ~/Projects/claude-tools-kit/enforcement/MONITORING_ENFORCEMENT.md ~/.claude/MONITORING_ENFORCEMENT.md

# 3. Reference from CLAUDE.md so it loads at session start
# Add this line to ~/.claude/CLAUDE.md:
#    "Read ~/.claude/CTK_ENFORCEMENT.md and MONITORING_ENFORCEMENT.md at session start."
```

## Updates

When updating a rule:
1. Edit the file under `~/Projects/claude-tools-kit/enforcement/`
2. Commit + push to GitHub
3. Other machines `git pull` to receive the update (symlinks make it automatic if installed per above)
4. **Also save a memory row** to neo-brain (`category: ctk-rule`) so non-symlinked agents (remote CC, scheduled jobs) can search-discover the rule.

## Cross-agent inheritance via neo-brain

Every CTK rule should also exist as a memory row in neo-brain so agents that
don't read the filesystem (e.g. cloud-hosted scheduled CC agents) can still
find them via semantic search:

```js
// from any agent using @todak/memory
const rules = await brain.search("monitoring discipline ctk", { k: 5 });
```

The originating commit always lives here in git for auditability.
