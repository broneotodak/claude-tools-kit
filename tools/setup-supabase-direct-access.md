# Setup Direct Supabase Access for Claude Tools Kit

## Prerequisites
You'll need to add your Supabase service role key to the `.env` file. This key has full database access, so keep it secure.

## Steps:

### 1. Get your Service Role Key
1. Go to: https://supabase.com/dashboard/project/ftbtsxlujsnobujwekwx/settings/api
2. Find "Service role key" under "Project API keys"
3. Click the eye icon to reveal it
4. Copy the key

### 2. Update your .env file
Add this to `/Users/broneotodak/Projects/claude-tools-kit/.env`:

```bash
# Supabase Service Role Key (KEEP SECURE - has full database access)
ATLAS_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### 3. Create Database Introspection Tool
Once you've added the service role key, I'll create tools to:
- Query table structures
- List all columns and their types
- Check relationships and foreign keys
- Validate data before running SQL
- Execute SQL directly when needed

### Security Notes:
- NEVER commit the service role key to git
- The .env file should already be in .gitignore
- This key bypasses Row Level Security (RLS)
- Only use for development/admin tasks

### Benefits:
- No more SQL errors from wrong column names
- Can check table structure before creating views
- Direct SQL execution when needed
- Better understanding of your database schema
- Faster development with accurate queries

Let me know when you've added the service role key, and I'll create the introspection tools!