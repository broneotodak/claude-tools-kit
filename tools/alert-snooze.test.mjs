// alert-snooze.test.mjs — run with:  node --test tools/alert-snooze.test.mjs
// (node:test, no dependencies; not picked up by `npm test` = jest, which only matches *.test.js)
// Vectors V1–V9 are SHARED with the other two monitors' repos — same meaning everywhere; do not change them.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSnoozeKey, isSnoozable, matchesSnooze, pickSnooze, loadActiveSnoozes,
  NEVER_SNOOZE_PREFIXES, NEVER_SNOOZE_EXACT, CRIT_CHANGE_SECTIONS,
} from "./alert-snooze.mjs";

const MON = "intrusion-watch";
const subj = (key, extra = {}) => ({ monitor: MON, key, level: "warning", ...extra });
const NOW = Date.parse("2026-10-12T08:00:00Z");
const FUTURE = "2026-10-19T08:00:00.000Z", PAST = "2026-10-11T08:00:00.000Z";
const note = (match, over = {}) => ({ id: `id-${match}`, content: `snooze ${match}`, created_at: PAST, metadata: { scope: "ops", status: "active", match, label: match, until: FUTURE, reason: "test", by: "neo", ...over } });

test("V1 agent:<name> matches silent:<name> and brain:agent:<name>", () => {
  assert.equal(matchesSnooze("agent:forge-coach-agent", subj("silent:forge-coach-agent")), true);
  assert.equal(matchesSnooze("agent:forge-coach-agent", subj("brain:agent:forge-coach-agent")), true);
  assert.ok(pickSnooze([note("agent:forge-coach-agent")], subj("silent:forge-coach-agent"), NOW));
  assert.ok(pickSnooze([note("agent:forge-coach-agent")], subj("brain:agent:forge-coach-agent"), NOW));
});

test("V2 agent match is exact, not a prefix", () => {
  assert.equal(matchesSnooze("agent:forge-coach-agent", subj("silent:forge-coach")), false);
  assert.equal(matchesSnooze("agent:forge-coach", subj("silent:forge-coach-agent")), false);
  assert.equal(pickSnooze([note("agent:forge-coach-agent")], subj("silent:forge-coach"), NOW), null);
});

test("V3 host:<box> matches a page raised with that host", () => {
  assert.equal(matchesSnooze("host:bandung-01", subj("silent:sentinel-bandung", { host: "bandung-01" })), true);
  assert.equal(matchesSnooze("host:bandung-01", subj("silent:sentinel-bandung", { host: "edge" })), false);
  assert.equal(matchesSnooze("host:bandung-01", subj("silent:sentinel-bandung")), false); // no host on the page → no match
  assert.ok(pickSnooze([note("host:bandung-01")], subj("silent:sentinel-bandung", { host: "bandung-01" }), NOW));
});

test("V4 host snooze never reaches a security-family page (sudo) even on that host", () => {
  const s = subj("sudo:bandung-01:x", { host: "bandung-01" });
  assert.equal(isSnoozable(s), false);
  assert.equal(pickSnooze([note("host:bandung-01")], s, NOW), null);
});

test("V5 check:<monitor>/<id> — exact or prefix on the page key, same monitor only", () => {
  assert.equal(matchesSnooze("check:intrusion-watch/silent:sentinel-bandung", subj("silent:sentinel-bandung")), true);
  assert.equal(matchesSnooze("check:intrusion-watch/silent:", subj("silent:sentinel-bandung")), true);
  assert.equal(matchesSnooze("check:intrusion-watch/silent:", subj("silent:anything-at-all")), true);
  assert.equal(matchesSnooze("check:intrusion-watch/silent:", subj("door:naca-mcp")), false);
  assert.equal(matchesSnooze("check:daily-checkup/heartbeat-", subj("heartbeat-forge")), false);
  assert.equal(matchesSnooze("check:daily-checkup/silent:", subj("silent:sentinel-bandung")), false);
  assert.equal(matchesSnooze("check:intrusion-watch/door:", { monitor: "daily-checkup", key: "door:x" }), false);
});

test("V6 isSnoozable is false for every off-limits family, and for anything critical", () => {
  const offLimits = [
    "login:1.2.3.4:abcdef12", "sudo:sentinel-edge:neo->root", "tsssh:sentinel-edge", "users:sentinel-edge",
    "posture:sentinel-edge:pw", "posture:sentinel-edge:tsssh", "tailnet:ssh:box@100.64.0.9",
    "github:key:123:laptop", "github:public:broneotodak/x", "hetzner:key:k SHA256:abc",
    "vault:unknown:UNKNOWN:nokey", "vault:bulk:edge_cc", "vault:never:netlify_v2", "vault:new:edge_cc:x/y",
    "token:github:edge_cc_pat", "token:github:edge_cc_pat:expiry", "token:openai:key_1:expiry",
    "brain:auth-users", "spend:daily-crit", "maint:sentinel-edge:12345", "watchdog:stale", "siti:line",
    ...CRIT_CHANGE_SECTIONS.map((sec) => `change:sentinel-edge:${sec}`),
  ];
  for (const key of offLimits) assert.equal(isSnoozable({ key, level: "warning" }), false, `expected NOT snoozable: ${key}`);
  for (const p of NEVER_SNOOZE_PREFIXES) assert.equal(isSnoozable({ key: `${p}x`, level: "warning" }), false, p);
  for (const k of NEVER_SNOOZE_EXACT) assert.equal(isSnoozable({ key: k, level: "warning" }), false, k);
  for (const key of ["silent:x", "door:naca-mcp", "brain:agent:x", "pkg:edge", "tailnet:new:foo", "hetzner:server:x", "change:sentinel-edge:egress:tor -> X"]) {
    assert.equal(isSnoozable({ key, level: "critical" }), false, `critical must never snooze: ${key}`);
  }
  // and a critical page never picks a snooze even when a note names it
  assert.equal(pickSnooze([note("agent:x")], subj("silent:x", { level: "critical" }), NOW), null);
  assert.equal(pickSnooze([note("host:edge")], subj("change:sentinel-edge:sshd", { host: "edge" }), NOW), null);
});

test("V7 isSnoozable is true for the ops families at level warning", () => {
  for (const key of ["silent:x", "door:naca-mcp", "brain:agent:x", "spend:daily-warn", "tailnet:new:foo", "pkg:edge",
    "change:sentinel-edge:egress:python3 -> SOME-ISP", "change:sentinel-edge:ports", "lane:run_task:edge-cc", "github:event:123", "hetzner:server:x"]) {
    assert.equal(isSnoozable({ key, level: "warning" }), true, `expected snoozable: ${key}`);
  }
  assert.equal(isSnoozable({ key: "silent:x" }), true); // level defaults to warning in page()
});

test("V8 expired or cleared snoozes never match; garbage keys parse to null", () => {
  assert.equal(pickSnooze([note("agent:x", { until: PAST })], subj("silent:x"), NOW), null);
  assert.equal(pickSnooze([note("agent:x", { status: "cleared" })], subj("silent:x"), NOW), null);
  assert.equal(pickSnooze([note("agent:x", { until: "not a date" })], subj("silent:x"), NOW), null);
  assert.equal(pickSnooze([note("agent:x", { until: undefined })], subj("silent:x"), NOW), null);
  assert.equal(pickSnooze([], subj("silent:x"), NOW), null);
  assert.equal(pickSnooze(null, subj("silent:x"), NOW), null);
  assert.equal(pickSnooze([null, {}, { metadata: null }], subj("silent:x"), NOW), null);
  for (const g of ["agent:", "host:", "check:", "check:intrusion-watch", "check:intrusion-watch/", "check:/x", "foo:bar", "", null, undefined, 42, {}]) {
    assert.equal(parseSnoozeKey(g), null, `expected null for ${JSON.stringify(g)}`);
    assert.equal(matchesSnooze(g, subj("silent:x", { host: "x" })), false);
  }
  assert.deepEqual(parseSnoozeKey("agent:forge-coach-agent"), { kind: "agent", name: "forge-coach-agent" });
  assert.deepEqual(parseSnoozeKey("host:bandung-01"), { kind: "host", host: "bandung-01" });
  assert.deepEqual(parseSnoozeKey("check:intrusion-watch/silent:a/b"), { kind: "check", monitor: "intrusion-watch", id: "silent:a/b" });
  // the boundary itself: until === now is already over; one millisecond later is still live
  assert.equal(pickSnooze([note("agent:x", { until: new Date(NOW).toISOString() })], subj("silent:x"), NOW), null);
  assert.ok(pickSnooze([note("agent:x", { until: new Date(NOW + 1).toISOString() })], subj("silent:x"), NOW));
  assert.ok(pickSnooze([note("agent:x")], subj("silent:x"), new Date(NOW)));            // Date or ms both accepted
  assert.ok(pickSnooze([note("agent:y"), note("agent:x")], subj("silent:x"), NOW));      // first matching row wins, others ignored
});

test("V9 matchesSnooze is a pure function of (snoozeKey, subject): same answer regardless of clock", () => {
  const cases = [["agent:a", subj("silent:a")], ["host:h", subj("x:y", { host: "h" })], ["check:intrusion-watch/door:", subj("door:cockpit")], ["agent:a", subj("silent:b")]];
  const before = cases.map(([k, s]) => matchesSnooze(k, s));
  const realNow = Date.now; Date.now = () => 0;
  try { assert.deepEqual(cases.map(([k, s]) => matchesSnooze(k, s)), before); } finally { Date.now = realNow; }
  assert.deepEqual(before, [true, true, true, false]);
});

test("loadActiveSnoozes: builds the agreed PostgREST query with the brain headers", async () => {
  let seen = null;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => [note("agent:x")] }; };
  const rows = await loadActiveSnoozes({ fetchImpl, url: "https://brain.example/", key: "test-key", now: new Date(NOW) });
  assert.equal(rows.length, 1);
  const u = new URL(seen.url);
  assert.equal(u.origin + u.pathname, "https://brain.example/rest/v1/memories");
  assert.equal(u.searchParams.get("select"), "id,content,created_at,metadata");
  assert.equal(u.searchParams.get("category"), "eq.alert_snooze");
  assert.equal(u.searchParams.get("metadata->>status"), "eq.active");
  assert.equal(u.searchParams.get("metadata->>until"), `gt.${new Date(NOW).toISOString()}`);
  assert.equal(u.searchParams.get("archived"), "is.false");
  assert.equal(u.searchParams.get("order"), "created_at.asc");
  assert.equal(u.searchParams.get("limit"), "50");
  assert.equal(seen.init.headers.apikey, "test-key");
  assert.equal(seen.init.headers.Authorization, "Bearer test-key");
});

test("loadActiveSnoozes: throws on failure (caller fails OPEN) and drops rows the server should not have sent", async () => {
  await assert.rejects(loadActiveSnoozes({ fetchImpl: async () => { throw new Error("offline"); }, url: "https://b", key: "k" }), /offline/);
  await assert.rejects(loadActiveSnoozes({ fetchImpl: async () => ({ ok: false, status: 503 }), url: "https://b", key: "k" }), /http 503/);
  await assert.rejects(loadActiveSnoozes({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ message: "nope" }) }), url: "https://b", key: "k" }), /unexpected body/);
  await assert.rejects(loadActiveSnoozes({ fetchImpl: async () => ({ ok: true }), url: "", key: "k" }), /url and key/);
  const rows = await loadActiveSnoozes({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => [
    note("agent:live"), note("agent:expired", { until: PAST }), note("agent:cleared", { status: "cleared" }), note("garbage-key"), { id: "x", metadata: null },
  ] }), url: "https://b", key: "k", now: new Date(NOW) });
  assert.deepEqual(rows.map((r) => r.metadata.match), ["agent:live"]);
});
