# Context Protection Checklist for Claude Code

## Before Starting ANY Project Work:

### 1. Memory Check
- [ ] Search memories for project name + "rebuild"
- [ ] Search memories for project name + "deleted"
- [ ] Search memories for project name + "created"
- [ ] Load last 10 memories about this project

### 2. Version Control Check
- [ ] Run `git status` to see local changes
- [ ] Run `git log --oneline -10` to see recent commits
- [ ] Check current branch with `git branch`
- [ ] Compare with remote: `git fetch && git status`
- [ ] Check if local is ahead/behind GitHub
- [ ] Look for uncommitted changes that might be important
- [ ] Verify which version is authoritative (local vs GitHub)
- [ ] **SAVE MEMORY** after version check:
  ```bash
  node ~/claude-tools/save-memory.js "[Project]" "Version Check" \
  "[Project] version check: Local is X commits ahead/behind GitHub. \
  Branch: [branch-name]. Uncommitted changes: [list files]. \
  Decision: use [local/GitHub] version because [reason]" 8
  ```

### 3. Existing Structure Check
- [ ] List all files in project directory
- [ ] Read README.md if exists
- [ ] Check package.json/requirements.txt
- [ ] Look for .sql or schema files
- [ ] Check for documentation folder

### 4. Database Verification
- [ ] List all tables in database
- [ ] Check table schemas before modifying
- [ ] Verify relationships between tables
- [ ] Look for migration files

### 5. Past Work Verification
- [ ] Search for "I created" or "I built" in memories
- [ ] Check git log for recent changes
- [ ] Look for TODO or FIXME comments
- [ ] Verify deployment status

### 6. Assumption Prevention Rules
- [ ] NEVER recreate existing features
- [ ] NEVER delete without explicit user confirmation
- [ ] ALWAYS read before writing
- [ ] ALWAYS search memories before major changes
- [ ] WHEN IN DOUBT, ASK THE USER

### 7. Safe Operations Only
- [ ] Start with read-only operations
- [ ] Document findings before changes
- [ ] Make minimal necessary changes
- [ ] Test in isolation first
- [ ] Keep backups of modified files
- [ ] **SAVE MEMORY** after significant findings:
  ```bash
  node ~/claude-tools/save-memory.js "[Project]" "[Discovery/Decision]" \
  "Found: [what you discovered]. Decision: [what you decided]. \
  Reason: [why this approach]" 7
  ```

## Red Flags to Stop and Ask:
- Creating a "new" system that might exist
- Deleting any table or major component
- Rebuilding instead of fixing
- Making assumptions about structure
- Can't find expected files/tables
- Local and GitHub versions are significantly different
- Uncommitted changes that look important
- Multiple branches with different features

## Memory Save Points:
1. **After Version Check** - Document which version chosen and why
2. **After Structure Discovery** - Save what exists in the project
3. **After Database Check** - Document existing tables/schema
4. **After Major Decisions** - Save approach chosen and reasoning
5. **Before Any Deletions** - Document what's being removed and why

## Remember:
**The user's concern is valid - Claude Code can lose context and rebuild unnecessarily. This checklist prevents that.**

## Example Memory Saves:
```bash
# After version check
node tools/save-memory-enhanced.js "FlowState" "Version Check" \
"FlowState version check: Local is 3 commits ahead of GitHub. \
Branch: main. Uncommitted: dashboard.js, config.json. \
Decision: use local version - has latest dashboard fixes not yet pushed" 8

# After finding existing feature
node tools/save-memory-enhanced.js "FlowState" "Activity Sync Exists" \
"Found: FlowState already has activity sync via Edge Functions. \
Tables: user_activities, project_metrics. No activity_log table needed. \
Decision: Use existing sync, don't create new tables" 9
```