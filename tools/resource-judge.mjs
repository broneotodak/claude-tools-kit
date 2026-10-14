// resource-judge.mjs — "is this box running hot / full / out of memory?" for the fleet judge (v1 · 14 Oct 2026)
//
// The sentinel (v1.5) puts a volatile `resources` block in every heartbeat: load, RAM, swap, disk, temperatures,
// GPU, the top memory users, and the sandbox egress drop counter. intrusion-watch.mjs hands each fresh report to
// evaluateResources() and pages whatever comes back. Pure functions, no I/O — the streak counters live in the
// judge's own state and are passed in and out, so this file is trivially testable.
//
// Rules of the road (Neo, 13 Oct 2026):
//  • nothing watched CPU/RAM/disk/temperature before — this is the early gate for the Studio hub (terminals, sandbox)
//  • noisy-alert guard: a metric must be bad for N consecutive reports (10 min each) before it pages, except disk and
//    the sandbox egress counter, which are immediate
//  • one page per signal per day (the caller uses cooldownH = 24); never during a maintenance window (the caller skips)
//  • plain English — Neo is a CEO, not an engineer
//  • lab-egress is security: level "critical" (never snoozable) — the sandbox user tried to reach a private network

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

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const gb = (mb) => (mb >= 10240 ? `${Math.round(mb / 1024)} GB` : `${(mb / 1024).toFixed(1)} GB`);
const topText = (res) => (res.top?.length ? `Biggest memory users right now: ${res.top.map((t) => `${t.comm} ${gb(t.rss_mb)}`).join(", ")}.` : "");

function bump(streaks, metric, bad) {
  streaks[metric] = bad ? (streaks[metric] || 0) + 1 : 0;
  return streaks[metric];
}

/**
 * evaluateResources(res, { host, cfg, streaks, prevDrops })
 *   res       the heartbeat's meta.resources (may be undefined for a sentinel older than v1.5 → no signals)
 *   streaks   {metric: consecutiveBadReports}, mutated and returned
 *   prevDrops the last seen `lab_drops` for this box (number | undefined)
 * returns { signals: [{key, level, emoji, signal, body, cooldownH}], streaks, drops }
 */
export function evaluateResources(res, { host = "?", cfg = {}, streaks = {}, prevDrops } = {}) {
  const c = { ...DEFAULTS, ...cfg };
  const out = { signals: [], streaks, drops: undefined };
  if (!res || typeof res !== "object") return out;
  const skip = (m) => (c.ignore || []).includes(m);
  const add = (key, level, signal, body) => out.signals.push({ key, level, emoji: level === "critical" ? "🚨" : "📈", signal, body, cooldownH: 24 });

  // ── load: 5-minute average per core ──
  const load5 = num(res.load?.[1]), ncpu = num(res.ncpu);
  if (!skip("load") && load5 !== null && ncpu) {
    const per = load5 / ncpu;
    const n = bump(streaks, "load", per >= c.load_per_core_warn);
    if (n >= c.load_streak) add(`resources:${host}:load`, "warning", `${host} is overloaded`, `Load ${load5.toFixed(1)} on ${ncpu} cores (${per.toFixed(1)} per core) for ${n * 10}+ minutes.\n${topText(res)}`.trim());
  }

  // ── memory: share still available ──
  const total = num(res.mem?.total_mb), avail = num(res.mem?.avail_mb);
  if (!skip("mem") && total && avail !== null) {
    const pct = (100 * avail) / total;
    const crit = pct < c.mem_avail_crit_pct, warn = pct < c.mem_avail_warn_pct;
    const n = bump(streaks, "mem", warn);
    if (n >= c.mem_streak) add(`resources:${host}:mem`, crit ? "critical" : "warning", `${host} is running out of memory`, `Only ${gb(avail)} free of ${gb(total)} (${pct.toFixed(0)}%) for ${n * 10}+ minutes.\n${topText(res)}`.trim());
  }

  // ── swap ──
  const st = num(res.mem?.swap_total_mb), sf = num(res.mem?.swap_free_mb);
  if (!skip("swap") && st && sf !== null) {
    const used = (100 * (st - sf)) / st;
    const n = bump(streaks, "swap", used >= c.swap_used_warn_pct);
    if (n >= c.swap_streak) add(`resources:${host}:swap`, "warning", `${host} is leaning on swap`, `${used.toFixed(0)}% of swap in use for ${n * 10}+ minutes — memory is tight and everything slows down.\n${topText(res)}`.trim());
  }

  // ── disk: immediate ──
  if (!skip("disk")) {
    for (const [mp, d] of Object.entries(res.disk || {})) {
      const p = num(d.used_pct);
      if (p === null) continue;
      if (p >= c.disk_warn_pct) add(`resources:${host}:disk:${mp}`, p >= c.disk_crit_pct ? "critical" : "warning", `${host} disk ${p >= c.disk_crit_pct ? "almost full" : "filling up"}`, `${mp} is ${p.toFixed(0)}% full — ${d.free_gb} GB left of ${d.total_gb} GB.`);
    }
  }

  // ── temperature: hottest CPU/board sensor ──
  const hottest = (res.temps || []).reduce((a, t) => (num(t.c) !== null && (!a || t.c > a.c) ? t : a), null);
  if (!skip("temp") && hottest) {
    const n = bump(streaks, "temp", hottest.c >= c.temp_warn_c);
    if (n >= c.temp_streak) add(`resources:${host}:temp`, hottest.c >= c.temp_crit_c ? "critical" : "warning", `${host} is running hot`, `${hottest.name} at ${hottest.c.toFixed(0)}°C (warning line ${c.temp_warn_c}°C) for ${n * 10}+ minutes.`);
  }

  // ── GPU temperature ──
  const gpuT = (res.gpu || []).reduce((a, g) => (num(g.temp_c) !== null && (a === null || g.temp_c > a) ? g.temp_c : a), null);
  if (!skip("gpu") && gpuT !== null) {
    const n = bump(streaks, "gpu", gpuT >= c.gpu_temp_warn_c);
    if (n >= c.temp_streak) add(`resources:${host}:gpu`, gpuT >= c.gpu_temp_crit_c ? "critical" : "warning", `${host} graphics chip is running hot`, `GPU at ${gpuT.toFixed(0)}°C (warning line ${c.gpu_temp_warn_c}°C) for ${n * 10}+ minutes.`);
  }

  // ── sandbox egress wall: any new dropped packet is the sandbox user trying to reach a private network ──
  const drops = num(res.lab_drops);
  out.drops = drops === null ? undefined : drops;
  if (drops !== null && num(prevDrops) !== null && drops > prevDrops) {
    add(`lab-egress:${host}`, "critical", `sandbox tried to reach a private network on ${host}`, `The sandbox user's egress wall dropped ${drops - prevDrops} new packet(s) (total ${drops}). Something running in the sandbox tried to reach the tailnet, the LAN or a local service. Check what is running in the sandbox NOW.`);
  }
  return out;
}

/** One short line for the 08:45 security line: "tr-office load 0.0/24 · RAM 77% free · disk 25% · 37°C". */
export function resourceLine(host, res) {
  if (!res || typeof res !== "object") return `${host} n/a`;
  const bits = [];
  const l5 = num(res.load?.[1]);
  if (l5 !== null) bits.push(`load ${l5.toFixed(1)}/${res.ncpu ?? "?"}`);
  const total = num(res.mem?.total_mb), avail = num(res.mem?.avail_mb);
  if (total && avail !== null) bits.push(`RAM ${Math.round((100 * avail) / total)}% free`);
  const root = res.disk?.["/"] ?? Object.values(res.disk || {})[0];
  if (root && num(root.used_pct) !== null) bits.push(`disk ${Math.round(root.used_pct)}%`);
  const t = Math.max(...[...(res.temps || []).map((x) => x.c), ...(res.gpu || []).map((g) => g.temp_c)].filter((v) => num(v) !== null), -Infinity);
  if (Number.isFinite(t)) bits.push(`${Math.round(t)}°C`);
  return `${host} ${bits.join(" · ") || "n/a"}`;
}
