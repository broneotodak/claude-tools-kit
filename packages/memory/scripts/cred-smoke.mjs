import "dotenv/config";
import { NeoBrain } from "../src/index.js";

const brain = new NeoBrain({ agent: "credentials-smoke" });

console.log("list (metadata only):");
const list = await brain.listCredentials();
console.log(`  ${list.length} active credentials`);
for (const c of list.slice(0, 5)) console.log(`  - ${c.service}/${c.credential_type} (${c.environment})`);

console.log("\nget one (whatsapp/app_id):");
const cred = await brain.getCredential("whatsapp", { type: "app_id" });
if (cred) {
  console.log(`  found — value length: ${cred.credential_value.length}, preview: ${cred.credential_value.slice(0, 3)}***`);
} else {
  console.log("  not found");
}

console.log("\nget openai api_key (length only):");
try {
  const v = await brain.getCredentialValue("openai", { type: "api_key" });
  console.log(`  ok — length: ${v.length}, starts with: ${v.slice(0, 3)}***`);
} catch (e) {
  console.log("  err:", e.message);
}

console.log("\n✅ credentials SDK works end-to-end");
