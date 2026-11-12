#!/usr/bin/env bash
# memguard.sh — kill ONE process if the machine runs low on memory (12 Nov 2026).
# Why: on 9-10 Nov 2026 a heavy model test drove the live EdgeXpert (Siti, twin, voices) to ~0 GB free before any guard existed.
# Start it BEFORE the heavy thing, on the box that runs it, and check the abort fires:
#   memguard.sh --min-gb 20 --pid 12345 [--interval 0.5] [--log ~/memguard.log] [--signal KILL]
#   (remote: scp this file to the box, then  ssh box 'nohup ~/memguard.sh --min-gb 20 --pid <PID> >/dev/null 2>&1 &')
# Exit codes: 0 process ended by itself · 3 killed by the guard · 2 bad arguments. Linux only (/proc/meminfo); MEMGUARD_MEMINFO overrides the file (tests).
set -u
MIN=""; PID=""; INT="0.5"; LOG=""; SIG="KILL"
while [ $# -gt 0 ]; do
  case "$1" in
    --min-gb) MIN="${2:-}"; shift 2;;
    --pid) PID="${2:-}"; shift 2;;
    --interval) INT="${2:-}"; shift 2;;
    --log) LOG="${2:-}"; shift 2;;
    --signal) SIG="${2:-}"; shift 2;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
case "$MIN" in ''|*[!0-9]*) echo "--min-gb must be a whole number" >&2; exit 2;; esac
case "$PID" in ''|*[!0-9]*) echo "--pid must be a number (find it with ss -ltnp or ps; never a name pattern)" >&2; exit 2;; esac
MEMINFO="${MEMGUARD_MEMINFO:-/proc/meminfo}"
[ -r "$MEMINFO" ] || { echo "cannot read $MEMINFO" >&2; exit 2; }
say() { [ -n "$LOG" ] && echo "$(date +%FT%T) $*" >> "$LOG"; return 0; }
say "guard on pid $PID: kill with $SIG if MemAvailable < ${MIN} GB"
while kill -0 "$PID" 2>/dev/null; do
  avail=$(awk '/^MemAvailable:/{printf "%d", $2/1048576}' "$MEMINFO")
  if [ -n "$avail" ] && [ "$avail" -lt "$MIN" ]; then
    kill "-$SIG" "$PID" 2>/dev/null
    say "KILLED pid $PID: only ${avail} GB available (< ${MIN} GB)"
    echo "memguard: killed pid $PID (only ${avail} GB available, floor ${MIN} GB)" >&2
    exit 3
  fi
  sleep "$INT"
done
say "pid $PID ended by itself; guard done"
exit 0
