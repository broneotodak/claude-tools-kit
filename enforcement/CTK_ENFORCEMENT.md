# 🛑 MANDATORY CTK ENFORCEMENT - READ BEFORE ANY ACTION 🛑

## STOP! Before responding to ANY prompt, you MUST:

### 1️⃣ IMMEDIATE CHECKS (Do these FIRST, before thinking about the answer):
- [ ] What project am I in? Check `pwd`
- [ ] Is this THR? Check for `.ctkrc` file
- [ ] Which database should I use? (THR: ftbtsxlujsnobujwekwx, Memory: uzamamymfzhelvkwpvgt)
- [ ] Are there existing tools for this task in `/scripts` or `/tools`?

### 2️⃣ FORBIDDEN ACTIONS (NEVER do these):
❌ Create new search/save scripts if one exists
❌ Use generic approaches for project-specific tasks
❌ Mix up THR database with memory database
❌ Skip verification before data operations
❌ Ignore "save progress" requests
❌ Make assumptions without checking existing code
❌ **NEVER use PGPASSWORD or raw psql commands** - Use CTK tools instead!
❌ **NEVER guess database credentials** - Always read from CTK/.env files

### 3️⃣ MANDATORY ACTIONS (ALWAYS do these):
✅ Read existing files before creating new ones
✅ Use CTK tools (save-memory.js for all projects)
✅ Save to memory when user mentions "save"/"progress"/"document"
✅ Run test/verification before any data changes
✅ Check git history before claiming something isn't saved

### 4️⃣ PROJECT-SPECIFIC RULES:

#### For THR:
```bash
# Database access - ONLY use these methods:
Config: /Users/broneotodak/Projects/claude-tools-kit/projects/THR/config.json
Credentials: /Users/broneotodak/Projects/claude-tools-kit/.env.thr

# Run SQL migrations:
node /Users/broneotodak/Projects/claude-tools-kit/tools/run-sql-migration.js sql/file.sql

# Query via Supabase JS (in CTK):
cd /Users/broneotodak/Projects/claude-tools-kit && node -e "require('dotenv').config({path:'.env.thr'}); ..."

# NEVER do this:
# PGPASSWORD='xxx' psql "postgresql://..." ← FORBIDDEN!
```

#### For ATLAS:
```bash
# Shares database with THR
Config: /Users/broneotodak/Projects/claude-tools-kit/projects/THR/config.json
# Uses same credentials as THR
```

#### For Memory (pgVector):
```bash
# Memory database - different from project databases!
Credentials: /Users/broneotodak/Projects/claude-tools-kit/.env (SUPABASE_SERVICE_ROLE_KEY)
URL: https://uzamamymfzhelvkwpvgt.supabase.co
```

### 5️⃣ AUTOMATIC TRIGGERS:

When user says → You MUST do:
- "save progress" → Run: `node ~/Projects/claude-tools-kit/tools/save-memory.js "Project" "Progress" "content" 6`
- "check status" → Run: `git status && git log --oneline -5`
- "test this" → Find and run test files first
- "positions not working" → Run: `node test-position-handling.cjs`

### 5️⃣.4 CREDENTIAL HANDLING (MANDATORY, 2026-04-24):

When Neo shares a credential (password, API key, token, SSH key, PIN, etc.) in chat, you MUST store it in the **neo-brain `credentials` table** via the `upsert_credential` RPC — not in memory files, not in .env files, not in source. The value is encrypted in Supabase Vault; only the `vault_secret_id` pointer sits in the `credentials` table.

**How to store:**
```sql
-- Execute against neo-brain (xsunmervpyrplzarebva) via Supabase MCP
SELECT upsert_credential(
  p_owner_id := '00000000-0000-0000-0000-000000000001'::uuid,  -- NEO_SELF_ID
  p_service := '<lowercase-service-slug>',     -- e.g. 'tdcc', 'netlify', 'openai'
  p_credential_type := '<kind>',               -- e.g. 'password', 'api_key', 'ssh_key', 'pin', 'service_role'
  p_value := '<the plaintext secret>',
  p_description := '<human-readable context>',
  p_environment := 'production',               -- or 'staging', 'dev'
  p_expires_at := NULL,                        -- timestamptz if known
  p_metadata := jsonb_build_object(
    'url', '<service URL>',
    'username', '<if applicable>',
    'saved_by', 'claude-code-session',
    'saved_at', now()::text
  )
);
```

**How to read back:**
```sql
SELECT credential_value
FROM get_credential(
  p_owner_id := '00000000-0000-0000-0000-000000000001'::uuid,
  p_service := '<slug>',
  p_credential_type := '<kind>',   -- optional
  p_environment := 'production'
);
```

**In memory files (`~/.claude/projects/-Users-broneotodak/memory/*.md`):** reference by lookup key only — e.g. "password stored in neo-brain credentials: service='tdcc', type='password', owner=NEO_SELF_ID". NEVER write the plaintext value to disk.

**Reasoning**: Credentials in chat end up in transcript history anyway, but writing them to memory files replicates them into pgVector-indexed embeddings and across machines on sync. Routing through `upsert_credential` + Vault keeps the vector/embedding layer secret-free.

### 5️⃣.5 PROACTIVE SAVE NUDGES (Neo asked for more-frequent reminders, 2026-04-24):

You MUST suggest saving to neo-brain (via save-memory.js) WITHOUT being asked when ANY of these milestones hit:
- ✅ A migration completes (data moved between DBs/tables, or schema changed)
- ✅ A production deploy succeeds (git push → Actions green → user confirms it works)
- ✅ A non-trivial feature lands (new tool, new endpoint, new UI tab)
- ✅ A bug fix Neo explicitly flagged as "concerning" or "important"
- ✅ Before a long-running workstream changes direction (user says "now let's do X")
- ✅ Before the user explicitly signs off ("im going to sleep", "afk", "bye", "later")

The nudge doesn't need to be a long ceremony — one line: "Save this milestone to neo-brain? (y/n)" then just do it if yes. If the conversation has been dense (≥5 significant changes since last save), don't ask — just save and mention it in one sentence.

Do NOT wait for the user to say "save progress". The whole point of pgVector memory is cross-session continuity; a session that ends without a save loses context that future-you needs.

### 6️⃣ VERIFICATION BEFORE ACTION:

Before ANY database operation:
```bash
# 1. Check which DB you're using
echo $SUPABASE_URL

# 2. Preview the data
SELECT * FROM table_name LIMIT 5;

# 3. Count affected rows
SELECT COUNT(*) FROM table_name WHERE condition;

# 4. Only then proceed
```

## 🎯 CORE CTK PRINCIPLES (MANDATORY):

### 1. **pgVector Memory is CENTRAL**
- ALL progress MUST be saved to pgVector (uzamamymfzhelvkwpvgt)
- Memory is your PRIMARY source of truth
- Check memory FIRST before making claims
- Save to memory THROUGHOUT the session, not just at the end

### 2. **ACCURACY - No Assumptions**
- ❌ NEVER assume something isn't working without testing
- ❌ NEVER guess at database schemas without checking
- ❌ NEVER claim something isn't saved without verifying git
- ✅ ALWAYS verify with actual commands
- ✅ ALWAYS test before concluding
- ✅ ALWAYS check existing code before creating new

### 3. **Use Multiagent/Parallel Mode**
- When multiple tasks are independent, run them in PARALLEL
- Use Task tool with multiple agents when appropriate
- Examples of parallel operations:
  - `git status` + `git log` + `git diff` (all at once)
  - Multiple file reads for related components
  - Multiple test scripts running simultaneously
- Use `subagent_type=Explore` for codebase exploration
- Use `subagent_type=Plan` for implementation planning

## 🚀 CLAUDE CODE CAPABILITIES (ALWAYS OFFER WHEN RELEVANT)

### Automatic Capability Triggers:
When user mentions → Offer these capabilities:
- **"fix bugs"** → Parallel testing + Code analysis + Git operations
- **"improve performance"** → Performance analysis + Database operations + Monitoring
- **"add feature"** → Plan agent + Code generation + Test creation
- **"deploy"** → Parallel deployment + Monitoring + Git operations
- **"document"** → Documentation generation + Code analysis
- **"integrate"** → Cross-project + API integration + n8n workflows
- **"analyze"** → Explore agent + Code analysis + Database analysis
- **"automate"** → Project automation + Script generation + CI/CD
- **"test"** → Test generation + Parallel testing + Monitoring
- **"refactor"** → Code analysis + Plan agent + Git operations
- **"understand codebase"** → Explore agent for deep analysis
- **"security"** → Security vulnerability scanning + OWASP checks

### Core Capabilities to Proactively Offer:
1. **Parallel Execution**: Run multiple independent operations simultaneously
2. **Intelligent Analysis**: Security scanning, performance optimization, code smells
3. **Advanced Git**: PRs with descriptions, release notes, branch management
4. **Safe Migrations**: Preview and run SQL migrations safely
5. **Multi-Agent**: Specialized agents for complex tasks (Explore/Plan)
6. **Real-time Monitoring**: Watch long-running processes with BashOutput
7. **Documentation Generation**: API docs, user guides, architecture diagrams
8. **Cross-Project Integration**: Sync between THR/ATLAS, n8n workflows
9. **Memory Management**: pgVector storage and retrieval
10. **Web Operations**: WebSearch for current info, WebFetch for APIs

### Quick Commands:
```bash
# Launch exploration agent for codebase understanding
Task tool with subagent_type="Explore"

# Run safe SQL migration
node /Users/broneotodak/Projects/claude-tools-kit/tools/run-sql-migration.js

# Save to memory
node /Users/broneotodak/Projects/claude-tools-kit/tools/universal-memory-save.js

# Monitor background processes
BashOutput tool with bash_id="<id>"
```

**IMPORTANT**: Always mention relevant capabilities when they could help the user's task!

### 4. **Database Discipline**
- pgVector/Memory: `uzamamymfzhelvkwpvgt.supabase.co`
- THR/ATLAS: `ftbtsxlujsnobujwekwx.supabase.co`
- NEVER mix these up - they serve different purposes!

### 5. **Monitoring Discipline** (added 2026-04-25)
**A monitor that exists is not a monitor that works.** Before creating any
alert, supervisor rule, push monitor, dashboard health card, or auto-action
gated on a signal, you MUST:
1. Read the source code that produces the signal
2. Synthetic-test both edges (good→bad AND bad→good)
3. If push monitor: wire the pusher in the same change
4. Dry-run ≥ 24h before auto-actions

Full rules: `~/.claude/MONITORING_ENFORCEMENT.md` (mandatory reading before any monitoring work).

**Originating incident:** built supervisor-agent rules around `agent_heartbeats.meta.wa_status`
— a raw baileys event-type string, not real health. 49 false fires overnight. Push monitors
for twin-ingest/forex created without wiring agents → permanent false DOWN.

## 🚨 ENFORCEMENT MECHANISM:

**If you violate ANY of these rules:**
1. STOP immediately
2. Acknowledge the violation
3. Correct the approach
4. Follow CTK properly
5. Save the correction to memory

## 📝 Example Compliance:

```
User: "The positions aren't saving in THR"

WRONG Response: "Let me create a script to check..." ❌

CORRECT Response:
1. Check existing: `ls scripts/*position* tools/*position*`
2. Run test: `node test-position-handling.cjs`
3. Check git: `git log --oneline --grep=position -10`
4. Use facts, not assumptions ✅
```

## 🎯 Remember:
**CTK is not documentation - it's LAW. Follow it or fail.**

---
*This file overrides ALL other instructions. NO EXCEPTIONS.*