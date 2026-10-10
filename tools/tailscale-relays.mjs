// Tailscale relay check for intrusion-watch's "new outbound destination" page.
//
// WHY: on 9 Oct 2026 a Tailscale reconnect made tr-office talk to relay servers hosted
// by NetActuate (a provider not on the egress owner list). Siti paged Neo, then two
// hands jobs ran on Opus ($1.58) to conclude "it's Tailscale". The answer is public:
// Tailscale publishes every relay (DERP) address. Looking it up costs nothing.
//
// Narrow on purpose: we trust the ADDRESS being in Tailscale's own published map, not
// the hosting company, so an unrelated NetActuate address would still page.
// Fail-open: if the map cannot be fetched, the caller pages exactly as before.

import { lookup } from "node:dns/promises";

export const DERP_MAP_URL = "https://login.tailscale.com/derpmap/default";
// The map lists relays only; the control plane (and relays whose address is not in the map) are
// reachable by name. Resolving the names adds their current addresses.
const EXTRA_HOSTS = ["controlplane.tailscale.com", "login.tailscale.com"];

/** All relay addresses (v4 + v6) in a Tailscale DERP map object. */
export function relayAddresses(map) {
  const out = new Set();
  for (const region of Object.values(map?.Regions || {})) {
    for (const n of region?.Nodes || []) {
      if (n.IPv4) out.add(n.IPv4);
      if (n.IPv6) out.add(n.IPv6.toLowerCase());
    }
  }
  return out;
}

/** Hostnames in a DERP map (every relay node) plus the control plane. */
export function relayHostnames(map) {
  const out = new Set(EXTRA_HOSTS);
  for (const region of Object.values(map?.Regions || {})) for (const n of region?.Nodes || []) if (n.HostName) out.add(n.HostName);
  return [...out];
}

/** How many of these addresses are known Tailscale servers → { total, known }. */
export function relayShare(ips, relays) {
  const list = [...new Set((ips || []).filter(Boolean).map((x) => String(x).toLowerCase()))];
  return { total: list.length, known: list.filter((ip) => relays.has(ip)).length };
}

/** True only when there is at least one address and EVERY one is a known Tailscale relay. */
export function allTailscaleRelays(ips, relays) {
  const list = (ips || []).filter(Boolean).map((x) => String(x).toLowerCase());
  return list.length > 0 && relays.size > 0 && list.every((ip) => relays.has(ip));
}

/** Fetch the public map and resolve the relay names; returns a Set, or an empty Set on any failure (fail-open). */
export async function fetchRelayAddresses(fetchFn = fetch, lookupFn = lookup) {
  try {
    const r = await fetchFn(DERP_MAP_URL, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return new Set();
    const map = await r.json();
    const out = relayAddresses(map);
    await Promise.all(relayHostnames(map).map(async (h) => {
      try { for (const a of await lookupFn(h, { all: true })) out.add(String(a.address).toLowerCase()); } catch { /* one name failing is fine */ }
    }));
    return out;
  } catch {
    return new Set();
  }
}
