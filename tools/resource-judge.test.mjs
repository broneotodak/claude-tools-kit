// resource-judge.test.mjs — run with:  node --test tools/resource-judge.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateResources, resourceLine, DEFAULTS } from "./resource-judge.mjs";

const healthy = () => ({ v: 1, load: [0.2, 0.2, 0.5], ncpu: 20, mem: { total_mb: 121000, avail_mb: 30000, swap_total_mb: 16000, swap_free_mb: 15800 },
  disk: { "/": { total_gb: 3700, free_gb: 3300, used_pct: 6 } }, temps: [{ name: "k10temp", c: 41 }], gpu: [{ temp_c: 41, util_pct: 0 }],
  top: [{ comm: "llama-server", rss_mb: 12000 }, { comm: "python", rss_mb: 11900 }] });
const keys = (r) => r.signals.map((s) => s.key);

test("a healthy box raises nothing", () => { assert.deepEqual(evaluateResources(healthy(), { host: "edge" }).signals, []); });
test("a sentinel older than v1.5 (no resources) raises nothing and does not throw", () => {
  assert.deepEqual(evaluateResources(undefined, { host: "x" }).signals, []);
  assert.deepEqual(evaluateResources(null, { host: "x" }).signals, []);
  assert.deepEqual(evaluateResources({}, { host: "x" }).signals, []);
});

test("load must stay high for 3 reports before it pages; one calm report resets", () => {
  const s = {}; const hot = healthy(); hot.load = [30, 31, 29];
  assert.deepEqual(keys(evaluateResources(hot, { host: "edge", streaks: s })), []);
  assert.deepEqual(keys(evaluateResources(hot, { host: "edge", streaks: s })), []);
  assert.deepEqual(keys(evaluateResources(hot, { host: "edge", streaks: s })), ["resources:edge:load"]);
  evaluateResources(healthy(), { host: "edge", streaks: s });
  assert.equal(s.load, 0);
});

test("memory: warning under 10% available, critical under 5%, names the biggest users", () => {
  const s = {}; const low = healthy(); low.mem.avail_mb = 9000;       // 7.4%
  for (let i = 0; i < 2; i++) assert.deepEqual(evaluateResources(low, { host: "edge", streaks: s }).signals, []);
  const w = evaluateResources(low, { host: "edge", streaks: s }).signals[0];
  assert.equal(w.level, "warning"); assert.match(w.body, /llama-server 12 GB/); assert.equal(w.cooldownH, 24);
  const s2 = {}; const crit = healthy(); crit.mem.avail_mb = 3000;     // 2.5%
  for (let i = 0; i < 2; i++) evaluateResources(crit, { host: "edge", streaks: s2 });
  assert.equal(evaluateResources(crit, { host: "edge", streaks: s2 }).signals[0].level, "critical");
});

test("disk pages immediately, per mount, critical at 93%", () => {
  const r = healthy(); r.disk = { "/": { total_gb: 913, free_gb: 100, used_pct: 89 }, "/volume1": { total_gb: 22000, free_gb: 100, used_pct: 97 } };
  const sig = evaluateResources(r, { host: "nas" }).signals;
  assert.deepEqual(sig.map((x) => [x.key, x.level]), [["resources:nas:disk:/", "warning"], ["resources:nas:disk:/volume1", "critical"]]);
});

test("temperature: 2 consecutive reports over 85C; critical at 95C; GPU has its own line", () => {
  const s = {}; const r = healthy(); r.temps = [{ name: "Tctl", c: 88 }];
  assert.deepEqual(evaluateResources(r, { host: "tr-office", streaks: s }).signals, []);
  const sig = evaluateResources(r, { host: "tr-office", streaks: s }).signals;
  assert.equal(sig[0].key, "resources:tr-office:temp"); assert.equal(sig[0].level, "warning");
  const g = healthy(); g.gpu = [{ temp_c: 94 }]; const gs = {};
  evaluateResources(g, { host: "edge", streaks: gs });
  const gsig = evaluateResources(g, { host: "edge", streaks: gs }).signals;
  assert.equal(gsig[0].key, "resources:edge:gpu"); assert.equal(gsig[0].level, "critical");
});

test("sandbox egress: first reading is a baseline, a rise is CRITICAL (never snoozable), a counter reset is not an alarm", () => {
  const r = healthy(); r.lab_drops = 12;
  assert.deepEqual(evaluateResources(r, { host: "tr-office" }).signals, []);                 // no previous value
  assert.deepEqual(evaluateResources(r, { host: "tr-office", prevDrops: 12 }).signals, []);  // unchanged
  r.lab_drops = 20;
  const sig = evaluateResources(r, { host: "tr-office", prevDrops: 12 }).signals;
  assert.equal(sig[0].key, "lab-egress:tr-office"); assert.equal(sig[0].level, "critical"); assert.match(sig[0].body, /8 new packet/);
  r.lab_drops = 3;                                                                           // reboot / reload → counter restarted
  assert.deepEqual(evaluateResources(r, { host: "tr-office", prevDrops: 20 }).signals, []);
  assert.equal(evaluateResources(r, { host: "tr-office", prevDrops: 20 }).drops, 3);
});

test("per-box config can raise a threshold or ignore a metric", () => {
  const r = healthy(); r.load = [30, 30, 30]; const s = {};
  for (let i = 0; i < 3; i++) evaluateResources(r, { host: "mbp", cfg: { ignore: ["load"] }, streaks: s });
  assert.equal(evaluateResources(r, { host: "mbp", cfg: { ignore: ["load"] }, streaks: s }).signals.length, 0);
  const d = healthy(); d.disk["/"].used_pct = 88;
  assert.equal(evaluateResources(d, { host: "mbp", cfg: { disk_warn_pct: 95 } }).signals.length, 0);
  assert.equal(DEFAULTS.disk_warn_pct, 85);                                                   // defaults untouched
});

test("garbage values never throw", () => {
  assert.doesNotThrow(() => evaluateResources({ load: ["a"], ncpu: "x", mem: { total_mb: "y" }, disk: { "/": { used_pct: null } }, temps: [{ c: "hot" }], gpu: [{}] }, { host: "x" }));
});

test("resourceLine is short and survives partial data", () => {
  assert.equal(resourceLine("tr-office", healthy()), "tr-office load 0.2/20 · RAM 25% free · disk 6% · 41°C");
  assert.equal(resourceLine("old", undefined), "old n/a");
  assert.equal(resourceLine("x", { v: 1 }), "x n/a");
});
