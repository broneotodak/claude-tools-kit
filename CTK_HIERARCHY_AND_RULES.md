# CTK (Claude Task Kit) Hierarchy and Rules

## What is CTK?

CTK (Claude Task Kit) is a comprehensive system of rules, procedures, and tools designed to ensure data integrity, security, and consistent development practices across all Claude Code sessions.

## CTK Hierarchy (Order of Precedence)

### 1. **Global CTK** (Highest Priority)
- **Location**: `/Users/broneotodak/.claude/CLAUDE.md`
- **Purpose**: System-wide rules that apply to ALL projects
- **Contents**: 
  - Security guidelines
  - General development principles
  - Workspace overview
  - Tool locations
  - Critical warnings (e.g., data corruption prevention)
- **When Loaded**: ALWAYS loaded first in every session

### 2. **Project-Specific CTK** (Overrides Global)
- **Location**: `[PROJECT_DIR]/CLAUDE.md`
- **Examples**:
  - `/Users/broneotodak/Projects/THR/CLAUDE.md`
  - `/Users/broneotodak/Projects/flowstate-ai/CLAUDE.md`
- **Purpose**: Project-specific rules and knowledge
- **Contents**:
  - Project structure
  - Field mappings
  - Database schemas
  - Project-specific warnings
  - Custom procedures
- **When Loaded**: When working in that specific project directory

### 3. **CTK Tools** (Enforcement Layer)
- **Primary Location**: `/Users/broneotodak/Projects/claude-tools-kit/`
- **Secondary Location**: `/Users/broneotodak/claude-tools/` (older, being phased out)
- **Purpose**: Validation, enforcement, and utility scripts
- **Key Tools**:
  - `ctk-enforcer.js` - Validates operations before execution
  - `safe-data-migration.js` - Safe data migration wrapper
  - `fix-memory-null-owners.js` - Database maintenance
  - Memory management tools
  - Backup utilities

## CTK Rules (Non-Negotiable)

### 1. **Data Integrity**
- ❌ NEVER make assumptions about data structure
- ❌ NEVER perform bulk operations without preview
- ❌ NEVER skip validation checks
- ✅ ALWAYS verify data structure before operations
- ✅ ALWAYS show 5 sample records before bulk changes
- ✅ ALWAYS create rollback points

### 2. **Security**
- ❌ NEVER hardcode credentials
- ❌ NEVER commit secrets to git
- ❌ NEVER log sensitive data
- ✅ ALWAYS use environment variables
- ✅ ALWAYS check .gitignore before commits
- ✅ ALWAYS validate environment on startup

### 3. **Memory Management**
- ✅ ALWAYS include proper metadata when saving memories
- ✅ ALWAYS include owner field (default: 'neo_todak')
- ✅ ALWAYS use appropriate importance levels (1-10)
- ✅ ALWAYS provide vector embeddings when possible
- ❌ NEVER save memories without proper structure

### 4. **Project Boundaries**
- ✅ ALWAYS respect project phase limits
- ✅ ALWAYS read existing code before editing
- ✅ ALWAYS follow project-specific conventions
- ❌ NEVER implement features beyond current phase
- ❌ NEVER create files unless necessary

### 5. **Documentation**
- ❌ NEVER create documentation proactively
- ✅ ONLY create docs when explicitly requested
- ✅ ALWAYS update CTK files when patterns change
- ✅ ALWAYS document critical fixes in memory

## How CTK is Applied

### When Starting a Session:
1. Load global CLAUDE.md from `~/.claude/`
2. Check current working directory
3. Load project-specific CLAUDE.md if exists
4. Note any warnings or special procedures
5. Verify tool availability

### When Performing Operations:
1. Check if CTK enforcer should be run
2. Verify operation against CTK rules
3. Preview changes before execution
4. Create backups if needed
5. Execute with validation
6. Save memory of significant operations

### When Switching Projects:
1. Save current context to memory
2. Load new project's CLAUDE.md
3. Note differences from previous project
4. Adjust procedures accordingly

## CTK Tool Usage

### For Validation:
```bash
node ~/Projects/claude-tools-kit/ctk-enforcer.js "describe operation"
```

### For Safe Migration:
```bash
node ~/Projects/claude-tools-kit/safe-data-migration.js
```

### For Memory Management:
```bash
node ~/Projects/claude-tools-kit/tools/save-memory-enhanced.js
```

## Common CTK Patterns

### 1. **Before Data Operations**
- Read current structure
- Show sample data
- Get confirmation
- Create backup
- Execute in batches
- Verify results

### 2. **Before Code Changes**
- Read existing code
- Understand conventions
- Check dependencies
- Make minimal changes
- Test thoroughly

### 3. **Before Commits**
- Check for credentials
- Verify .gitignore
- Review changes
- Ensure no sensitive data
- Commit with clear message

## CTK Maintenance

### Daily:
- Memory backups (automated)
- Check for NULL owners
- Verify automation running

### Weekly:
- Review CTK effectiveness
- Update project CLAUDE.md files
- Clean old memories

### Monthly:
- Archive old data
- Update global CTK
- Review security practices

## Important Reminders

1. **CTK is mandatory** - Never skip CTK procedures
2. **Project CTK overrides global** - But security rules never change
3. **When in doubt, check CTK** - Better safe than sorry
4. **Document CTK violations** - Learn from mistakes
5. **CTK evolves** - Update based on lessons learned

## Current Active CTK Locations

- **Global**: `/Users/broneotodak/.claude/CLAUDE.md`
- **Tools**: `/Users/broneotodak/Projects/claude-tools-kit/`
- **THR Project**: `/Users/broneotodak/Projects/THR/CLAUDE.md`
- **FlowState**: `/Users/broneotodak/Projects/flowstate-ai/CLAUDE.md`
- **Memory**: PGVector database with proper structure

---

*Remember: CTK exists to prevent data corruption and ensure quality. Follow it always.*