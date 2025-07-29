# THR Testing Procedure (CTK)

## Overview
This document outlines the systematic testing procedure for THR application to prevent regressions and catch errors early.

## Quick Health Check
```bash
# Run from THR directory
node scripts/health-check-simple.js

# Results saved to: health-check-results/
```

## Full Testing Procedure

### 1. Pre-Deployment Checklist
Before any major changes:

```bash
# 1. Run database constraint check
node scripts/analyze-all-constraints.js

# 2. Run health check
node scripts/health-check-simple.js

# 3. Save current state to memory
cd ~/Projects/claude-tools-kit
node tools/save-memory-enhanced.js -p "THR" -i 5 -c "Testing" "Pre-deployment health check passed"
```

### 2. Error Monitoring Setup

Add to your main App.jsx:
```jsx
import ErrorMonitor from '@shared/components/ErrorMonitor';

// In your App component
return (
  <>
    {/* Your app content */}
    <ErrorMonitor /> {/* Only shows in development */}
  </>
);
```

### 3. Automated Test Results

Health check tests:
- ✅ Database connection
- ✅ All tables exist and have data
- ✅ Critical queries work
- ✅ No duplicate constraints
- ✅ Performance metrics

### 4. Manual Testing Checklist

When automated tests pass, verify these manually:

#### Dashboard
- [ ] Login works (MVP bypass for neo@todak.com)
- [ ] Dashboard loads without errors
- [ ] Stats cards show correct data
- [ ] Dark mode toggle works

#### Organizations
- [ ] Organization cards display
- [ ] Click opens dialog without errors
- [ ] Employee list shows in dialog
- [ ] Executive filter works

#### Employees
- [ ] Employee directory loads
- [ ] Search functionality works
- [ ] Employee profile dialog opens
- [ ] Filters work properly

#### Error States
- [ ] 404 page shows for invalid routes
- [ ] Error boundaries catch component errors
- [ ] Network errors show user-friendly messages

### 5. Performance Benchmarks

Expected load times:
- Dashboard: < 1000ms
- Employee Directory: < 1500ms
- Organization Dialog: < 500ms
- Profile Dialog: < 500ms

### 6. Post-Testing

After testing:
```bash
# Save test results to memory
cd ~/Projects/claude-tools-kit
node tools/save-memory-enhanced.js -p "THR" -i 6 -c "Testing" -f "test_results" "Health check complete: X/Y tests passed"

# Commit health check results
cd ~/Projects/THR
git add health-check-results/
git commit -m "Add health check results [date]"
```

## Common Issues & Solutions

### 1. Duplicate Foreign Key Error
**Symptom**: "More than one relationship found"
**Solution**: Run `sql/85-fix-duplicate-constraints.sql`

### 2. Slow Query Performance
**Symptom**: Page load > 2000ms
**Solution**: Check indexes with `scripts/analyze-all-constraints.js`

### 3. Console Errors Not Visible
**Symptom**: Errors in production
**Solution**: Add ErrorMonitor component

## CI/CD Integration

Add to package.json:
```json
{
  "scripts": {
    "test:health": "node scripts/health-check-simple.js",
    "test:db": "node scripts/analyze-all-constraints.js"
  }
}
```

## Emergency Procedures

If health check fails:
1. Check recent commits: `git log --oneline -10`
2. Run constraint analysis: `node scripts/analyze-all-constraints.js`
3. Check browser console for specific errors
4. Revert if necessary: `git revert HEAD`

## Memory Integration

All test results are automatically saved to CTK memory when:
- Tests fail (importance: 7)
- Major issues found (importance: 8)
- Routine checks pass (importance: 5)

Access memories:
```bash
cd ~/Projects/claude-tools-kit
node tools/check-memory.js THR
```

---

This procedure ensures systematic testing and prevents the issues you mentioned about fixes breaking the system. Always run health checks before and after major changes!