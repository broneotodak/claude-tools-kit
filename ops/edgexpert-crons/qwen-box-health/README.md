# qwen-box-health

Standing vitals check for **EdgeXpert** (`edgexpert-2b2e`) — the NVIDIA GB10 ARM box that
hosts the local LLM behind the **@qwen** lane (`huihui_ai/Qwen3.8-abliterated:27b` via Ollama).

Built 13 Oct 2026 at Neo's request: *"a standing health check that reports GPU busy/temp/RAM
on a schedule, or alerts me if anything climbs past safe limits."*

## What it does
Every run it reads the box's vitals straight from the driver/kernel (no heartbeat fields),
scores them against safe limits, and:
- is **silent when healthy**,
- **pages Neo on WhatsApp** when something crosses a limit (or recovers from one),
- **never pages twice for the same state** inside a cooldown (anti-flap).

## Signals (source of truth)
| What | Source |
|---|---|
| GPU busy %, temp, power | `nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,power.draw` |
| CPU busy % | `/proc/stat` delta over ~700 ms |
| CPU load | `/proc/loadavg` (1-min) |
| CPU temp | max of `/sys/class/thermal/thermal_zone*/temp` |
| RAM used/free | `/proc/meminfo` (MemTotal / MemAvailable) |

## Safe limits (env-overridable)
| Metric | Warn | Crit | Notes |
|---|---|---|---|
| GPU temp | 85 °C | 95 °C | box idles ~60–68 °C |
| CPU temp (hottest zone) | 90 °C | 100 °C | idles ~69–76 °C |
| RAM free | ≤ 20 % | ≤ 10 % | ~121 GB box |
| load1 | ≥ 1.5 × cores | ≥ 3 × cores | 20 cores → warn ≥ 30, crit ≥ 60 |

GPU busy % and load are **reported** in every message but are only *page-worthy* via the
load threshold — the GPU being busy is what it's there for.

## Anti-flap policy (mirrors `creative-hub/lib/alerts.mjs`)
- healthy → silent (except one "back to normal" line after a WARN/CRIT clears)
- WARN/CRIT → page once per state; re-page after `PAGE_COOLDOWN_H` (default 6 h) if still bad
- state + cooldown map persisted in `state.json` (git-ignored)

## Lane
`POST 127.0.0.1:3501/send` with the `SEND_API_TOKEN` bearer — the same single WhatsApp route
as hub-watch. Never touches wacli's session.db. Token comes from `/home/neo/naca/siti/.env`.

## Run it
```
node index.mjs              # one sweep: decide, page if news, update state, log
node index.mjs --dry        # collect + decide + print; send nothing, write no state
node index.mjs --status     # print the current snapshot + status; no state, no send
```

## Cron (user `neo`, EdgeXpert)
```
*/10 * * * * flock -n /tmp/qwen-box-health.lock -c 'cd /home/neo/claude-tools-kit/ops/edgexpert-crons/qwen-box-health && /home/neo/.nvm/versions/node/v22.23.2/bin/node --env-file=/home/neo/naca/siti/.env index.mjs >> logs/cron.log 2>&1'
```

## Both-edges validation (MONITORING_ENFORCEMENT)
Before going live the alert decision was proven on **both** edges and for anti-flap, all via
`--dry` (nothing sent to Neo's live WA):
- good→bad: forced WARN/CRIT thresholds → `would-page` ✅
- bad→good: state set to warn, healthy box → `would-page (back to normal)` ✅
- anti-flap: still bad within cooldown → `silent` (no re-page) ✅
