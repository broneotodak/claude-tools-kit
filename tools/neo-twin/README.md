# neo-twin orchestrator

Phase 6 Step 9 (NACA milestones). Spec: `claude-tools-kit/specs/neo-twin-v2.md`.

## What it does

Polls neo-brain `memories` table every 30s for new `wa-primary` rows that
twin-ingest just wrote. For each, decides whether to reply (state lookup +
rate limit + confidence gate), runs Tier 1 (Haiku → Gemini fallback) +
Tier 2 (qwen2.5:32b on tr-home), persists draft to legacy DB `twin_drafts`,
and either:

- **shadow_mode=true** on target → logs `would_have_sent=true`, no actual send
- **shadow_mode=false** (live) → POSTs to twin-ingest's `/api/send` (localhost:3900)

## Where it runs

Twin VPS (`5.161.126.222` / tailnet `100.120.79.126` / hostname `neo-twin`),
managed by pm2 alongside twin-ingest.

## Config (.env on Twin VPS)

```
NEO_BRAIN_URL=...
NEO_BRAIN_SERVICE_ROLE_KEY=...
LEGACY_DB_URL=https://uzamamymfzhelvkwpvgt.supabase.co
LEGACY_DB_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
TWIN_INGEST_URL=http://localhost:3900
TWIN_INGEST_SEND_TOKEN=...
TR_HOME_URL=http://100.126.89.7:11434
POLL_INTERVAL_MS=30000
MEMORY_LOOKBACK_MIN=5
OWNER_PHONE=60177519610
```

## Operate

```
pm2 start orchestrator.mjs --name neo-twin-orchestrator
pm2 logs neo-twin-orchestrator --lines 100
pm2 restart neo-twin-orchestrator
```

## Safety

- Default state for new targets = `disabled` (must explicitly enable per target)
- Currently both seeded targets (Lan Epul Neo + Test AI WhatsApp group) start in `shadow_mode=true`
- 3-day shadow soak required before flipping to `shadow_mode=false`
- Rate limit: 3 replies per target per hour (configurable per row in `twin_active_state.max_per_hour`)
- Self-loop guard: skips messages from `OWNER_PHONE` or `is_from_owner=true`
- Tier 1 confidence gate: `"abstain"` skips Tier 2 entirely
- Tier 2 fallback: if tr-home offline, posts Tier 1 raw output (still goes through state checks)

## Stop

```
pm2 stop neo-twin-orchestrator
# Or globally disable everything via legacy DB:
# UPDATE twin_active_state SET status='disabled', last_change_reason='emergency stop';
```
