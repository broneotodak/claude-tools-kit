#!/usr/bin/env python3
"""
token-budget-watch — month-to-date Claude token spend for this Mac, with an early warning.

Why it exists: the monthly allowance is invisible until you cross it. In September 2026
Neo crossed it around the 18th at roughly 322M billable tokens, after which every message
was billed as overage. This reports the running total so the line is visible in advance.

Reads Claude Code session logs only (~/.claude/projects/**/*.jsonl). No network, no API key.

  billable  = input + output + cache_creation   (the tokens charged at full rate)
  re-read   = cache_read                        (charged far cheaper, but it is the volume
                                                 that explodes when sessions stay open)

Usage:
  python3 token-budget-watch.py              # report + macOS notification if over a threshold
  python3 token-budget-watch.py --quiet      # only speak up when a threshold is crossed
  python3 token-budget-watch.py --budget 300 # override the monthly budget, in millions
  python3 token-budget-watch.py --push       # also send the Mac's meters to neo-brain (below)
  python3 token-budget-watch.py --evening    # 23:00 check: name every session open > 12 h

--push (NACA audit 2026-09-23, "one money line a day"): the 08:30 WhatsApp money line is
built on EdgeXpert, which cannot see this Mac. So the Mac reports three meters into
neo-brain `creative_providers` (rows claude-plan, codex, higgsfield-mac) plus one
`creative_provider_checks` history row each:
  claude-plan    month-to-date billable tokens vs the practical allowance, stale sessions
  codex          Codex tokens yesterday (8am-8am MYT) and month to date (~/.codex/sessions)
  higgsfield-mac credits left in the Mac-only Higgsfield workspace (software@todak.com)

--evening: close-sessions-nightly. Session AGE is the cost driver (Rules.md 3a), so at 23:00
this names each Claude session that has been open more than 12 hours and was active in the
last 3 hours, with its task from ~/.claude/session-focus. One macOS notification, silent
when there is nothing to close. It never closes anything itself.
"""
import json, glob, os, sys, subprocess
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.expanduser("~/.claude/projects")
STATE = os.path.expanduser("~/.claude/token-budget-state.json")

# Empirical, not published by Anthropic: ~322M billable was the month-to-date total on
# 18 Sep 2026, the day overage charges began. Treat as the practical ceiling.
DEFAULT_BUDGET_M = 300.0
WARN_AT = [(1.00, "OVER"), (0.80, "80%"), (0.60, "60%")]
STALE_SESSION_HOURS = 24


def human(n):
    if n >= 1e9:
        return f"{n/1e9:.2f}B"
    if n >= 1e6:
        return f"{n/1e6:.0f}M"
    if n >= 1e3:
        return f"{n/1e3:.0f}k"
    return str(n)


def collect(month_prefix):
    """Returns (billable, reread, per_day, open_sessions) for the given YYYY-MM."""
    billable = reread = 0
    per_day = defaultdict(int)
    sessions = {}
    for f in glob.glob(ROOT + "/**/*.jsonl", recursive=True):
        first = last = None
        sb = 0
        try:
            fh = open(f, encoding="utf-8", errors="ignore")
        except OSError:
            continue
        with fh:
            for line in fh:
                if '"usage"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                ts = d.get("timestamp") or ""
                if not ts.startswith(month_prefix):
                    continue
                u = (d.get("message") or {}).get("usage") or {}
                if not u:
                    continue
                b = ((u.get("input_tokens") or 0)
                     + (u.get("output_tokens") or 0)
                     + (u.get("cache_creation_input_tokens") or 0))
                billable += b
                sb += b
                reread += u.get("cache_read_input_tokens") or 0
                per_day[ts[:10]] += b
                first = first or ts
                last = ts
        if first and sb:
            sessions[os.path.basename(f)[:-6]] = (first, last, sb)
    return billable, reread, per_day, sessions


def stale(sessions):
    """Sessions whose first and last message are more than a day apart — the expensive shape."""
    out = []
    for sid, (first, last, sb) in sessions.items():
        try:
            hrs = (datetime.fromisoformat(last.replace("Z", "+00:00"))
                   - datetime.fromisoformat(first.replace("Z", "+00:00"))).total_seconds() / 3600
        except Exception:
            continue
        if hrs >= STALE_SESSION_HOURS:
            out.append((hrs, sb, sid))
    return sorted(out, reverse=True)


def notify(title, msg):
    try:
        subprocess.run(
            ["osascript", "-e",
             f'display notification {json.dumps(msg)} with title {json.dumps(title)}'],
            check=False, capture_output=True, timeout=10)
    except Exception:
        pass


# ── --push / --evening helpers ──────────────────────────────────────────────

CTK_ENV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
FOCUS_DIR = os.path.expanduser("~/.claude/session-focus")
CODEX_ROOT = os.path.expanduser("~/.codex/sessions")
HIGGSFIELD_CANDIDATES = [os.path.expanduser("~/.npm-global/bin/higgsfield"), "/opt/homebrew/bin/higgsfield", "/usr/local/bin/higgsfield"]


def load_env():
    env = {}
    path = CTK_ENV if os.path.exists(CTK_ENV) else os.path.expanduser("~/Projects/claude-tools-kit/.env")
    try:
        for line in open(path, encoding="utf-8"):
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.rstrip("\n").split("=", 1)
                env[k.strip()] = v.strip()
    except OSError:
        pass
    return env


def brain_post(env, path, body, prefer="return=minimal"):
    import urllib.request
    url = env.get("NEO_BRAIN_URL", "").rstrip("/") + "/rest/v1/" + path
    key = env.get("NEO_BRAIN_SERVICE_ROLE_KEY", "")
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "apikey": key, "Authorization": "Bearer " + key,
        "Content-Type": "application/json", "Prefer": prefer})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


def brain_patch(env, path, body):
    import urllib.request
    url = env.get("NEO_BRAIN_URL", "").rstrip("/") + "/rest/v1/" + path
    key = env.get("NEO_BRAIN_SERVICE_ROLE_KEY", "")
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="PATCH", headers={
        "apikey": key, "Authorization": "Bearer " + key,
        "Content-Type": "application/json", "Prefer": "return=minimal"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


def codex_tokens(window_from, window_to, month_prefix):
    """Codex tokens by event time. token_count events carry a running per-session total,
    so each event contributes its increase over the previous one."""
    yday = mtd = 0
    for f in glob.glob(CODEX_ROOT + "/**/*.jsonl", recursive=True):
        try:
            if os.path.getmtime(f) < datetime.now().timestamp() - 40 * 86400:
                continue
            prev = 0
            for line in open(f, encoding="utf-8", errors="ignore"):
                if "token_count" not in line:
                    continue
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                p = e.get("payload") or {}
                info = p.get("info") if p.get("type") == "token_count" else None
                if not info:
                    continue
                tot = (info.get("total_token_usage") or {}).get("total_tokens") or 0
                delta = max(0, tot - prev)
                prev = max(prev, tot)
                ts = e.get("timestamp") or ""
                if ts.startswith(month_prefix):
                    mtd += delta
                if window_from <= ts < window_to:
                    yday += delta
        except OSError:
            continue
    return yday, mtd


def higgsfield_mac_credits():
    import shutil
    cli = shutil.which("higgsfield") or next((c for c in HIGGSFIELD_CANDIDATES if os.path.exists(c)), None)
    if not cli:
        return None
    try:
        out = subprocess.run([cli, "workspace", "list", "--json"], capture_output=True, text=True, timeout=60).stdout
        ws = json.loads(out)
        ws = ws if isinstance(ws, list) else (ws.get("workspaces") or ws.get("data") or [])
        pick = next((w for w in ws if w.get("is_selected") or w.get("is_current")), ws[0] if ws else None)
        return None if not pick else {"credits": float(pick.get("credits")), "plan": pick.get("plan_type"), "workspace": pick.get("name")}
    except Exception:
        return None


def focus_task(sid):
    try:
        return open(os.path.join(FOCUS_DIR, sid + ".txt"), encoding="utf-8").readline().strip()
    except OSError:
        return ""


def long_open_sessions(sessions, now, min_hours=12, active_within_h=3):
    out = []
    for sid, (first, last, sb) in sessions.items():
        try:
            f = datetime.fromisoformat(first.replace("Z", "+00:00"))
            l = datetime.fromisoformat(last.replace("Z", "+00:00"))
        except Exception:
            continue
        if (now - l).total_seconds() / 3600 <= active_within_h and (l - f).total_seconds() / 3600 >= min_hours:
            out.append(((l - f).total_seconds() / 3600, sid, focus_task(sid)))
    return sorted(out, reverse=True)


def push(env, month, billable, budget, projected, st, sessions, now):
    from datetime import timedelta
    utc_midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    w_from = (utc_midnight - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")
    w_to = utc_midnight.strftime("%Y-%m-%dT%H:%M:%S")
    cx_y, cx_m = codex_tokens(w_from, w_to, month)
    hf = higgsfield_mac_credits()
    long_open = long_open_sessions(sessions, now, min_hours=24, active_within_h=24)
    rows = {
        "claude-plan": {"used_pct": round(100 * billable / budget, 1) if budget else None,
                        "billable_m": round(billable / 1e6, 1), "budget_m": round(budget / 1e6),
                        "projected_m": round(projected / 1e6), "month": month,
                        "stale_sessions": len(st), "long_open": len(long_open)},
        "codex": {"tokens_yesterday": cx_y, "tokens_mtd": cx_m, "month": month},
    }
    if hf:
        rows["higgsfield-mac"] = hf
    stamp = now.isoformat()
    sent = []
    for pid, bal in rows.items():
        try:
            brain_patch(env, f"creative_providers?id=eq.{pid}", {"balance": bal, "updated_at": stamp,
                        "health": {"status": "ok", "checked_at": stamp, "error": None, "pushed_by": "neo-mbp"}})
            brain_post(env, "creative_provider_checks", [{"provider_id": pid, "ok": True, "status": "ok",
                       "balance": bal, "latency_ms": None, "error": None, "checked_by": "token-budget-watch@neo-mbp"}])
            sent.append(pid)
        except Exception as e:
            print(f"push {pid} failed: {str(e)[:120]}")
    print(f"pushed to neo-brain: {', '.join(sent) or 'nothing'}"
          + ("" if hf else " (higgsfield-mac: no reading — CLI missing or logged out)"))


def evening(sessions, now):
    lo = long_open_sessions(sessions, now)
    if not lo:
        print("evening: no session open longer than 12 h — nothing to close")
        return
    names = [(t or sid[:8])[:40] for _, sid, t in lo[:4]]
    body = f"{len(lo)} Claude session(s) open >12h: " + "; ".join(names)
    notify("Close before bed", body + ". Close them (or /compact) — a day-old session costs ~15x.")
    print("evening: " + body)
    for hrs, sid, t in lo:
        print(f"  {sid[:8]}  open {hrs:>4.0f}h  {t}")


def main():
    args = sys.argv[1:]
    quiet = "--quiet" in args
    budget_m = DEFAULT_BUDGET_M
    if "--budget" in args:
        try:
            budget_m = float(args[args.index("--budget") + 1])
        except (IndexError, ValueError):
            pass
    budget = budget_m * 1e6

    now = datetime.now(timezone.utc)
    month = now.strftime("%Y-%m")
    billable, reread, per_day, sessions = collect(month)
    pct = billable / budget if budget else 0

    # Pace: are we on track to finish the month inside the budget?
    day = now.day
    days_in_month = 31 if now.month in (1, 3, 5, 7, 8, 10, 12) else (
        30 if now.month != 2 else 28)
    projected = (billable / day) * days_in_month if day else 0

    level = next((lab for thr, lab in WARN_AT if pct >= thr), None)
    st = stale(sessions)

    lines = [
        f"Claude spend · {month} · day {day} of {days_in_month}",
        f"  billable   {human(billable):>7}  of {budget_m:.0f}M budget   ({pct*100:.0f}%)",
        f"  re-read    {human(reread):>7}",
        f"  projected  {human(projected):>7}  by month end"
        + ("   ← over budget" if projected > budget else "   (inside budget)"),
    ]
    if per_day:
        busiest = max(per_day.items(), key=lambda kv: kv[1])
        lines.append(f"  busiest    {busiest[0]} at {human(busiest[1])}")
    if st:
        lines.append(f"\n  {len(st)} session(s) open longer than a day — the expensive shape:")
        for hrs, sb, sid in st[:5]:
            lines.append(f"    {sid[:8]}  spanning {hrs:>5.0f}h  {human(sb):>6} billable")
        lines.append("    → close them, or run /compact if the work must continue")

    report = "\n".join(lines)

    # Only notify once per level per month.
    fired = {}
    try:
        fired = json.load(open(STATE))
    except Exception:
        pass
    already = fired.get(month)

    if level and already != level:
        head = ("Claude budget exceeded" if level == "OVER"
                else f"Claude budget at {level}")
        body = f"{human(billable)} billable this month. Projected {human(projected)}."
        if st:
            body += f" {len(st)} stale session(s)."
        notify(head, body)
        fired[month] = level
        try:
            json.dump(fired, open(STATE, "w"))
        except Exception:
            pass
    elif not level and already:
        fired.pop(month, None)
        try:
            json.dump(fired, open(STATE, "w"))
        except Exception:
            pass

    if not quiet or level:
        print(report)
    if "--push" in args:
        push(load_env(), month, billable, budget, projected, st, sessions, now)
    if "--evening" in args:
        evening(sessions, now)
    return 0


if __name__ == "__main__":
    sys.exit(main())
