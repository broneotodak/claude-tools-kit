# CTK Tools — Active Inventory

39 active tools organized by category. All archived tools are in `archive/`.

## Memory Management
| Tool | Purpose |
|------|---------|
| `save-memory.js` | **Primary** — unified memory save to pgVector. Supports old & new CLI formats |
| `universal-memory-save.js` | Backward-compatible wrapper → delegates to save-memory.js |
| `check-memory-health.js` | Diagnose memory DB issues (count, recent entries, connectivity) |
| `check-latest-activities.js` | Fetch recent activity_log entries |
| `backup-memory-complete.js` | Full memory DB backup to local JSON |
| `memory-enrichment.js` | Enrich existing memories with metadata |
| `memory-enrichment-rules.js` | Rules engine for memory enrichment |
| `conversation-memory-manager.js` | Manage conversation-level memory context |
| `unified-memory-strategy.js` | Strategy pattern for memory operations |

## RAG / Semantic Search
| Tool | Purpose |
|------|---------|
| `rag-context-builder.js` | Build context from memory for prompts |
| `rag-embed-memories.js` | Generate embeddings for memory entries |
| `rag-retrieve.js` | Retrieve relevant memories by query |
| `rag-semantic-search.js` | AI-powered semantic memory search |

## Database & Introspection
| Tool | Purpose |
|------|---------|
| `db-introspect.js` | Generic database schema introspection |
| `supabase-introspect.js` | Supabase-specific schema explorer |
| `query-supabase-project.js` | Query any Supabase project by config |
| `run-sql-migration.js` | Safe SQL migration runner with preview + confirmation |
| `safe-data-migration.js` | Data migration wrapper with rollback |

## CTK Enforcement & Security
| Tool | Purpose |
|------|---------|
| `ctk-enforcer.js` | Prevents assumptions before data operations |
| `ctk-pre-prompt-validator.js` | Validates prompts before execution |
| `machine-detection.js` | Standardized machine name detection |
| `analyze-tech-stack.js` | Analyze project tech stack |
| `performance-diagnostic.js` | Performance analysis and diagnostics |

## Sub-Agent System
| Tool | Purpose |
|------|---------|
| `sub-agent-orchestrator.js` | Coordinate multiple sub-agents |
| `sub-agent-monitor.js` | Monitor sub-agent health and progress |
| `sub-agent-memory-system.js` | Shared memory for sub-agents |
| `sub-agents-enhanced.js` | Enhanced sub-agent capabilities |
| `save-subagent-progress.js` | *(archived — use save-memory.js)* |

## Startup & Initialization
| Tool | Purpose |
|------|---------|
| `claude-startup.sh` | Shell startup script |
| `claude-startup-macos.sh` | macOS-specific startup |
| `claude-startup-context.js` | Load context on startup |
| `claude-code-auto-save.js` | Auto-save hook for Claude Code |
| `claude-code-prompt-hook.sh` | Prompt hook for Claude Code |
| `claude-rag-startup.sh` | RAG system startup |
| `ctk-auto-commands.sh` | Auto-run CTK commands |
| `ctk-guardian-setup.sh` | CTK guardian initialization |
| `ctk-smart-init.sh` | Smart project initialization |
| `setup-memory-enrichment-cron.sh` | Cron for memory enrichment |
| `setup-new-machine.sh` | New machine CTK setup |
| `install-working-git-hooks.sh` | Install git hooks |

## Project Configs (`../projects/`)
| Project | Database | Status |
|---------|----------|--------|
| THR | `ftbtsxlujsnobujwekwx` | Active |
| Academy | `hgdlmgqduruejlouesll` | Active |
| Musclehub | `jxcddfejjqqynekbpdxh` | Archived |
| AskMyLegal | `yvxpggnbvuwgwsmsubtr` | Planning |
| Presentation | N/A (static) | Active |
