# `people` vs `contacts` — neo-brain canonical schema

**Last updated**: 2026-05-06
**Lives at**: `claude-tools-kit/docs/PEOPLE_VS_CONTACTS.md`
**Reference memory**: search neo-brain for `reference_people_vs_contacts`

This doc is the canonical answer to "why are there two tables and which one do I use?". Read once when you first touch either table; future-you and every other agent session inherits the answer.

---

## TL;DR

| | `people` | `contacts` |
|---|---|---|
| **What it answers** | "WHO are they?" | "HOW does Siti talk to them?" |
| **Holds** | Identity, profile, knowledge | Operational policy + WA settings |
| **Mutation pace** | Slow (profile enrichment) | Faster (you toggle permissions) |
| **Typical writers** | Profile-extraction agents (Gemini-driven) | Operator commands (`update_contact`), WA roster sync |
| **Typical readers** | CHAT specialist (for context), profile lookups | Router permissions check, every specialist's gate |
| **Cardinality** (2026-05-06) | 3,010 rows | ~1,981 rows |
| **Required?** | No — a contact can land before a profile exists | No — a person can be mentioned without ever messaging Siti |

**Rule of thumb:**
- Need `permission` / `persona_override` / `auto_reply_enabled` / `reply_mode` / `project_scope` → **`contacts`**
- Need `bio` / `traits` / `facts` / `relationship` / `nicknames` / `face_embeddings` → **`people`**
- Need both → JOIN `contacts.person_id = people.id`

---

## Why two tables (the design rationale)

These are different concerns mapped onto the same real-world entity:

- **`people`** is **identity + knowledge**. It's the answer to "tell me about Brozaid10camp" — his bio, his relationship to Neo, what languages he speaks, which traits an LLM has extracted. It changes when Siti learns something new about a person.

- **`contacts`** is **operational policy + WA settings**. It's the answer to "should Siti act on this WhatsApp message?" — what permission tier, whether auto-reply is on, what voice/text mode, which projects this contact is allowed to submit tasks for. It changes when the operator (Neo) edits how Siti should treat someone.

Mixing these into one table couples *identity churn* with *policy churn*. Every Gemini-driven profile enrichment would touch the same row that holds your permission edits — more contention, more accidental overwrites, less clean audit trail.

There's also a **cardinality mismatch**: a `people` row can exist for someone Neo only *mentioned* (never messaged Siti). A `contacts` row can exist for a brand-new sender Siti hasn't built a profile for yet (you set them readonly the moment they show up). One isn't always a strict subset of the other.

---

## Schema

### `people` (existing)

Already in neo-brain since 2026-04-19 cutover. Holds:

```
id                       uuid PK
display_name             text          ← canonical name Siti uses
full_name                text
nicknames                text[]
relationship             text          ← 'sister', 'colleague', 'client', etc.
phone                    text          ← matched against contacts.phone
lid                      text          ← matched against contacts.lid
push_name                text
kind                     text
identifiers              jsonb         ← extra IDs (email, GitHub, etc.)
bio                      text
traits                   jsonb
facts                    jsonb
languages                jsonb
notes                    text
metadata                 jsonb
face_embeddings          jsonb
message_count            integer
first_seen_at            timestamptz
last_seen_at             timestamptz
profile_version          integer
last_profile_extraction  timestamptz
created_at, updated_at   timestamptz
```

### `contacts` (new on 2026-05-06)

```
id                       uuid PK
person_id                uuid FK → people(id)   ← nullable; links to identity when known
phone                    text                   ← denormalized for fast permission lookup
jid                      text
lid                      text
name                     text                   ← Neo-set WA contact name
push_name                text
kind                     text                   ← 'user' | 'group'
permission               text                   ← 'owner' | 'admin' | 'developer' | 'chat' | 'readonly' | 'blocked'
persona_override         text                   ← additive persona context for replies
auto_reply_enabled       boolean
reply_mode               text                   ← 'text' | 'voice' | 'auto'
project_scope            text[]                 ← developer allowlist (e.g. {'naca-app'})
notes                    text
last_seen_at             timestamptz
wa_synced_at             timestamptz
created_at, updated_at   timestamptz
```

Indexes: `phone`, `jid`, `lid`, `person_id`, `(kind, permission)`. Unique `(phone, kind)` and `(jid, kind)` where the field is not null (prevents duplicate rows for the same WA entity).

---

## Permission semantics

From `contacts.permission`:

| Value | Meaning |
|---|---|
| `owner` | Neo himself. Siti acts on anything from this tier. |
| `admin` | Inner circle (family, top-trusted contacts). Can issue some commands. |
| `developer` | Per-project allowlist. May submit tasks scoped via `project_scope`. |
| `chat` | Conversational only — Siti will reply but won't accept commands. |
| `readonly` | Default for new contacts. Siti silent unless explicitly invoked. |
| `blocked` | Siti ignores entirely. |

Default for newly-seen WA senders: `readonly`. Operator commands like `update_contact` (or future operator UI) flip these.

For **groups**: same `permission` semantics, applied to every message in the group. `developer` group with `project_scope=['naca-app']` means anyone in that group can submit naca-app tasks via Siti.

---

## When to use which (decision tree)

```
Need to know about a real person?  → people
Need to gate a Siti action on permission tier?  → contacts.permission
Need to set persona for replies to someone?  → contacts.persona_override
Need to know if Siti should auto-reply?  → contacts.auto_reply_enabled
Need to know if reply should be voice or text?  → contacts.reply_mode
Need a developer's allowed projects?  → contacts.project_scope
Need rich profile (bio, traits, facts)?  → people  (JOIN via contacts.person_id)
Need both identity AND policy in one query?  → JOIN contacts → people
```

---

## Migration history

- **Pre-2026-05-06**: `nclaw_contacts` lived only in legacyDB (`uzamamymfzhelvkwpvgt`), legacy of the original Siti era. The `people` table was already on neo-brain.
- **2026-05-06**: `nclaw_contacts` migrated to neo-brain as `contacts` (see `tools/migrate-nclaw-contacts-to-neo-brain.mjs`). Renamed for clarity ("contacts" is self-explanatory; "nclaw_contacts" was Siti-internal jargon). `person_id` FK backfilled by matching phone/lid against the existing `people` rows where possible.
- **Going forward**: any agent that needs WA operational policy reads from `neo-brain.contacts`. legacyDB.nclaw_contacts stays around for the paused old siti's reference but is no longer the source of truth.

---

## Cross-references

- Old siti's `update_contact` tool lives in `~/Projects/siti/server.js` ~line 1468 — useful reference for how the original CRUD was modeled
- Per-project developer allowlist concept: see neo-brain memory `project_developer_role_allowlist`
- siti-v2 router permissions: `~/Projects/siti-v2/src/router/permissions.js`
- siti-v2 architecture (4-stage pipeline + per-specialist bridges): neo-brain memory `15798e27`
