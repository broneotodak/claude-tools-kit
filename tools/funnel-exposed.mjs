// funnel-exposed — is this `tailscale funnel status` line a PUBLIC Funnel?
//
// Bug B-05 (Assistant Spine, 26 Nov 2026): intrusion-watch paged CRITICAL "Tailscale Funnel exposed"
// about every 12 h for edge2. The box was fine: newer Tailscale lists a PRIVATE `tailscale serve` site
// in the funnel status output as "https://<host>.ts.net (tailnet only)" (the Nio page). Only a line
// that is NOT marked "(tailnet only)" — a real Funnel prints "(Funnel on)" — is exposed to the internet.
//
// Known limit (logged, not hidden): the sentinel sends only the FIRST line of the status. A second,
// public block behind a tailnet-only first block would not be seen until the sentinel reports every
// "Funnel on" line (follow-up in blueprint P1-04).
export function funnelExposed(line) {
  const s = String(line || "");
  if (!/https?:\/\//.test(s)) return false;
  if (/\(tailnet only\)/i.test(s)) return false;
  return true;
}
