import "dotenv/config";
import { NeoBrain } from "../src/index.js";

const brain = new NeoBrain({ agent: "post-migration-verify" });

async function q(query, opts = {}) {
  console.log(`\nQuery: "${query}"`);
  const hits = await brain.search(query, { k: 4, ...opts });
  for (const h of hits) {
    const s = Math.round(h.similarity * 100);
    console.log(`  ${s}% [${h.memory_type || "?"}, imp ${h.importance || "?"}, ${h.visibility}] ${(h.content || "").slice(0, 140).replace(/\n/g, " ")}`);
  }
  if (hits.length === 0) console.log("  (no matches ≥ threshold)");
}

await q("what are Neo's main projects right now");
await q("Digitech handover status");
await q("NClaw deployment architecture Hetzner");
await q("Neo's family");
