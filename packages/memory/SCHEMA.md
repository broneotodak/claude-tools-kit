# neo-brain schema reference

Supabase project: `xsunmervpyrplzarebva` (Singapore, Pro $10/mo)
URL: https://xsunmervpyrplzarebva.supabase.co

Applied: 2026-04-19 · Postgres 17 · pgvector 0.8.0 (HNSW cosine)

## Tables

### `people` — canonical person registry
Cross-instance person identity. Every `subject_id` FK points here.

| column | type | notes |
|---|---|---|
| id | uuid PK | default `gen_random_uuid()` |
| display_name | text NOT NULL | |
| kind | text NOT NULL | CHECK (`self`, `user`, `group`, `bot`) |
| identifiers | jsonb NOT NULL | `[{"type":"phone","value":"60..."}, {"type":"lid","value":"..."}, {"type":"email","value":"..."}]` |
| notes | text | |
| metadata | jsonb | |
| created_at, updated_at | timestamptz | |

**Neo's seed row:** `00000000-0000-0000-0000-000000000001` (`NEO_SELF_ID`).
**Indexes:** `people_kind_idx`, `people_identifiers_gin`.

### `memories` — text memories (twin brain + agent logs)

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| content | text NOT NULL | the memory itself |
| embedding | vector(768) | gemini-embedding-001 |
| category | text | e.g. `project`, `personal`, `preference`, `family`, `health`, `finance`, `tech` |
| memory_type | text | e.g. `fact`, `preference`, `milestone`, `decision`, `note`, `conversation_turn` |
| importance | int | 1..10 |
| visibility | text NOT NULL | CHECK (`public`, `internal`, `private`). Default `private`. |
| subject_id | uuid → people.id | who this is ABOUT |
| related_people | uuid[] | other people mentioned |
| source | text NOT NULL | agent that wrote (e.g. `nclaw-hetzner`, `claude-desktop`, `migration_legacy`, `save-memory.js-dualwrite`) |
| source_ref | jsonb | agent-specific ref (contact_id, wa_message_id, session_id, legacy_id, etc) |
| media_id | uuid → media.id | nullable — set when memory describes a media blob |
| metadata | jsonb | free-form |
| archived | boolean | soft-delete |
| created_at, last_accessed | timestamptz | |

**Indexes:**
- `memories_hnsw` — HNSW vector_cosine_ops (partial: embedding IS NOT NULL AND archived = false)
- `memories_subject_idx (subject_id, created_at DESC)`
- `memories_visibility_idx`, `memories_source_idx`, `memories_type_idx`, `memories_category_idx`
- `memories_related_gin` — GIN on related_people array

### `media` — audio / image / video blobs

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| kind | text NOT NULL | CHECK (`image`, `audio`, `video`) |
| storage_url | text NOT NULL | e.g. `https://fsn1.your-objectstorage.com/neo-brain-media/audio/2026/04/uuid.mp3` |
| storage_provider | text | default `s3` |
| mime_type, bytes | | |
| duration_sec | numeric | audio/video |
| width, height | int | image/video |
| transcript | text | audio STT output |
| caption | text | image Gemini vision description |
| embedding | vector(768) | embed of transcript OR caption |
| source, source_ref, subject_id, metadata | | |
| created_at | timestamptz | |

**Blob storage:** Hetzner Object Storage (S3-compatible). SDK uses `S3StorageAdapter` — swap to `LocalFSAdapter` for future NAS without touching calling code.

### `facts` — structured per-subject facts

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| subject_id | uuid → people.id NOT NULL | |
| fact | text NOT NULL | |
| category | text | |
| confidence | numeric | 0..1 |
| source_memory_ids | uuid[] | memories this was derived from |
| metadata | jsonb | |
| created_at, updated_at | timestamptz | |

Replaces old `neo_facts`. Not limited to Neo — can track facts about anyone.

### `personality` — per-person trait profile

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| subject_id | uuid → people.id NOT NULL | |
| trait | text | e.g. `emoji_usage`, `n8n`, `directness` |
| dimension | text | e.g. `communication`, `expertise`, `decision_making`, `work_style` |
| value | numeric | 0..1 score |
| sample_count, std_deviation, min_observed, max_observed | | |
| example_behaviors | text[] | |
| description | text | |
| source_memory_ids | uuid[] | |
| last_updated | timestamptz | |
| **UNIQUE** | `(subject_id, trait, dimension)` | upsert on conflict |

Replaces old `neo_personality` (which was Neo-only). Now supports trait profiles for any contact who interacts regularly (e.g., NClaw could build personality profiles for frequent WhatsApp contacts over time).

### `knowledge_nodes` + `knowledge_edges` — knowledge graph

`knowledge_nodes`:
| column | type |
|---|---|
| id | uuid PK |
| label | text NOT NULL |
| kind | text (entity/concept/project/place/company) |
| description | text |
| embedding | vector(768) |
| metadata | jsonb |

`knowledge_edges`:
| column | type |
|---|---|
| id | uuid PK |
| src, dst | uuid → knowledge_nodes.id |
| relation | text |
| weight | numeric, default 1.0 |
| metadata | jsonb |

### `credentials` — Vault-encrypted secrets (API keys, tokens)

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| owner_id | uuid → people.id NOT NULL | Neo self = `00000000-0000-0000-0000-000000000001`, Lan = `00000000-0000-0000-0000-000000000002` |
| service | text | `openai`, `netlify`, `anthropic`, `whatsapp`, `supabase_thr`, etc |
| credential_type | text | `api_key`, `access_token`, `service_role_key`, `app_secret`, etc |
| vault_secret_id | uuid | FK to `vault.secrets.id` — the actual value lives in **Supabase Vault** (encrypted at rest) |
| description | text | |
| environment | text | `production`, `staging`, `dev` (default `production`) |
| is_active | boolean | |
| expires_at | timestamptz | |
| metadata | jsonb | |
| **UNIQUE** | `(owner_id, service, credential_type, environment)` | upsert target |

**Never SELECT directly from this table in SDK callers** — values are not in the row, they're in vault. Use the RPCs below.

#### RPCs for credentials
```
upsert_credential(p_owner_id, p_service, p_credential_type, p_value, p_description=null, p_environment='production', p_expires_at=null, p_metadata='{}')
  → uuid  (creates or rotates vault secret in place)

get_credential(p_owner_id, p_service, p_credential_type=null, p_environment='production')
  → TABLE(id, service, credential_type, credential_value, description, environment, expires_at, metadata)
  (returns decrypted value; service-role only — SECURITY DEFINER)

list_credentials(p_owner_id=null, p_service=null, p_active_only=true)
  → TABLE(...)  (metadata only, safe to log)
```

#### SDK methods (`@todak/memory`)
```js
await brain.getCredential('openai', { type: 'api_key' })
  // { id, service, credential_type, credential_value, ... }

await brain.getCredentialValue('openai', { type: 'api_key' })
  // "sk-..."  (throws if not found)

await brain.listCredentials()
  // metadata only, no values

await brain.upsertCredential({ service: 'stripe', type: 'secret_key', value: 'sk_live_...', description: 'Stripe prod' })
  // { id: <uuid> }  — value encrypted into Vault
```

Legacy-compat view `neo_credentials(service, credential_type, credential_value, description)` is preserved — mirrors the old contract, filtered to Neo's active creds.

### `agent_sessions` — Claude Code / OpenClaw session runs

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| agent | text NOT NULL | e.g. `claude-code-vps-ams1`, `claw-mac-mini-plaud` |
| started_at, ended_at | timestamptz | |
| task_summary | text | what the session worked on |
| transcript_url | text | object storage if long |
| memory_ids | uuid[] | memories written/read during session |
| metadata | jsonb | |

Use `brain.startSession()` / `brain.endSession()` from the SDK.

### `memory_writes_log` — audit trail (all writes, append-only)

| column | type |
|---|---|
| id | bigserial PK |
| memory_id | uuid |
| action | text (`insert`, `update`, `archive`, `delete`) |
| written_by | text NOT NULL — the agent name |
| written_at | timestamptz |
| payload_preview | text (first 180 chars) |

Every SDK write emits here. Use for forensics: "what agent wrote what, when?"

## RPCs

### `match_memories`
```
match_memories(
  query_embedding vector(768),
  match_count int DEFAULT 5,
  min_similarity float DEFAULT 0.35,
  visibility_filter text[] DEFAULT ['public','internal','private'],
  p_subject_id uuid DEFAULT NULL,
  source_filter text[] DEFAULT NULL
) RETURNS TABLE (id, content, category, memory_type, importance, visibility, source, subject_id, similarity, created_at)
```
Cosine similarity over `memories.embedding`. Filters by visibility, subject, source. Returns sorted by similarity.

### `match_media`
```
match_media(query_embedding, match_count=5, min_similarity=0.35, kind_filter text DEFAULT NULL)
```

### `resolve_person`
```
resolve_person(p_type text, p_value text) RETURNS uuid
```
Looks up person by an identifier entry (e.g., `resolve_person('phone', '60177519610')`).

## SDK

JS: `@todak/memory` → `~/Projects/claude-tools-kit/packages/memory/`
Python: `~/Projects/claude-tools-kit/tools/neo_brain_client.py`

Minimum env:
```
NEO_BRAIN_URL=https://xsunmervpyrplzarebva.supabase.co
NEO_BRAIN_SERVICE_ROLE_KEY=sb_secret_...
GEMINI_API_KEY=...
```

Usage contract: **never query these tables directly**. Always use the SDK so audit log fires and invariants hold.

## Legacy mapping (for migrated rows)

| legacy table (uzamamymfzhelvkwpvgt) | new table | source_ref set to |
|---|---|---|
| `claude_desktop_memory` | `memories` | `{legacy_id: <old.id>, legacy_table: "claude_desktop_memory"}`, source=`migration_legacy` |
| `neo_facts` | `facts` | `metadata.legacy_id` |
| `neo_personality` | `personality` | `metadata.legacy_id` |
| `neo_knowledge_graph` | `knowledge_nodes` | `metadata.legacy_id` / `metadata.legacy_row` |

Dual-write source: `save-memory.js-dualwrite` (also sets `source_ref.legacy_id` on dual-writes).

## RLS

All tables have RLS enabled. Service-role key bypasses. No public policies yet — if you want anon reads for a public dashboard, add policies like `CREATE POLICY ... ON memories FOR SELECT USING (visibility = 'public')`.

## Row counts (post-migration 2026-04-19)

| table | rows |
|---|---|
| memories | 4,818 (100% embedded) |
| facts | 893 |
| knowledge_nodes | 795 (embeddings backfilled) |
| personality | 14 |
| people | 1 (Neo self) |
| media | 0 |
| agent_sessions | 0 |
| memory_writes_log | grows with every write |
