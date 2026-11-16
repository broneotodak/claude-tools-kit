-- Brain-Key-Narrowing step 4: the vault doorman, installed SWITCHED OFF (every key 'off'); a second statement later flips keys to 'shadow'.
-- shadow  = every read is judged and logged (credential_reads.verdict), nothing is refused.
-- enforce = a read off the key's list returns no rows (verdict 'deny').
-- The identity comes ONLY from the gateway's signed token claim (api_key_hash), never from a header the caller can write.
-- A fault inside the check never breaks a read in off/shadow mode (fail open); in enforce it refuses (fail closed).
-- Rollback: 01-vault-shadow.rollback.sql restores the previous function text.

alter table public.credential_reads add column if not exists verdict text;

create table if not exists public.credential_key_mode (
  key_name text primary key,
  mode text not null default 'off' check (mode in ('off','shadow','enforce')),
  master_ok boolean not null default false,
  note text
);
create table if not exists public.credential_access (
  key_name text not null,
  service text not null,
  credential_type text not null default '*',
  can_read boolean not null default true,
  can_write boolean not null default false,
  note text,
  primary key (key_name, service, credential_type)
);
alter table public.credential_key_mode enable row level security;
alter table public.credential_access enable row level security;
revoke all on public.credential_key_mode, public.credential_access from public, anon, authenticated, service_role;

-- every named key starts OFF; the two master keys (Neo's Mac and the Vault iPhone app) are master_ok. '*unknown*' = a real key nobody has named.
insert into public.credential_key_mode (key_name, mode, master_ok, note)
select k.key_name, 'off', k.key_name in ('neo_mbp','vault_app_iphone'), case when k.key_name in ('neo_mbp','vault_app_iphone') then 'master: reads everything by design' end
from public.credential_key_names k
on conflict (key_name) do nothing;
insert into public.credential_key_mode (key_name, mode, master_ok, note) values ('*unknown*', 'off', false, 'a real key that is not named in credential_key_names') on conflict (key_name) do nothing;

-- each key's list = what it has really read (credential_reads, rows_returned > 0), measured 16 Nov 2026
insert into public.credential_access (key_name, service, credential_type, can_read, can_write, note)
select r.key_name, r.service, coalesce(r.credential_type, '*'), true, false, 'seeded from observed reads, 16 Nov 2026'
from public.credential_reads r
where r.rows_returned > 0 and r.key_name is not null and r.key_name not in ('neo_mbp','vault_app_iphone')
group by 1, 2, 3
on conflict do nothing;

create or replace function public.get_credential(p_owner_id uuid, p_service text, p_credential_type text default null::text, p_environment text default 'production'::text)
 returns table(id uuid, service text, credential_type text, credential_value text, description text, environment text, expires_at timestamp with time zone, metadata jsonb)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_n int := 0;
  h json; c json;
  v_fp text; v_key_name text;
  v_mode text := 'off'; v_master boolean := false; v_allowed boolean := true; v_verdict text := 'allow';
begin
  -- 1) who is calling (the same identification as before)
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
    -- The API gateway swaps sb_secret_* keys for a short-lived JWT whose claim api_key_hash = base64url(sha256(key)); that is how we know WHICH machine key.
    c := nullif(current_setting('request.jwt.claims', true), '')::json;
    v_fp := left(coalesce(c->>'api_key_hash',
                          case when nullif(h->>'apikey', '') is null then null
                               else rtrim(translate(encode(sha256(convert_to(h->>'apikey', 'UTF8')), 'base64'), '+/', '-_'), '=') end), 16);
    select k.key_name into v_key_name from public.credential_key_names k where k.key_fp = v_fp;
  exception when others then null;
  end;

  -- 2) the doorman's verdict. No identity at all (the database owner running SQL) is never judged.
  begin
    if v_fp is not null then
      select m.mode, m.master_ok into v_mode, v_master from public.credential_key_mode m where m.key_name = coalesce(v_key_name, '*unknown*');
      v_mode := coalesce(v_mode, 'off');
      if v_mode <> 'off' then
        v_allowed := coalesce(v_master, false) or (v_key_name is not null and exists (
          select 1 from public.credential_access a
          where a.key_name = v_key_name and a.can_read and a.service = p_service
            and (a.credential_type = '*' or p_credential_type is null or a.credential_type = p_credential_type)));
        v_verdict := case when v_allowed then 'allow' when v_mode = 'shadow' then 'would_deny' else 'deny' end;
      end if;
    end if;
  exception when others then
    v_verdict := case when v_mode = 'enforce' then 'deny' else 'allow' end; -- fail open in off/shadow, closed in enforce
  end;

  -- 3) the read itself (unchanged); a refused read returns nothing
  if v_verdict <> 'deny' then
    return query
    select cr.id, cr.service, cr.credential_type, vds.decrypted_secret::text,
           cr.description, cr.environment, cr.expires_at, cr.metadata
    from public.credentials cr
    join vault.decrypted_secrets vds on vds.id = cr.vault_secret_id
    where cr.owner_id = p_owner_id
      and cr.service = p_service
      and (p_credential_type is null or cr.credential_type = p_credential_type)
      and cr.environment = p_environment
      and cr.is_active = true
    order by cr.created_at desc;
    get diagnostics v_n = row_count;
  end if;

  -- 4) the log (as before, plus the verdict); never lets logging break a read
  begin
    insert into public.credential_reads (service, credential_type, environment, rows_returned, key_fp, key_name, ip, user_agent, via, verdict)
    values (p_service, p_credential_type, p_environment, v_n, v_fp, v_key_name,
            coalesce(h->>'cf-connecting-ip', split_part(h->>'x-forwarded-for', ',', 1), h->>'x-real-ip'),
            left(h->>'user-agent', 200),
            case when h is null then 'sql' else 'api' end,
            case when v_fp is null then 'allow' else v_verdict end);
  exception when others then
    null;
  end;
end;
$function$;
