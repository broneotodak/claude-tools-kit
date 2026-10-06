#!/usr/bin/env node
// ndjson-to-copy.mjs — one backup file (<table>.ndjson.gz) → Postgres COPY text on stdout.
//
//   node ndjson-to-copy.mjs /backups/2026-10-06/memories.ndjson.gz tables.json memories \
//     | psql -d restore -c '\copy public."memories"(id,content,…) FROM STDIN'
//
// tables.json comes from schema-from-openapi.mjs and gives the column order and types, so the
// COPY column list and the emitted fields always agree. Encoding rules (COPY text format):
// NULL → \N; booleans t/f; json/jsonb → JSON text; Postgres arrays (text[], uuid[]) → {…}
// literals; vector/tsvector/uuid/timestamps/text → their text form. Backslash, tab, newline
// and carriage return are escaped as COPY requires. No dependencies; streams, flat memory.
import { createReadStream, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

const [file, tablesFile, table] = process.argv.slice(2);
if (!file || !tablesFile || !table) { console.error("usage: ndjson-to-copy.mjs <file.ndjson.gz> <tables.json> <table>"); process.exit(2); }
const cols = JSON.parse(readFileSync(tablesFile, "utf8"))[table];
if (!cols) { console.error(`unknown table ${table}`); process.exit(2); }

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
const arrayElem = (v) => (v == null ? "NULL" : `"${String(typeof v === "object" ? JSON.stringify(v) : v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
export function encode(value, type) {
  if (value === null || value === undefined) return "\\N";
  const t = String(type);
  if (t.endsWith("[]")) return esc(Array.isArray(value) ? `{${value.map(arrayElem).join(",")}}` : String(value));
  if (t === "json" || t === "jsonb") return esc(JSON.stringify(value));
  if (t === "boolean") return value ? "t" : "f";
  if (typeof value === "object") return esc(JSON.stringify(value));
  return esc(String(value));
}

let n = 0;
const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
const out = process.stdout;
for await (const line of rl) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  const fields = cols.map((c) => encode(row[c.name], c.type));
  if (!out.write(fields.join("\t") + "\n")) await new Promise((r) => out.once("drain", r));
  n++;
}
console.error(`[ndjson-to-copy] ${table}: ${n} rows`);
