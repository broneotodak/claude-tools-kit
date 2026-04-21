# neo-brain — Migration runbook

## Step 1 — Grab secrets (manual, 2 min)

You must do this yourself from a browser — Supabase MCP can't fetch service_role keys.

### 1a. neo-brain service_role key
1. Visit https://supabase.com/dashboard/project/xsunmervpyrplzarebva/settings/api
2. Under "Project API keys" → copy the **service_role** key (the `sb_secret_...` or JWT format)
3. Add to `~/Projects/claude-tools-kit/.env`:
   ```
   NEO_BRAIN_URL=https://xsunmervpyrplzarebva.supabase.co
   NEO_BRAIN_SERVICE_ROLE_KEY=<paste here>
   ```

### 1b. Hetzner Object Storage (for future media work — not blocking migration)
1. Hetzner Cloud Console → Object Storage → Create bucket `neo-brain-media` (region Helsinki/Falkenstein)
2. Create S3 credentials for that bucket
3. Add to `.env`:
   ```
   NEO_BRAIN_S3_ENDPOINT=https://fsn1.your-objectstorage.com
   NEO_BRAIN_S3_REGION=fsn1
   NEO_BRAIN_S3_BUCKET=neo-brain-media
   NEO_BRAIN_S3_ACCESS_KEY_ID=<paste>
   NEO_BRAIN_S3_SECRET_ACCESS_KEY=<paste>
   ```

Skip 1b if you're not ingesting media yet — text migration (step 2) doesn't need it.

## Step 2 — Dry run

```bash
cd ~/Projects/claude-tools-kit
node tools/migrate-to-neo-brain.js --phase=all --dry-run
```

This reads from old, shows what WOULD be inserted, makes no changes. Review the counts.

## Step 3 — Real migration (phased)

Run phases one at a time, verify between each:

```bash
# 3a. Personality (smallest, 14 rows)
node tools/migrate-to-neo-brain.js --phase=personality

# 3b. Facts (893 rows)
node tools/migrate-to-neo-brain.js --phase=facts

# 3c. Knowledge graph (795 rows, best-effort flatten)
node tools/migrate-to-neo-brain.js --phase=graph

# 3d. Memories (4,816 rows, ~25 min — re-embeds 37 unembedded)
node tools/migrate-to-neo-brain.js --phase=memories --batch=200
```

## Step 4 — Verify

```sql
-- in Supabase dashboard → neo-brain → SQL Editor
SELECT 'memories' AS t, COUNT(*) FROM memories
UNION ALL SELECT 'facts', COUNT(*) FROM facts
UNION ALL SELECT 'personality', COUNT(*) FROM personality
UNION ALL SELECT 'knowledge_nodes', COUNT(*) FROM knowledge_nodes;
```

Row counts should match old DB (within small tolerance for de-duplication / re-embed).

## Step 5 — Dual-write active

`save-memory.js` already dual-writes once `NEO_BRAIN_URL` + `NEO_BRAIN_SERVICE_ROLE_KEY` are in `.env`. No code change needed — just the env. Every memory saved will go to BOTH databases during soak.

## Step 6 — Soak (2 weeks)

Both DBs accumulate. Monitor:
```bash
node tools/compare-memory-rowcounts.js  # TODO: write this during soak
```

## Step 7 — Flip reads

One consumer at a time, update to read from neo-brain:

- [ ] NClaw dashboard (`/home/openclaw/nclaw-dashboard/server.js`) — swap its `retrieveTwinMemories` RPC from `match_memories_gemini` to `match_memories` on neo-brain
- [ ] ClaudeN (`~/Projects/clauden-app`) — API endpoints query neo-brain via SDK
- [ ] `check-latest-activities.js` — point at neo-brain `memory_writes_log`
- [ ] Any Python scripts — swap to `neo_brain_client.py`

## Step 8 — Old DB read-only

Once everything reads from neo-brain:
1. Revoke service_role write permission on `claude_desktop_memory` (via SQL — `REVOKE INSERT,UPDATE,DELETE ON claude_desktop_memory FROM service_role;`)
2. Disable dual-write in `save-memory.js` (comment out or feature-flag)
3. Old DB stays as archive forever per Neo's preference.
