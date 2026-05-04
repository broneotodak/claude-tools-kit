# Phase 6 Fine-Tuning — Hybrid Hardware Strategy

**Status:** active strategy as of 2026-05-04 (spec captures Strategy C decision)
**Owner:** NACA project (Phase 6 — Personalization & Independence)
**Companion files in this folder:** `extract.js`, `prepare-training.js`, `upload-dataset.py`, `spin-pod.mjs`, `train.py`, `merge-adapter.py`, `compare.py`, `compare-results.md`, `chat-local.py`

---

## 1. Strategy C — Hybrid hardware (Neo, 2026-05-04)

| Tier | Hardware | Workload | Why |
|---|---|---|---|
| **Iteration** | tr-home (RX 7900 XTX 24GB, ROCm 6.2) | small bases (≤7B), per-experiment LoRA, eval+iterate loops | Zero cloud cost. Cycle time = whenever. Plugged in 24/7. Proves toolchain on local hw before cloud spend. |
| **Production** | RunPod (A100/H100 spot) | large bases (≥13B), full-corpus runs, final adapters | Faster wall-clock. Scaled VRAM. Hourly billing pressure ensures runs finish. |

**Heuristic:** if it fits in 24GB VRAM during training (typically ≤7B QLoRA), default to tr-home. If not, RunPod.

---

## 2. What Run 1 looked like (the reference)

Per `compare-results.md` + neo-brain memory `project_phase6_run1_complete.md`:

- **Base:** `mesolitica/Malaysian-Qwen2.5-7B-Instruct` (BM-localized variant)
- **Adapter:** `broneotodak/neo-voice-qwen-v1` (LoRA, published to HF)
- **Sampling:** temp=0.8, top_p=0.95, max_new=180
- **Eval:** 8 hand-picked prompts spanning DM/group, technical/casual, BM-EN code-switch
- **Verdict:** ~60% Neo-likeness, NOT deployed. Captures the right tone in some scenes (creative/casual), wanders in others (technical/long-form).
- **Cost:** ~RM0.80 on RunPod RTX 3090 spot
- **Toolchain:** validated end-to-end on RunPod (extract → upload → train → compare → merge)

That run is the **baseline**. Going forward we iterate on prompts, dataset slicing, LoRA config, base model — all on tr-home for short feedback loops.

---

## 3. tr-home toolchain (NEW — to install)

Installed once into a Python 3.12 venv at `~/.openclaw/phase6/.venv/` on tr-home:

```bash
# ROCm-PyTorch (gfx1100 supported)
pip install --index-url https://download.pytorch.org/whl/rocm6.2 torch torchvision

# Standard HF stack — backend-agnostic
pip install transformers peft accelerate datasets evaluate trl bitsandbytes safetensors

# Smoke-test packages
pip install jupyter ipykernel  # for one-off probing
```

**Out of scope:** unsloth (CUDA-only), vLLM (ROCm support patchy — Ollama is the serving layer).

**Smoke test (proves the toolchain works on this gfx1100 before any real run):**

```python
import torch
print('CUDA-style API available:', torch.cuda.is_available())  # True for ROCm via HIP
print('Device:', torch.cuda.get_device_name(0))                # AMD Radeon RX 7900 XTX

from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import LoraConfig, get_peft_model

tok = AutoTokenizer.from_pretrained('Qwen/Qwen2.5-0.5B-Instruct')   # tiny model for smoke
m = AutoModelForCausalLM.from_pretrained('Qwen/Qwen2.5-0.5B-Instruct').to('cuda')
m = get_peft_model(m, LoraConfig(r=8, target_modules=['q_proj','v_proj']))
print('PEFT wrapped:', sum(p.numel() for p in m.parameters() if p.requires_grad), 'trainable params')
```

If that prints without error → green light for real runs.

---

## 4. Per-step hardware allocation (Phase 6 NACA milestones)

| Step | What | Target hw | Status |
|---|---|---|---|
| 1-3 | Dataset extraction (`extract.js`, weekly cron) | local (anywhere) | ✅ done — 12,464 rows |
| 4 | HF + RunPod creds in vault | n/a | ✅ done |
| **5** | **Intent classifier** (small, 5,934-row wa-primary slice) | **tr-home** (7B QLoRA fits comfortably) | ⏳ todo — first tr-home run |
| 6 | Siti integration (classifier in front of Gemini) | n/a (HTTP wiring) | ⏳ todo |
| 7 | A/B harness + 7-day soak | n/a (orchestration) | ⏳ todo |
| **8** | **Voice rewriter** (Phase 6.2 — full corpus, possibly 13B+ base) | **RunPod** (size doesn't fit 24GB headroom) | ⏳ todo |
| 9 | Neo-Twin auto-reply (live shadow soak) | inference: tr-home (qwen2.5:32B), training pending Step 8 | 🟡 partial |

---

## 5. Dataset access pattern (tr-home pulls from neo-brain)

`extract.js` runs as a weekly cron (per `weekly-extract.sh`). Output goes to `~/datasets/neo-corpus/<DATE>/`. To get it on tr-home:

```bash
# from operator machine that has the latest extract:
rsync -avh ~/datasets/neo-corpus/ neo@tr-home:~/datasets/neo-corpus/

# or, on tr-home directly (re-runs the extract on tr-home itself):
cd ~/code/claude-tools-kit/tools/dataset-pipeline && node extract.js --since-days 30
```

`prepare-training.js` then converts the JSONL slices into the chat-format dataset that `train.py` consumes.

---

## 6. Eval + deploy loop

After each tr-home training run:

1. **Eval:** `python compare.py --adapter <path> --prompts test-prompts.json` — runs the same 8 fixed prompts (compare-results.md format), records base-vs-fine-tuned outputs side-by-side. Neo scores manually.
2. **Score threshold:** ≥75% Neo-likeness on the eval set is the bar to consider deploying.
3. **Convert:** `python merge-adapter.py` merges LoRA into base, then convert merged model → GGUF via llama.cpp's `convert_hf_to_gguf.py`.
4. **Deploy back to Ollama:**
   ```bash
   ollama create neo-voice-v2 -f Modelfile  # Modelfile points at the merged GGUF
   ollama run neo-voice-v2
   ```
5. **Wire into neo-twin Tier 2:** Twin VPS orchestrator switches its `OLLAMA_MODEL` env from `qwen2.5:32b` → `neo-voice-v2`. Restart pm2.

---

## 7. CTK constraints applying to Phase 6 runs

- **§4 vault:** all model/HF/RunPod credentials live in neo-brain `credentials`. Never hardcode.
- **§9 multi-session:** Phase 6 is NACA-domain. Before each milestone-row update or major hardware/script change, post a 3-line intent note for the NACA-focused CC session.
- **§6 monitoring:** if eval hits a threshold (e.g. drift detection vs ground truth), the supervisor watches it via /api/health-style aggregate — don't build half-done monitors.
- **§3.5 doc/memory:** this spec is THE engineering doc; per-experiment notes go to neo-brain memory tagged `phase6-experiment-N`; progress notes go to PR descriptions or the milestone item_status.

---

## 8. Open questions

- **Base model for Step 5 intent classifier:** Mesolitica's `Malaysian-Qwen2.5-7B-Instruct` (continuity with Run 1) vs `gemma-2-2b` (fast, English-anchored, classifier-friendly) vs `Qwen/Qwen2.5-1.5B-Instruct` (smallest viable for BM)?
- **Label schema for intent classifier:** flat list (greeting/question/decision/banter/...) or hierarchical (domain × intent)?
- **Eval bar:** is 75% the right threshold, or do we need to set per-scenario thresholds (group banter vs technical decisions)?
- **GGUF conversion on tr-home:** ROCm doesn't accelerate llama.cpp's quantize step the same way CUDA does — may need to convert on Mac or via cloud.
- **When does 7B → 13B promotion happen?** Run 1 saw 60% likeness on 7B. Maybe 13B is the unlock. Costs ~RM3-4 on RunPod for full run. Worth it after 2-3 7B iterations on tr-home plateau.

---

## 9. Pointers

- This file: `claude-tools-kit/tools/dataset-pipeline/PHASE6_FINE_TUNING.md`
- Related milestones: `project_milestones WHERE project='naca-app' AND phase_code LIKE 'phase-6%'` (rendered on `presentation.neotodak.com/naca-overview.html`)
- Neo-brain memories: tag `category='phase6-experiment-N'` (per-run notes), `category='shared_infra_change'` (decisions)
- Companion neo-twin spec: `claude-tools-kit/specs/neo-twin-v2.md` (covers the Tier 2 inference seat that Phase 6.2 voice rewriter eventually fills)
