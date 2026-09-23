import test from "node:test";
import assert from "node:assert/strict";
import { signalQuery, heartbeatUses, isDue, verdictLine } from "../tools/idle-agent-clock.mjs";

test("each signal counts from records the fleet already keeps", () => {
  const s = "2026-09-22T16:00:00.000Z";
  assert.match(signalQuery({ kind: "commands", to_agent: "dev-agent" }, s), /^agent_commands\?select=id&to_agent=eq\.dev-agent&created_at=gte\./);
  assert.match(signalQuery({ kind: "commands_engine", engine: "codex" }, s), /payload->>engine=eq\.codex/);
  assert.match(signalQuery({ kind: "table_count", table: "creative_router_log", time_col: "created_at" }, s), /^creative_router_log\?/);
  assert.match(signalQuery({ kind: "heartbeat_field", agent: "neo-twin", field: "replied" }, s), /agent_name=eq\.neo-twin/);
  assert.equal(signalQuery({ kind: "nope" }, s), null);
});

test("a heartbeat counter that resets on restart never loses the uses already seen", () => {
  assert.equal(heartbeatUses(3, { replied: 0 }, "replied"), 3);
  assert.equal(heartbeatUses(3, { replied: 7 }, "replied"), 7);
  assert.equal(heartbeatUses(undefined, {}, "replied"), 0);
});

test("due once on or after review_on, never twice", () => {
  assert.equal(isDue({ review_on: "2026-10-23" }, "2026-10-22T09:00:00Z"), false);
  assert.equal(isDue({ review_on: "2026-10-23" }, "2026-10-23T01:00:00Z"), true);
  assert.equal(isDue({ review_on: "2026-10-23", reported_at: "2026-10-23T01:00:00Z" }, "2026-10-24T01:00:00Z"), false);
});

test("the verdict is plain words", () => {
  assert.match(verdictLine("neo-twin", { subject: "Neo-twin auto-reply", uses: 0 }), /Neo-twin auto-reply: not used once → suggest ARCHIVE/);
  assert.match(verdictLine("dev-agent", { uses: 3 }), /barely used/);
  assert.match(verdictLine("x", { uses: 12 }), /KEEP/);
});
