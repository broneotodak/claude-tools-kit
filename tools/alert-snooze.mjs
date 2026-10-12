// alert-snooze.mjs — "stand down on that ONE warning until <date>" for the fleet monitors (v1 · 2026-10-12)
//
// Neo tells Siti to stop paging him about one warning for a while; Siti writes a note (neo-brain `memories`,
// category `alert_snooze`); each monitor reads the active notes once per tick and skips the matching
// NON-security pages. Pure functions, except loadActiveSnoozes (one PostgREST GET, injectable fetch).
//
// Note shape — row.metadata:
//   { scope:'ops', status:'active'|'cleared', match:'<key>', label, until:'<ISO datetime>', reason, by:'neo',
//     chat_jid, created_at, cleared_at, cleared_by }
//
// Match keys — exact, case-sensitive, no wildcards:
//   agent:<name>            matches page key `silent:<name>` or `brain:agent:<name>`
//   host:<box>              matches when the page's host === box
//   check:<monitor>/<id>    matches when the page is from that monitor AND (key === id OR key.startsWith(id))
//
// Never snoozable, whatever a note says: any page at level `critical`, and the security families below
// (logins, sudo, Tailscale SSH, accounts, posture, keys on GitHub/Hetzner, vault, tokens, maintenance digests,
// the watchdogs, Siti's own line, and config changes to the access/persistence surfaces).

/** Key prefixes that a snooze can never silence. */
export const NEVER_SNOOZE_PREFIXES = [
  "login:", "sudo:", "tsssh:", "users:", "posture:", "tailnet:ssh:",
  "github:key:", "github:public:", "hetzner:key:", "vault:", "token:",
  "maint:", "watchdog:", "siti:",
];
/** Exact keys that a snooze can never silence. */
export const NEVER_SNOOZE_EXACT = ["brain:auth-users", "spend:daily-crit"];
/** change:<sentinel>:<section> — the access/persistence surfaces (mirrors CRIT_SECTIONS in intrusion-watch.mjs). */
export const CRIT_CHANGE_SECTIONS = ["authkeys", "sudoers", "preload", "sshd", "suid", "admins", "users"];

/** parseSnoozeKey("agent:x") → {kind:"agent", name} | {kind:"host", host} | {kind:"check", monitor, id} | null */
export function parseSnoozeKey(key) {
  if (typeof key !== "string" || !key) return null;
  if (key.startsWith("agent:")) { const name = key.slice(6); return name ? { kind: "agent", name } : null; }
  if (key.startsWith("host:")) { const host = key.slice(5); return host ? { kind: "host", host } : null; }
  if (key.startsWith("check:")) {
    const rest = key.slice(6), i = rest.indexOf("/");
    if (i <= 0) return null;                       // no monitor, or no slash
    const monitor = rest.slice(0, i), id = rest.slice(i + 1);
    return id ? { kind: "check", monitor, id } : null; // an empty id would prefix-match everything
  }
  return null;
}

/** May this page be snoozed at all? False for critical pages and for every security family. */
export function isSnoozable({ key, level } = {}) {
  if (typeof key !== "string" || !key) return false;
  if (level === "critical") return false;
  if (NEVER_SNOOZE_EXACT.includes(key)) return false;
  if (NEVER_SNOOZE_PREFIXES.some((p) => key.startsWith(p))) return false;
  if (key.startsWith("change:") && CRIT_CHANGE_SECTIONS.includes(key.split(":")[2])) return false;
  return true;
}

/** Pure: does this snooze key name this page? subject = { monitor, key, host }. No time, no I/O. */
export function matchesSnooze(snoozeKey, { monitor, key, host } = {}) {
  const s = parseSnoozeKey(snoozeKey);
  if (!s || typeof key !== "string" || !key) return false;
  if (s.kind === "agent") return key === `silent:${s.name}` || key === `brain:agent:${s.name}`;
  if (s.kind === "host") return !!host && host === s.host;
  if (s.kind === "check") return monitor === s.monitor && (key === s.id || key.startsWith(s.id));
  return false;
}

/**
 * The first snooze row that is active, not yet expired at `now`, and names this page — or null.
 * Refuses by construction when the page itself is not snoozable (security family / critical).
 */
export function pickSnooze(snoozes, subject, now = Date.now()) {
  if (!isSnoozable(subject)) return null;
  const t = now instanceof Date ? now.getTime() : Number(now);
  for (const s of snoozes || []) {
    const m = s?.metadata || {};
    if (m.status !== "active") continue;
    const until = new Date(m.until || 0).getTime();
    if (!(until > t)) continue;                     // expired, or no parseable date → not a live snooze
    if (matchesSnooze(m.match, subject)) return s;
  }
  return null;
}

/**
 * Read the active notes from neo-brain (PostgREST, same headers the monitors already use).
 * Returns an array; THROWS on any failure so the caller can log one line and run with no snoozes (fail open).
 */
export async function loadActiveSnoozes({ fetchImpl = globalThis.fetch, url, key, now = new Date(), limit = 50 } = {}) {
  if (!url || !key) throw new Error("url and key required");
  const iso = (now instanceof Date ? now : new Date(now)).toISOString();
  const q = `${String(url).replace(/\/$/, "")}/rest/v1/memories?select=id,content,created_at,metadata` +
    `&category=eq.alert_snooze&metadata->>status=eq.active&metadata->>until=gt.${encodeURIComponent(iso)}` +
    `&archived=is.false&order=created_at.asc&limit=${Number(limit) || 50}`;
  const r = await fetchImpl(q, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r || !r.ok) throw new Error(`http ${r?.status ?? "?"}`);
  const rows = await r.json();
  if (!Array.isArray(rows)) throw new Error("unexpected body");
  const t = new Date(iso).getTime();
  // The server already filtered; re-check so a lenient server or a malformed note can never widen the mute.
  return rows.filter((s) => s?.metadata?.status === "active" && new Date(s.metadata.until || 0).getTime() > t && parseSnoozeKey(s.metadata.match));
}
