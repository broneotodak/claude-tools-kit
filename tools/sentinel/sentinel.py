#!/usr/bin/env python3
"""
sentinel.py — box-local intrusion sentinel (NACA fleet, v1 · 2026-09-25)

Born from the 22–25 Sep 2026 break-in. Every fleet box runs this every 10 min
from cron / launchd. It takes a fingerprint of everything an intruder tends to
touch, diffs it against the last run, collects the login / sudo / Tailscale-SSH
events since the last run, and reports ONE heartbeat row to neo-brain:

    agent_heartbeats  agent_name = sentinel-<name>   status = ok | degraded
    meta = { fp, changed, diff, events, sessions, outbound, caps, ... }

`degraded` = something changed (keys, sudoers, listening ports, units, cron,
docker, Tailscale prefs, sshd config, SUID, /tmp executables, package installs,
user changes, any Tailscale-SSH session, reboot). The judge on EdgeXpert
(tools/intrusion-watch.mjs) reads these rows, applies the allow-list of known
keys / IPs and pages Neo. A sentinel that goes silent is itself an alarm.

Stdlib only. Works on Ubuntu / Debian (UGOS) / macOS. Uses `sudo -n` when the
box allows it; otherwise reports what the user can see and says so in caps.

Usage:
  sentinel.py                 collect + post heartbeat (normal cron run)
  sentinel.py --stdout        print the report JSON, do not post (pull mode / tests)
  sentinel.py --reset         re-baseline (no diff this run)
  sentinel.py --selftest      inject a synthetic change so the judge path can be
                              exercised without touching the box (judge treats
                              section "selftest" as a dry run — no WhatsApp)
  sentinel.py --name X        heartbeat name (default sentinel-<hostname>)

Env file (~/.naca/sentinel/.env or $SENTINEL_ENV): NEO_BRAIN_URL,
NEO_BRAIN_SERVICE_ROLE_KEY (or NEO_BRAIN_KEY). State: ~/.naca/sentinel/state.json
"""
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

VERSION = "sentinel-v1.0"
ARGS = sys.argv[1:]
FLAG = lambda f: f in ARGS
OPT = lambda k, d=None: (ARGS[ARGS.index(k) + 1] if k in ARGS and ARGS.index(k) + 1 < len(ARGS) else d)

HOME = os.path.expanduser("~")
DIR = os.environ.get("SENTINEL_DIR", os.path.join(HOME, ".naca", "sentinel"))
ENV_FILE = os.environ.get("SENTINEL_ENV", os.path.join(DIR, ".env"))
STATE_FILE = os.path.join(DIR, "state.json")
IS_MAC = platform.system() == "Darwin"
IS_ROOT = os.geteuid() == 0
HOSTNAME = platform.node().split(".")[0].lower()
NAME = OPT("--name") or os.environ.get("SENTINEL_NAME") or f"sentinel-{HOSTNAME}"
MAX_LIST = 25
MAX_STR = 140

LOOPBACK = re.compile(r"^(127\.|\[?::1\]?|localhost)")
PRIVATE = re.compile(r"^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.|169\.254\.|fd7a:|fe80:|::1|\[)")


def sh(cmd, timeout=20, sudo=False):
    """Run a shell command, return stdout ('' on any failure)."""
    if sudo and not IS_ROOT:
        cmd = "sudo -n " + cmd
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, errors="replace")
        return r.stdout if r.returncode == 0 or r.stdout else ""
    except Exception:
        return ""


def sha(lines):
    return hashlib.sha256("\n".join(sorted(set(lines))).encode()).hexdigest()[:12]


def trunc(s, n=MAX_STR):
    s = str(s)
    return s if len(s) <= n else s[: n - 1] + "…"


def clean(lines):
    return sorted({trunc(l.strip()) for l in lines if l and l.strip()})


def load_env():
    env = {}
    try:
        with open(ENV_FILE) as f:
            for line in f:
                m = re.match(r"^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
                if m:
                    env[m.group(1)] = m.group(2).strip("'\"")
    except FileNotFoundError:
        pass
    for k in ("NEO_BRAIN_URL", "NEO_BRAIN_SERVICE_ROLE_KEY", "NEO_BRAIN_KEY"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


# ── capabilities ──────────────────────────────────────────────────────────────
CAPS = {
    "root": IS_ROOT,
    "sudo": IS_ROOT or sh("sudo -n true && echo ok").strip() == "ok",
    "journal": (not IS_MAC) and bool(sh("journalctl -n1 --no-pager -q 2>/dev/null && echo ok").strip().endswith("ok")),
    "tailscale": bool(sh("command -v tailscale")),
    "docker": bool(sh("docker ps -q 2>/dev/null && echo ok").strip().endswith("ok")) or (sh("command -v docker") != "" and (IS_ROOT or bool(sh("sudo -n docker ps -q 2>/dev/null && echo ok").strip().endswith("ok")))),
    "mac": IS_MAC,
}
SUDO = CAPS["sudo"]


# ── sections (fingerprinted) ──────────────────────────────────────────────────
def users():
    if IS_MAC:
        out = sh("dscl . -list /Users UniqueID")
        return clean(f"{u} uid={i}" for u, i in (l.split() for l in out.splitlines() if len(l.split()) == 2) if int(i) >= 500 or u == "root")
    out = []
    try:
        for line in open("/etc/passwd"):
            p = line.strip().split(":")
            if len(p) >= 7 and re.search(r"(ba|z|da|k|c|tc)?sh$", p[6]) and "nologin" not in p[6] and "false" not in p[6]:
                out.append(f"{p[0]} uid={p[2]} home={p[5]}")
    except Exception:
        pass
    return clean(out)


def homes():
    hs = []
    if IS_MAC:
        hs = [(d, f"/Users/{d}") for d in os.listdir("/Users") if not d.startswith(".") and d != "Shared"]
    else:
        try:
            for line in open("/etc/passwd"):
                p = line.strip().split(":")
                if len(p) >= 7 and (p[5].startswith("/home") or p[5].startswith("/volume1/homes") or p[5] == "/root" or p[5].startswith("/var/lib")):
                    hs.append((p[0], p[5]))
        except Exception:
            pass
    return hs


def authkeys():
    out = []
    for user, home in homes():
        for fn in ("authorized_keys", "authorized_keys2"):
            path = os.path.join(home, ".ssh", fn)
            content = ""
            try:
                content = open(path).read()
            except PermissionError:
                if SUDO:
                    content = sh(f"cat {path} 2>/dev/null", sudo=True)
            except Exception:
                continue
            if not content.strip():
                continue
            tmp = os.path.join(DIR, ".ak.tmp")
            try:
                with open(tmp, "w") as f:
                    f.write(content)
                fps = sh(f"ssh-keygen -lf {tmp}")
            finally:
                try:
                    os.remove(tmp)
                except Exception:
                    pass
            for l in fps.splitlines():
                parts = l.split()
                if len(parts) >= 2:
                    comment = " ".join(parts[2:-1]) if len(parts) > 3 else ""
                    opts = ""
                    for raw in content.splitlines():
                        if raw.startswith(("from=", "command=", "no-", "restrict")):
                            opts = "opts"
                    out.append(f"{user} {parts[1]} {trunc(comment, 60)} {opts}".strip())
    return clean(out)


def sudoers():
    if not SUDO:
        return ["(no sudo — unreadable)"]
    txt = sh("cat /etc/sudoers /etc/sudoers.d/* 2>/dev/null", sudo=True) if not IS_MAC else sh("cat /etc/sudoers /private/etc/sudoers.d/* 2>/dev/null", sudo=True)
    return clean(l for l in txt.splitlines() if l.strip() and not l.strip().startswith(("#", "Defaults")))


def admins():
    if IS_MAC:
        return clean(sh("dscl . -read /Groups/admin GroupMembership 2>/dev/null").replace("GroupMembership:", "").split())
    out = []
    try:
        for line in open("/etc/group"):
            p = line.strip().split(":")
            if len(p) >= 4 and p[0] in ("sudo", "wheel", "admin", "docker", "adm", "root") and p[3]:
                out.append(f"{p[0]}: {p[3]}")
    except Exception:
        pass
    return clean(out)


def listen():
    if IS_MAC:
        out = sh("lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $9\" \"$1}'")
        return clean(l for l in out.splitlines() if not LOOPBACK.match(l.split(":")[0]) and "127.0.0.1" not in l and "[::1]" not in l)
    out = sh("ss -tlnpH 2>/dev/null || sudo -n ss -tlnpH 2>/dev/null")
    res = []
    for l in out.splitlines():
        p = l.split()
        if len(p) < 4:
            continue
        addr = p[3]
        if addr.startswith(("127.", "[::1]")) or "%lo" in addr:
            continue
        proc = re.search(r'\("([^"]+)"', l)
        res.append(f"{addr} {proc.group(1) if proc else ''}".strip())
    return clean(res)


def units():
    if IS_MAC:
        out = []
        for d in ("/Library/LaunchDaemons", "/Library/LaunchAgents", os.path.join(HOME, "Library/LaunchAgents")):
            try:
                for f in os.listdir(d):
                    if f.endswith(".plist"):
                        h = hashlib.sha256(open(os.path.join(d, f), "rb").read()).hexdigest()[:8]
                        out.append(f"{d}/{f} {h}")
            except Exception:
                pass
        return clean(out)
    out = sh("systemctl list-unit-files --state=enabled --no-legend 2>/dev/null | awk '{print $1}'").splitlines()
    out += [f"/etc/systemd/system/{f}" for f in (os.listdir("/etc/systemd/system") if os.path.isdir("/etc/systemd/system") else []) if f.endswith((".service", ".timer", ".socket"))]
    out += ["user:" + l for l in sh("systemctl --user list-unit-files --state=enabled --no-legend 2>/dev/null | awk '{print $1}'").splitlines()]
    return clean(l for l in out if not l.startswith("snap-"))


def cron():
    if IS_MAC:
        return clean(l for l in sh("crontab -l 2>/dev/null").splitlines() if l.strip() and not l.startswith("#"))
    out = ["me:" + l for l in sh("crontab -l 2>/dev/null").splitlines() if l.strip() and not l.startswith("#")]
    out += ["etc:" + l for l in sh("cat /etc/crontab /etc/cron.d/* 2>/dev/null").splitlines() if l.strip() and not l.startswith("#")]
    if SUDO:
        spool = "/var/spool/cron/crontabs"
        for u in sh(f"ls {spool} 2>/dev/null", sudo=True).split():
            if u == os.environ.get("USER") or u == os.environ.get("LOGNAME"):
                continue
            out += [f"{u}:" + l for l in sh(f"cat {spool}/{u} 2>/dev/null", sudo=True).splitlines() if l.strip() and not l.startswith("#")]
    return clean(out)


def docker():
    if not CAPS["docker"]:
        return []
    out = sh("docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null") or sh("docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null", sudo=True)
    return clean(out.splitlines())


def tailscale():
    if not CAPS["tailscale"]:
        return []
    out = []
    prefs = sh("tailscale debug prefs 2>/dev/null", sudo=SUDO)
    try:
        p = json.loads(prefs) if prefs.strip().startswith("{") else {}
        for k in ("RunSSH", "ExitNodeID", "ExitNodeIP", "AdvertiseRoutes", "ShieldsUp", "Hostname", "OperatorUser", "AdvertiseTags"):
            if k in p:
                out.append(f"{k}={p[k]}")
    except Exception:
        pass
    st = sh("tailscale status --json 2>/dev/null")
    try:
        s = json.loads(st)
        self_ = s.get("Self", {})
        out.append(f"self={self_.get('HostName')} ips={','.join(self_.get('TailscaleIPs', []))} user={s.get('User', {}).get(str(self_.get('UserID')), {}).get('LoginName')}")
        if self_.get("SSH_HostKeys"):
            out.append("SSH_HostKeys=advertised")
    except Exception:
        pass
    fun = sh("tailscale funnel status 2>/dev/null").strip().splitlines()[:1]
    srv = sh("tailscale serve status 2>/dev/null").strip().splitlines()[:1]
    out.append("funnel=" + (fun[0] if fun else "?"))
    out.append("serve=" + (srv[0] if srv else "?"))
    return clean(out)


def sshd():
    keys = ("passwordauthentication", "permitrootlogin", "pubkeyauthentication", "kbdinteractiveauthentication", "port", "listenaddress", "authorizedkeysfile", "permitemptypasswords", "authorizedkeyscommand")
    if IS_MAC:
        on = sh("launchctl print system/com.openssh.sshd 2>/dev/null | head -1")
        out = ["remote_login=" + ("on" if on else "off")]
        ss = sh("launchctl print system/com.apple.screensharing 2>/dev/null | head -1")
        out.append("screen_sharing=" + ("on" if ss else "off"))
        return clean(out)
    txt = sh("sshd -T 2>/dev/null", sudo=SUDO)
    if not txt.strip():
        txt = sh("cat /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null")
    return clean(l for l in txt.splitlines() if l.split()[:1] and l.split()[0].lower() in keys)


def preload():
    try:
        return clean(open("/etc/ld.so.preload").read().splitlines())
    except Exception:
        return []


def suid():
    if IS_MAC:
        return []
    out = sh("find /usr /bin /sbin /opt /home /root /tmp /var/tmp /dev/shm /srv -xdev -type f -perm -4000 2>/dev/null", timeout=60, sudo=SUDO)
    return clean(out.splitlines())


def pm2():
    out = []
    for user, home in homes():
        d = os.path.join(home, ".pm2", "pids")
        names = sh(f"ls {d} 2>/dev/null", sudo=(SUDO and user != os.environ.get("USER")))
        for f in names.split():
            proc = re.sub(r"-\d+\.pid$", "", f)  # kept outside the f-string: macOS /usr/bin/python3 is 3.9
            out.append(f"{user}:{proc}")
    return clean(out)


def home_rc():
    out = []
    for user, home in homes():
        for f in (".bashrc", ".profile", ".bash_profile", ".zshrc", ".zprofile", ".ssh/rc", ".ssh/config"):
            p = os.path.join(home, f)
            try:
                h = hashlib.sha256(open(p, "rb").read()).hexdigest()[:8]
            except PermissionError:
                if not SUDO:
                    continue
                c = sh(f"cat {p} 2>/dev/null", sudo=True)
                if not c:
                    continue
                h = hashlib.sha256(c.encode()).hexdigest()[:8]
            except Exception:
                continue
            out.append(f"{user}:{f} {h}")
    return clean(out)


TMP_NOISE = re.compile(r"/(snap|systemd-private|\.X11|kdeno|claude-[0-9]|claude|tmux-|pm2|npm-|pip-|go-build|node-compile-cache|v8-compile-cache|pyright|com\.apple|\.com\.apple|ansible|hsperfdata|ollama|torch|xdg-)")


def tmp_exec():
    """Executables dropped in the world-writable temp dirs in the last 7 days (attacker staging)."""
    dirs = "/tmp /var/tmp /dev/shm" if not IS_MAC else "/tmp /private/tmp /var/tmp"
    out = sh(f"find {dirs} -type f -perm -u+x -mtime -7 2>/dev/null | head -400", timeout=30, sudo=SUDO)
    return clean(l for l in out.splitlines() if not TMP_NOISE.search(l))[:60]


def hosts_file():
    try:
        return clean(l for l in open("/etc/hosts").read().splitlines() if l.strip() and not l.startswith("#"))
    except Exception:
        return []


SECTIONS = {
    "users": users, "admins": admins, "authkeys": authkeys, "sudoers": sudoers, "listen": listen, "units": units,
    "cron": cron, "docker": docker, "tailscale": tailscale, "sshd": sshd, "preload": preload, "suid": suid,
    "pm2": pm2, "home_rc": home_rc, "tmp_exec": tmp_exec, "hosts": hosts_file,
}


# ── events since last run ─────────────────────────────────────────────────────
def journal(since_epoch, unit=None, comm=None, extra=""):
    if not CAPS["journal"]:
        return ""
    sel = f"-u {unit}" if unit else (f"_COMM={comm}" if comm else "")
    return sh(f"journalctl {sel} --since=@{int(since_epoch)} --no-pager -q -o short-iso {extra} 2>/dev/null", timeout=40, sudo=SUDO and not CAPS["root"])


def events(since_epoch):
    ev = {"since": datetime.fromtimestamp(since_epoch, timezone.utc).isoformat(timespec="seconds"), "logins": [], "failed": 0, "sudo": {"by": {}, "last": []}, "ts_ssh": [], "user_changes": [], "pkg_installs": []}
    if IS_MAC:
        mins = max(1, int((time.time() - since_epoch) / 60) + 1)
        txt = sh(f"log show --style compact --last {min(mins, 180)}m --predicate '(process == \"sshd\" OR process == \"sshd-session\" OR process == \"sudo\" OR process == \"screensharingd\")' 2>/dev/null", timeout=90)
    else:
        txt = journal(since_epoch, unit="ssh") + journal(since_epoch, unit="sshd") + journal(since_epoch, comm="sudo") + journal(since_epoch, comm="useradd") + journal(since_epoch, comm="usermod") + journal(since_epoch, comm="passwd") + journal(since_epoch, comm="chpasswd") + journal(since_epoch, comm="userdel") + journal(since_epoch, comm="groupadd")
        tsl = journal(since_epoch, unit="tailscaled")
        for m in re.finditer(r"access granted to (\S+) as ssh-user \"([^\"]+)\"", tsl):
            ev["ts_ssh"].append(f"{m.group(1)} as {m.group(2)}")
        for m in re.finditer(r"handling new SSH connection from (\S+) \(([^)]+)\)", tsl):
            ev["ts_ssh"].append(f"conn {m.group(1)} ({m.group(2)})")
        try:
            for line in open("/var/log/dpkg.log", errors="replace"):
                if " install " in line:
                    ts = line[:19].replace(" ", "T")
                    try:
                        t = datetime.fromisoformat(ts).timestamp()
                    except Exception:
                        continue
                    if t >= since_epoch:
                        ev["pkg_installs"].append(trunc(line.strip(), 80))
        except Exception:
            pass
    logins = {}
    for m in re.finditer(r"Accepted (\w[\w-]*) for (\S+) from (\S+) port \d+(?:.*?(SHA256:\S+))?", txt):
        key = (m.group(2), m.group(3), m.group(1), m.group(4) or "")
        logins[key] = logins.get(key, 0) + 1
    ev["logins"] = [{"u": k[0], "ip": k[1], "m": k[2], "fp": k[3], "n": n} for k, n in sorted(logins.items(), key=lambda x: -x[1])][:MAX_LIST]
    ev["failed"] = len(re.findall(r"Failed password|Invalid user|authentication failure|Connection closed by authenticating user", txt))
    for m in re.finditer(r"(\S+) : TTY=.*?; USER=(\S+) ; COMMAND=(.*)", txt):
        u = f"{m.group(1)}->{m.group(2)}"
        ev["sudo"]["by"][u] = ev["sudo"]["by"].get(u, 0) + 1
        if len(ev["sudo"]["last"]) < 8:
            ev["sudo"]["last"].append(trunc(f"{u}: {m.group(3)}", 100))
    for m in re.finditer(r"(new user|new group|delete user|password changed|changed password|added to group|removed from group)[^\n]{0,80}", txt):
        ev["user_changes"].append(trunc(m.group(0), 100))
    ev["ts_ssh"] = sorted(set(ev["ts_ssh"]))[:MAX_LIST]
    ev["user_changes"] = sorted(set(ev["user_changes"]))[:MAX_LIST]
    ev["pkg_installs"] = ev["pkg_installs"][-MAX_LIST:]
    return ev


def sessions():
    out = sh("who 2>/dev/null")
    res = []
    for l in out.splitlines():
        p = l.split()
        if not p:
            continue
        m = re.search(r"\(([^)]+)\)\s*$", l)
        res.append(f"{p[0]} {m.group(1) if m else (p[1] if len(p) > 1 else '')}")
    return clean(res)[:MAX_LIST]


def facts(sections):
    """A few parsed booleans the judge reasons on without needing the raw lines."""
    sshd_l, ts_l, listen_l = sections.get("sshd", []), sections.get("tailscale", []), sections.get("listen", [])

    def get(lines, key):
        for l in lines:
            if not l.lower().startswith(key):
                continue
            if key.endswith("="):
                return l.split("=", 1)[1]            # "funnel=No serve config" → "No serve config"
            return l.split(None, 1)[1] if " " in l else l.split("=", 1)[-1]
        return None

    return {
        "password_auth": get(sshd_l, "passwordauthentication"),
        "permit_root": get(sshd_l, "permitrootlogin"),
        "remote_login": get(sshd_l, "remote_login="),
        "screen_sharing": get(sshd_l, "screen_sharing="),
        "ts_run_ssh": get(ts_l, "runssh="),
        "ts_funnel": get(ts_l, "funnel="),
        "ts_serve": get(ts_l, "serve="),
        "ts_ssh_hostkeys": any(l.startswith("SSH_HostKeys") for l in ts_l),
        "public_listen": [l for l in listen_l if l.startswith(("0.0.0.0:", "*:", "[::]:"))][:20],
        "login_users": [l.split()[0] for l in sections.get("users", [])],
        "docker_n": len(sections.get("docker", [])),
        "tmp_exec_n": len(sections.get("tmp_exec", [])),
        "preload": bool(sections.get("preload")),
    }


def outbound():
    if IS_MAC:
        txt = sh("lsof -nP -iTCP -sTCP:ESTABLISHED 2>/dev/null | awk 'NR>1{print $9\" \"$1}'")
        pairs = [(l.split()[0].split("->")[-1].rsplit(":", 1)[0], l.split()[1]) for l in txt.splitlines() if "->" in l]
    else:
        txt = sh("ss -tnpH state established 2>/dev/null")
        pairs = []
        for l in txt.splitlines():
            p = l.split()
            if len(p) < 4:
                continue
            ip = p[3].rsplit(":", 1)[0].strip("[]")
            proc = re.search(r'\("([^"]+)"', l)
            pairs.append((ip, proc.group(1) if proc else ""))
    agg = {}
    for ip, proc in pairs:
        if PRIVATE.match(ip) or ip.startswith("::ffff:100."):
            continue
        k = (ip, proc)
        agg[k] = agg.get(k, 0) + 1
    return [{"ip": k[0], "proc": k[1], "n": n} for k, n in sorted(agg.items(), key=lambda x: -x[1])[:10]]


def boot_id():
    if IS_MAC:
        return sh("sysctl -n kern.boottime").strip()[:40]
    try:
        return open("/proc/sys/kernel/random/boot_id").read().strip()
    except Exception:
        return ""


def uptime_s():
    if IS_MAC:
        m = re.search(r"sec = (\d+)", sh("sysctl -n kern.boottime"))
        return int(time.time() - int(m.group(1))) if m else 0
    try:
        return int(float(open("/proc/uptime").read().split()[0]))
    except Exception:
        return 0


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    os.makedirs(DIR, exist_ok=True)
    try:
        os.chmod(DIR, 0o700)
    except Exception:
        pass
    now = time.time()
    state = {}
    try:
        state = json.load(open(STATE_FILE))
    except Exception:
        state = {}
    reset = FLAG("--reset") or not state.get("sections")
    since = float(state.get("last_run", now - 600))
    if now - since > 6 * 3600:
        since = now - 6 * 3600  # never replay more than 6h of journal

    sections = {}
    errors = []
    for name, fn in SECTIONS.items():
        try:
            sections[name] = fn()
        except Exception as e:  # never let one collector kill the report
            sections[name] = [f"(error {type(e).__name__})"]
            errors.append(f"{name}: {e}")
    prev = state.get("sections", {})
    diff, changed = {}, []
    if not reset:
        for name, lines in sections.items():
            a, b = set(prev.get(name, [])), set(lines)
            if a != b:
                changed.append(name)
                diff[name] = {"added": sorted(b - a)[:MAX_LIST], "removed": sorted(a - b)[:MAX_LIST]}
    if FLAG("--selftest"):
        changed.append("selftest")
        diff["selftest"] = {"added": ["synthetic change from --selftest"], "removed": []}

    ev = events(since)
    bid = boot_id()
    rebooted = bool(state.get("boot_id")) and bid != state.get("boot_id")
    degraded = bool(changed) or bool(ev["ts_ssh"]) or bool(ev["user_changes"]) or bool(ev["pkg_installs"]) or rebooted
    meta = {
        "v": 1, "version": VERSION, "host": HOSTNAME, "name": NAME, "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "os": platform.platform()[:60], "boot_id": bid[:36], "rebooted": rebooted, "uptime_s": uptime_s(), "caps": CAPS,
        "baseline": reset, "fp": {k: sha(v) for k, v in sections.items()}, "counts": {k: len(v) for k, v in sections.items()},
        "changed": changed, "diff": diff, "events": ev, "sessions": sessions(), "outbound": outbound(), "errors": errors[:5],
        "facts": facts(sections), "selftest": FLAG("--selftest"),
    }
    body = json.dumps(meta)
    if len(body) > 14000:  # keep the row small: drop diff detail first, then outbound
        meta["diff"] = {k: {"added": v["added"][:5], "removed": v["removed"][:5]} for k, v in diff.items()}
        meta["outbound"] = meta["outbound"][:3]
        body = json.dumps(meta)
    status = "degraded" if degraded else "ok"

    if not FLAG("--selftest"):
        state = {"last_run": now, "boot_id": bid, "sections": sections, "name": NAME, "version": VERSION}
        json.dump(state, open(STATE_FILE, "w"))
        try:
            os.chmod(STATE_FILE, 0o600)
        except Exception:
            pass

    if FLAG("--stdout"):
        print(json.dumps({"agent_name": NAME, "status": status, "meta": meta}))
        return 0

    env = load_env()
    url = (env.get("NEO_BRAIN_URL") or "").rstrip("/")
    key = env.get("NEO_BRAIN_SERVICE_ROLE_KEY") or env.get("NEO_BRAIN_KEY")
    if not url or not key:
        print(f"[{NAME}] no NEO_BRAIN_URL/key in {ENV_FILE} — report not posted", file=sys.stderr)
        print(json.dumps({"status": status, "changed": changed}))
        return 2
    payload = json.dumps({"agent_name": NAME, "status": status, "meta": meta, "reported_at": meta["ts"]}).encode()
    req = urllib.request.Request(f"{url}/rest/v1/agent_heartbeats?on_conflict=agent_name", data=payload, method="POST", headers={
        "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            code = r.status
    except Exception as e:
        print(f"[{NAME}] heartbeat POST failed: {e}", file=sys.stderr)
        return 1
    print(f"[{meta['ts']}] {NAME} {status} changed={','.join(changed) or '-'} logins={sum(l['n'] for l in ev['logins'])} failed={ev['failed']} ts_ssh={len(ev['ts_ssh'])} http={code}{' BASELINE' if reset else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
