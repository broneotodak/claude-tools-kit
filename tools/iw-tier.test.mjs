import test from "node:test";
import assert from "node:assert/strict";
import { tierFor, wireLabel } from "./iw-tier.mjs";

test("maintenance-window notices are p2 (hub only), even though they are warnings", () => {
  assert.equal(tierFor({ key: "maint:sentinel-edge2:2026-11-25T03:00:02+00:00", level: "warning" }), "p2");
});

test("critical is always p0 — no family can quiet it", () => {
  for (const key of ["resources:edge:load", "brain:agent:x", "silent:sentinel-bandung", "lane:run_task:edge-cc", "posture:edge:funnel", "vault:never:abc"]) {
    assert.equal(tierFor({ key, level: "critical" }), "p0", key);
  }
});

test("resource / silent / unregistered / lane warnings are p1 (the daily brief)", () => {
  for (const key of ["resources:edge:disk:/", "resources:neo-mbp:disk:/", "brain:agent:foo", "lane:run_dev_task:edge-cc", "silent:sentinel-nas"]) {
    assert.equal(tierFor({ key, level: "warning" }), "p1", key);
  }
});

test("security families stay p0, and an unknown family fails LOUD", () => {
  for (const key of ["vault:unknown:x", "vault:bulk:x", "change:edge:egress:1.2.3.4", "pkg:bandung", "users:foo", "tailnet:new:abc", "sudo:edge:x", "login:1.2.3.4:abcd", "github:key:x", "hetzner:server:1", "token:github:x", "door:naca", "tsssh:edge", "something:new"]) {
    assert.equal(tierFor({ key, level: "warning" }), "p0", key);
  }
  assert.equal(tierFor({}), "p0");
});

test("wireLabel: priority + source + key + box; IW_TIERING=off sends nothing extra", () => {
  const w = wireLabel({ key: "maint:edge:1", level: "warning", box: "edge" }, {});
  assert.deepEqual(w, { priority: "p2", source: "intrusion-watch", key: "maint:edge:1", box: "edge" });
  assert.deepEqual(wireLabel({ key: "maint:edge:1" }, { IW_TIERING: "off" }), {});
  assert.equal(wireLabel({ key: "x", tier: "p1" }, {}).priority, "p1");
});
