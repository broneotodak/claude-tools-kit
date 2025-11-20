# Performance Diagnostic Tool

Comprehensive performance analysis tool for web projects. Automatically detects performance issues, anti-patterns, and provides actionable recommendations.

## Features

✅ **Bundle Size Analysis**
- Identifies large bundles (>1MB warning, >2MB critical)
- Lists individual large files (>500KB)
- Provides code splitting recommendations

✅ **Dependency Analysis**
- Detects heavy dependencies (moment, lodash, chart.js, etc.)
- Suggests lighter alternatives
- Counts total dependencies

✅ **Performance Anti-Patterns**
- Scans for inline arrow functions in event handlers
- Detects console.log statements in production code
- Finds dangerous patterns (dangerouslySetInnerHTML, forceUpdate)

✅ **Database Query Analysis**
- Detects SELECT * queries
- Finds queries without LIMIT clause
- Identifies sequential await in loops (N+1 problem)

✅ **Component Structure**
- Identifies large components (>300 lines)
- Counts total components
- Recommends splitting strategies

✅ **Memory Leak Detection**
- Finds event listeners without cleanup
- Detects missing useEffect cleanup functions

✅ **Build Configuration**
- Checks for Vite/Webpack configuration
- Suggests build optimizations

## Usage

### Run on Current Project
```bash
node /Users/broneotodak/Projects/claude-tools-kit/tools/performance-diagnostic.js
```

### Run on Specific Project
```bash
node /Users/broneotodak/Projects/claude-tools-kit/tools/performance-diagnostic.js /path/to/project
```

### From Any Directory (Add to PATH)
```bash
# Add to your ~/.zshrc or ~/.bashrc:
alias perf-check="node /Users/broneotodak/Projects/claude-tools-kit/tools/performance-diagnostic.js"

# Then use:
perf-check
perf-check /path/to/project
```

## Output

The tool provides:

1. **Performance Score** (0-100)
   - 90-100: Excellent 🟢
   - 75-89: Good 🟡
   - 60-74: Fair 🟠
   - 0-59: Needs Improvement 🔴

2. **Critical Issues** (🔴)
   - High-severity problems that significantly impact performance
   - Includes specific recommendations

3. **Warnings** (🟡)
   - Medium-severity issues that should be addressed
   - May impact performance under certain conditions

4. **Recommendations** (💡)
   - Optimization suggestions with impact ratings
   - Best practices for improvement

5. **Detailed JSON Report**
   - Saved to `performance-report.json` in project root
   - Contains all metrics and findings

## Example Output

```
🔍 Performance Diagnostic Tool
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 Project: /path/to/project
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Project Type: React

📦 Bundle Size Analysis...
   📊 Total Bundle Size: 7527.24 KB
   🔴 Issue: Bundle size exceeds 2MB

🗄️  Database Query Analysis...
   🔴 Found 453 queries without LIMIT
   🔴 Found 116 await statements in loops

══════════════════════════════════════════════════
📊 PERFORMANCE DIAGNOSTIC REPORT
══════════════════════════════════════════════════

🔴 Overall Score: 23/100 (Needs Improvement)

🔴 CRITICAL ISSUES:
1. [Database] Queries without LIMIT clause
   💡 Add pagination or limit to prevent loading large datasets
```

## What It Checks

### 1. Bundle Size
- Total JavaScript bundle size
- Individual file sizes
- Recommends code splitting for files >500KB

### 2. Dependencies
- Detects heavy libraries:
  - `moment` → Use date-fns or day.js
  - `lodash` → Use lodash-es with tree-shaking
  - `@mui/material` → Optimize imports
  - `chart.js` → Import only needed charts

### 3. React Anti-Patterns
- Inline arrow functions (re-render issues)
- Excessive console.log statements
- Deprecated patterns (forceUpdate, findDOMNode)
- Security issues (dangerouslySetInnerHTML)

### 4. Database Optimization
- **SELECT *** - Should specify columns
- **Missing LIMIT** - Can load thousands of rows
- **Sequential await** - Should use Promise.all()

Example bad pattern:
```javascript
// BAD: Sequential (slow)
for (const item of items) {
  await database.query(item.id);
}

// GOOD: Parallel (fast)
await Promise.all(
  items.map(item => database.query(item.id))
);
```

### 5. Component Size
- Components >300 lines should be split
- Improves:
  - Maintainability
  - Re-render performance
  - Code reusability

### 6. Memory Leaks
Detects missing cleanup:
```javascript
// BAD: Memory leak
useEffect(() => {
  window.addEventListener('resize', handler);
}, []);

// GOOD: Cleanup
useEffect(() => {
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
}, []);
```

## Scoring System

Points are deducted for:
- Bundle >2MB: -15 points
- Bundle >1MB: -10 points
- Queries without LIMIT: -10 points
- Sequential await in loops: -10 points
- Memory leaks: -10 points
- Each heavy dependency: -3 points
- Large components: -1 point each (max -10)
- Many console.logs: -3 points
- Inline arrow functions: -5 points

## Integration

### CI/CD Pipeline
```yaml
# .github/workflows/performance.yml
name: Performance Check
on: [push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Build
        run: npm run build
      - name: Performance Check
        run: node tools/performance-diagnostic.js
```

### Pre-commit Hook
```bash
#!/bin/sh
# .git/hooks/pre-commit
npm run build
node tools/performance-diagnostic.js
if [ $? -ne 0 ]; then
    echo "Performance check failed!"
    exit 1
fi
```

## Interpreting Results

### Critical Issues (🔴)
**Must fix** before production. These significantly impact:
- User experience
- Server costs
- Page load times
- Memory usage

### Warnings (🟡)
**Should fix** soon. May cause:
- Slower performance under load
- Increased bundle size
- Maintainability issues

### Recommendations (💡)
**Nice to have** improvements:
- Future optimizations
- Best practices
- Code quality improvements

## Common Fixes

### Database Performance
```javascript
// Add .limit() to queries
const { data } = await supabase
  .from('employees')
  .select('*')
  .limit(100);  // ← Add this

// Use Promise.all() for parallel queries
const results = await Promise.all([
  supabase.from('employees').select('*'),
  supabase.from('organizations').select('*')
]);
```

### Bundle Size
```javascript
// Lazy load heavy components
const PDFViewer = lazy(() => import('./PDFViewer'));

// Tree-shake Material-UI
import Button from '@mui/material/Button';  // Good
import { Button } from '@mui/material';      // Bad (imports everything)
```

### Component Size
```javascript
// Split large components
// Before: 3000-line component
// After: Multiple 300-line components

<EmployeeDetails>
  <EmployeeHeader />
  <EmployeeInfo />
  <EmployeeDocuments />
  <EmployeeHistory />
</EmployeeDetails>
```

## Requirements

- Node.js 14+
- Built project (dist/ or build/ directory)
- src/ directory for code analysis

## Supported Frameworks

- React (JSX/TSX)
- Vue
- Angular
- Next.js
- Generic JavaScript projects

## Output Files

- `performance-report.json` - Detailed JSON report with all metrics
- Console output - Human-readable summary

## Tips

1. **Run after building**: The tool analyzes built bundles
2. **Fix critical issues first**: Focus on database and bundle size
3. **Re-run after fixes**: Track improvement over time
4. **Use with CI/CD**: Catch issues before deployment
5. **Set baselines**: Track score changes over time

## Support

For issues or feature requests, contact the development team or create an issue in the project repository.

## License

Internal tool for Todak/Neotodak projects.
