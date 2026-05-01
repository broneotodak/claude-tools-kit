#!/usr/bin/env python3
"""
LoRA fine-tune of mesolitica/Malaysian-Qwen2.5-7B-Instruct on Neo's WhatsApp voice.

Designed to run on RunPod A100 40GB. Pulls dataset from HuggingFace, trains LoRA
adapter (rank 32, 3 epochs), pushes adapter back to HuggingFace as private repo.

Usage on a fresh RunPod pod (Ubuntu + CUDA + Python 3.11):
  pip install -r requirements.txt
  export HF_TOKEN=<from neo-brain credentials vault>
  python train.py --dataset broneotodak/neo-voice-train --output broneotodak/neo-voice-qwen-v1

Local sanity test (no GPU, just argument parsing + model card lookup):
  python train.py --dry-run --dataset broneotodak/neo-voice-train --output broneotodak/neo-voice-qwen-v1

Designed for SFTTrainer (TRL). Uses 4-bit base + LoRA → ~24GB VRAM on A100 40GB.
"""

import argparse
import os
import sys
from pathlib import Path

BASE_MODEL = "mesolitica/Malaysian-Qwen2.5-7B-Instruct"


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", required=True, help="HF dataset id (e.g. broneotodak/neo-voice-train)")
    p.add_argument("--output", required=True, help="HF repo id to push adapter to (e.g. broneotodak/neo-voice-qwen-v1)")
    p.add_argument("--base", default=BASE_MODEL, help=f"base model (default: {BASE_MODEL})")
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--lora-rank", type=int, default=32)
    p.add_argument("--lora-alpha", type=int, default=64)
    p.add_argument("--learning-rate", type=float, default=2e-4)
    p.add_argument("--batch-size", type=int, default=2)
    p.add_argument("--grad-accum", type=int, default=8)
    p.add_argument("--max-seq-len", type=int, default=2048)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--save-dir", default="./out")
    p.add_argument("--dry-run", action="store_true", help="parse args, print plan, exit")
    p.add_argument("--push", action="store_true", help="push trained adapter to HF (default: save locally only)")
    return p.parse_args()


def main():
    args = parse_args()

    plan = {
        "base_model": args.base,
        "dataset": args.dataset,
        "output_repo": args.output,
        "epochs": args.epochs,
        "lora_rank": args.lora_rank,
        "lora_alpha": args.lora_alpha,
        "learning_rate": args.learning_rate,
        "effective_batch": args.batch_size * args.grad_accum,
        "max_seq_len": args.max_seq_len,
        "save_dir": args.save_dir,
        "push_to_hub": bool(args.push),
    }
    print("=== Training plan ===")
    for k, v in plan.items():
        print(f"  {k:20s} : {v}")

    if args.dry_run:
        print("\n[dry-run] not loading model. Exiting.")
        return

    # Heavy imports gated behind dry-run so the script can be lint-checked locally
    # without GPU deps installed.
    print("\n→ Importing torch / transformers / peft / datasets / trl ...")
    import torch
    from datasets import load_dataset
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
    )
    from peft import LoraConfig, prepare_model_for_kbit_training
    from trl import SFTTrainer, SFTConfig

    if not torch.cuda.is_available():
        print("ERROR: CUDA not available — this script needs a GPU.", file=sys.stderr)
        sys.exit(1)

    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        print("ERROR: HF_TOKEN env var not set (required to pull private dataset + push adapter).", file=sys.stderr)
        sys.exit(1)

    # ─── DATASET ─────────────────────────────────────────────────────────────
    print(f"\n→ Loading dataset: {args.dataset}")
    ds = load_dataset(args.dataset, split="train", token=hf_token)
    print(f"  rows: {len(ds)}")

    # ─── MODEL + TOKENIZER ───────────────────────────────────────────────────
    print(f"\n→ Loading base model: {args.base}")
    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(args.base, token=hf_token)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        args.base,
        quantization_config=bnb,
        device_map="auto",
        torch_dtype=torch.bfloat16,
        token=hf_token,
    )
    model = prepare_model_for_kbit_training(model)

    # ─── LORA CONFIG ─────────────────────────────────────────────────────────
    lora = LoraConfig(
        r=args.lora_rank,
        lora_alpha=args.lora_alpha,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )

    # ─── TRAIN CONFIG ────────────────────────────────────────────────────────
    save_dir = Path(args.save_dir)
    save_dir.mkdir(parents=True, exist_ok=True)
    sft_cfg = SFTConfig(
        output_dir=str(save_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.learning_rate,
        bf16=True,
        logging_steps=10,
        save_strategy="epoch",
        save_total_limit=2,
        seed=args.seed,
        max_seq_length=args.max_seq_len,
        packing=False,
        report_to="none",
        warmup_ratio=0.03,
        lr_scheduler_type="cosine",
        push_to_hub=False,  # we push the LoRA adapter manually after
    )

    # ─── TRAIN ───────────────────────────────────────────────────────────────
    print("\n→ Starting training ...")
    # trl 0.11.x: needs explicit formatting_func for chat-format datasets (no auto-detect)
    def formatting_func(example):
        return tokenizer.apply_chat_template(example["messages"], tokenize=False)

    trainer = SFTTrainer(
        model=model,
        train_dataset=ds,
        peft_config=lora,
        tokenizer=tokenizer,
        formatting_func=formatting_func,
        args=sft_cfg,
    )
    trainer.train()

    # ─── SAVE ────────────────────────────────────────────────────────────────
    final_dir = save_dir / "final"
    print(f"\n→ Saving adapter to {final_dir}")
    trainer.save_model(str(final_dir))
    tokenizer.save_pretrained(str(final_dir))

    if args.push:
        print(f"\n→ Pushing adapter to HF: {args.output}")
        trainer.model.push_to_hub(args.output, token=hf_token, private=True)
        tokenizer.push_to_hub(args.output, token=hf_token, private=True)
        print("  pushed.")
    else:
        print("\n[--push not set] skipping HF upload. Adapter is in", final_dir)

    print("\nDone.")


if __name__ == "__main__":
    main()
