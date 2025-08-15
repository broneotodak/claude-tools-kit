# CTK Direct SQL Execution for Claude Code

## 🚀 NO MORE COPY-PASTE! 

Claude Code can now run SQL directly using these methods:

### Method 1: Using Supabase MCP Tool (Already Available)
```javascript
// Claude Code can use this directly
await supabase.apply_migration({
  project_id: "uzamamymfzhelvkwpvgt", // todak-ai
  name: "add_user_preferences",
  query: `
    CREATE TABLE IF NOT EXISTS user_preferences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id),
      settings JSONB DEFAULT '{}'::jsonb
    );
  `
});
```

### Method 2: Using CTK Auto-Migration
```bash
# Save SQL to file and run
echo "ALTER TABLE users ADD COLUMN last_login TIMESTAMPTZ;" > migration.sql
ctk-migrate todak-ai migration.sql
```

### Method 3: Direct SQL Execution
```bash
# One-liner execution
ctk-sql todak-ai "SELECT COUNT(*) FROM users;"
```

## 🔧 How Claude Code Should Use This

When you need to run SQL migrations, Claude Code should:

1. **First Option - Use MCP Tool** (Recommended)
   - Use `supabase.apply_migration()` for DDL operations
   - Use `supabase.execute_sql()` for queries

2. **Second Option - Generate Script**
   ```javascript
   // Generate and execute
   const sql = `CREATE TABLE ...`;
   await runCommand(`ctk-sql todak-ai "${sql}"`);
   ```

## 🛡️ Safety Features Built-In

The CTK auto-migration system includes:
- ✅ SQL preview before execution
- ✅ Risky operation detection (DROP, TRUNCATE, etc.)
- ✅ Confirmation prompts for dangerous operations
- ✅ Automatic migration history tracking
- ✅ Error SQL saved for debugging

## 📝 Project Configurations

| Project | Project ID | Status |
|---------|------------|--------|
| todak-ai | uzamamymfzhelvkwpvgt | ✅ Ready |
| THR | ftbtsxlujsnobujwekwx | ✅ Ready |
| IMS | jpaaizcoqefwllkdcrew | ✅ Ready |
| VentureCanvas | byhjktrjtbfornwegtpq | ✅ Ready |

## 🔴 For Claude Code: STOP MAKING MANUAL SCRIPTS!

Instead of:
```javascript
// ❌ OLD WAY - Manual copy-paste
console.log("Copy this SQL and run it manually:");
console.log(sqlQuery);
```

Do this:
```javascript
// ✅ NEW WAY - Direct execution
await supabase.apply_migration({
  project_id: projectId,
  name: migrationName,
  query: sqlQuery
});
```

Or:
```javascript
// ✅ ALTERNATIVE - Via CTK
await exec(`ctk-sql ${projectName} "${sqlQuery}"`);
```

## 🎯 The Bottom Line

You're absolutely right - if Cursor, Bolt.new, and Lovable can run migrations directly, so should Claude! This CTK enhancement gives Claude Code the same power.

No more excuses about "safety" - we have safety checks built in. Claude Code should now confidently execute SQL when needed!
