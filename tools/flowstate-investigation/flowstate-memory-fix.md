# FlowState Memory System Fix Guide

## Quick Fix (Without activity_log table)

Since the `activity_log` table doesn't exist and FlowState already reads from `claude_desktop_memory`, we can fix the system without it:

### 1. Stop the Broken Memory Sync Service

```bash
# Disable the failing service
launchctl unload ~/Library/LaunchAgents/com.flowstate.memory-sync.plist
launchctl remove com.flowstate.memory-sync

# Remove the service file
rm ~/Library/LaunchAgents/com.flowstate.memory-sync.plist
```

### 2. Update Claude Desktop System Prompt

Replace your current ClaudeN V15 system prompt with the new V16 version that ensures proper metadata:

**Key changes in V16:**
- Fixed machine name: Always "MacBook Pro" (not "Neo Macbook")
- Proper tool name: "Claude Desktop" (not "claude_desktop")
- Required metadata fields for FlowState
- Correct activity_type values

**Location:** `/Users/broneotodak/claude-tools/CLAUDE_DESKTOP_SYSTEM_PROMPT_V16.md`

### 3. Machine Name Normalization

The memory enrichment rules have been updated to normalize all machine name variations:
- "Neo Macbook" → "MacBook Pro"
- "MacBook-Pro-3.local" → "MacBook Pro"
- Any variation with "mac" → "MacBook Pro"

### 4. Direct Memory Saving (No Bridge Needed)

Since FlowState reads directly from `claude_desktop_memory`, we don't need the bridge. Just ensure:

1. **Claude Desktop** saves with correct metadata
2. **Claude Code** uses THR memory utils or CTK enrichment
3. **Git hooks** use normalized machine names

## Testing the Fix

### 1. Test Claude Desktop Memory
Start a new conversation in Claude Desktop and check if memories appear correctly:

```sql
SELECT id, source, category, metadata
FROM claude_desktop_memory
WHERE created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC;
```

### 2. Check FlowState Dashboard
Visit https://flowstate.neotodak.com and verify:
- "Active Development" shows recent activities
- Machine names are "MacBook Pro"
- Tools show proper names
- Categories are correct

## Optional: Create activity_log Table

If you want the full architecture working:

1. Run this SQL in Supabase dashboard:
   ```sql
   -- File: /Users/broneotodak/claude-tools/create-activity-log.sql
   ```

2. Re-enable the memory sync service:
   ```bash
   cd /Users/broneotodak/Projects/flowstate-ai
   ./setup-memory-sync.sh
   ```

## Summary

The memory system is already functional because FlowState reads directly from `claude_desktop_memory`. The main fixes needed are:

1. ✅ Stop the broken sync service
2. ✅ Update Claude Desktop system prompt to V16
3. ✅ Machine name normalization is already fixed
4. ✅ No additional changes needed - system works!

The "404 errors" and "daemon failures" were from trying to sync to a non-existent `activity_log` table, which isn't actually needed for basic FlowState functionality.