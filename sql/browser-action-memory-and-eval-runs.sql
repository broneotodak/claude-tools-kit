-- Phase 5b.1 step 4 — L3 click-memory cache + step 5 replay log
-- Target: neo-brain (xsunmervpyrplzarebva)
-- Owner: ClawBrowserSession (tools/claw-browser-session.mjs) — service_role only

-- L3: click-memory cache. Keyed by (domain, page_state_hash, intent_hash).
-- Every successful L2 preflight writes here. Hand-coached entries (for L2
-- failure cases like FB login nag) also live here with coached_by='human'.
-- On future acquire->goto->intent, the wrapper checks this cache BEFORE
-- calling Gemini. Cache hit = ~50ms. Cache miss = fall through to L2.
create table if not exists public.browser_action_memory (
  id              uuid primary key default gen_random_uuid(),
  domain          text not null,
  page_state_hash text not null,
  intent_hash     text not null,
  action          jsonb not null,          -- { type: 'click_selector'|'click_coords'|'keyboard_esc', selector?, x?, y?, key? }
  last_success_at timestamptz,
  success_count   int  not null default 0,
  fail_count      int  not null default 0,
  coached_by      text,                    -- null | 'gemini-flash' | 'claude-opus' | 'human'
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (domain, page_state_hash, intent_hash)
);
create index if not exists browser_action_memory_domain_idx on public.browser_action_memory (domain);
alter table public.browser_action_memory enable row level security;

-- Step 5 replay log. One row per eval run.
create table if not exists public.browser_eval_runs (
  id                     uuid primary key default gen_random_uuid(),
  task_id                uuid,
  task_label             text,
  domain                 text,
  intent                 text,
  run_at                 timestamptz not null default now(),
  resolved_at_layer      smallint check (resolved_at_layer between 1 and 4),
  success                boolean not null,
  duration_ms            int,
  preflight_ms           int,
  cost_tokens_estimated  int,
  screenshots_url        text[],
  failure_reason         text,
  metadata               jsonb not null default '{}'::jsonb
);
create index if not exists browser_eval_runs_run_at_idx on public.browser_eval_runs (run_at desc);
create index if not exists browser_eval_runs_task_label_idx on public.browser_eval_runs (task_label);
alter table public.browser_eval_runs enable row level security;

-- updated_at trigger on action memory
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists browser_action_memory_touch_updated_at on public.browser_action_memory;
create trigger browser_action_memory_touch_updated_at
  before update on public.browser_action_memory
  for each row execute function public.touch_updated_at();

comment on table public.browser_action_memory is
  'Phase 5b.1 L3 click-memory cache. Written by ClawBrowserSession after successful L2 dismissal or manual coaching. Read on every act() before L2 preflight.';
comment on table public.browser_eval_runs is
  'Phase 5b.1 step 5 replay log. One row per browser eval run. Drives the nightly replay + Opus-coaching loop.';
