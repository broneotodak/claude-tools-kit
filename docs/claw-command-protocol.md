# CLAW Command Protocol v1

**Contract between NACA (planner-agent, Siti, dev-agent) and CLAW's `claw-command-worker` service.**

Version: `v1` (2026-04-23, draft)
Transport: `public.agent_commands` table in neo-brain (`xsunmervpyrplzarebva`)
Receiver: `to_agent='claw-mac'` rows are claimed by CLAW's worker service

---

## 1. Principles

1. **LLM-driven routing.** Commands are defined as Gemini function declarations. Siti / planner-agent register CLAW commands as tools and the LLM picks one based on user intent. No hardcoded regex / no keyword matching.
2. **Existing queue, existing pattern.** Reuses `agent_commands` (the same table NACA already uses for dev-agent, planner, reviewer). No new transport layer.
3. **Asynchronous.** Every command is fire-and-forget from the sender's perspective. Sender polls `status` or subscribes to Realtime changes. Siti notifies Neo on completion.
4. **Idempotency where possible.** Commands that mutate external state (post, comment, upload) include an `idempotency_key` to prevent double-execution on retry.
5. **Human-in-loop for high-risk ops.** Auto-comment, auto-reply, mass-action commands require explicit approval before CLAW executes.
6. **Capability-gated.** CLAW advertises capabilities in `nclaw_instances.metadata.capabilities`. Planner checks capability match before routing.

---

## 2. Common envelope (all commands)

### 2.1 Sender-set columns in `agent_commands`

| Column | Value |
|---|---|
| `from_agent` | `'siti'` / `'planner-agent'` / `'dev-agent'` / `'neo-direct'` |
| `to_agent` | `'claw-mac'` |
| `command` | one of the names in §4 (snake_case, stable) |
| `payload` | jsonb matching the command's schema |
| `priority` | `1` (high, user-facing DM) … `5` (background/batch). Default `3` |
| `max_retries` | see per-command spec. Default `2` |
| `expires_at` | now() + timeout_ms (per command). Default 5 min |

### 2.2 CLAW-set columns

| Column | Behavior |
|---|---|
| `claimed_at` | set when worker locks the row (`FOR UPDATE SKIP LOCKED`) |
| `status` | `queued` → `claimed` → `running` → `done` / `failed` / `timeout` / `needs_approval` |
| `retry_count` | incremented on transient failure |
| `result` | jsonb per command's result_schema, OR `{error: string, error_class: string}` on failure |
| `completed_at` | set on terminal status (done / failed / timeout) |

### 2.3 Status lifecycle

```
queued ──► claimed ──► running ──► done
                            │
                            ├──► needs_approval (pauses, Siti notifies Neo)
                            │          │
                            │          └──► resumes: running ──► done
                            │          └──► rejected: ──► failed
                            ├──► failed  (error_class=transient → requeued if retry_count<max)
                            └──► timeout (worker crashed, pg_cron requeues)
```

### 2.4 Error classes (in `result.error_class`)

- `invalid_payload` — schema mismatch, sender's bug, don't retry
- `capability_missing` — CLAW doesn't have the required capability right now (re-route)
- `session_expired` — logged-in browser session died, needs re-auth
- `rate_limited` — platform (IG/TikTok/etc.) rate-limited; retry after delay
- `platform_block` — platform silently blocked (e.g. IG anti-abuse); don't auto-retry, notify Neo
- `transient` — network/timeout; safe to retry
- `permanent` — unrecoverable without human fix

---

## 3. Capabilities CLAW advertises

Written to `nclaw_instances.claw-mac.metadata.capabilities` at startup. Planner-agent reads this before routing.

```json
{
  "capabilities": [
    "browser-chrome-profile",
    "ig-session",
    "threads-session",
    "linkedin-session",
    "tiktok-session",
    "x-session",
    "facebook-session",
    "higgsfield-video",
    "byteplus-video",
    "ollama-local",
    "macos-automation",
    "macos-arm64",
    "xcrun-ios-build",
    "chrome-devtools-mcp",
    "xurl-cli",
    "google-calendar-personal",
    "forex-signal-ingest",
    "wacli-send-only"
  ]
}
```

Sessions marked as `*-session` may go stale — each command checks session health before executing; if session expired, returns `error_class: session_expired` and marks the capability as `needs_reauth` in the heartbeat.

---

## 4. Command catalog

### 4.1 Social posting (capability: `browser-chrome-profile` + respective `*-session`)

#### `post_to_ig`
```json
{
  "name": "post_to_ig",
  "description": "Post image/video/reel to @broneotodak on Instagram. Uses CLAW's logged-in Chrome profile with isTrusted click events.",
  "parameters": {
    "type": "object",
    "properties": {
      "media_url":    {"type": "string", "description": "HTTPS URL or neo-brain storage key of image/video"},
      "media_type":   {"type": "string", "enum": ["image", "video", "reel"]},
      "caption":      {"type": "string", "maxLength": 2200},
      "location":     {"type": "string", "optional": true},
      "alt_text":     {"type": "string", "optional": true},
      "idempotency_key": {"type": "string", "description": "Must be unique per intended post"}
    },
    "required": ["media_url", "media_type", "caption", "idempotency_key"]
  }
}
```
Timeout: 180s • Retries: 1 (reposting risks duplicate) • Returns: `{post_url, post_id, posted_at}`

#### `post_to_threads`
Same shape as `post_to_ig`, caption max 500.

#### `post_to_linkedin`
```json
{
  "parameters": {
    "media_url": {"type": "string", "optional": true},
    "content":   {"type": "string", "maxLength": 3000},
    "visibility": {"type": "string", "enum": ["public", "connections"], "default": "public"},
    "idempotency_key": {"type": "string"}
  }
}
```

#### `post_to_tiktok`
```json
{
  "parameters": {
    "video_url":  {"type": "string"},
    "caption":    {"type": "string", "maxLength": 2200},
    "tags":       {"type": "array", "items": {"type": "string"}},
    "idempotency_key": {"type": "string"}
  }
}
```
Note: tiktok-post.py uses browser-use + logged-in TikTok session. Uses raw CDP for isTrusted events (learned Apr 10 from IG Share bug).

#### `post_to_x` (requires xurl OAuth2 re-auth — currently expired Dec 2024)
```json
{
  "parameters": {
    "content":  {"type": "string", "maxLength": 280},
    "media_url": {"type": "string", "optional": true},
    "reply_to": {"type": "string", "description": "Tweet ID to reply to", "optional": true},
    "idempotency_key": {"type": "string"}
  }
}
```
**Status**: currently unavailable — capability is advertised with `needs_reauth` flag until `xurl auth oauth2 --app neo-todak` completes on CLAW.

#### `post_to_facebook`
Shape TBD. Not in initial release — page/group posting has platform-specific quirks.

---

### 4.2 Social engagement (capability: `*-session` + **human approval required**)

#### `reply_to_comment`
```json
{
  "description": "Reply to a comment on one of Neo's posts.",
  "parameters": {
    "platform":   {"type": "string", "enum": ["ig", "threads", "linkedin", "tiktok", "x"]},
    "post_id":    {"type": "string"},
    "comment_id": {"type": "string"},
    "reply_text": {"type": "string"},
    "idempotency_key": {"type": "string"}
  }
}
```
Auto-approved only if `reply_text` is under 200 chars AND matches a Siti-drafted approval from `ai.openclaw.socmed-comments` queue. Otherwise `status=needs_approval`.

#### `auto_comment_on_post` ⚠️ high misuse risk
```json
{
  "description": "Comment on someone else's post (e.g. a creator's post Neo wants to engage with). **ALWAYS requires human approval before execution** in v1. Never auto-executes even if LLM suggests it.",
  "parameters": {
    "platform":    {"type": "string"},
    "post_url":    {"type": "string"},
    "comment_text":{"type": "string", "maxLength": 500},
    "intent":      {"type": "string", "description": "Why Neo wants to comment (insight, support, reply to mention, etc.)"},
    "idempotency_key": {"type": "string"}
  }
}
```
**Hard rules**:
- `status` starts as `needs_approval` regardless of sender context
- Rate limited: max 20 executed per day across ALL platforms combined (banned-account defense)
- Never fires inside 60 seconds of another `auto_comment_on_post` execution
- If platform returns any anti-abuse signal, CLAW **disables** the capability and notifies Neo; manual re-enable required

---

### 4.3 Content generation (capability: `higgsfield-video`, `byteplus-video`, `ollama-local`)

#### `generate_higgsfield_video`
```json
{
  "description": "Generate a video using Higgsfield AI. Supports Neo-face consistent character model (v1 or v2). For non-Neo videos, omit character_id.",
  "parameters": {
    "prompt":         {"type": "string"},
    "starting_image_url": {"type": "string", "optional": true},
    "character_id":   {"type": "string", "enum": ["v1", "v2", "none"], "default": "none"},
    "duration_sec":   {"type": "integer", "default": 10, "maximum": 20},
    "endpoint":       {"type": "string", "enum": ["soul", "kling", "standard"], "default": "standard"},
    "idempotency_key": {"type": "string"}
  }
}
```
Returns: `{video_url, duration_sec, generation_cost_credits}`. Timeout: 300s.

Hard rule from Apr 10 incident: if `starting_image_url` is provided, CLAW MUST use that image as-is — never regenerate it. `character_id='none'` MUST NOT stamp Neo's face.

#### `generate_byteplus_content`
TBD pending use case definition. Placeholder in catalog.

#### `run_ollama_prompt`
```json
{
  "description": "Run a prompt through CLAW's local Ollama (free fallback when Gemini rate-limited).",
  "parameters": {
    "model":  {"type": "string", "enum": ["qwen3:8b", "qwen3:14b", "gemma3:12b"]},
    "prompt": {"type": "string"},
    "max_tokens": {"type": "integer", "default": 2000}
  }
}
```
Returns: `{response, model, tokens_used}`. Timeout: 120s.

---

### 4.4 Browser / research (capability: `chrome-devtools-mcp` + `*-session`)

#### `fetch_logged_in_content`
```json
{
  "description": "Fetch content from a URL using a logged-in browser session. Use when the public/unauthenticated fetch would miss content (private IG, LinkedIn profile behind wall, etc.)",
  "parameters": {
    "url":      {"type": "string"},
    "session":  {"type": "string", "enum": ["ig", "linkedin", "threads", "tiktok", "x", "facebook"]},
    "extract":  {"type": "string", "enum": ["html", "text", "screenshot", "structured"], "default": "text"},
    "timeout_ms": {"type": "integer", "default": 30000}
  }
}
```
Returns: `{content, content_type, fetched_at}`. For `extract=screenshot`, content is a neo-brain storage URL.

#### `capture_screenshot`
```json
{
  "parameters": {
    "url": {"type": "string"},
    "logged_in_as": {"type": "string", "optional": true},
    "full_page": {"type": "boolean", "default": false}
  }
}
```

---

### 4.5 macOS / build (capability: `macos-automation`, `xcrun-ios-build`)

#### `run_apple_script` ⚠️ power tool
```json
{
  "description": "Execute an AppleScript/osascript on CLAW. **Requires human approval** in v1 for all usages.",
  "parameters": {
    "script": {"type": "string"},
    "language": {"type": "string", "enum": ["applescript", "javascript"], "default": "applescript"}
  }
}
```
Auto-`needs_approval`. No exceptions.

#### `flutter_ios_build` (future — not in v1 initial release)
Placeholder. Will need Xcode + codesign + TestFlight credentials indexed in `credentials`.

---

### 4.6 Social media comments service integration (existing on CLAW :3896)

Existing `ai.openclaw.socmed-comments` service already runs on CLAW. The new `claw-command-worker` bridges NACA to it via:

#### `list_pending_comments`
```json
{
  "description": "List social media comments awaiting reply (from ai.openclaw.socmed-comments scraper).",
  "parameters": {
    "platform": {"type": "string", "optional": true},
    "limit":    {"type": "integer", "default": 20}
  }
}
```
Returns: `{comments: [{id, platform, post_id, author, text, suggested_reply, scraped_at}]}`.

#### `approve_comment_reply`
```json
{
  "parameters": {
    "comment_id": {"type": "string"},
    "final_text": {"type": "string", "description": "Final reply text (after Neo's edit)"},
    "idempotency_key": {"type": "string"}
  }
}
```
Triggers `reply_to_comment` internally.

---

### 4.7 WhatsApp send-only (capability: `wacli-send-only`)

#### `wacli_send`
```json
{
  "description": "Send a WhatsApp message from CLAW's number (+6281111150379 Indo Bank Neo). Send-only — CLAW no longer listens on WhatsApp per Phase 1 amendment.",
  "parameters": {
    "to":      {"type": "string", "description": "phone number E.164 without +"},
    "message": {"type": "string"},
    "media_url": {"type": "string", "optional": true},
    "idempotency_key": {"type": "string"}
  }
}
```
**Status**: requires wacli re-auth first (session disconnected during Phase 1 when wacli-service was unloaded). Capability marked `needs_reauth` until `wacli sync` completes on CLAW.

---

## 5. Guardrails

### 5.1 Always-approval commands
Regardless of sender confidence or LLM intent:
- `auto_comment_on_post`
- `run_apple_script`
- `post_to_facebook` (when added)

### 5.2 Rate limits (enforced by worker)

| Command | Limit | Window |
|---|---|---|
| `post_to_ig` | 3 | per hour |
| `post_to_threads` | 5 | per hour |
| `post_to_linkedin` | 2 | per hour |
| `post_to_tiktok` | 2 | per hour |
| `post_to_x` | 20 | per hour |
| `auto_comment_on_post` | 20 | per 24h (all platforms combined) |
| `reply_to_comment` | 50 | per 24h |
| `generate_higgsfield_video` | 10 | per day (credit cost) |

### 5.3 Idempotency enforcement

Worker maintains a table (or uses `agent_commands.idempotency_key` uniqueness) so the same `idempotency_key` never executes twice. Second attempt returns the original `result`.

### 5.4 Session-expiry handling

If a `*-session` capability fails auth:
1. Worker marks that capability as `needs_reauth` in the next heartbeat
2. Sends WhatsApp notification to Neo: "CLAW's IG session expired — please re-login at CLAW terminal"
3. Returns `error_class: session_expired` to the command
4. Planner-agent stops routing that platform's commands to CLAW until capability flips back

---

## 6. Observability

### 6.1 Heartbeat
`ai.openclaw.claw-command-worker` writes `agent_heartbeats` every 60s:
```json
{
  "agent_name": "claw-mac",
  "status": "ok",
  "meta": {
    "version": "claw-command-worker-v1",
    "claim_in_flight": 2,
    "last_command_at": "2026-04-23T14:00:00Z",
    "session_health": {
      "ig": "ok",
      "threads": "ok",
      "linkedin": "ok",
      "tiktok": "needs_reauth",
      "x": "needs_reauth"
    }
  }
}
```

### 6.2 Per-command logging
Each claim/execution logs to `~/.openclaw/logs/claw-command-worker.log` with `command_id` correlation. Successful commands also emit a memory_writes_log row for audit.

### 6.3 NACA dashboard
NACA HQ tab's existing `agent_commands` visualization automatically includes `to_agent='claw-mac'` rows. No client changes needed.

---

## 7. Versioning

- Commands include optional `payload._v` field (integer). Default `1`.
- Worker rejects `_v > MAX_SUPPORTED_V` with `error_class: invalid_payload`.
- Commands never change semantics under the same name — new behavior requires a new command name (e.g. `post_to_ig_v2` if shape evolves incompatibly).

---

## 8. Not in v1 (future)

- Bidirectional streaming results (for long-running generation that wants progress updates)
- File upload from CLAW to neo-brain storage (currently workers upload to Hetzner Object Storage directly)
- Cross-agent command chains (command A completes → auto-dispatches command B)
- `flutter_ios_build` and TestFlight uploads
- Facebook posting
- Telegram bridge
- Email send via GAM7 (pending GAM7 setup on MBP)

---

## 9. Example end-to-end flow

**Scenario**: Neo DMs Siti `"post this pic to IG and Threads: Beach day 🌴"` with photo attached.

1. **Siti** receives DM, tool-calls:
   - `post_to_ig({media_url, media_type:'image', caption:'Beach day 🌴', idempotency_key:'dm-<id>-ig'})`
   - `post_to_threads({...same..., idempotency_key:'dm-<id>-threads'})`
2. Each tool call inserts a row into `agent_commands` with `to_agent='claw-mac', from_agent='siti'`.
3. **claw-command-worker** polls, claims both rows (`FOR UPDATE SKIP LOCKED`), status→`running`.
4. Worker invokes existing skills: `ig-post.py` for IG, `threads-post.py` for Threads.
5. Each skill completes → worker writes `result={post_url, post_id, posted_at}`, status→`done`.
6. **Siti** subscribes to Realtime changes on `agent_commands`, receives completion event, sends WhatsApp summary to Neo:
   > ✅ Posted to IG: https://instagram.com/p/XXXX
   > ✅ Posted to Threads: https://threads.net/@broneotodak/post/YYYY

Total user wait: ~30-90 seconds depending on platform responsiveness.

---

## 10. Open questions for review

1. Should **sender identity** matter for capability gating? E.g., should `dev-agent` be allowed to invoke `post_to_ig`? Or only Siti/planner/Neo-direct?
2. **Command cancellation** — if Neo says "cancel" before CLAW claims, how is that signaled? (Probably: planner flips status to `cancelled` before `claimed`, worker skip-locks only `queued`.)
3. **Cost tracking** — should `result` always include `cost_estimate_usd` for commands that burn credits (Higgsfield, BytePlus, ElevenLabs)? Feeds into NACA cost monitor.
4. **Multi-platform atomic posting** — if Neo wants "post to IG+Threads+LinkedIn together", is that one command (`post_to_social`, multi-platform fanout) or three separate commands? Currently spec assumes three. Three is more resilient (one failure doesn't block others).
5. **Audit trail for high-risk commands** — should `run_apple_script` and `auto_comment_on_post` write to a separate `high_risk_action_log` table in addition to `agent_commands`?
