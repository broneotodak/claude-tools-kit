// resource-judge.mjs — "is this box running hot / full / out of memory?" for the fleet judge (v1.1 · 14 Oct 2026)
//
// The sentinel (v1.5) puts a volatile `resources` block in every heartbeat: load, RAM, swap, disk, temperatures,
// GPU, the top memory users, and the sandbox egress drop counter. intrusion-watch.mjs hands each fresh report to
// evaluateResources() and pages whatever comes back. Pure functions, no I/O — the streak counters live in the
// judge's own state and are passed in and out, so this file is trivially testable.
//
// Rules of the road (Neo, 13 Oct 2026):
//  • nothing watched CPU/RAM/disk/temperature before — this is the early gate for the Studio hub (terminals, sandbox)
//  • noisy-alert guard: a metric must be bad for N consecutive reports (10 min apart) before it pages, except disk and
//    the sandbox egress counter, which are immediate; a report with NO reading for a metric resets its streak
//  • one page per signal per day (warnings: cooldown 24 h) — but a CRITICAL page has its own key (":crit") and a short
//    cooldown, so a warning that fired earlier can never swallow the critical that follows (review finding, 14 Oct)
//  • plain English — Neo is a CEO, not an engineer
//  • lab-egress is security: level "critical" (never snoozable) — the sandbox user tried to reach a private network
//  • ROBUST BY CONSTRUCTION: the judge loops over every box; a malformed `resources` block (or a bad per-box config)
//    must never throw — it yields fewer signals, never a crash (review finding #1, 14 Oct)

/** Default thresholds. A box can override any of them via agent_registry sentinel-<box>.meta.resources_cfg. */
export const DEFAULTS = {
  load_per_core_warn: 1.5, load_streak: 3,
  mem_avail_warn_pct: 10, mem_avail_crit_pct: 5, mem_streak: 3,
  swap_used_warn_pct: 50, swap_streak: 3,
  disk_warn_pct: 85, disk_crit_pct: 93,
  temp_warn_c: 85, temp_crit_c: 95, temp_streak: 2,
  gpu_temp_warn_c: 83, gpu_temp_crit_c: 92,
  ignore: [],            // metric names to skip on this box, e.g. ["load"] for a laptop
};

const COOLDOWN_WARN_H = 24, COOLDOWN_CRIT_H = 3, COOLDOWN_EGRESS_H = 1;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const gb = (mb) => (mb >= 10240 ? `${Math.round(mb / 1024)} GB` : `${(mb / 1024).toFixed(1)} GB`);

/** Merge a per-box config over DEFAULTS, ignoring anything of the wrong type (null, strings, bad `ignore`). */
export function sanitizeCfg(cfg) {
  const c = { ...DEFAULTS, ignore: [] };
  for (const [k, v] of Object.entries(obj(cfg))) {
    if (k === "ignore") c.ignore = arr(v).filter((x) => typeof x === "string");
    else if (k in DEFAULTS && num(v) !== null) c[k] = v;
  }
  return c;
}

function topText(res) {
  const t = arr(res.top).filter((x) => x && typeof x === "object" && num(x.rss_mb) !== null && typeof x.comm === "string");
  return t.length ? `Biggest memory users right now: ${t.map((x) => `${x.comm} ${gb(x.rss_mb)}`).join(", ")}.` : "";
}

function bump(streaks, metric, bad) {          // bad === null → no reading this report → the streak resets
  streaks[metric] = bad === true ? (streaks[metric] || 0) + 1 : 0;
  return streaks[metric];
}
const mins = (n) => `${Math.max(n - 1, 1) * 10}+`;   // n consecutive reports, 10 min apart ⇒ at least (n-1)*10 minutes

/**
 * evaluateResources(res, { host, cfg, streaks, prevDrops })
 *   res       the heartbeat's meta.resources (may be undefined for a sentinel older than v1.5 → no signals)
 *   streaks   {metric: consecutiveBadReports}, mutated and returned
 *   prevDrops the last seen `lab_drops` for this box (number | undefined)
 * returns { signals: [{key, level, emoji, signal, body, cooldownH}], streaks, drops }
 *   drops = this report's `lab_drops` or undefined when the report has none — the caller stores it UNCONDITIONALLY, so
 *           a gap in readings clears the baseline instead of leaving a stale high one behind (review finding #4)
 */
export function evaluateResources(res, { host = "?", cfg = {}, streaks = {}, prevDrops } = {}) {
  const c = sanitizeCfg(cfg);
  const out = { signals: [], streaks, drops: undefined };
  if (!res || typeof res !== "object" || Array.isArray(res)) return out;
  const skip = (m) => c.ignore.includes(m);
  const add = (base, level, signal, body, { cooldownH } = {}) => out.signals.push({
    key: level === "critical" ? `${base}:crit` : base, level, emoji: level === "critical" ? "🚨" : "📈", signal, body,
    cooldownH: cooldownH ?? (level === "critical" ? COOLDOWN_CRIT_H : COOLDOWN_WARN_H),
  });

  // ── load: 5-minute average per core ──
  const load = arr(res.load), load5 = num(load[1]), ncpu = num(res.ncpu);
  if (!skip("load")) {
    const n = bump(streaks, "load", load5 !== null && ncpu ? load5 / ncpu >= c.load_per_core_warn : null);
    if (n >= c.load_streak) add(`resources:${host}:load`, "warning", `${host} is overloaded`, `Load ${load5.toFixed(1)} on ${ncpu} cores (${(load5 / ncpu).toFixed(1)} per core) for ${mins(n)} minutes.\n${topText(res)}`.trim());
  }

  // ── memory: share still available ──
  const mem = obj(res.mem), total = num(mem.total_mb), avail = num(mem.avail_mb);
  if (!skip("mem")) {
    const have = total && avail !== null;
    const pct = have ? (100 * avail) / total : null;
    const n = bump(streaks, "mem", have ? pct < c.mem_avail_warn_pct : null);
    if (n >= c.mem_streak) add(`resources:${host}:mem`, pct < c.mem_avail_crit_pct ? "critical" : "warning", `${host} is running out of memory`, `Only ${gb(avail)} free of ${gb(total)} (${pct.toFixed(0)}%) for ${mins(n)} minutes.\n${topText(res)}`.trim());
  }

  // ── swap ──
  const st = num(mem.swap_total_mb), sf = num(mem.swap_free_mb);
  if (!skip("swap")) {
    const have = st && sf !== null;
    const used = have ? (100 * (st - sf)) / st : null;
    const n = bump(streaks, "swap", have ? used >= c.swap_used_warn_pct : null);
    if (n >= c.swap_streak) add(`resources:${host}:swap`, "warning", `${host} is leaning on swap`, `${used.toFixed(0)}% of swap in use for ${mins(n)} minutes — memory is tight and everything slows down.\n${topText(res)}`.trim());
  }

  // ── disk: immediate, per mount ──
  if (!skip("disk")) {
    for (const [mp, d0] of Object.entries(obj(res.disk))) {
      const d = obj(d0), p = num(d.used_pct);
      if (p === null || p < c.disk_warn_pct) continue;
      const crit = p >= c.disk_crit_pct;
      add(`resources:${host}:disk:${mp}`, crit ? "critical" : "warning", `${host} disk ${crit ? "almost full" : "filling up"}`, `${mp} is ${p.toFixed(0)}% full — ${num(d.free_gb) ?? "?"} GB left of ${num(d.total_gb) ?? "?"} GB.`);
    }
  }

  // ── temperature: hottest CPU/board sensor ──
  const hottest = arr(res.temps).reduce((a, t) => (t && typeof t === "object" && num(t.c) !== null && (!a || t.c > a.c) ? t : a), null);
  if (!skip("temp")) {
    const n = bump(streaks, "temp", hottest ? hottest.c >= c.temp_warn_c : null);
    if (n >= c.temp_streak) add(`resources:${host}:temp`, hottest.c >= c.temp_crit_c ? "critical" : "warning", `${host} is running hot`, `${String(hottest.name ?? "CPU").slice(0, 28)} at ${hottest.c.toFixed(0)}°C (warning line ${c.temp_warn_c}°C) for ${mins(n)} minutes.`);
  }

  // ── GPU temperature ──
  const gpuT = arr(res.gpu).reduce((a, g) => (g && typeof g === "object" && num(g.temp_c) !== null && (a === null || g.temp_c > a) ? g.temp_c : a), null);
  if (!skip("gpu")) {
    const n = bump(streaks, "gpu", gpuT !== null ? gpuT >= c.gpu_temp_warn_c : null);
    if (n >= c.temp_streak) add(`resources:${host}:gpu`, gpuT >= c.gpu_temp_crit_c ? "critical" : "warning", `${host} graphics chip is running hot`, `GPU at ${gpuT.toFixed(0)}°C (warning line ${c.gpu_temp_warn_c}°C) for ${mins(n)} minutes.`);
  }

  // ── sandbox egress wall: any new dropped packet is the sandbox user trying to reach a private network ──
  const drops = num(res.lab_drops);
  out.drops = drops === null ? undefined : drops;
  if (drops !== null && num(prevDrops) !== null && drops > prevDrops) {
    add(`lab-egress:${host}`, "critical", `sandbox tried to reach a private network on ${host}`, `The sandbox user's egress wall dropped ${drops - prevDrops} new packet(s) (total ${drops}). Something running in the sandbox tried to reach the tailnet, the LAN or a local service. Check what is running in the sandbox NOW.`, { cooldownH: COOLDOWN_EGRESS_H });
    out.signals[out.signals.length - 1].key = `lab-egress:${host}`;   // one key, short cooldown: a second burst within a day must page again
  }
  return out;
}

/** One short line for the 08:45 security line: "tr-office load 0.0/24 · RAM 77% free · disk 25% · 37°C". Never throws. */
export function resourceLine(host, res) {
  try {
    if (!res || typeof res !== "object" || Array.isArray(res)) return `${host} n/a`;
    const bits = [];
    const l5 = num(arr(res.load)[1]);
    if (l5 !== null) bits.push(`load ${l5.toFixed(1)}/${num(res.ncpu) ?? "?"}`);
    const mem = obj(res.mem), total = num(mem.total_mb), avail = num(mem.avail_mb);
    if (total && avail !== null) bits.push(`RAM ${Math.round((100 * avail) / total)}% free`);
    const disks = obj(res.disk), root = obj(disks["/"] ?? Object.values(disks)[0]);
    if (num(root.used_pct) !== null) bits.push(`disk ${Math.round(root.used_pct)}%`);
    const ts = [...arr(res.temps).map((x) => num(obj(x).c)), ...arr(res.gpu).map((g) => num(obj(g).temp_c))].filter((v) => v !== null);
    if (ts.length) bits.push(`${Math.round(Math.max(...ts))}°C`);
    return `${host} ${bits.join(" · ") || "n/a"}`;
  } catch {
    return `${host} n/a`;
  }
}
