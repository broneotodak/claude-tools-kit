# THR AI Architecture - Static vs Dynamic

## When to Use Static Pages:
1. **High-frequency tasks** (> 5 times/day)
2. **Performance-critical** (< 100ms load time needed)
3. **Complex interactions** (drag-drop, real-time updates)
4. **Regulated workflows** (payroll, leave approval)
5. **Mobile-first features** (needs to work offline)

## When to Use AI-Generated:
1. **Exploratory queries** ("What if..." questions)
2. **One-off reports** (board presentations)
3. **Custom dashboards** (per-user preferences)
4. **Complex filters** (multi-dimensional queries)
5. **Natural language** (CEO asking questions)

## Technical Implementation:

### Static Page:
```jsx
// Pre-built, always available
function EmployeeDirectory() {
  const [employees] = useEmployees(); // Cached, fast
  return <DataGrid rows={employees} />; // Optimized component
}
```

### AI-Generated:
```javascript
// Dynamic, flexible
async function handleSofiaQuery(query) {
  // "Show me all developers in KL office"
  
  // 1. Intent Understanding (OpenAI)
  const intent = await analyzeIntent(query);
  // Output: { action: "list", entity: "employees", filters: {...} }
  
  // 2. Query Generation
  const sqlQuery = await generateSQL(intent);
  // Output: SELECT * FROM thr_employees WHERE position LIKE '%Developer%'
  
  // 3. Component Generation (Claude)
  const componentCode = await generateReactComponent(intent, data);
  
  // 4. Dynamic Rendering
  return renderDynamicComponent(componentCode);
}
```

## Recommended Implementation Plan:

### Phase 1: Core Static Pages (Current)
- ✅ Dashboard
- ✅ Login
- 🔄 Employee Directory
- 🔄 Leave Management
- 🔄 Claims

### Phase 2: AI Enhancement
- Sofia integration in dashboard
- Natural language search
- Query builder UI

### Phase 3: Full AI Views
- Dynamic report generation
- Custom dashboard creation
- Export capabilities

## Example Scenarios:

### Scenario 1: Daily Task
**User**: Needs to apply for leave
**Solution**: Static leave form (instant, reliable)

### Scenario 2: Executive Query
**User**: "Show me headcount growth by department over last 6 months"
**Solution**: AI-generated chart (flexible, one-time)

### Scenario 3: HR Browse
**User**: Needs to find employee by name
**Solution**: Static directory with search (fast, frequently used)

### Scenario 4: Analysis
**User**: "Which departments have the highest turnover?"
**Solution**: AI-generated analysis with recommendations

## Benefits of Hybrid:
1. **Best of both worlds** - Speed when needed, flexibility when wanted
2. **Graceful degradation** - Core features work even if AI is down
3. **Cost-effective** - Don't pay for AI tokens for routine tasks
4. **Progressive enhancement** - Start simple, add AI features gradually

## Implementation Priority:
1. Build core static pages for daily workflows
2. Add Sofia for natural language queries
3. Enable AI view generation for power users
4. Create AI template library for common requests