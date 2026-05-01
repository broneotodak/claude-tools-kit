# Dataset Pipeline (neo-corpus)

Reads neo-brain `memories` table read-only and writes versioned JSONL slices to
`~/datasets/neo-corpus/YYYY-MM-DD/` for downstream RAG corpus refresh and
eventual fine-tuning experiments.

## Guardrails (per NACA session sign-off 2026-05-01)

- **Read-only on neo-brain.** No inserts, no updates, no `exported_at` markers.
  If write-back is ever needed, that becomes a CTK §9 shared-infra change.
- **Source enum reuse.** The JSONL `source` field is copied verbatim from
  `memories.source` (`wa-primary`, `claude_code`, `supervisor`, `wacli`,
  `plaud`, `siti`, `nclaw_whatsapp_conversation`, etc.). Never invent new
  vocabulary — Phase 5 and Phase 6 share this taxonomy.
- **Visibility-respecting.** Default extraction includes `internal` + `private`
  rows for local-only use. `--push-hf` (when implemented) will silently filter
  to `public` only.

## Output layout

```
~/datasets/neo-corpus/YYYY-MM-DD/
  by-source/
    wa-primary.jsonl
    claude_code.jsonl
    ...
  by-actor/
    neo.jsonl                  # wa-primary + manual + wa-chat-importer
    agent-claude_code.jsonl
    agent-supervisor.jsonl
    ...
  by-domain/
    conversation.jsonl
    technical.jsonl
    milestones.jsonl
    activity.jsonl
    other.jsonl
  manifest.json                # row counts, bytes, sha256, distributions
```

Outputs are git-ignored (`datasets/`, `*.jsonl`, `manifest.json`).

## Each JSONL row

```json
{
  "id": "uuid",
  "content": "...",
  "source": "wa-primary",
  "actor": "neo",
  "memory_type": "conversation",
  "domain": "conversation",
  "category": "...",
  "visibility": "internal",
  "importance": 6,
  "ts": "2026-05-01T...",
  "subject_id": null,
  "related_people": null,
  "source_ref": null,
  "metadata": { ... }
}
```

`embedding` and `content_tsv` are deliberately stripped — DB-specific, regenerable.

## Usage

```bash
# Dry-run: count rows + show distributions, no files written
node extract.js --dry-run

# Default: visibility=internal,private, slice=all, output=~/datasets/neo-corpus/<today>/
node extract.js

# Last 7 days only
node extract.js --since-days 7

# Public only (preview what HF push would include)
node extract.js --visibility public

# Single slicer
node extract.js --slice by-source

# Custom output dir
node extract.js --out ~/datasets/neo-corpus/test
```

## Env

Reads from `~/Projects/claude-tools-kit/.env`:

- `NEO_BRAIN_URL`
- `NEO_BRAIN_SERVICE_ROLE_KEY`

## When NAS is back

One-line rsync to durable storage:

```bash
rsync -avh --delete ~/datasets/neo-corpus/ \
  /Volumes/Backup-TS/Todak\ Studios/datasets/neo-corpus/
```
