-- ROLLBACK for 01-vault-shadow.sql: restores get_credential exactly as it was on 16 Nov 2026 (captured from the live database before the change).
-- The new tables and the verdict column are harmless to leave in place.
CREATE OR REPLACE FUNCTION public.get_credential(p_owner_id uuid, p_service text, p_credential_type text DEFAULT NULL::text, p_environment text DEFAULT 'production'::text)
 RETURNS TABLE(id uuid, service text, credential_type text, credential_value text, description text, environment text, expires_at timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;
