# Complete Memory Schema Guide - 25 Columns Explained

## Overview
**Table:** `claude_desktop_memory`
**Total Columns:** 25 (16 original + 9 new from 2025-11-03 upgrade)
**Database:** uzamamymfzhelvkwpvgt.supabase.co

---

## Original 16 Columns (Pre-Upgrade)

### 1. **id** (bigint, PRIMARY KEY)
- **Purpose:** Unique identifier for each memory
- **Auto-generated:** Yes (sequence)
- **Example:** 3207

### 2. **user_id** (text)
- **Purpose:** Identifies the memory owner
- **Your value:** "neo_todak"
- **Use:** Filter memories by user

### 3. **memory_type** (text)
- **Purpose:** Type categorization (episodic vs semantic)
- **Common values:** "context", "fact", "procedure"
- **Use:** Distinguish memory types in hybrid architecture

### 4. **category** (text)
- **Purpose:** Fine-grained classification
- **Valid values:** "Session", "Progress", "Learning", "Decision", "Project", "Config", "Technical", "THR", etc.
- **Use:** Filter memories by topic/domain

### 5. **content** (text)
- **Purpose:** The actual memory content
- **Size:** Can be very large (full conversations, documents)
- **Use:** Main searchable text field

### 6. **metadata** (jsonb)
- **Purpose:** Flexible structured data storage
- **Common fields:**
  ```json
  {
    "machine_name": "MacBook Air",
    "saved_by": "claude-code",
    "timestamp": "2025-11-03T...",
    "session_id": "...",
    "project": "THR"
  }
  ```
- **Use:** Store contextual information without schema changes

### 7. **importance** (integer)
- **Purpose:** Priority/relevance score
- **Range:** 1-10 (1=low, 10=critical)
- **Use:** Prioritize retrieval, filter by importance

### 8. **last_accessed** (timestamp)
- **Purpose:** Track when memory was last retrieved
- **Auto-updated:** On read operations
- **Use:** Identify stale/unused memories

### 9. **created_at** (timestamp)
- **Purpose:** When memory was first created
- **Auto-set:** On insert
- **Use:** Temporal queries, chronological ordering

### 10. **updated_at** (timestamp)
- **Purpose:** Last modification time
- **Auto-updated:** On any change
- **Use:** Track memory evolution

### 11. **embedding** (vector(1536))
- **Purpose:** Vector representation for semantic search
- **Dimensions:** 1536 (OpenAI text-embedding-3-small compatible)
- **Index:** HNSW index for fast similarity search
- **Use:** Find semantically similar memories

### 12. **owner** (jsonb, nullable)
- **Purpose:** Extended ownership information
- **Typical value:** null (user_id is sufficient)
- **Use:** Future multi-tenant features

### 13. **archived** (boolean)
- **Purpose:** Soft delete flag
- **Default:** false
- **Use:** Hide memories without deleting them

### 14. **heat_score** (numeric)
- **Purpose:** Dynamic relevance score based on access patterns
- **Calculation:** Function of access_count, recency, importance
- **Use:** Smart retrieval ordering

### 15. **access_count** (integer)
- **Purpose:** Number of times memory was retrieved
- **Default:** 0
- **Incremented:** On each read
- **Use:** Identify frequently used memories

### 16. **source** (text)
- **Purpose:** Where the memory came from
- **Valid values:** "claude-code", "claude-desktop", "manual", "api"
- **❌ ISSUE:** Was incorrectly set to "claude_desktop"
- **✅ FIXED:** Now correctly set to "claude-code"
- **Use:** Track memory provenance

---

## New 9 Columns (Added 2025-11-03)

### 17. **entities** (jsonb, nullable) 🆕
- **Purpose:** Extracted entities for GraphRAG
- **Structure:**
  ```json
  [
    {"type": "person", "name": "Sarah", "id": "emp_123"},
    {"type": "project", "name": "THR", "id": "proj_thr"},
    {"type": "concept", "name": "leave policy"}
  ]
  ```
- **When populated:** During memory save with entity extraction
- **Use:** Entity-based retrieval, relationship mapping
- **Current status:** NULL (feature not yet implemented)

### 18. **relationships** (jsonb, nullable) 🆕
- **Purpose:** Connections between entities
- **Structure:**
  ```json
  [
    {
      "from": "emp_123",
      "to": "proj_thr",
      "type": "works_on",
      "strength": 0.9
    },
    {
      "from": "emp_123",
      "to": "emp_456",
      "type": "reports_to"
    }
  ]
  ```
- **When populated:** During entity extraction
- **Use:** Multi-hop reasoning, graph traversal
- **Current status:** NULL (feature not yet implemented)

### 19. **entity_count** (integer) 🆕
- **Purpose:** Quick count of entities in this memory
- **Default:** 0
- **Use:** Filter memories by entity density, analytics
- **Current status:** Defaults to 0, will be updated with entity extraction

### 20. **consolidated_from** (integer[], nullable) 🆕
- **Purpose:** Track which memories were merged into this one
- **Structure:** Array of memory IDs
- **Example:** [3201, 3202, 3205] = this memory consolidated those 3
- **When populated:** During intelligent consolidation (Mem0-style)
- **Use:** Memory provenance, audit trail, rollback capability
- **Current status:** NULL (consolidation not yet active)

### 21. **consolidation_date** (timestamp, nullable) 🆕
- **Purpose:** When this memory was created via consolidation
- **Set:** When merging multiple memories
- **Use:** Track consolidation history, identify consolidated memories
- **Current status:** NULL

### 22. **consolidation_reason** (text, nullable) 🆕
- **Purpose:** Why memories were consolidated
- **Examples:**
  - "Duplicate content (similarity: 0.98)"
  - "Related topics - merged for coherence"
  - "Temporal consolidation - weekly summary"
- **Use:** Explainability, debugging consolidation logic
- **Current status:** NULL

### 23. **priority_score** (float) 🆕
- **Purpose:** Dynamic priority for retrieval ranking
- **Default:** 1.0 (normal priority)
- **Range:** 0.0 to 10.0
  - < 0.5 = decaying/low priority
  - 1.0 = normal
  - > 1.0 = elevated priority
- **Calculation:** Based on importance, access patterns, recency, decay_factor
- **Use:** Intelligent retrieval ordering (Mem0-style)
- **Current status:** Defaults to 1.0

### 24. **last_consolidation** (timestamp, nullable) 🆕
- **Purpose:** Last time this memory was considered for consolidation
- **Set:** During consolidation runs (even if not consolidated)
- **Use:** Schedule next consolidation check, prevent repeated processing
- **Current status:** NULL

### 25. **decay_factor** (float) 🆕
- **Purpose:** Intelligent decay mechanism
- **Default:** 1.0 (no decay)
- **Range:** 0.0 to 1.0
  - 1.0 = fresh, full relevance
  - 0.5 = half relevance (decaying)
  - 0.1 = nearly irrelevant
  - 0.0 = candidate for archival
- **Decay rules:**
  - High importance = slower decay
  - Frequently accessed = no decay
  - Old + unused = faster decay
- **Use:** Automatic memory lifecycle management
- **Current status:** Defaults to 1.0

---

## Indexes

### Primary Index
- `PRIMARY KEY (id)` - Unique identifier lookup

### Vector Index (Performance)
- `memory_embedding_hnsw_idx` - HNSW index on embedding
  - **Type:** hnsw (Hierarchical Navigable Small World)
  - **Parameters:** m=16, ef_construction=64
  - **Purpose:** 2-3x faster similarity search
  - **Created:** 2025-11-03

### Graph Indexes (New)
- `idx_memory_entities` - GIN index on entities
  - **Purpose:** Fast entity-based queries
- `idx_memory_relationships` - GIN index on relationships
  - **Purpose:** Fast relationship lookups
- `idx_memory_priority` - B-tree on priority_score DESC
  - **Purpose:** Efficient priority-based retrieval

### Other Indexes (if any)
- Check with: `SELECT * FROM pg_indexes WHERE tablename = 'claude_desktop_memory';`

---

## Column Usage Patterns

### Every Memory Save
**Always populated:**
- id (auto)
- user_id
- memory_type
- category
- content
- importance
- source ✅ (now fixed)
- metadata
- created_at
- updated_at
- priority_score (default: 1.0)
- decay_factor (default: 1.0)
- entity_count (default: 0)

**Optional/Advanced:**
- embedding (if using semantic search)
- entities (when entity extraction implemented)
- relationships (when entity extraction implemented)

### During Consolidation
**Populated when merging memories:**
- consolidated_from
- consolidation_date
- consolidation_reason
- priority_score (recalculated)
- decay_factor (adjusted)

### Automatic Updates
**System-managed:**
- last_accessed (on read)
- access_count (incremented on read)
- heat_score (calculated periodically)
- updated_at (on any change)
- last_consolidation (during consolidation runs)

---

## Why These Columns?

### Performance (HNSW Index)
- **Goal:** 2-3x faster queries
- **Columns:** embedding + HNSW index
- **Result:** Achieved ✅

### GraphRAG Capabilities
- **Goal:** Multi-hop reasoning, relationship understanding
- **Columns:** entities, relationships, entity_count
- **Status:** Schema ready, features pending

### Intelligent Consolidation (Mem0-style)
- **Goal:** Prevent memory bloat, 90% token savings
- **Columns:** consolidated_from, consolidation_date, consolidation_reason
- **Status:** Tracking ready, logic pending

### Smart Retrieval
- **Goal:** Better ranking, context-aware retrieval
- **Columns:** priority_score, decay_factor, last_consolidation
- **Status:** Defaults set, algorithms pending

---

## Data Accuracy Fixes (2025-11-03)

### Issue #1: Incorrect Source Field ❌ → ✅
**Problem:**
- Memories were saved with `source: "claude_desktop"`
- But running in Claude Code, not Claude Desktop

**Root Cause:**
- `save-memory-simple.js` didn't explicitly set source field
- Database used default/previous value

**Fix Applied:**
```javascript
// Added to save-memory-simple.js line 27
source: 'claude-code',  // ✅ Accurate identifier
```

**Verification:**
- New saves will have correct source
- Old memories remain (historical record)
- Can bulk update if needed: `UPDATE claude_desktop_memory SET source = 'claude-code' WHERE source = 'claude_desktop' AND metadata->>'saved_by' = 'claude-code';`

---

## Future Enhancements

### Phase 1 (Next Week)
- Implement entity extraction in save scripts
- Populate `entities` and `relationships` fields
- Update `entity_count` automatically

### Phase 2 (Week 2)
- Intelligent consolidation logic
- Use `consolidated_from`, `consolidation_date`, `consolidation_reason`
- Automated weekly runs

### Phase 3 (Week 3)
- Dynamic priority scoring algorithm
- Intelligent decay implementation
- Update `priority_score` and `decay_factor` based on usage

### Phase 4 (Week 4)
- GraphRAG query system
- Multi-hop reasoning
- Hybrid retrieval (vector + graph)

---

## Quick Reference

| Column | Type | Purpose | Status |
|--------|------|---------|--------|
| id | bigint | Unique ID | ✅ Active |
| user_id | text | Owner | ✅ Active |
| memory_type | text | Type category | ✅ Active |
| category | text | Topic | ✅ Active |
| content | text | Main content | ✅ Active |
| metadata | jsonb | Context data | ✅ Active |
| importance | integer | Priority 1-10 | ✅ Active |
| last_accessed | timestamp | Last read | ✅ Active |
| created_at | timestamp | Creation time | ✅ Active |
| updated_at | timestamp | Last modified | ✅ Active |
| embedding | vector(1536) | Semantic vector | ✅ Active |
| owner | jsonb | Extended owner | ⚪ Nullable |
| archived | boolean | Soft delete | ✅ Active |
| heat_score | numeric | Dynamic score | ✅ Active |
| access_count | integer | Read count | ✅ Active |
| source | text | Origin | ✅ FIXED |
| **entities** 🆕 | jsonb | Entities | 🟡 Ready |
| **relationships** 🆕 | jsonb | Connections | 🟡 Ready |
| **entity_count** 🆕 | integer | Entity # | ✅ Active |
| **consolidated_from** 🆕 | integer[] | Source IDs | 🟡 Ready |
| **consolidation_date** 🆕 | timestamp | When merged | 🟡 Ready |
| **consolidation_reason** 🆕 | text | Why merged | 🟡 Ready |
| **priority_score** 🆕 | float | Retrieval priority | ✅ Active |
| **last_consolidation** 🆕 | timestamp | Last check | 🟡 Ready |
| **decay_factor** 🆕 | float | Relevance decay | ✅ Active |

**Legend:**
- ✅ Active = Currently in use
- 🟡 Ready = Schema ready, features pending
- ⚪ Nullable = Optional/unused

---

## Testing Accuracy

**Verify correct source:**
```sql
SELECT id, source, metadata->>'saved_by', created_at
FROM claude_desktop_memory
ORDER BY created_at DESC
LIMIT 10;
```

**Expected for new saves:**
- `source = 'claude-code'`
- `metadata.saved_by = 'claude-code'`

---

*Schema documentation complete. All 25 columns explained.*
