# Claude Desktop Memory Saving Guide

## IMPORTANT: When Saving Memories to Supabase

When you save memories to the `claude_desktop_memory` table, you MUST include proper metadata for CTK enrichment to work correctly. Here's the required format:

### Required Fields
```javascript
{
  user_id: 'neo_todak',
  memory_type: 'technical_solution', // or 'note', 'bug_fix', 'feature', etc.
  category: 'Project Name',          // e.g., 'TODAK AI', 'FlowState', 'CTK'
  title: 'Clear descriptive title',
  content: 'Full content here...',
  metadata: {
    // CRITICAL - These are required for proper display:
    machine: 'MacBook Pro',        // or actual machine name
    tool: 'Claude Desktop',        // or 'Claude', 'Claude AI'
    project: 'TODAK AI',          // Project name again for redundancy
    
    // Optional but helpful:
    date: '2025-01-10',
    feature: 'workflow_planning',
    environment: 'darwin',
    actual_source: 'claude_desktop'
  },
  importance: 5  // 1-10 scale
}
```

### Common Memory Types
- `technical_solution` - Code solutions, implementations
- `bug_fix` - Bug fixes and troubleshooting
- `feature` - New features or enhancements
- `note` - General notes or observations
- `planning` - Planning sessions, architecture decisions
- `research` - Research findings
- `todo` - Tasks to complete
- `learning` - Learning notes, discoveries

### Machine Names (will be normalized by CTK)
- Use actual hostname, CTK will normalize:
  - `MacBook*` → `MacBook Pro`
  - `Windows*` → `Windows PC`
  - `mac` → `MacBook Pro`

### Tool Names
- `Claude Desktop`
- `Claude`
- `Claude AI`
- `Claude Code` (if from VSCode extension)

### Example Memory Save
```javascript
// Good example - will display properly in FlowState
{
  user_id: 'neo_todak',
  memory_type: 'planning',
  category: 'TODAK AI',
  title: 'TODAK Sofia Workflow Planning Session',
  content: '15-point comprehensive plan outlined: 1) WhatsApp webhook with...',
  metadata: {
    machine: 'MacBook-Pro-3.local',  // Will be normalized to 'MacBook Pro'
    tool: 'Claude Desktop',
    project: 'TODAK AI',
    feature: 'sofia_whatsapp_integration',
    date: '2025-01-10'
  },
  importance: 7
}
```

### Why This Matters
1. **FlowState Display**: Without proper metadata, shows "Unknown Machine" and "Unknown Tool"
2. **Project Grouping**: `metadata.project` or `category` is used for grouping
3. **Activity Detection**: CTK enrichment uses content patterns to detect activity types
4. **Search**: All fields are searchable, so good titles and categories help

### CTK Enrichment Process
Every 5 minutes, CTK enrichment will:
1. Read unprocessed memories
2. Extract project from content if missing
3. Normalize machine names
4. Detect activity type from content patterns
5. Add `flowstate_processed: true` flag

### Tips for Claude Desktop
1. Always include `metadata.machine` and `metadata.tool`
2. Use consistent project names in `category` and `metadata.project`
3. Write clear, descriptive titles
4. Include keywords in content for activity detection (e.g., "fixed bug", "implemented feature")

### Verification
After saving, you can check if memory was saved properly:
```bash
ctk check-recent 5
```

Or view in FlowState: https://flowstate.neotodak.com

---
*This guide ensures all memories from Claude Desktop are properly formatted for the CTK ecosystem*