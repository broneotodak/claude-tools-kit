-- Vault read log (2026-10-02, claude-code-neo-mbp, Neo: "let's do this").
-- Every get_credential call leaves one append-only row: which secret, which
-- machine key (sha256 prefix -> name), which IP, which client. The judge
-- (tools/intrusion-watch.mjs) reads it and pages on unknown keys and sweeps.
-- Logging can never break a secret read: failures are swallowed.

create table if not exists public.credential_reads (
  id             bigint generated always as identity primary key,
  read_at        timestamptz not null default now(),
  service        text,
  credential_type text,
  environment    text,
  rows_returned  int,
  key_fp         text,      -- first 16 chars of base64url(sha256(api key)) = the gateway's api_key_hash; never the key
  key_name       text,      -- from credential_key_names; NULL = unknown key
  ip             text,
  user_agent     text,
  via            text       -- 'api' (PostgREST) or 'sql' (no request headers)
);
create index if not exists credential_reads_read_at on public.credential_reads (read_at desc);
create index if not exists credential_reads_key on public.credential_reads (key_name, read_at desc);

create table if not exists public.credential_key_names (
  key_fp     text primary key,
  key_name   text not null,
  created_at timestamptz not null default now()
);

alter table public.credential_reads enable row level security;
alter table public.credential_key_names enable row level security;
-- append-only: no client role may insert/update/delete; machine keys may only read.
revoke all on public.credential_reads, public.credential_key_names from public, anon, authenticated, service_role;
grant select on public.credential_reads, public.credential_key_names to service_role;
revoke all on sequence public.credential_reads_id_seq from public, anon, authenticated, service_role;

create or replace function public.get_credential(p_owner_id uuid, p_service text, p_credential_type text default null::text, p_environment text default 'production'::text)
 returns table(id uuid, service text, credential_type text, credential_value text, description text, environment text, expires_at timestamp with time zone, metadata jsonb)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_n int;
  h json;
  v_key text;
  c json;
  v_fp text;
begin
  return query
  select c.id, c.service, c.credential_type, vds.decrypted_secret::text,
         c.description, c.environment, c.expires_at, c.metadata
  from public.credentials c
  join vault.decrypted_secrets vds on vds.id = c.vault_secret_id
  where c.owner_id = p_owner_id
    and c.service = p_service
    and (p_credential_type is null or c.credential_type = p_credential_type)
    and c.environment = p_environment
    and c.is_active = true
  order by c.created_at desc;
  get diagnostics v_n = row_count;
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
    -- The API gateway swaps sb_secret_* keys for a short-lived JWT whose claim
    -- api_key_hash = base64url(sha256(key)); that is how we know WHICH machine key.
    c := nullif(current_setting('request.jwt.claims', true), '')::json;
    v_key := nullif(h->>'apikey', '');
    v_fp := left(coalesce(c->>'api_key_hash',
                          case when v_key is null then null
                               else rtrim(translate(encode(sha256(convert_to(v_key, 'UTF8')), 'base64'), '+/', '-_'), '=') end), 16);
    insert into public.credential_reads (service, credential_type, environment, rows_returned, key_fp, key_name, ip, user_agent, via)
    values (p_service, p_credential_type, p_environment, v_n, v_fp,
            (select k.key_name from public.credential_key_names k where k.key_fp = v_fp),
            coalesce(h->>'cf-connecting-ip', split_part(h->>'x-forwarded-for', ',', 1), h->>'x-real-ip'),
            left(h->>'user-agent', 200),
            case when h is null then 'sql' else 'api' end);
  exception when others then
    null; -- never let logging break a secret read
  end;
end;
$function$;
