import test from "node:test";
import assert from "node:assert/strict";
import { relayAddresses, allTailscaleRelays, fetchRelayAddresses, relayHostnames, relayShare } from "../tools/tailscale-relays.mjs";

const map = { Regions: { 1: { Nodes: [{ HostName: "derp1.tailscale.com", IPv4: "172.237.72.79", IPv6: "2606:B740:1:20::102" }, { IPv4: "1.2.3.4" }] }, 2: { Nodes: [] } } };

test("relayAddresses collects v4 and lower-cased v6", () => {
  const s = relayAddresses(map);
  assert.ok(s.has("172.237.72.79") && s.has("1.2.3.4") && s.has("2606:b740:1:20::102"));
  assert.equal(relayAddresses({}).size, 0);
  assert.equal(relayAddresses(null).size, 0);
});

test("allTailscaleRelays: every address must be a relay", () => {
  const s = relayAddresses(map);
  assert.equal(allTailscaleRelays(["172.237.72.79", "2606:B740:1:20::102"], s), true);
  assert.equal(allTailscaleRelays(["172.237.72.79", "9.9.9.9"], s), false); // one stranger → still pages
  assert.equal(allTailscaleRelays([], s), false);                            // nothing to compare → still pages
  assert.equal(allTailscaleRelays(["172.237.72.79"], new Set()), false);     // empty map → still pages
});

test("fetchRelayAddresses fails open to an empty set", async () => {
  assert.equal((await fetchRelayAddresses(async () => { throw new Error("offline"); })).size, 0);
  assert.equal((await fetchRelayAddresses(async () => ({ ok: false }))).size, 0);
  const noDns = async () => { throw new Error("no dns"); };
  assert.equal((await fetchRelayAddresses(async () => ({ ok: true, json: async () => map }), noDns)).size, 3);
});

test("relayHostnames includes the control plane and every relay name", () => {
  const h = relayHostnames(map);
  assert.ok(h.includes("controlplane.tailscale.com") && h.includes("derp1.tailscale.com"));
});

test("fetchRelayAddresses adds resolved names (control plane) and survives a failing name", async () => {
  const lookupFn = async (h) => { if (h === "controlplane.tailscale.com") return [{ address: "2606:B740:49::114" }]; throw new Error("nxdomain"); };
  const s = await fetchRelayAddresses(async () => ({ ok: true, json: async () => map }), lookupFn);
  assert.ok(s.has("2606:b740:49::114") && s.has("172.237.72.79"));
});

test("relayShare counts known vs total (the 9 Oct alert: 2 of 3 known)", () => {
  const s = new Set(["172.237.72.79", "2606:b740:49::114"]);
  assert.deepEqual(relayShare(["172.237.72.79", "2606:b740:1:20::102", "2606:B740:49::114", "172.237.72.79"], s), { total: 3, known: 2 });
});
