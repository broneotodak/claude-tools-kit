-- Run AFTER 01-vault-shadow.sql in the SAME transaction (see run-test.sh): everything is rolled back by the final raise. Prints only counts and verdicts, never a secret.
do $$
declare
  o uuid; r text := ''; n int; v text;
  edge_fp text; mbp_fp text; unk_fp text := 'zzzzzzzzzzzzzzzz';
  edge_listed text; edge_unlisted text := 'edgexpert-2/sudo_password';
  fails int := 0;
  procedure_dummy int;
begin
  select owner_id into o from public.credentials limit 1;
  select key_fp into edge_fp from public.credential_key_names where key_name = 'edge';
  select key_fp into mbp_fp from public.credential_key_names where key_name = 'neo_mbp';
  select service into edge_listed from public.credential_access where key_name = 'edge' limit 1;
  r := 'edge_listed=' || coalesce(edge_listed,'(none)') || ' | ';
end $$;

create or replace function pg_temp.t(p_label text, p_fp text, p_service text, p_expect_rows int, p_expect_verdict text) returns text language plpgsql as $$
declare o uuid; n int; v text; ok boolean;
begin
  select owner_id into o from public.credentials limit 1;
  perform set_config('request.jwt.claims', case when p_fp is null then '' else json_build_object('api_key_hash', p_fp)::text end, true);
  perform set_config('request.headers', json_build_object('x-real-ip', 'T-' || p_label)::text, true);
  select count(*) into n from public.get_credential(o, p_service, null, 'production');
  select verdict into v from public.credential_reads where ip = 'T-' || p_label order by id desc limit 1;
  ok := (case when p_expect_rows = -1 then n >= 1 else n = p_expect_rows end) and (coalesce(v, 'none') = p_expect_verdict);
  return (case when ok then 'ok  ' else 'FAIL' end) || ' ' || p_label || ' rows=' || n || '/' || p_expect_rows || ' verdict=' || coalesce(v,'none') || '/' || p_expect_verdict;
end $$;

do $$
declare
  edge_fp text; mbp_fp text; edge_listed text; edge_unlisted text := 'edgexpert-2/sudo_password'; res text[] := '{}'; out text;
begin
  select key_fp into edge_fp from public.credential_key_names where key_name = 'edge';
  select key_fp into mbp_fp from public.credential_key_names where key_name = 'neo_mbp';
  select service into edge_listed from public.credential_access where key_name = 'edge' and service in (select service from public.credentials where is_active) limit 1;
  -- switched OFF: everything reads, verdict allow
  res := res || pg_temp.t('off-edge-unlisted', edge_fp, edge_unlisted, 1, 'allow');
  res := res || pg_temp.t('off-unknown', 'zzzzzzzzzzzzzzzz', edge_unlisted, 1, 'allow');
  res := res || pg_temp.t('owner-sql', null, edge_unlisted, 1, 'allow');
  -- SHADOW: reads always work; off-list is recorded as would_deny
  update public.credential_key_mode set mode = 'shadow' where key_name in ('edge','neo_mbp','*unknown*');
  res := res || pg_temp.t('shadow-edge-listed', edge_fp, edge_listed, -1, 'allow');
  res := res || pg_temp.t('shadow-edge-unlisted', edge_fp, edge_unlisted, 1, 'would_deny');
  res := res || pg_temp.t('shadow-master', mbp_fp, edge_unlisted, 1, 'allow');
  res := res || pg_temp.t('shadow-unknown-key', 'zzzzzzzzzzzzzzzz', edge_unlisted, 1, 'would_deny');
  -- ENFORCE: off-list reads return nothing; master and listed still work; unknown key refused; owner SQL never judged
  update public.credential_key_mode set mode = 'enforce' where key_name in ('edge','neo_mbp','*unknown*');
  res := res || pg_temp.t('enforce-edge-listed', edge_fp, edge_listed, -1, 'allow');
  res := res || pg_temp.t('enforce-edge-unlisted', edge_fp, edge_unlisted, 0, 'deny');
  res := res || pg_temp.t('enforce-master', mbp_fp, edge_unlisted, 1, 'allow');
  res := res || pg_temp.t('enforce-unknown-key', 'zzzzzzzzzzzzzzzz', edge_unlisted, 0, 'deny');
  res := res || pg_temp.t('enforce-owner-sql', null, edge_unlisted, 1, 'allow');
  -- a FAULT inside the check: shadow stays open, enforce closes
  alter table public.credential_access rename to credential_access_x;
  update public.credential_key_mode set mode = 'shadow' where key_name = 'edge';
  res := res || pg_temp.t('fault-in-shadow-stays-open', edge_fp, edge_unlisted, 1, 'allow');
  update public.credential_key_mode set mode = 'enforce' where key_name = 'edge';
  res := res || pg_temp.t('fault-in-enforce-closes', edge_fp, edge_unlisted, 0, 'deny');
  out := (select count(*) filter (where x like 'ok%') || ' passed, ' || count(*) filter (where x like 'FAIL%') || ' FAILED' from unnest(res) x) || coalesce(E'\n' || (select string_agg(x, E'\n') from unnest(res) x where x like 'FAIL%'), '');
  raise exception E'RESULTS: %', out;
end $$;
