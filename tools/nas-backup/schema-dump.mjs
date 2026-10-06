#!/usr/bin/env node
// schema-dump.mjs — the full DDL of neo-brain's public schema, from the Mac, through the
// Supabase Management API with the org-owner token that lives ONLY in neo-mbp's Keychain
// (hardening 2026-10-02: `security find-generic-password -a neo-brain-owner -s supabase_neo_personal -w`).
//
// Why: the nightly backup (NAS) is a logical export + the OpenAPI column types. That restores the
// DATA (rehearsed 6 Oct 2026) but not the plumbing: foreign keys, indexes, RLS policies, triggers,
// functions such as match_memories_hybrid_v2 / get_credential, sequences, extensions. This writes
// all of that as SQL so a disaster recovery has it. No credential is needed on the NAS.
//
//   node tools/nas-backup/schema-dump.mjs                       # prints to stdout
//   node tools/nas-backup/schema-dump.mjs --out schema-full.sql
//   node tools/nas-backup/schema-dump.mjs --out schema-full.sql --push nas-remote:/volume1/docker/backups/neo-brain
//
// Read-only: every query is a SELECT on pg_catalog / information_schema.
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const PROJECT = process.env.NEO_BRAIN_PROJECT_REF || "xsunmervpyrplzarebva";
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : null; };

function token() {
  if (process.env.SUPABASE_OWNER_TOKEN) return process.env.SUPABASE_OWNER_TOKEN;
  try { return execSync("security find-generic-password -a neo-brain-owner -s supabase_neo_personal -w", { encoding: "utf8" }).trim(); }
  catch { throw new Error("no owner token: Keychain item neo-brain-owner/supabase_neo_personal missing (this runs on neo-mbp)"); }
}
const TOK = token();
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST", headers: { authorization: `Bearer ${TOK}`, "content-type": "application/json" }, body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`management api ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

const out = [];
const section = (title) => out.push("", `-- ═══ ${title} ═══`, "");

// extensions
section("extensions");
for (const e of await sql("select extname, extversion from pg_extension where extname not in ('plpgsql') order by extname"))
  out.push(`CREATE EXTENSION IF NOT EXISTS ${q(e.extname)}; -- ${e.extversion}`);

// enum types
section("types");
for (const t of await sql("select t.typname, string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) as labels from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by t.typname order by 1"))
  out.push(`CREATE TYPE public.${q(t.typname)} AS ENUM (${t.labels});`);

// sequences
section("sequences");
for (const s of await sql("select sequencename, data_type, start_value, increment_by from pg_sequences where schemaname='public' order by 1"))
  out.push(`CREATE SEQUENCE IF NOT EXISTS public.${q(s.sequencename)} AS ${s.data_type} START WITH ${s.start_value} INCREMENT BY ${s.increment_by};`);

// tables (columns with defaults/nullability/generated) + constraints
section("tables");
const cols = await sql("select table_name, column_name, ordinal_position, is_nullable, column_default, is_generated, generation_expression, pg_catalog.format_type(a.atttypid, a.atttypmod) as full_type from information_schema.columns c join pg_attribute a on a.attrelid=('public.'||quote_ident(c.table_name))::regclass and a.attname=c.column_name where c.table_schema='public' and c.table_name in (select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE') order by table_name, ordinal_position");
const cons = await sql("select c.conrelid::regclass::text as table_name, c.conname, c.contype, pg_get_constraintdef(c.oid) as def from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' order by c.contype desc, 1, 2");
const byTable = {};
for (const c of cols) (byTable[c.table_name] ||= []).push(c);
for (const [table, list] of Object.entries(byTable)) {
  const lines = list.map((c) => {
    let d = `  ${q(c.column_name)} ${c.full_type}`;
    if (c.is_generated === "ALWAYS" && c.generation_expression) d += ` GENERATED ALWAYS AS (${c.generation_expression}) STORED`;
    else if (c.column_default) d += ` DEFAULT ${c.column_default}`;
    if (c.is_nullable === "NO") d += " NOT NULL";
    return d;
  });
  const pk = cons.filter((x) => x.table_name === table && x.contype === "p").map((x) => `  CONSTRAINT ${q(x.conname)} ${x.def}`);
  out.push(`CREATE TABLE IF NOT EXISTS public.${q(table)} (\n${[...lines, ...pk].join(",\n")}\n);`, "");
}
section("constraints (unique, check, foreign keys)");
for (const x of cons.filter((c) => c.contype !== "p")) out.push(`ALTER TABLE ${x.table_name} ADD CONSTRAINT ${q(x.conname)} ${x.def};`);

// views
section("views");
for (const v of await sql("select viewname, definition from pg_views where schemaname='public' order by 1"))
  out.push(`CREATE OR REPLACE VIEW public.${q(v.viewname)} AS\n${v.definition}`, "");

// indexes (non-constraint)
section("indexes");
for (const i of await sql("select indexdef from pg_indexes where schemaname='public' and indexname not in (select conname from pg_constraint) order by tablename, indexname"))
  out.push(`${i.indexdef};`);

// functions
section("functions");
for (const f of await sql("select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') order by p.proname"))
  out.push(`${f.def};`, "");

// triggers
section("triggers");
for (const t of await sql("select pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by c.relname, t.tgname"))
  out.push(`${t.def};`);

// row level security
section("row level security");
for (const r of await sql("select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity order by 1"))
  out.push(`ALTER TABLE public.${q(r.relname)} ENABLE ROW LEVEL SECURITY;${r.relforcerowsecurity ? ` ALTER TABLE public.${q(r.relname)} FORCE ROW LEVEL SECURITY;` : ""}`);
for (const p of await sql("select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname='public' order by tablename, policyname"))
  out.push(`CREATE POLICY ${q(p.policyname)} ON public.${q(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${String(p.roles).replace(/[{}]/g, "")}${p.qual ? ` USING (${p.qual})` : ""}${p.with_check ? ` WITH CHECK (${p.with_check})` : ""};`);

// grants (table level)
section("grants");
for (const g of await sql("select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privs from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role') group by grantee, table_name order by 2, 1"))
  out.push(`GRANT ${g.privs} ON public.${q(g.table_name)} TO ${g.grantee};`);

const header = [
  `-- neo-brain public schema — full DDL dump`,
  `-- project ${PROJECT} · generated ${new Date().toISOString()} by tools/nas-backup/schema-dump.mjs (read-only, Management API)`,
  `-- Companion to the nightly data export (<table>.ndjson.gz). Apply this first on an empty database, then load the data.`,
  `-- Not included: schemas other than public (auth, storage, vault, extensions), roles, Supabase Vault secrets.`,
];
const text = [...header, ...out].join("\n") + "\n";
const file = opt("--out");
if (file) writeFileSync(file, text); else process.stdout.write(text);
console.error(`[schema-dump] ${Object.keys(byTable).length} tables · ${text.length} bytes${file ? ` → ${file}` : ""}`);
const push = opt("--push");
if (push && file) {
  const [host, dir] = push.split(":");
  const r = spawnSync("sh", ["-c", `cat '${file}' | ssh -o BatchMode=yes ${host} "cat > '${dir}/schema-full-latest.sql' && cp '${dir}/schema-full-latest.sql' '${dir}/schema-full-$(date +%Y-%m-%d).sql' && ls -la '${dir}' | grep schema-full | tail -n 2"`], { encoding: "utf8" });
  process.stderr.write(r.stdout + r.stderr);
  if (r.status !== 0) process.exit(r.status);
}
