// iw-tier — which tier does an intrusion-watch page belong to? (Assistant Spine P1-04, 26 Nov 2026)
//
// p0 = tell Neo's phone now (security + anything critical)
// p1 = matters, but belongs in the daily brief (resource warnings, silent/unregistered agents, lane stalls)
// p2 = hub only, never the phone (maintenance-window notices)
//
// Data (14 days to 26 Nov): maint 49 · resources 43 · vault 30 · posture 20 · change 19 · brain 14 · pkg 6 · users 5 · tailnet 1.
// Rules: critical is ALWAYS p0; every security family not named below defaults to p0 (fail safe: an unknown
// page is louder, never quieter). Labels only travel on the wire; whether p2 actually stays off the phone is
// decided by siti-ingest's NOTIFY_HONOUR_P2 flag (default off).

const P1_FAMILIES = new Set(["resources", "brain", "lane", "silent"]);

export function tierFor({ key = "", level = "warning" } = {}) {
  const fam = String(key).split(":")[0];
  if (fam === "maint") return "p2";
  if (level === "critical") return "p0";
  if (P1_FAMILIES.has(fam)) return "p1";
  return "p0";
}

/** Extra fields for siti-ingest /send. Empty when tiering is off (IW_TIERING=off) → the message goes out as before. */
export function wireLabel({ source, key, level, box, tier }, env = process.env) {
  if (String(env.IW_TIERING || "").toLowerCase() === "off") return {};
  const priority = tier || tierFor({ key, level });
  const out = { priority, source: String(source || "intrusion-watch").slice(0, 60) };
  if (key) out.key = String(key).slice(0, 120);
  if (box) out.box = String(box).slice(0, 40);
  return out;
}
