#!/usr/bin/env python3
"""
watchdog.py — the watcher of the watcher (NACA, v1 · 2026-09-25)

Runs OFF the office failure domain (root cron */10 on the neo-twin VPS). It
only talks to neo-brain and Twilio, never to EdgeXpert, so it still works when
the office loses power, EdgeXpert is unplugged, or Siti's WhatsApp is dead:

  intrusion-watch heartbeat older than 35 min  -> SMS "security judge silent"
  sentinel-edge   heartbeat older than 30 min  -> SMS "EdgeXpert silent"
  wa-line-watch   stale > 20 min or line != up -> SMS "Siti line down"
  neo-brain unreachable                        -> SMS "neo-brain unreachable"

One SMS per signal per 6 h, plus one "back" SMS when a signal clears. Its own
heartbeat is `watchdog-twin` (intrusion-watch pages if THAT goes stale, so the
two watch each other). Twilio creds come from the vault at run time via the
get_credential RPC; numbers from config.json next to this file.

Files: ~/.naca/watchdog/{config.json,state.json,watchdog.log}
Env:   $WATCHDOG_ENV (default ~/.naca/watchdog/.env) with NEO_BRAIN_URL + key,
       or point it at an env file already on the box.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DIR = os.environ.get("WATCHDOG_DIR", os.path.expanduser("~/.naca/watchdog"))
ENV_FILE = os.environ.get("WATCHDOG_ENV", os.path.join(DIR, ".env"))
CFG_FILE = os.path.join(DIR, "config.json")
STATE_FILE = os.path.join(DIR, "state.json")
NAME = os.environ.get("WATCHDOG_NAME", "watchdog-twin")
NEO_SELF = "00000000-0000-0000-0000-000000000001"
COOLDOWN_H = 6
CHECKS = [  # agent_name, max age (min), plain-English label
    ("intrusion-watch", 35, "the security judge on EdgeXpert"),
    ("sentinel-edge", 30, "EdgeXpert's sentinel"),
    ("wa-line-watch", 20, "Siti's WhatsApp line watcher"),
]
DRY = "--dry-run" in sys.argv


def log(msg):
    line = f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {NAME} {msg}"
    print(line)


def load_env():
    env = {}
    try:
        for line in open(ENV_FILE):
            m = re.match(r"^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m:
                env[m.group(1)] = m.group(2).strip("'\"")
    except FileNotFoundError:
        pass
    return env


def http(url, method="GET", headers=None, body=None, timeout=20):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode()


def main():
    os.makedirs(DIR, exist_ok=True)
    env = load_env()
    url = (env.get("NEO_BRAIN_URL") or "").rstrip("/")
    key = env.get("NEO_BRAIN_SERVICE_ROLE_KEY") or env.get("NEO_BRAIN_KEY")
    if not url or not key:
        log(f"no NEO_BRAIN_URL/key in {ENV_FILE}")
        return 2
    H = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        cfg = json.load(open(CFG_FILE))
    except Exception:
        cfg = {}
    try:
        state = json.load(open(STATE_FILE))
    except Exception:
        state = {}
    state.setdefault("last_alerts", {})
    state.setdefault("active", {})
    now = time.time()
    problems = {}  # key -> text

    # 1. neo-brain reachable + the three heartbeats
    names = ",".join(f'"{c[0]}"' for c in CHECKS)
    try:
        code, txt = http(f"{url}/rest/v1/agent_heartbeats?select=agent_name,reported_at,meta&agent_name=in.({names})", headers=H)
        rows = {r["agent_name"]: r for r in json.loads(txt)}
    except Exception as e:
        rows = None
        problems["brain"] = f"neo-brain unreachable from neo-twin ({type(e).__name__}). Either Supabase is down or its key was revoked."
    ages = {}
    if rows is not None:
        for agent, max_min, label in CHECKS:
            r = rows.get(agent)
            age = (now - datetime.fromisoformat(r["reported_at"].replace("Z", "+00:00")).timestamp()) / 60 if r else None
            ages[agent] = None if age is None else round(age)
            if age is None or age > max_min:
                problems[f"stale:{agent}"] = f"{label} has not reported for {'ever' if age is None else str(round(age)) + ' min'} (limit {max_min}). If EdgeXpert is off, Siti and the security judge are both dark."
            if agent == "wa-line-watch" and r and (r.get("meta") or {}).get("line_state") not in (None, "up"):
                problems["siti:line"] = f"Siti's WhatsApp line is {r['meta'].get('line_state')} (wa-line-watch). WhatsApp alerts cannot reach you right now."

    # 2. SMS via Twilio (creds from the vault RPC, numbers from config.json)
    def sms(text):
        if DRY:
            log(f"DRY SMS -> {text[:120]}")
            return True
        frm, to = cfg.get("sms_from"), cfg.get("sms_to")
        if not frm or not to:
            log("no sms_from/sms_to in config.json — cannot SMS")
            return False
        def cred(t):
            body = json.dumps({"p_owner_id": NEO_SELF, "p_service": "twilio", "p_credential_type": t, "p_environment": "production"}).encode()
            _, out = http(f"{url}/rest/v1/rpc/get_credential", "POST", H, body)
            rows_ = json.loads(out)
            return rows_[0]["credential_value"] if rows_ else None
        try:
            sid, tok = cred("account_sid"), cred("auth_token")
            import base64
            auth = "Basic " + base64.b64encode(f"{sid}:{tok}".encode()).decode()
            body = urllib.parse.urlencode({"From": frm, "To": to, "Body": text[:300]}).encode()
            code, _ = http(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json", "POST", {"Authorization": auth, "Content-Type": "application/x-www-form-urlencoded"}, body)
            return code in (200, 201)
        except Exception as e:
            log(f"SMS failed: {e}")
            return False

    sent = 0
    for k, text in problems.items():
        last = state["last_alerts"].get(k, 0)
        state["active"][k] = True
        if now - last < COOLDOWN_H * 3600:
            continue
        if sms(f"NACA watchdog (neo-twin): {text}"):
            state["last_alerts"][k] = now
            sent += 1
            log(f"SMS sent: {k}")
    for k in list(state["active"].keys()):
        if state["active"].get(k) and k not in problems:
            state["active"][k] = False
            if sms(f"NACA watchdog (neo-twin): back to normal — {k.split(':')[-1]} is reporting again."):
                log(f"recovery SMS: {k}")

    if not DRY:
        json.dump(state, open(STATE_FILE, "w"))
        try:
            os.chmod(STATE_FILE, 0o600)
        except Exception:
            pass
    # 3. own heartbeat (only if neo-brain is reachable)
    if rows is not None and not DRY:
        meta = {"version": "watchdog-v1.0", "ages_min": ages, "problems": list(problems.keys()), "sms_sent": sent, "host": "neo-twin"}
        body = json.dumps({"agent_name": NAME, "status": "degraded" if problems else "ok", "reported_at": datetime.now(timezone.utc).isoformat(), "meta": meta}).encode()
        try:
            http(f"{url}/rest/v1/agent_heartbeats?on_conflict=agent_name", "POST", {**H, "Prefer": "resolution=merge-duplicates,return=minimal"}, body)
        except Exception as e:
            log(f"heartbeat failed: {e}")
    log(f"ages={ages} problems={list(problems.keys()) or '-'} sms={sent}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
