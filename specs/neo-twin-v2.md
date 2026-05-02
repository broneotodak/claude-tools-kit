# neo-twin v2 — Tech Spec

**Phase 6 Step 9** (NACA milestones)
**Status:** draft for review — no code yet
**Author session:** Neo MBP CC, 2026-05-02
**Reviewer:** Neo

---

## 1. Goal

A WhatsApp auto-reply pipeline that responds **as Neo** on his primary number (+60177519610). Two-tier LLM (cloud reasoning + local voice rewrite). Sibling to Siti, controlled via Siti commands and a NACA-app GUI.

Filed as Phase 6 Step 9. Sits alongside the *existing* Phase 6 work (Steps 1-3 dataset extraction, Step 4 HF wiring, all done in this session).

---

## 2. Architecture

```
                     ┌──────────────────────────────────────────┐
                     │  Twin VPS (5.161.126.222 / neo-twin)     │
                     │  user=neotwin · Node 20 · pm2            │
                     │                                          │
   primary WA  ────→ │  twin-ingest (existing, KEEP AS-IS)      │
   (+60177519610)    │   ├─ Baileys 6.7.16 listens              │
                     │   ├─ classifies + embeds via Gemini      │
                     │   ├─ writes to neo-brain memories         │
                     │   │     source='wa-primary'              │
                     │   ├─ HTTP server on :3900 (dashboard)    │
                     │   └─ + NEW POST /api/send {jid, text}    │
                     │       (uses same Baileys sock)            │
                     │                                          │
                     │  neo-twin-orchestrator (NEW, NEW process)│
                     │   ├─ poll neo-brain memories every 30s   │
                     │   │     filter: wa-primary,              │
                     │   │     metadata.handled_by_neo_twin=null│
                     │   ├─ check twin_active_state (legacy DB) │
                     │   ├─ check rate limit (3/hour/target)    │
                     │   ├─ Tier 1: Haiku → Gemini fallback     │
                     │   ├─ confidence gate                      │
                     │   ├─ Tier 2: tr-home qwen2.5:32b         │
                     │   ├─ write twin_drafts                    │
                     │   ├─ if shadow_mode → STOP                │
                     │   └─ if live → POST :3900/api/send        │
                     │     mark memory.metadata.handled=true     │
                     └──────────────────────────────────────────┘
                                       ↑                     ↑
                                       │ HTTPS               │ HTTPS
                                       │                     │
                          ┌────────────────────┐   ┌─────────────────────┐
                          │ Anthropic / Gemini │   │ tr-home :11434       │
                          │ (Tier 1)            │   │ Ollama qwen2.5:32b   │
                          │                     │   │ (Tier 2)             │
                          └────────────────────┘   │ ⚠ TAILNET — see §11 │
                                                   └─────────────────────┘

   ┌──────────────────────────────────────────────────────────────────┐
   │ NACA VPS (frontend — KIV per Q25, planned by NACA session)        │
   │   Persona switcher UI: Siti / neo-twin / others                  │
   │   reads twin_active_state, twin_drafts                           │
   │   posts toggle / pause commands → Siti or directly to legacy DB │
   └──────────────────────────────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────────┐
   │ Siti (Hetzner CPX31, 178.156.241.204) — NACA session lane        │
   │   New command parsers: "@Siti pause/enable/disable/status        │
   │     neo-twin in <target>" — updates twin_active_state            │
   └──────────────────────────────────────────────────────────────────┘
```

---

## 3. What we keep vs build

### Keep (battle-tested, do not rebuild)

| Component | Location | Why keep |
|---|---|---|
| Tier 1 prompt with Neo style guide | `clauden-app/src/app/api/twin-reply/route.ts:191-220` | Already explicit + tuned for Neo voice |
| `buildReplyContext` function | same file:150 | Personality + facts + semantic memories pulled correctly |
| `twin_drafts`, `twin_whitelist`, `twin_contacts` tables | Legacy DB `uzamamymfzhelvkwpvgt` | Schema works, data already there |
| Manage UI (PIN-gated) | `clauden.neotodak.com/api/twin-reply?action=manage` | Backup admin in case NACA app GUI is delayed |
| twin-ingest itself | Twin VPS `/home/neotwin/twin-ingest` | Working, ingesting ~6,350 rows/week. NEVER touch the Baileys connection logic. |
| wacli-service on CLAW | `100.93.159.1:3898` | Existing send path; can stay as fallback |

### Build new

| Component | Why |
|---|---|
| **`POST :3900/api/send`** in twin-ingest | Reuse existing Baileys sock to send. Avoids second Baileys session (would log out primary device). |
| **`neo-twin-orchestrator`** as new pm2 process on Twin VPS | The decision logic; isolated from twin-ingest's listener |
| **Tier 2 client** (Ollama HTTP call to tr-home) | New layer in orchestrator |
| **`twin_active_state`** table (legacy DB) | Per-target on/off/pause/expiry; rate limit budget |
| **Siti command parsers** | NACA session lane — "@Siti pause neo-twin..." |
| **NACA app GUI** | NACA session lane — Twin Control + Persona Switcher |
| **`would_have_sent` field on `twin_drafts`** | Shadow-mode flag (3-day soak before live) |

---

## 4. Data model

### Existing (keep)

```sql
-- twin_drafts: stays, ADD columns
ALTER TABLE twin_drafts ADD COLUMN tier1_output    text;
ALTER TABLE twin_drafts ADD COLUMN tier2_output    text;
ALTER TABLE twin_drafts ADD COLUMN would_have_sent boolean DEFAULT false;
ALTER TABLE twin_drafts ADD COLUMN rate_limited    boolean DEFAULT false;
ALTER TABLE twin_drafts ADD COLUMN target_kind     text;     -- 'dm' | 'group'
ALTER TABLE twin_drafts ADD COLUMN target_jid      text;     -- group jid OR contact jid
ALTER TABLE twin_drafts ADD COLUMN tr_home_used    boolean DEFAULT false;
```

### New table (legacy DB initially)

```sql
CREATE TABLE twin_active_state (
  target_jid       text PRIMARY KEY,
  target_kind      text NOT NULL CHECK (target_kind IN ('dm','group')),
  status           text NOT NULL DEFAULT 'disabled'
                    CHECK (status IN ('active','paused','disabled')),
  pause_until_ts   timestamptz,                          -- nullable; auto-expire
  max_per_hour     int NOT NULL DEFAULT 3,
  shadow_mode      boolean NOT NULL DEFAULT true,        -- starts in shadow!
  added_at         timestamptz NOT NULL DEFAULT now(),
  added_by         text NOT NULL,                        -- 'neo' | 'siti' | 'naca-app'
  last_change_ts   timestamptz NOT NULL DEFAULT now(),
  last_change_reason text,
  notes            text
);

CREATE INDEX idx_twin_active_state_status ON twin_active_state(status);
CREATE INDEX idx_twin_active_state_pause ON twin_active_state(pause_until_ts) WHERE status='paused';
```

### Initial seed (per Neo's whitelist)

```sql
-- Both groups START in shadow mode (3-day soak before live)
INSERT INTO twin_active_state (target_jid, target_kind, status, shadow_mode, added_by, last_change_reason)
VALUES
  ('<lan-epul-neo-group-jid>',   'group', 'active', true, 'neo', 'initial whitelist'),
  ('<test-ai-whatsapp-group-jid>', 'group', 'active', true, 'neo', 'initial whitelist');
-- (DM contacts added ad-hoc per Neo's choice)
```

### Default state for new entries

`status='disabled'` (per Q12). Operator must explicitly toggle to `active`.

---

## 5. State machine

```
            ┌─────────────┐
            │  disabled   │  (default for new targets)
            └──────┬──────┘
                   │  manual: enable command
                   ▼
            ┌─────────────┐
            │  active     │ ── replies fire (subject to shadow_mode + rate limit)
            └──┬───────┬──┘
               │       │
   pause cmd   │       │  disable cmd
               ▼       ▼
         ┌─────────┐  ┌─────────┐
         │ paused  │  │disabled │
         └────┬────┘  └─────────┘
              │  pause_until_ts elapses (auto)
              ▼
            active
```

State transitions logged to `twin_drafts` audit trail with `last_change_reason`.

---

## 6. API contracts

### A. `POST /api/send` on twin-ingest (new endpoint at :3900)

**Auth:** shared secret in env `TWIN_INGEST_SEND_TOKEN`, Bearer header.

**Request:**
```json
{
  "to_jid": "60177519610-1234567890@g.us",
  "text": "hahaha gila la kau",
  "draft_id": "uuid-for-audit-trail"
}
```

**Response:**
```json
{ "ok": true, "message_id": "wa-msg-id" }
```

Errors: 401 unauth, 429 if Baileys reports send-too-fast, 503 if sock disconnected.

### B. Tier 1 (cloud reasoning)

Reuse `buildReplyContext` from `route.ts`. Provider order:

1. Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — primary
2. Gemini 2.0 Flash (`gemini-2.0-flash`) — fallback (per Q6 decision; replaces GPT-4o-mini in current code)

**Output schema:**
```json
{
  "reply": "string | null",
  "confidence": "high | medium | low | abstain"
}
```

If `confidence='abstain' OR null`: skip the message entirely. Don't call Tier 2.

### C. Tier 2 (tr-home Ollama)

**Endpoint:** `http://100.126.89.7:11434/api/chat`

**Request:**
```json
{
  "model": "qwen2.5:32b",
  "messages": [
    { "role": "system", "content": "<rewrite-system-prompt-see-§7>" },
    { "role": "user", "content": "INCOMING:\n<incoming msg>\n\nDRAFT:\n<tier1 output>" }
  ],
  "stream": false,
  "options": { "temperature": 0.7, "num_predict": 200 }
}
```

Per Q24: feed BOTH incoming + Tier 1 to Tier 2.

**Fallback**: if tr-home unreachable (timeout 5s, HTTP error, or returns garbage), use Tier 1 raw output (per Q16).

### D. Read pipeline (orchestrator → neo-brain memories)

```
SELECT id, content, source, metadata, created_at
FROM memories
WHERE source = 'wa-primary'
  AND created_at > now() - interval '5 minutes'
  AND (metadata->>'handled_by_neo_twin') IS NULL
ORDER BY created_at ASC
LIMIT 20;
```

After processing each, mark:
```
UPDATE memories
SET metadata = metadata || '{"handled_by_neo_twin": "<status>", "neo_twin_draft_id": "<uuid>"}'
WHERE id = '<id>';
```

Status values: `replied` | `shadow_logged` | `rate_limited` | `skipped_no_state` | `skipped_low_confidence` | `tier2_failed`.

---

## 7. Tier 2 system prompt (draft)

```
You are rewriting a draft WhatsApp reply to match Neo Todak's personal style.

Neo's WhatsApp style:
- SUPER casual. Lowercase. Short. 1-2 lines. Sometimes one word.
- Heavy BM-EN code-switch: "ok bro noted", "hahaha gila la", "nanti aku check"
- Filler particles: "je", "la", "kot", "ah", "eh", "kan"
- Laughs: "hahaha" or "wkwk" — never "Haha,"
- emoji: rare, max 1
- if unsure: "ntah bro", "tak sure la", "nanti aku tanya"

You will receive an incoming WhatsApp message and a draft reply (correct content
but wrong tone). Rewrite the draft to sound like Neo. Keep ALL FACTS. Don't
hallucinate new info. Don't add preamble like "Here's the rewrite:". Output
only the rewritten message text, nothing else.
```

---

## 8. Siti command grammar

Neo DMs Siti (or in any chat where Siti is admin):

```
@Siti enable neo-twin in [Lan Epul Neo]
@Siti pause neo-twin in [Lan Epul Neo] for 30 min
@Siti pause neo-twin everywhere for 1 hour
@Siti disable neo-twin in [Test AI WhatsApp group]
@Siti disable neo-twin everywhere
@Siti status neo-twin
```

`status neo-twin` returns:

```
neo-twin status:
🟢 Lan Epul Neo (active, shadow off, 2/3 this hour)
⏸️ Test AI WhatsApp group (paused until 14:30, shadow off)
⚪ Kak Riz (disabled)
```

Implementation lives in Siti `server.js` — **NACA session lane**. This spec defines what they need to build; they own the implementation.

---

## 9. NACA app GUI requirements (read-only spec for NACA session)

**Section name:** "Neo-Twin Control" (under a future "Persona Switcher" tab per Q25 KIV)

**v1 (bare):**
- Grid of all rows in `twin_active_state` showing:
  - Target name (resolved from twin_contacts.name)
  - Kind badge (DM / group)
  - Status pill (active / paused / disabled / shadow)
  - Per-hour count vs max (e.g. "2/3 this hour")
- Per-row buttons:
  - Toggle active ↔ disabled
  - Pause for 10 / 30 / 60 min
  - Toggle shadow_mode on/off
- Global emergency-stop button: "Disable ALL neo-twin replies" → sets all rows status='disabled'
- Read-only audit log: last 30 entries from `twin_drafts` showing target/incoming/draft/sent

**v2 (deferred):** add new targets, view full draft history, manual override (resend/retract), shadow-mode review queue.

API endpoints NACA app needs:
- `GET /api/neo-twin/state` → list of `twin_active_state` rows + recent drafts
- `POST /api/neo-twin/state/:target_jid` → mutate row (status / pause / shadow_mode)
- `POST /api/neo-twin/emergency-stop` → all rows disabled

These can live on NACA backend as new routes, OR as part of clauden-app's `/api/twin-reply` extension. NACA session decides.

---

## 10. Rollout plan

### Phase A — Build (this session lane)

1. Tighten `route.ts` Tier 1 fallback (GPT-4o-mini → Gemini Flash). Confidence gate.
2. Schema migrations on legacy DB: add columns to `twin_drafts`, create `twin_active_state`.
3. Tailscale install on Twin VPS *(decision needed — see §11)*.
4. New `POST /api/send` route in twin-ingest's index.js (or split out as small file imported by it).
5. New pm2 process: `neo-twin-orchestrator` on Twin VPS — poller, state checker, Tier 1, Tier 2, draft writer, send caller.
6. Seed `twin_active_state` for the 2 starting groups (Q1 answer) — **with `shadow_mode=true`**.
7. Register `neo-twin` agent in `agent_registry` per CTK §9 protocol.
8. `naca_milestones` Phase 6 Step 9 → `partial`.

### Phase B — NACA session lane (not this session)

1. Siti command parsers (server.js).
2. NACA app Twin Control section.

### Phase C — Shadow mode (3 days)

- All replies generated by orchestrator land in `twin_drafts` with `would_have_sent=true`.
- No actual WhatsApp sends.
- Daily review: Neo reads what Twin would have said, manually flags good/bad in DB or via NACA UI.
- Quality gate: ≥80% of would-have-sent rows judged "OK to send" → proceed to live.

### Phase D — Go-live flip

```sql
UPDATE twin_active_state
SET shadow_mode = false, last_change_ts = now(),
    last_change_reason = 'shadow gate passed, going live'
WHERE shadow_mode = true;
```

Real sends start. Monitor `twin_drafts.sent_reply` for 7 days; revert any individual target's `shadow_mode=true` if quality regresses.

### Phase E — LoRA on tr-home (later, per Q5 (b))

Train `mesolitica/Malaysian-Qwen2.5-7B-Instruct` LoRA on tr-home *itself* (it has Ollama; we use llama.cpp CPU/GPU train, or just fine-tune via Python). Use Phase 6 dataset (1,691 pairs) + 30-50 hand-curated group examples (per Q11 (c)). Replace Tier 2's vanilla qwen2.5:32b with `qwen2.5:32b + neo-LoRA`.

Estimated cost: RM0 (your hardware), ~60 min training. Adds maybe 10-20% Neo-likeness vs vanilla qwen.

---

## 11. ⚠ Open infrastructure decision: Tailscale on Twin VPS

**Problem:** Twin VPS at `5.161.126.222` is on public internet. tr-home at `100.126.89.7` is on tailnet only. Currently **unreachable** from Twin VPS — connection times out at 5s.

**Confirmed via test (this session):**
```
$ ssh root@5.161.126.222 'curl -s --max-time 5 http://100.126.89.7:11434/api/tags'
http_code=000 ttotal=5.002813
$ ssh root@5.161.126.222 'which tailscale'
(not installed)
```

**Three solutions:**

**A. Install Tailscale on Twin VPS** *(recommended)*
- 5 min install, joins tailnet, gets `100.x.y.z` IP
- Direct reach to tr-home ✓
- Bonus: orchestrator can also reach CLAW wacli-service if ever needed
- Requires: Neo's Tailscale auth key (one-time)
- Trade: small attack surface increase (tailscaled daemon), mitigated by Tailscale's hardening

**B. Move orchestrator to a tailnet host**
- e.g. CLAW (always-on, has wacli) or tr-home itself (already on tailnet, has Ollama)
- Loses "alongside twin-ingest" benefit
- tr-home as orchestrator host is interesting — but then tr-home needs reach BACK to Twin VPS for `/api/send` (round-trip via internet anyway)

**C. Expose tr-home Ollama publicly**
- ❌ Don't recommend. Ollama auth is weak.

**Recommendation: A.** Install Tailscale on Twin VPS. Need Neo to grab a tailnet auth key from Tailscale admin console (or a one-time `tailscale up` interactive run via SSH).

---

## 12. Failure modes + circuit breakers

| Failure | Detection | Action |
|---|---|---|
| Tier 1 (Haiku + Gemini both down) | API errors / timeouts on both | Skip message, log to `twin_drafts` with `tier1_output=null, status='skipped'` |
| Tier 1 returns "abstain" / low confidence | model output | Skip Tier 2 entirely |
| tr-home offline / Ollama timeout | HTTP timeout 5s | Use Tier 1 raw as final reply (per Q16) |
| Baileys disconnected on twin-ingest | `/api/send` returns 503 | Don't retry (avoid duplicate later); alert via Siti DM |
| Rate limit hit (3/hour for target) | Count `twin_drafts` WHERE created_at > now()-1hour AND target_jid = X AND would_have_sent OR sent_reply IS NOT NULL | Set `rate_limited=true`, skip send |
| Memory loop suspected (Twin replies to itself) | Sender JID = OWNER_PHONE | Hardcoded skip (cannot be disabled) |
| State corruption (status not in enum) | DB read | Fail-closed: treat as `disabled` |

---

## 13. Security + auth

- `TWIN_INGEST_SEND_TOKEN` — random 32-char, stored in env (NOT vault yet, per existing twin-ingest pattern). Could migrate to vault later.
- Ollama on tr-home: trusted (tailnet only).
- Tier 1 keys: pulled from env (not vault) — match existing clauden-app pattern. Could migrate.
- `twin_active_state` writes: only by the orchestrator + Siti + NACA backend (none of these are externally exposed). RLS not strictly required since legacy DB is service-role-only access already.

---

## 14. Phase 6 milestone alignment

After spec approval + implementation:

```
Phase 6 — Personalization & Independence
  Step 1 — Dataset extraction pipeline                    ✅ done
  Step 2 — Weekly cron via launchd                         ✅ done
  Step 3 — RunPod credentials staged                       ✅ done
  Step 4 — HF token + push-hf wiring                       ✅ done
  Step 5 — Intent classifier (cheap routing)               ⬜ todo (separate stream)
  Step 6 — Siti integration                                ⬜ todo
  Step 7 — A/B harness                                     ⬜ todo
  Step 8 — Voice rewriter (Run 1 not deployed)             ⬜ todo / deferred
  Step 9 — neo-twin auto-reply (THIS SPEC)                 🟡 in progress
  Step 10 — tr-home LoRA fine-tune                         ⬜ todo (after §10 Phase D)
```

CTK §9 `shared_infra_change` memory must be saved when:
- `agent_registry` row is added for `neo-twin`
- `twin_active_state` table is created
- `naca_milestones` Step 9 status changes

---

## 15. Decisions Neo has confirmed

| # | Decision | Confirmed |
|---|---|---|
| 1 | Whitelist starts: 2 groups (Lan Epul Neo + Test AI WhatsApp group), DMs ad-hoc | ✅ |
| 2 | No per-message approval — only on/off/pause via Siti | ✅ |
| 3 | Both DMs and groups eligible | ✅ |
| 4 | Tier 2 aggressiveness: medium restyle (preserve facts) | ✅ |
| 5 | LoRA on tr-home: yes, after first ship | ✅ |
| 6 | Tier 1: Haiku + Gemini fallback | ✅ |
| 7 | ClaudeN twin code: read first, salvage what fits | ✅ done in this spec |
| 8 | Approval flow: only on/off/pause, no per-message | ✅ |
| 9 | Naming: `neo-twin` | ✅ |
| 10 | Webhook vs polling: investigate (TBD) | poll first per §4 D |
| 11 | Group voice training data: (c) DM data + few-shot group examples | ✅ |
| 12 | Default state for new targets: `disabled` | ✅ |
| 13 | Pause command grammar phrasings | ✅ |
| 14 | 3 replies/hour/target rate limit | ✅ |
| 15 | Skip on low-confidence Tier 1 | ✅ |
| 16 | tr-home offline → Tier 1 raw | ✅ |
| 17 | Same on/off/pause grammar for social media comments | ✅ (out of scope of v1 build) |
| 18 | NACA app GUI v1 = bare | ✅ |
| 22 | Default `disabled` confirmed | ✅ |
| 23 | twin-ingest path located | ✅ `/home/neotwin/twin-ingest` |
| 24 | Tier 2 prompt feeds BOTH incoming + Tier 1 | ✅ |
| 25 | Posting via NACA VPS frontend persona switcher | KIV — orchestrator uses twin-ingest's POST /api/send for v1 |

---

## 16. Decisions still needed before code

1. **Tailscale on Twin VPS** (§11) — install yes/no?
2. **First-week target JIDs** — need to find the actual JIDs for "Lan Epul Neo" group + "Test AI WhatsApp group" (run `wacli chats list` or query twin_contacts). Wait until SSH check?
3. **Schema location finalize** — confirm legacy DB stays as the home for twin_drafts + twin_active_state for now.
4. **Tier 1 confidence gate** — does Haiku reliably output a confidence field? Or do we ask it explicitly via prompt? (Implementation detail, can decide during build.)

---

## 17. Estimated work after spec approval

| Phase | Hours | Lane |
|---|---|---|
| A.1-A.8 (build) | ~8-10 hr | This session (Neo MBP CC) |
| B.1 (Siti commands) | ~2 hr | NACA session |
| B.2 (NACA GUI) | ~3 hr | NACA session |
| C (3-day shadow) | passive | — |
| D (go-live) | 5 min | this session |
| E (LoRA later) | ~2 hr | this session, after E |

Total focused work: **~13-15 hr** across 2-3 sessions before live.

---

**End of spec — awaiting Neo's review.**
