// finish-step.test.mjs — run with:  node --test tools/finish-step.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, clampWait, pollBudget, finishKey, deployVerdict, progressLine, dailyCapReached, LIMITS } from "./finish-step.mjs";

test("parseArgs: flags, values and booleans", () => {
  const a = parseArgs(["--title", "P1-08 usage", "--repo", "o/r", "--pr", "201", "--dry-run", "--deploy-project", "siti-router"]);
  assert.equal(a.title, "P1-08 usage"); assert.equal(a.pr, "201"); assert.equal(a["dry-run"], true); assert.equal(a["deploy-project"], "siti-router");
  assert.equal(parseArgs(["--progress"]).progress, true);
});

test("NO INFINITE LOOP: the wait is clamped and the poll count is a fixed small number", () => {
  assert.equal(clampWait(undefined), LIMITS.waitDefaultSec);
  assert.equal(clampWait("abc"), LIMITS.waitDefaultSec);
  assert.equal(clampWait(-5), LIMITS.waitDefaultSec);
  assert.equal(clampWait(999999), LIMITS.waitMaxSec);          // hard ceiling
  assert.equal(pollBudget(999999), LIMITS.waitMaxSec / LIMITS.pollSec); // 30 polls at most
  assert.ok(pollBudget(1) >= 1);
  assert.ok(Number.isInteger(pollBudget(120)));
});

test("daily cap stops a runaway caller", () => {
  assert.equal(dailyCapReached(LIMITS.dailyRows - 1), false);
  assert.equal(dailyCapReached(LIMITS.dailyRows), true);
  assert.equal(dailyCapReached(1000), true);
});

test("finishKey is stable per repo#pr (idempotency)", () => {
  assert.equal(finishKey("broneotodak/siti-v2", "201"), "finish-step:broneotodak/siti-v2#201");
  assert.equal(finishKey(" a/b ", 7), finishKey("a/b", "7"));
});

test("deployVerdict: only a done order that says DEPLOY-RESULT: OK passes", () => {
  assert.equal(deployVerdict(null).state, "no-order");
  assert.equal(deployVerdict({ status: "pending" }).state, "pending");
  assert.equal(deployVerdict({ status: "running" }).ok, false);
  assert.equal(deployVerdict({ status: "failed" }).state, "failed");
  assert.equal(deployVerdict({ status: "done", result: { output: "restart\nDEPLOY-RESULT: OK sha=abc" } }).ok, true);
  assert.equal(deployVerdict({ status: "done", result: { output: "boom" } }).state, "not-ok");
  assert.equal(deployVerdict({ status: "done", result: "DEPLOY-RESULT: OK" }).ok, true);
});

test("progressLine counts distinct plan steps, ignores bug-fix tags, shows the latest", () => {
  const rows = [
    { step: "P1-08", title: "usage log", at: "2026-11-26T04:00:00Z" },
    { step: "P1-02", title: "browser hole", at: "2026-11-26T03:00:00Z" },
    { step: "P1-02", title: "browser hole (2nd repo)", at: "2026-11-26T03:10:00Z" },
    { step: "B-11", title: "tiktok reads", at: "2026-11-26T03:20:00Z" },
    { step: null, title: "untagged", at: "2026-11-26T03:30:00Z" },
  ];
  assert.equal(progressLine(rows, { total: 43, label: "Spine" }), "Spine: 2/43 steps logged · last: usage log (2026-11-26)");
  assert.equal(progressLine([], { total: 43, label: "Spine" }), "Spine: 0/43 steps logged");
  assert.equal(progressLine(rows), "Progress: 2 steps logged · last: usage log (2026-11-26)");
});
