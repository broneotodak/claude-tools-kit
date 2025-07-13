# Anthropic Usage Best Practices for CTK Workflows

This guide provides practical strategies for optimizing Claude usage within the Claude Tools Kit (CTK) ecosystem, based on Anthropic's official usage limit best practices.

## 1. Context Management Strategies

### Leverage Conversation Continuity
- **Reference Previous Information**: Instead of repeating data, use phrases like "As mentioned earlier" or "Using the data from above"
- **Build on Context**: Claude retains the entire conversation, so build incrementally rather than restating

### CTK-Specific Context Tips
```bash
# Good: Reference existing analysis
"Based on the memory entries we just reviewed, analyze the patterns"

# Avoid: Repeating data
"Here's the memory data again: [full data dump]"
```

### Organize Information Upfront
- Load all relevant CTK tools and configurations at conversation start
- Provide comprehensive project context in your initial message
- Include environment details, active projects, and relevant file paths

## 2. When to Use /compact

### Ideal Scenarios for Compact Mode
- **Large Data Processing**: When working with extensive memory queries or activity logs
- **Multi-File Operations**: Batch processing across multiple CTK tools
- **Report Generation**: Creating summaries from large datasets
- **Code Reviews**: Analyzing multiple tool scripts simultaneously

### CTK Compact Mode Examples
```bash
# Use compact for batch memory operations
/compact "Analyze all memories from the past week and identify patterns"

# Use compact for multi-tool workflows
/compact "Check activities, save important ones as memories, then generate report"
```

## 3. Efficient Large Data Operations

### Batch Processing Strategy
```javascript
// Instead of multiple individual operations
memories.forEach(m => saveMemory(m)); // Avoid

// Use batch operations
await batchSaveMemories(memories); // Preferred
```

### Streaming and Pagination
- Process large datasets in chunks
- Use CTK's built-in pagination for memory queries
- Stream results rather than loading everything into memory

### Query Optimization
```sql
-- Efficient: Specific date range and limit
SELECT * FROM claude_desktop_memory 
WHERE created_at > NOW() - INTERVAL '7 days' 
LIMIT 100;

-- Avoid: Unbounded queries
SELECT * FROM claude_desktop_memory;
```

## 4. File Operations Best Practices

### Minimize File Creation
- **Edit Over Create**: Always prefer modifying existing CTK tools
- **Batch Updates**: Group related file changes together
- **Use Multi-Edit**: For multiple changes to the same file

### Efficient File Reading
```javascript
// Read specific sections when possible
const config = await readFile('config.json', { 
  startLine: 10, 
  endLine: 50 
});

// Avoid reading entire large files repeatedly
```

### Smart File Organization
- Keep CTK tools modular and focused
- Use configuration files to avoid hardcoding
- Leverage `.env` for environment-specific settings

## 5. Memory Usage Optimization

### CTK Memory Strategies

#### 1. Importance Levels
```javascript
// Use appropriate importance levels
saveMemory("routine", "Daily check", "Status normal", 3);  // Low
saveMemory("insight", "Pattern found", "Critical trend", 7); // High

// Reserve 8-10 for truly critical items
```

#### 2. Category Organization
- Use consistent categories: `project`, `insight`, `task`, `reference`
- Query by category to reduce data transfer
- Archive old memories periodically

#### 3. Metadata Efficiency
```javascript
// Include only essential metadata
{
  machine_name: "normalized-name",
  importance: 5,
  tags: ["essential", "tags", "only"]
}
```

### Query Optimization Patterns

#### Time-Based Queries
```javascript
// Efficient: Specific timeframes
const recentMemories = await queryMemories({
  timeframe: '24h',
  limit: 50
});

// Avoid: Open-ended time queries
const allMemories = await queryMemories(); // Too broad
```

#### Focused Searches
```javascript
// Good: Specific search criteria
const results = await searchMemories({
  category: 'project',
  searchTerm: 'FlowState',
  importance: { min: 5 }
});
```

## 6. CTK Workflow Optimization

### Combined Operations
```bash
# Efficient: Single command with multiple actions
node ~/claude-tools/workflow.js --check-activities --save-important --generate-report

# Avoid: Multiple separate commands
node check-activities.js
node save-memory.js
node generate-report.js
```

### Tool Chaining
```javascript
// Create workflow scripts that combine tools
async function dailyWorkflow() {
  const activities = await checkActivities({ hours: 24 });
  const important = filterImportant(activities);
  await batchSaveMemories(important);
  return generateSummary(important);
}
```

### Caching Strategies
- Cache frequently accessed configurations
- Store computed results for reuse
- Use CTK's built-in caching mechanisms

## 7. Project-Specific Optimizations

### FlowState AI Integration
- Batch activity syncs rather than real-time
- Use webhooks for critical updates only
- Aggregate metrics before saving

### Multi-Machine Workflows
- Synchronize memories efficiently across machines
- Use machine-specific queries when possible
- Implement conflict resolution strategies

## 8. Communication Patterns

### Effective Prompting
```bash
# Good: Clear, comprehensive instruction
"Using the CTK memory tools, analyze project progress for FlowState over the past week, identify top 3 insights, and save them with appropriate importance levels"

# Avoid: Vague requests requiring clarification
"Check some memories"
```

### Progressive Enhancement
1. Start with overview queries
2. Drill down into specific areas
3. Reference previous findings
4. Build comprehensive understanding

## 9. Resource Management

### Monitor Usage
- Track conversation length
- Be aware of context window usage
- Plan complex operations across sessions if needed

### Optimize Tool Usage
- Web searches and external API calls consume more resources
- Batch similar operations together
- Use local caching when possible

## 10. Best Practices Summary

### Do's
- ✓ Plan conversations comprehensively
- ✓ Use /compact for large operations
- ✓ Reference previous context
- ✓ Batch similar operations
- ✓ Optimize queries with limits and filters
- ✓ Use appropriate importance levels
- ✓ Cache frequently accessed data

### Don'ts
- ✗ Repeat large data blocks
- ✗ Create unnecessary files
- ✗ Run unbounded queries
- ✗ Make multiple small requests
- ✗ Ignore context continuity
- ✗ Overuse high importance levels

## Quick Reference Card

```bash
# Efficient CTK workflow
1. Load context: source .env && check current state
2. Batch operations: use workflow scripts
3. Reference context: "As shown above..."
4. Use compact mode: /compact for large ops
5. Optimize queries: always use limits
6. Save selectively: importance 3-6 for most
```

---

*Based on Anthropic's official usage best practices, adapted for Claude Tools Kit workflows*