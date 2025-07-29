# CTK Installation Guide

## Quick Install

```bash
# 1. Clone this repository
git clone https://github.com/broneotodak/claude-tools-kit.git

# 2. Copy CTK to your project
cp -r claude-tools-kit/ctk-system /path/to/your/project/
cp claude-tools-kit/.ctkrc /path/to/your/project/
cp claude-tools-kit/hooks/pre-commit /path/to/your/project/.git/hooks/

# 3. Make hook executable
chmod +x /path/to/your/project/.git/hooks/pre-commit

# 4. Customize .ctkrc for your schema
```

## Manual Setup

### 1. Create CTK Directory
```bash
mkdir -p your-project/ctk-system
```

### 2. Configure .ctkrc
Edit `.ctkrc` to match your database schema:

```json
{
  "jsonbMappings": {
    "your_table": {
      "field_that_looks_like_column": "actual_jsonb_column"
    }
  }
}
```

### 3. Install Pre-commit Hook
Copy the hook to `.git/hooks/pre-commit` and make it executable.

### 4. Test Installation
```bash
# Try to commit a file with direct email access
echo "SELECT email FROM users" > test.sql
git add test.sql
git commit -m "test"
# Should fail with CTK error
```

## Integration with Claude Code

When starting a new session with Claude Code:

1. Mention CTK compliance is required
2. Point to the `.ctkrc` file
3. Remind about platform constraints (e.g., Supabase auth restrictions)

Example prompt:
```
This project uses CTK (Check-Think-Know) procedures. 
Check .ctkrc for JSONB field mappings.
Never create triggers on auth.* tables in Supabase.
```

## Troubleshooting

### Hook Not Running
- Check if executable: `ls -la .git/hooks/pre-commit`
- Make executable: `chmod +x .git/hooks/pre-commit`

### False Positives
- Add exceptions to the grep patterns in the hook
- Update `.ctkrc` with correct mappings

### Schema Changes
- Update `.ctkrc` when schema changes
- Run `node ctk-system/verify-schema.js` weekly