# CTK (Check-Think-Know) System

## Overview
CTK is a mandatory procedure system to prevent schema assumption errors in database operations. It was created after production incidents where direct column access failed due to JSONB field storage.

## Core Principles

1. **Never Assume Schema**: Always verify actual database structure
2. **Check Before Code**: Run verification before writing queries
3. **Think About Impact**: Consider cross-module effects
4. **Know Your Constraints**: Understand platform limitations (e.g., Supabase auth)

## Key Lessons from THR Implementation

### Critical Rules for Supabase

❌ **NEVER DO THESE:**
- Create triggers on `auth.users` or any `auth.*` tables
- Create views that join with `auth.users`
- Modify the auth schema directly
- Assume a field is a direct column without checking

✅ **ALWAYS DO THESE:**
- Use `auth.uid()` in RLS policies
- Reference `user_id` in your tables, not join auth tables
- Test authentication after ANY database changes
- Check JSONB field mappings in `.ctkrc`

### Common JSONB Patterns

Most modern applications store structured data in JSONB fields:

```javascript
// ❌ WRONG - Direct column access
.select('email, phone, address')

// ✅ CORRECT - JSONB field access
.select('contact_info')
// Then: data.contact_info.email
```

## Installation

1. Copy the CTK system to your project:
```bash
cp -r ctk-system/ /path/to/your/project/
cp .ctkrc /path/to/your/project/
cp .git/hooks/pre-commit /path/to/your/project/.git/hooks/
```

2. Make the hook executable:
```bash
chmod +x /path/to/your/project/.git/hooks/pre-commit
```

3. Configure `.ctkrc` for your schema

## Configuration (.ctkrc)

```json
{
  "jsonbMappings": {
    "table_name": {
      "field_name": "jsonb_column_name"
    }
  },
  "strictMode": true,
  "checklistRequired": true,
  "commonMistakes": {
    "directEmailAccess": "Email is always in JSONB contact_info field"
  }
}
```

## Usage

### Before Writing Database Queries

1. Run schema verification:
```bash
node ctk-system/verify-schema.js
```

2. Check `.ctkrc` for field mappings

3. Write queries using correct JSONB access

### Git Pre-commit Hook

The hook automatically:
- Checks for direct column access patterns
- Validates against `.ctkrc` mappings
- Blocks commits with schema assumptions

### Weekly Checklist

Run weekly to maintain compliance:
```bash
node ctk-system/weekly-checklist.js
```

## Emergency Procedures

If authentication breaks:
1. Check for triggers on `auth.*` tables
2. Check for views joining `auth.users`
3. Run rollback scripts immediately

## Integration with Claude Code

When working with Claude Code:
1. ALWAYS mention CTK compliance is required
2. Point to `.ctkrc` for field mappings
3. Remind about platform constraints (Supabase auth)

## Learning from Incidents

### The Authentication Lockout (2025-01-28)
- **Cause**: Trigger created on `auth.users` table
- **Impact**: Complete system authentication failure
- **Fix**: Remove all triggers/views touching auth schema
- **Lesson**: Never modify auth schema in Supabase

### The Email Column Error
- **Cause**: Assumed `email` was a direct column
- **Impact**: Queries failed in production
- **Fix**: Access via `contact_info` JSONB field
- **Lesson**: Always verify schema structure

## Best Practices

1. **Incremental Testing**: Test after each database change
2. **Cross-Module Awareness**: Consider impacts on other modules
3. **Documentation**: Update `.ctkrc` when schema changes
4. **Monitoring**: Check logs after deployments

Remember: CTK is not optional - it's a critical safety system.