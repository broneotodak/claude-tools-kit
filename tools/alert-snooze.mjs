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
//
// One deliberate exception — "this box is down on purpose": a `host:<box>` note is Neo's explicit statement about
// that box, so it may ALSO mute the SILENCE family for that box (`silent:<name>` / `brain:agent:<name>` raised with
// host === box) even when the monitor raises it at level critical (the judge pages a silent sentinel critical).
// Naming the quiet watcher itself is just as explicit (v2.1, 13 Oct 2026 — Neo: "snooze the sentinel watch on
// bandung" → Siti writes `agent:sentinel-bandung`, the same key the daily check-up uses for that finding), so an
// `agent:<name>` note whose name is EXACTLY the silent one may mute that silence page at critical too.
// Nothing else widens: logins, sudo, Tailscale SSH, accounts, posture, crit config changes, keys, vault, tokens on
// that box still page, and a `check:` note (a prefix over many pages) never reaches a critical page.

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
/** The silence family ("nothing heard from X"). A host:<box> note may mute these for that box even at critical. */
export const SILENCE_PREFIXES = ["silent:", "brain:agent:"];

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

/**
 * May a host:<box> note mute this page even though it is critical? Only the silence family, and only when the
 * page carries a host (the box the note must name — matchesSnooze checks host === box). `level` is deliberately
 * not consulted: that is the whole point. Everything else keeps the isSnoozable rule.
 */
export function hostDownSnoozable({ key, host, level } = {}) { // eslint-disable-line no-unused-vars
  if (typeof key !== "string" || !key || typeof host !== "string" || !host) return false;
  return SILENCE_PREFIXES.some((p) => key.startsWith(p));
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
 * Refuses by construction when the page itself is not snoozable (security family / critical) — except that a
 * host:<box> note, or an agent:<name> note naming exactly the quiet watcher, may reach the silence family for its
 * box at any level (hostDownSnoozable); a check: note never can. The subject MUST carry `level`: without it a
 * critical page reads as plain and the exception is not applied — callers pass { monitor, key, host, level }.
 */
export function pickSnooze(snoozes, subject, now = Date.now()) {
  const plain = isSnoozable(subject);                        // any note kind may mute a non-security warning
  const hostDown = !plain && hostDownSnoozable(subject);     // only a host:<box> note may mute the silence family at critical
  if (!plain && !hostDown) return null;
  const t = now instanceof Date ? now.getTime() : Number(now);
  for (const s of snoozes || []) {
    const m = s?.metadata || {};
    if (m.status !== "active") continue;
    const until = new Date(m.until || 0).getTime();
    if (!(until > t)) continue;                     // expired, or no parseable date → not a live snooze
    if (hostDown) { const k = parseSnoozeKey(m.match)?.kind; if (k !== "host" && k !== "agent") continue; } // check: never reaches a critical page; agent: only by exact name (matchesSnooze)
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
