# @todak/memory

Unified memory SDK for all Todak / OpenClaw agents — NClaw, Claude Desktop, Claude Code sessions, CLAW services. Read and write Neo's long-term memory (text + media) through one interface.

Backed by the `neo-brain` Supabase project (pgvector) + Hetzner Object Storage (media blobs).

## Install

From inside `claude-tools-kit`, consumers import via `file:`:

```json
{
  "dependencies": {
    "@todak/memory": "file:../claude-tools-kit/packages/memory"
  }
}
```

(Once we publish to a private npm registry we'll drop the `file:` prefix. The API stays the same.)

## Env vars

```
NEO_BRAIN_URL=https://xsunmervpyrplzarebva.supabase.co
NEO_BRAIN_SERVICE_ROLE_KEY=...   # server-side only
NEO_BRAIN_ANON_KEY=...           # client-side (read-only with RLS)
GEMINI_API_KEY=...               # for embeddings
# If using media:
NEO_BRAIN_S3_ENDPOINT=https://fsn1.your-objectstorage.com
NEO_BRAIN_S3_REGION=fsn1
NEO_BRAIN_S3_BUCKET=neo-brain-media
NEO_BRAIN_S3_ACCESS_KEY_ID=...
NEO_BRAIN_S3_SECRET_ACCESS_KEY=...
```

## Quick usage

```js
import { NeoBrain, S3StorageAdapter } from "@todak/memory";

const storage = new S3StorageAdapter({
  endpoint: process.env.NEO_BRAIN_S3_ENDPOINT,
  region:   process.env.NEO_BRAIN_S3_REGION,
  bucket:   process.env.NEO_BRAIN_S3_BUCKET,
  accessKeyId: process.env.NEO_BRAIN_S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.NEO_BRAIN_S3_SECRET_ACCESS_KEY,
});

const brain = new NeoBrain({ agent: "nclaw-hetzner", storage });

// Search
const hits = await brain.search("what are Neo's active projects?", { k: 5 });

// Save
await brain.save("Neo is in Hong Kong Apr 17-20 2026 recovering from hemorrhoids.", {
  category: "health",
  type: "event",
  importance: 7,
  visibility: "private",
});

// Media (audio)
await brain.saveMedia({
  kind: "audio",
  buffer: audioBuf,
  mimeType: "audio/mp3",
  transcript: "Neo discussing project plans...",
});
```

## Storage adapter — swap later

`S3StorageAdapter` works with Hetzner Object Storage, Cloudflare R2, AWS S3, MinIO. When Neo moves to a NAS in his office, swap in a `LocalFSAdapter` or `SFTPAdapter` with the same shape — zero calling-code changes.

## Agent convention

Every agent instance MUST set `agent:` — it's the `source` label for writes and appears in the `memory_writes_log` audit trail. Examples: `nclaw-hetzner`, `nclaw-vps-2`, `claude-desktop`, `claude-code-vps-ams1`, `claw-mac-mini-plaud`.

## RPCs wrapped

- `match_memories(query, visibility, k, subject_id, source)`
- `match_media(query, kind, k)`
- `resolve_person(type, value)` — phone/lid/email → person.id

## Rules (MANDATORY for all Todak agents)

1. **Never query `memories` / `media` / `facts` tables directly.** Always go through the SDK.
2. **Never write to the old `uzamamymfzhelvkwpvgt.claude_desktop_memory`.** It's read-only archive.
3. Always pass a meaningful `agent:` name — the audit log depends on it.
4. `visibility` defaults to `private`. Tag public-safe entries explicitly if you want them retrievable in group chats / shared contexts.
