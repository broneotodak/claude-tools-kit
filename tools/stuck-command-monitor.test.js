// node --test tools/stuck-command-monitor.test.js
// Pure decision helpers only — no network. The monitor itself runs on Hermes (fleetops cron */5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetFor, queuedBehindRunning } from "./stuck-command-monitor.js";

const MIN = 60_000;

test("budgetFor: run_task uses payload.budget_min + grace, never below the table floor", () => {
  assert.deepEqual(budgetFor({ command: "run_task", payload: { budget_min: 45 } }), { pending: 30, running: 55 });
  assert.deepEqual(budgetFor({ command: "run_task", payload: {} }), { pending: 30, running: 30 });   // default 20 + 10
  assert.deepEqual(budgetFor({ command: "run_task", payload: { budget_min: 5 } }), { pending: 30, running: 20 }); // floor 20
  assert.deepEqual(budgetFor({ command: "run_dev_task", payload: { budget_min: 45 } }), { pending: 240, running: 90 }); // floor 90 wins
  assert.deepEqual(budgetFor({ command: "deploy_project", payload: {} }), { pending: 30, running: 25 });
  assert.equal(budgetFor({ command: "send_whatsapp_notification", payload: {} }), null);
});

test("queuedBehindRunning: pending row behind a busy box is queued, not stuck (up to 6 h)", () => {
  const now = Date.now();
  const pending = { id: "p1", status: "pending", to_agent: "edge-cc", created_at: new Date(now - 11 * MIN).toISOString() };
  const running = [{ id: "r1", status: "running", to_agent: "edge-cc" }];
  assert.equal(queuedBehindRunning(pending, running, now), true);
  // other box busy -> not our queue
  assert.equal(queuedBehindRunning(pending, [{ id: "r2", status: "running", to_agent: "tr-home-cc" }], now), false);
  // nothing running -> genuinely unclaimed
  assert.equal(queuedBehindRunning(pending, [], now), false);
  // waited more than 6 h -> stuck even if the box is busy
  const old = { ...pending, created_at: new Date(now - 361 * MIN).toISOString() };
  assert.equal(queuedBehindRunning(old, running, now), false);
  // running rows are never "queued"
  assert.equal(queuedBehindRunning({ ...pending, status: "running" }, running, now), false);
});
