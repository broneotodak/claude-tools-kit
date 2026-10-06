#!/usr/bin/env node
// schema-from-openapi.mjs — CREATE TABLE statements for neo-brain, from PostgREST's OpenAPI.
//
// The nightly backup is a logical export (one .ndjson.gz per table) and carries no DDL, and
// no management/DB credential survives in the vault since the 25 Sep 2026 rotation. PostgREST's
// OpenAPI document does expose every column's exact Postgres type (e.g. "public.vector(768)",
// "uuid[]", "timestamp with time zone") and marks primary keys, which is enough to rebuild the
// tables for a data restore. Not included (and not needed to read the data back): foreign keys,
// indexes, RLS policies, triggers, functions such as match_memories_hybrid_v2 — a full disaster
// recovery still needs a schema dump; this gets the rows back.
//
//   node schema-from-openapi.mjs --from schema.openapi.json --sql schema.sql --tables tables.json
//   node schema-from-openapi.mjs --live --sql schema.sql --tables tables.json   (NEO_BRAIN_URL/KEY)
//   node schema-from-openapi.mjs --from … --cols memories                        (prints "id,content,…")
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : null; };

export function pgType(prop) {
  const f = String(prop?.format || "").trim();
  if (f) {
    if (/^public\.vector\((\d+)\)$/.test(f)) return f.replace(/^public\./, "");
    if (/^public\.vector$/.test(f)) return "vector";
    return f.replace(/^public\./, "");
  }
  return { string: "text", integer: "bigint", number: "double precision", boolean: "boolean", object: "jsonb", array: "jsonb" }[prop?.type] || "text";
}
const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

export function schemaFromDefinitions(defs) {
  const tables = {};
  const sql = ["CREATE EXTENSION IF NOT EXISTS vector;", ""];
  for (const [table, def] of Object.entries(defs || {})) {
    const cols = [], pk = [];
    for (const [name, prop] of Object.entries(def.properties || {})) {
      const type = pgType(prop);
      cols.push({ name, type });
      if (String(prop.description || "").includes("<pk/>")) pk.push(name);
    }
    if (!cols.length) continue;
    tables[table] = cols;
    const lines = cols.map((c) => `  ${q(c.name)} ${c.type}`);
    if (pk.length) lines.push(`  PRIMARY KEY (${pk.map(q).join(", ")})`);
    sql.push(`CREATE TABLE IF NOT EXISTS public.${q(table)} (\n${lines.join(",\n")}\n);`, "");
  }
  return { sql: sql.join("\n"), tables };
}

async function loadDefinitions() {
  const from = opt("--from");
  if (from) return JSON.parse(readFileSync(from, "utf8"));
  const url = (process.env.NEO_BRAIN_URL || "").replace(/\/$/, ""), key = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("--from <file> or NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY required");
  const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, authorization: `Bearer ${key}`, accept: "application/openapi+json" } });
  if (!r.ok) throw new Error(`openapi fetch ${r.status}`);
  return (await r.json()).definitions || {};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const defs = await loadDefinitions();
  const { sql, tables } = schemaFromDefinitions(defs);
  const colsFor = opt("--cols");
  if (colsFor) { if (!tables[colsFor]) { console.error(`unknown table ${colsFor}`); process.exit(2); } console.log(tables[colsFor].map((c) => c.name).join(",")); process.exit(0); }
  if (opt("--sql")) writeFileSync(opt("--sql"), sql);
  if (opt("--tables")) writeFileSync(opt("--tables"), JSON.stringify(tables));
  if (!opt("--sql") && !opt("--tables")) process.stdout.write(sql);
  console.error(`[schema-from-openapi] ${Object.keys(tables).length} tables`);
}
