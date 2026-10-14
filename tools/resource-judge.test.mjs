// resource-judge.test.mjs — run with:  node --test tools/resource-judge.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateResources, resourceLine, sanitizeCfg, DEFAULTS } from "./resource-judge.mjs";

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
  const cs = evaluateResources(crit, { host: "edge", streaks: s2 }).signals[0];
  assert.equal(cs.level, "critical"); assert.equal(cs.key, "resources:edge:mem:crit"); assert.equal(cs.cooldownH, 3);
});

test("disk pages immediately, per mount, critical at 93%", () => {
  const r = healthy(); r.disk = { "/": { total_gb: 913, free_gb: 100, used_pct: 89 }, "/volume1": { total_gb: 22000, free_gb: 100, used_pct: 97 } };
  const sig = evaluateResources(r, { host: "nas" }).signals;
  assert.deepEqual(sig.map((x) => [x.key, x.level]), [["resources:nas:disk:/", "warning"], ["resources:nas:disk:/volume1:crit", "critical"]]);
});

test("temperature: 2 consecutive reports over 85C; critical at 95C; GPU has its own line", () => {
  const s = {}; const r = healthy(); r.temps = [{ name: "Tctl", c: 88 }];
  assert.deepEqual(evaluateResources(r, { host: "tr-office", streaks: s }).signals, []);
  const sig = evaluateResources(r, { host: "tr-office", streaks: s }).signals;
  assert.equal(sig[0].key, "resources:tr-office:temp"); assert.equal(sig[0].level, "warning");
  const g = healthy(); g.gpu = [{ temp_c: 94 }]; const gs = {};
  evaluateResources(g, { host: "edge", streaks: gs });
  const gsig = evaluateResources(g, { host: "edge", streaks: gs }).signals;
  assert.equal(gsig[0].key, "resources:edge:gpu:crit"); assert.equal(gsig[0].level, "critical");
});

test("sandbox egress: first reading is a baseline, a rise is CRITICAL (never snoozable), a counter reset is not an alarm", () => {
  const r = healthy(); r.lab_drops = 12;
  assert.deepEqual(evaluateResources(r, { host: "tr-office" }).signals, []);                 // no previous value
  assert.deepEqual(evaluateResources(r, { host: "tr-office", prevDrops: 12 }).signals, []);  // unchanged
  r.lab_drops = 20;
  const sig = evaluateResources(r, { host: "tr-office", prevDrops: 12 }).signals;
  assert.equal(sig[0].key, "lab-egress:tr-office"); assert.equal(sig[0].level, "critical"); assert.equal(sig[0].cooldownH, 1); assert.match(sig[0].body, /8 new packet/);
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


test("resourceLine is short and survives partial data", () => {
  assert.equal(resourceLine("tr-office", healthy()), "tr-office load 0.2/20 · RAM 25% free · disk 6% · 41°C");
  assert.equal(resourceLine("old", undefined), "old n/a");
  assert.equal(resourceLine("x", { v: 1 }), "x n/a");
});

// ── review findings (14 Oct 2026) ──────────────────────────────────────────────────────────────────────────────
const MALFORMED = [
  { disk: { "/": null } }, { disk: "full" }, { disk: [1, 2] }, { temps: [null] }, { temps: {} }, { temps: "hot" },
  { gpu: [null] }, { gpu: {} }, { top: "x" }, { top: {} }, { top: [null, 1, "a"] }, { mem: null }, { mem: "x" }, { load: "x" },
  { load: [null] }, { ncpu: "x", load: [1, 1, 1] }, { load: { 1: 5 }, ncpu: 4 }, { lab_drops: "12" }, { lab_drops: NaN },
  { disk: { "/": { used_pct: "90" } } }, { temps: [{ c: "hot" }] }, { gpu: [{}] }, [], "string", 42,
];
test("review #1: a malformed resources block never throws (it must not blind the judge for the other boxes)", () => {
  for (const bad of MALFORMED) {
    assert.doesNotThrow(() => evaluateResources(bad, { host: "x" }), JSON.stringify(bad));
    assert.doesNotThrow(() => resourceLine("x", bad), JSON.stringify(bad));
  }
  // and a half-bad block still reports what IS readable
  const r = healthy(); r.disk = { "/": null, "/data": { total_gb: 100, free_gb: 3, used_pct: 97 } }; r.temps = [null, { name: "x", c: 50 }];
  assert.deepEqual(keys(evaluateResources(r, { host: "x" })), ["resources:x:disk:/data:crit"]);
});

test("review #1: a malformed per-box config never throws and falls back to defaults", () => {
  for (const bad of [{ ignore: 5 }, { ignore: true }, { ignore: [1, null, "load"] }, { load_per_core_warn: null }, { disk_warn_pct: "x" }, null, "x", [], 7]) {
    assert.doesNotThrow(() => evaluateResources(healthy(), { host: "x", cfg: bad }), JSON.stringify(bad));
  }
  assert.deepEqual(sanitizeCfg({ ignore: 5 }).ignore, []);
  assert.deepEqual(sanitizeCfg({ ignore: [1, "load", null] }).ignore, ["load"]);
  assert.equal(sanitizeCfg({ load_per_core_warn: null }).load_per_core_warn, DEFAULTS.load_per_core_warn);   // null threshold = default, NOT "always true"
  const hot = healthy(); hot.load = [1, 1, 1]; const s = {};
  for (let i = 0; i < 4; i++) assert.deepEqual(evaluateResources(hot, { host: "x", cfg: { load_per_core_warn: null }, streaks: s }).signals, []);
});

test("review #2: a critical is a different page from the warning before it (key + short cooldown)", () => {
  const w = healthy(); w.disk["/"].used_pct = 86;
  const c = healthy(); c.disk["/"].used_pct = 97;
  const ws = evaluateResources(w, { host: "h" }).signals[0], cs = evaluateResources(c, { host: "h" }).signals[0];
  assert.notEqual(ws.key, cs.key);
  assert.equal(ws.cooldownH, 24); assert.equal(cs.cooldownH, 3);
});

test("review #4: a report without lab_drops clears the baseline (caller stores drops unconditionally)", () => {
  const r = healthy();                                      // no lab_drops key
  const out = evaluateResources(r, { host: "h", prevDrops: 500 });
  assert.equal(out.drops, undefined);                       // → caller sets state to undefined → next reading is a fresh baseline
  r.lab_drops = 10;                                         // table reloaded, counters restarted
  assert.deepEqual(evaluateResources(r, { host: "h", prevDrops: out.drops }).signals, []);
});

test("review #6: a missing reading resets the streak (bad, gap, bad is NOT two consecutive)", () => {
  const s = {}; const hot = healthy(); hot.temps = [{ name: "t", c: 90 }];
  evaluateResources(hot, { host: "h", streaks: s });          // bad → 1
  const gap = healthy(); delete gap.temps; delete gap.gpu;    // no temperature reading at all
  evaluateResources(gap, { host: "h", streaks: s });
  assert.equal(s.temp, 0);
  assert.deepEqual(evaluateResources(hot, { host: "h", streaks: s }).signals, []);     // back to 1, not 2
  assert.equal(evaluateResources(hot, { host: "h", streaks: s }).signals.length, 1);   // now 2 consecutive → pages
});

test("review #6: the minutes text says (n-1)*10, not n*10", () => {
  const s = {}; const hot = healthy(); hot.load = [30, 30, 30];
  for (let i = 0; i < 2; i++) evaluateResources(hot, { host: "h", streaks: s });
  assert.match(evaluateResources(hot, { host: "h", streaks: s }).signals[0].body, /for 20\+ minutes/);
});
