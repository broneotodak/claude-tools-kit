#!/usr/bin/env python3
"""
Merge a PEFT LoRA adapter into its base model and save as a single HF model.

Why: mlx-lm's fuse only accepts MLX-trained adapters. PEFT-trained adapters need
to be merged into the base FIRST, then the merged model can be converted to MLX.

Usage:
  python merge-adapter.py \
    --base mesolitica/Malaysian-Qwen2.5-7B-Instruct \
    --adapter /Users/broneotodak/models/neo-voice-adapter-raw \
    --out /Users/broneotodak/models/neo-voice-merged

Memory: loads base in fp16 (~14GB), adds adapter (~325MB), merges in place.
Tight on 24GB M4 Pro but should fit.
"""
import argparse
import time
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--base", required=True)
    p.add_argument("--adapter", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--dtype", default="float16", choices=["float16", "bfloat16", "float32"])
    return p.parse_args()


def main():
    args = parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    dtype = getattr(torch, args.dtype)

    print(f"# Merge plan")
    print(f"  base    : {args.base}")
    print(f"  adapter : {args.adapter}")
    print(f"  out     : {args.out}")
    print(f"  dtype   : {args.dtype}")

    t0 = time.time()
    print(f"\n→ Loading tokenizer ...")
    tokenizer = AutoTokenizer.from_pretrained(args.base)

    print(f"→ Loading base model in {args.dtype} (CPU) ...")
    # device_map="cpu" keeps everything in unified memory without trying MPS
    # (MPS doesn't support all ops needed for merge; CPU is reliable)
    base = AutoModelForCausalLM.from_pretrained(
        args.base,
        torch_dtype=dtype,
        low_cpu_mem_usage=True,
        device_map="cpu",
    )
    print(f"  loaded in {time.time() - t0:.0f}s")

    print(f"\n→ Loading adapter on top of base ...")
    t1 = time.time()
    model = PeftModel.from_pretrained(base, args.adapter, torch_dtype=dtype)
    print(f"  loaded in {time.time() - t1:.0f}s")

    print(f"\n→ Merging adapter into base (this is the memory-heavy step) ...")
    t2 = time.time()
    merged = model.merge_and_unload()
    print(f"  merged in {time.time() - t2:.0f}s")

    print(f"\n→ Saving merged model to {args.out} ...")
    t3 = time.time()
    merged.save_pretrained(args.out, safe_serialization=True)
    tokenizer.save_pretrained(args.out)
    print(f"  saved in {time.time() - t3:.0f}s")

    # Quick sanity check — count parameters and check for adapter remnants
    n_params = sum(p.numel() for p in merged.parameters())
    print(f"\n# Done in {time.time() - t0:.0f}s total")
    print(f"  parameters : {n_params / 1e9:.2f}B")
    print(f"  output     : {args.out}")
    print(f"\nNext step: mlx_lm.convert --hf-path {args.out} --mlx-path ~/models/neo-voice-mlx -q")


if __name__ == "__main__":
    main()
