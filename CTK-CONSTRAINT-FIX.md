# CTK Constraint Fix Instructions

## Problem
CTK is saving memories with `source='claude_code'` but they're being rejected by the database constraint.

## Quick Fix via Supabase SQL Editor

1. Go to: https://supabase.com/dashboard/project/uzamamymfzhelvkwpvgt/sql/new
2. Copy and paste this SQL:

```sql
-- Drop existing constraint
ALTER TABLE claude_desktop_memory 
DROP CONSTRAINT IF EXISTS claude_desktop_memory_source_check;

-- Add updated constraint with claude_code
ALTER TABLE claude_desktop_memory 
ADD CONSTRAINT claude_desktop_memory_source_check 
CHECK (source::text = ANY (ARRAY['claude_desktop', 'cursor', 'manual', 'other', 'claude_code']::text[]));
```

3. Click "Run" 

## Alternative: Run the Node.js Script

```bash
cd ~/Projects/claude-tools-kit
node tools/fix-ctk-constraint.js
```

## Verify the Fix

After running either method:

1. Test CTK memory save:
```bash
node tools/save-memory-enhanced.js --project "CTK" --category "Test" --importance 5 "Testing claude_code source after fix"
```

2. Check FlowState dashboard: https://flowstate.neotodak.com
   - CTK activities should now appear

## What This Fixes
- ✅ CTK memories can save with `source='claude_code'`
- ✅ FlowState dashboard will display CTK activities
- ✅ Proper separation between Claude Desktop and Claude Code sources
- ✅ All existing memories remain intact