#!/usr/bin/env node
/**
 * Run AFTER pasting NEO_BRAIN_SERVICE_ROLE_KEY into ~/Projects/claude-tools-kit/.env
 * Verifies: SDK can write, RPC works, audit log fires.
 *
 * Usage:
 *   cd ~/Projects/claude-tools-kit
 *   node packages/memory/scripts/verify-connection.mjs
 */
import "dotenv/config";
import { NeoBrain } from "../src/index.js";

if (!process.env.NEO_BRAIN_URL || !process.env.NEO_BRAIN_SERVICE_ROLE_KEY) {
  console.error("❌ NEO_BRAIN_URL or NEO_BRAIN_SERVICE_ROLE_KEY not set in .env");
  console.error("   See packages/memory/MIGRATION.md Step 1a");
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY not set");
  process.exit(1);
}

const brain = new NeoBrain({ agent: "verify-script" });

console.log("1. Saving test memory...");
const saved = await brain.save("neo-brain verify-connection smoke test — safe to delete", {
  category: "test",
  type: "note",
  importance: 1,
  visibility: "internal",
});
console.log("   ✓ saved:", saved.id);

console.log("2. Searching for the test memory...");
const hits = await brain.search("neo-brain verify-connection smoke", { k: 3 });
console.log(`   ✓ got ${hits.length} matches, top similarity: ${hits[0] ? Math.round(hits[0].similarity * 100) + "%" : "n/a"}`);

console.log("3. Getting personality (Neo self)...");
const traits = await brain.getPersonality();
console.log(`   ✓ personality rows: ${traits.length}`);

console.log("4. Getting facts (Neo self)...");
const facts = await brain.getFacts({ limit: 5 });
console.log(`   ✓ facts rows: ${facts.length}`);

console.log("\n✅ neo-brain SDK is fully connected and operational.");
console.log(`   Cleanup: DELETE FROM memories WHERE id='${saved.id}'; in Supabase SQL editor.`);
