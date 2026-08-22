#!/usr/bin/env node
// kb-recall — KB-FIRST recall against neo-brain. Returns the maintained-truth
// page for a question, ahead of the diary. This is the primitive a Siti/twin
// `kb_read` tool calls (source_filter=['kb']); also usable from the CLI.
//
// Usage: node tools/kb-recall.mjs "which machine does Siti run on" [--k 3] [--full]

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
for (const p of [join(HERE, "..", ".env")]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const URL = process.env.NEO_BRAIN_URL?.replace(/\/$/, "");
const KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
const GEMINI = process.env.GEMINI_API_KEY;

const args = process.argv.slice(2);
const full = args.includes("--full");
const kIdx = args.indexOf("--k");
const k = kIdx >= 0 ? parseInt(args[kIdx + 1], 10) : 3;
const q = args.filter((a, i) => !a.startsWith("--") && !(kIdx >= 0 && i === kIdx + 1)).join(" ").trim();
if (!q) { console.error('usage: kb-recall "<question>" [--k N] [--full]'); process.exit(1); }

const er = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI}`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ content: { parts: [{ text: q }] }, outputDimensionality: 768 }),
});
const vec = (await er.json())?.embedding?.values;
const res = await fetch(`${URL}/rest/v1/rpc/match_memories_hybrid_v2`, {
  method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
  body: JSON.stringify({ query_embedding: `[${vec.join(",")}]`, query_text: q, match_count: k, min_similarity: 0.15, source_filter: ["kb"] }),
});
const rows = await res.json();
if (!rows.length) { console.log("∅ no KB page matched — the diary may still have it (recall without source_filter)."); process.exit(0); }
for (const r of rows) {
  const first = r.content.split("\n")[0].replace("# neo-kb · ", "");
  console.log(`\n📄 ${first}  (sim ${r.similarity?.toFixed(2)})`);
  if (full) console.log(r.content.split("\n").slice(1).join("\n"));
}
