import { test } from "node:test";
import assert from "node:assert/strict";
import { funnelExposed } from "./funnel-exposed.mjs";

test("a real public Funnel is exposed (the intruder's trick stays loud)", () => {
  assert.equal(funnelExposed("https://edgexpert-f450.tail76a85b.ts.net (Funnel on)"), true);
  assert.equal(funnelExposed("https://tr-home.tail1234.ts.net:8443 (Funnel on)"), true);
  assert.equal(funnelExposed("http://host.ts.net (Funnel on)"), true);
});

test("a private serve site (tailnet only) is NOT a Funnel — the 20x false alarm on edge2", () => {
  assert.equal(funnelExposed("https://edgexpert-f450.tail76a85b.ts.net (tailnet only)"), false);
  assert.equal(funnelExposed("https://x.ts.net (Tailnet Only)"), false);
});

test("no site / no config / unknown → not exposed", () => {
  assert.equal(funnelExposed("No serve config"), false);
  assert.equal(funnelExposed("?"), false);
  assert.equal(funnelExposed(""), false);
  assert.equal(funnelExposed(undefined), false);
});
