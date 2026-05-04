# NAS-UGREEN Focus CC Session Prompt

Paste below into a fresh Claude Code session as the first message when working on the **Ugreen NAS** — the home storage hub now also serving as a fleet member (heartbeat live since 2026-05-03).

**Before doing anything else, read `~/Projects/claude-tools-kit/WORKFLOW.md`** (canonical 5-phase work flow). NAS itself is `tier_2` — sidekick role. NORMATIVE rules apply when storing fleet media (NAS is the canonical media store) or when running services other agents depend on.

---

You are scoped to **NAS-UGREEN** — Neo's home Ugreen NAS. Started life as a backup target; now also runs Tailscale exit-node duty, MinIO media storage for the fleet, and could host more services (n8n, Vaultwarden, Immich) given how overbuilt it is for backup alone.

## Live layout

| What | Where |
|---|---|
| Box | Ugreen NAS (Backup-TS) |
| CPU | 6-core Pentium Gold |
| RAM | 23 GB |
| Storage | 22 TB RAID5 |
| OS | Linux + Docker |
| LAN IP | `192.168.0.35` |
| Tailnet IP | `100.85.18.97` |
| SSH user | `Neo` (capital N — not `neo`. Memory: `feedback_memory_search_before_no_access.md`) |
| SSH cmd | `ssh Neo@100.85.18.97` (over Tailscale) |
| `agent_registry` row | `nas-ugreen` (kind: service · tier_2 · deploy_method: ssh+systemd) |

## What runs here

- **Tailscale** — full-node, also serves as exit node for some clients
- **Docker** — host for the NACA Docker-shaped agents (see below)
- **Heartbeat publisher** — the script that keeps `agent_heartbeats.agent_name='nas-ugreen'` fresh. Lives at `/usr/local/bin/nas-heartbeat.sh`, fires every 60s via cron. Reports: disk total/used/free GB + %, CPU %, RAM %, load_1m, uptime, Tailscale up/down.
- **NACA Docker agents** (5 as of 2026-05-04, all under `/volume1/Todak Studios/agents/<name>/`):
  - **timekeeper-agent** — fires `scheduled_actions` at `fire_at` (multi-instance-safe via SELECT FOR UPDATE SKIP LOCKED)
  - **verifier-agent** — confirms merged PRs actually deployed live; pings stuck-PR alerts at 15-min mark
  - **toolsmith-agent** — generates tool specs when Siti hits a capability gap
  - **poster-agent** — routes social posts to platform publishers (browser/publisher agents on Slave-MBP)
  - **daily-checkup** (since 2026-05-04) — daily 09:00 MYT fleet-health digest. Long-lived loop; reads heartbeats/stuck-cmds/orphan-PRs, translates FAIL+WARN to plain English via Sonnet 4.6, dispatches one consolidated WhatsApp via Siti. Phase 1 detector only — no fix dispatch.
- **MinIO** — canonical media store for the fleet. Per the Studio/Publisher split: media generated on CLAW or via Higgsfield/Kling lands here; browser-agent / publisher-agent on Slave-MBP read from here.
- **n8n** (since 2026-04-28) — local automation flows
- **Business docs archive** — `/volume1/Todak Studios/business-docs/` (e.g. `SSM-TSSB.pdf`)
- **(Possible future)** — Vaultwarden, Immich, Jellyfin per `project_nas_use_cases.md`

## Deploy flow

For the **heartbeat publisher** or any NAS-side script:

```bash
# 1. Edit locally
cd ~/Projects/claude-tools-kit
# … edit tools/nas-heartbeat.sh ...

# 2. PR + merge
git push + gh pr create + gh pr merge --squash --admin

# 3. Copy + reload on NAS
scp tools/nas-heartbeat.sh Neo@100.85.18.97:/usr/local/bin/nas-heartbeat.sh
ssh Neo@100.85.18.97 "chmod +x /usr/local/bin/nas-heartbeat.sh"

# 4. Verify the next cron tick lands a fresh heartbeat
node ~/Projects/claude-tools-kit/tools/check-project-health.js nas-ugreen
```

For **adding a new Docker service** (e.g., n8n update):

```bash
ssh Neo@100.85.18.97
# … docker-compose up -d / docker pull / etc. ...

# Document the new service in:
#   - project_registry (if it's becoming a fleet member)
#   - reference_ugreen_nas memory
#   - this focus doc (Live layout table above)
```

For **mounting / SCP with paths that have spaces** (e.g. business-docs):

```bash
# scp with space-in-path needs the double-pipe:
ssh Neo@100.85.18.97 "cat '/volume1/Todak Studios/business-docs/SSM-TSSB.pdf'" > /local/SSM-TSSB.pdf
# (per memory feedback_business_docs_nas — direct scp with quoted path can fail)
```

## Hard rules — DO NOT violate

1. **SSH user is `Neo` (capital N).** Lowercase `neo` won't authenticate. This wasted hours before the discovery. (`feedback_memory_search_before_no_access.md`).
2. **Don't disable Tailscale here** — multiple fleet members reach NAS only over the tailnet (`100.85.18.97`). Public LAN IP `192.168.0.35` is local-only.
3. **Don't fill the disk** — RAID5 has 22TB but Plaud + media + business-docs + future Immich grow fast. Check `df -h` before bulk uploads.
4. **Don't break the heartbeat cron.** If the NAS heartbeat goes stale, FCC will report NAS offline and the supervisor-agent will alarm.
5. **Don't expose Docker services to the public internet** unless explicitly asked. Tailnet-only by default.
6. **Business docs are sensitive** — the `/volume1/Todak Studios/business-docs/` path holds SSM/registration/legal docs. Don't move, rename, or share without explicit go-ahead.

## First-90-seconds debug entry points

- **"NAS shows offline in FCC"**: heartbeat cron isn't firing. SSH and check: `tail /var/log/nas-heartbeat.log` (or wherever the cron output goes). Also check the cron line is still present: `crontab -l | grep nas-heartbeat`.
- **"MinIO not reachable"**: check the docker container: `docker ps | grep minio`. Tailnet-only — clients should be using `100.85.18.97:<port>`, not the LAN IP, when over Tailscale.
- **"Disk warnings"**: `df -h /volume1`. Plaud uploads + Immich photos + media regen are the usual culprits.
- **"n8n flows not running"**: `docker ps | grep n8n`. Logs via `docker logs -f n8n`.
- **"SCP failed with 'no such file'"** but the file exists: probably a quoted-path issue. Use `cat | ssh` pipe or `tar | ssh` for paths with spaces.

## Memory discipline

- **Category**: `reference_ugreen_nas` for layout, `project_nas_use_cases` for service plans, `shared_infra_change` if changing how the fleet writes to MinIO or reaches NAS services.
- **Scope**: `fleet` for infra; `knowledge` for layout / paths; `ops` if integrating into agent flows.
- **Importance**: 6 for routine deploys, 7 for new service additions, 8+ for fleet integration (e.g. browser-agent reading from MinIO).

## Pointers

- `~/Projects/claude-tools-kit/WORKFLOW.md` — canonical work flow
- neo-brain: `reference_ugreen_nas`, `reference_business_docs_nas`, `project_nas_use_cases`, `feedback_memory_search_before_no_access`
- Heartbeat script: `~/Projects/claude-tools-kit/tools/nas-heartbeat.sh` (local) → `/usr/local/bin/nas-heartbeat.sh` (NAS)

## Tone

Same as everywhere — terse, signal-first. NAS holds 22TB of mostly-Neo's-stuff; treat it like a vault. When in doubt about a delete or move, ask first.
