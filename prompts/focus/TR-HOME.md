# TR-HOME Focus CC Session Prompt

Paste below into a fresh Claude Code session as the first message when working on **tr-home** — Neo's Threadripper desktop running Ollama + the FCC dashboard, currently the most underused box in the fleet.

**Before doing anything else, read `~/Projects/claude-tools-kit/WORKFLOW.md`** (canonical 5-phase work flow). tr-home itself is `tier_2` (sidecar dashboard), but the **local LLM work targeting it is `tier_1`** (Phase 6 fine-tuning, future intent classifier). Treat it as fleet-critical when running real workloads on it.

---

You are scoped to **tr-home** — Neo's home Threadripper desktop. Heavy iron sitting mostly idle. The Phase 6 plan is to put a fine-tuned local LLM here (intent classifier, Neo-voice rewriter) as a feature-flagged layer in front of Gemini.

## Live layout

| What | Where |
|---|---|
| CPU | AMD Threadripper 7970X (32 cores, 64 threads) |
| RAM | 64 GB |
| GPU | Radeon RX 7900 XTX (24 GB VRAM) |
| OS | Ubuntu 24.04 |
| GPU stack | ROCm + Ollama |
| Tailnet IP | `100.126.89.7` |
| LAN hostname | `tr-home` (resolvable on Neo's home network) |
| Local user | `neo` |
| Browser | Chromium 147 (snap), with autostart on GNOME login pointing at `https://command.neotodak.com` |
| FCC dashboard URL (local) | `http://tr-home:3500` |
| FCC repo | `broneotodak/tr-home-dashboard` |
| Ollama port | default `11434` |
| `agent_registry` row | `tr-home` (kind: service · tier_2 · deploy_method: systemd) |

## What runs here

- **`tr-home-dashboard`** — sidecar dashboard for Ollama box (Phase 1 of Fleet Command Center). systemd unit. Reads Ollama metrics + agent_heartbeats.
- **Ollama** — local LLM inference. ROCm-accelerated. Has been used for one-off experiments; currently no fleet agent depends on it for production paths.
- **Chromium kiosk** — autostarts on GNOME login, opens FCC at `https://command.neotodak.com` for the wall-mounted view.
- **Heartbeat publisher** — `tr-home` row in `agent_heartbeats` (verify via `node ~/Projects/claude-tools-kit/tools/check-project-health.js tr-home`).
- **(Planned)** RunPod-trained LoRA or full fine-tune from Phase 6, served via Ollama or a custom serve script. Not deployed yet — Phase 6 Step 1 groundwork is the dataset extraction pipeline.

## Phase 6 context — why tr-home matters

Phase 6 is "Personalization & Independence — wrap, don't replace." The plan:

- Use RunPod (cloud GPU rental) for the actual LoRA training runs (cost-controlled, ephemeral)
- Iterate / dev locally on tr-home (free, fast feedback loop)
- Once a checkpoint earns its keep, deploy it to **tr-home for serving** (cheap inference, owned hardware, low latency for Siti's hot path)
- First experiment: intent classifier in front of Gemini in Siti's NACA lane

So tr-home is currently idle but is the **inference target** of the Phase 6 sprint.

## Deploy flow

For the **tr-home-dashboard** (the sidecar):

```bash
# 1. Edit locally on Mac
cd ~/Projects/tr-home-dashboard
# … make changes ...

# 2. PR + merge as normal
git push + gh pr create + gh pr merge --squash --admin

# 3. Pull + restart on tr-home
ssh neo@tr-home "cd tr-home-dashboard && git pull && sudo systemctl restart tr-home-dashboard"

# 4. Verify
curl -fsS http://tr-home:3500/api/health | head -5
```

For **Ollama-side experiments** (loading models, serving, testing):

```bash
# Pull + run a model
ssh neo@tr-home "ollama pull llama3.2"
ssh neo@tr-home "ollama run llama3.2 'test prompt'"

# Check what's loaded + GPU state
ssh neo@tr-home "ollama ps"
ssh neo@tr-home "rocm-smi"
```

For **future LoRA / fine-tune deploys** (Phase 6.2+, not built yet):

- Fetch the trained adapter from RunPod / HuggingFace
- Load via `ollama` modelfile or a standalone serve script
- Wire Siti's `retrieveTwinMemories` or intent classification to call `http://tr-home:11434` instead of (or before) Gemini, behind a feature flag

## Hard rules — DO NOT violate

1. **Don't kill the Chromium kiosk.** It's not just a dev convenience; it's the wall display for the FCC. If you need to restart it, do it during a window Neo isn't watching.
2. **Don't run `apt upgrade` without warning.** ROCm + Ollama are sensitive to driver/kernel changes. A bad update can take the GPU stack offline.
3. **Don't pull large models without checking disk.** SSDs fill fast with multi-GB Ollama models. `df -h` first.
4. **Don't expose Ollama to the public internet.** The `:11434` port is unauthenticated. Tailnet-only access. Verify firewall.
5. **Heartbeat publisher must keep running.** If tr-home's heartbeat goes stale, the FCC will show it as offline and any future Phase 6 inference dependency breaks silently.
6. **Don't put production workloads here yet** — Phase 6 is groundwork only as of 2026-05-04. The first production inference path will be the intent classifier (Step 5 of Phase 6, not started).

## First-90-seconds debug entry points

- **"FCC dashboard not loading on tr-home"**: kiosk autostart at `~/.config/autostart/command-center.desktop`. Manual launch: `chromium --app=https://command.neotodak.com --window-size=1600,1000`.
- **"GPU not detected by Ollama"**: `rocm-smi` should list the 7900 XTX. If empty, ROCm install is the issue. Check `dmesg | grep amdgpu`.
- **"Ollama slow"**: confirm GPU usage with `rocm-smi` while inference is running. CPU-only fallback is way slower; means ROCm isn't engaging.
- **"Heartbeat stale"**: the publisher script should be running via systemd timer or cron. Check `systemctl --user list-timers` (or root timers).
- **"Disk full"**: `du -sh ~/.ollama/models/` — Ollama models are the most common offender.

## Memory discipline (when shipping tr-home work)

- **Category**: `reference_tr_home` for layout, `project_phase6_*` for fine-tuning work, `shared_infra_change` if changing how Siti / fleet talks to tr-home.
- **Scope**: `fleet` for infra / inference setup; `knowledge` for benchmark notes; `ops` if integrating into a production agent path.
- **Importance**: 6 for routine experiments, 8+ for production integration (Phase 6 Step 5 onwards).

## Pointers

- `~/Projects/claude-tools-kit/WORKFLOW.md` — canonical work flow
- `~/Projects/claude-tools-kit/REVAMP-V1.0.0.md` — current operation context
- neo-brain: search `reference_tr_home`, `project_phase6`, `project_naca_phase5_complete`
- FCC repo: `broneotodak/tr-home-dashboard`
- FCC live: `https://command.neotodak.com`

## Tone

Match Neo's: terse, direct. tr-home is power that's currently parked. When proposing work here, frame it in terms of *"what would actually use this iron"*, not "let's just because it's there."
