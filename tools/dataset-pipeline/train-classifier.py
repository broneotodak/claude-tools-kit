#!/usr/bin/env python3
"""
Train a topic classifier on the wa-primary slice (Phase 6 Step 5).

Pipeline (downstream of prepare-classifier-data.py):
  1. Load train.jsonl / val.jsonl from ~/datasets/neo-corpus/training/topic-classifier-v1/
  2. Format each row as Qwen chat template:
       <|im_start|>user\\nClassify the topic of this WhatsApp message: <text><|im_end|>
       <|im_start|>assistant\\n<label><|im_end|>
  3. Tokenize, mask the user-prompt portion in `labels` (loss only on assistant output).
  4. Wrap Qwen2.5-1.5B-Instruct with PEFT LoRA (r=16, target q/k/v/o/gate/up/down).
  5. Train via HF Trainer — bf16, batch 8 with grad accum, lr 2e-4, 2 epochs.
  6. Save final adapter + best-by-val-loss to ~/.openclaw/phase6/runs/topic-classifier-v1/
  7. Print val accuracy at end (greedy decode on val set).

Usage on tr-home:
  source ~/.openclaw/phase6/.venv/bin/activate
  TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL=1 python3 train-classifier.py
  python3 train-classifier.py --epochs 1 --quick    # tiny smoke run
  python3 train-classifier.py --base Qwen/Qwen2.5-7B-Instruct  # try bigger base
"""

import argparse
import json
import os
import random
import sys
from pathlib import Path
from typing import Optional

# Set deterministic seeds before importing torch (some kernels read env on init)
os.environ.setdefault('PYTHONHASHSEED', '42')


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument('--data-dir', type=Path,
                   default=Path.home() / 'datasets' / 'neo-corpus' / 'training' / 'topic-classifier-v1',
                   help='dir with train.jsonl + val.jsonl + manifest.json')
    p.add_argument('--out-dir', type=Path,
                   default=Path.home() / '.openclaw' / 'phase6' / 'runs' / 'topic-classifier-v1',
                   help='where to save adapter + checkpoints')
    p.add_argument('--base', type=str, default='Qwen/Qwen2.5-1.5B-Instruct',
                   help='base model HF id (default Qwen/Qwen2.5-1.5B-Instruct)')
    p.add_argument('--epochs', type=int, default=2)
    p.add_argument('--batch-size', type=int, default=8, help='per-device train batch size')
    p.add_argument('--grad-accum', type=int, default=2, help='effective batch = batch_size * grad_accum')
    p.add_argument('--lr', type=float, default=2e-4)
    p.add_argument('--max-length', type=int, default=512, help='max tokens per example')
    p.add_argument('--lora-r', type=int, default=16)
    p.add_argument('--lora-alpha', type=int, default=32)
    p.add_argument('--seed', type=int, default=42)
    p.add_argument('--quick', action='store_true',
                   help='smoke run — 50 train rows, 1 epoch')
    return p.parse_args()


PROMPT_TEMPLATE = "Classify the topic of this WhatsApp message: {text}"


def main() -> int:
    args = parse_args()

    # Imports here so --help works without the heavy stack
    import torch
    from datasets import Dataset
    from transformers import (
        AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer,
        DataCollatorForSeq2Seq, set_seed,
    )
    from peft import LoraConfig, get_peft_model, TaskType

    set_seed(args.seed)
    random.seed(args.seed)

    print(f'# Phase 6 Step 5 — topic classifier training')
    print(f'  base       : {args.base}')
    print(f'  data       : {args.data_dir}')
    print(f'  out        : {args.out_dir}')
    print(f'  epochs     : {args.epochs}{"  (QUICK)" if args.quick else ""}')
    print(f'  batch      : {args.batch_size} × grad_accum {args.grad_accum} = effective {args.batch_size * args.grad_accum}')
    print(f'  lr         : {args.lr}')
    print(f'  lora       : r={args.lora_r}, alpha={args.lora_alpha}')
    print(f'  device     : {"cuda:0 (" + torch.cuda.get_device_name(0) + ")" if torch.cuda.is_available() else "CPU"}')
    print()

    # ── load data ──────────────────────────────────────────────────────────────
    train_path = args.data_dir / 'train.jsonl'
    val_path = args.data_dir / 'val.jsonl'
    if not train_path.exists() or not val_path.exists():
        print(f'ERROR: missing {train_path} or {val_path}. Run prepare-classifier-data.py first.', file=sys.stderr)
        return 1

    def load_jsonl(p: Path) -> list[dict]:
        return [json.loads(l) for l in p.read_text(encoding='utf-8').splitlines() if l.strip()]

    train_rows = load_jsonl(train_path)
    val_rows = load_jsonl(val_path)
    if args.quick:
        train_rows = train_rows[:50]
        val_rows = val_rows[:20]
        args.epochs = 1
    print(f'  train rows : {len(train_rows)}')
    print(f'  val   rows : {len(val_rows)}')

    labels = sorted({r['label'] for r in train_rows})
    print(f'  labels     : {labels}')
    print()

    # ── tokenizer + model ──────────────────────────────────────────────────────
    print('## Loading tokenizer + model (this may take 1-2 min for first download)')
    tok = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    tok.padding_side = 'right'

    model = AutoModelForCausalLM.from_pretrained(
        args.base, dtype=torch.bfloat16, device_map='auto', trust_remote_code=True,
    )
    model.config.use_cache = False  # required for gradient checkpointing later

    # ── PEFT LoRA wrap ─────────────────────────────────────────────────────────
    lora_cfg = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=args.lora_r, lora_alpha=args.lora_alpha, lora_dropout=0.05, bias='none',
        target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj',
                        'gate_proj', 'up_proj', 'down_proj'],
    )
    model = get_peft_model(model, lora_cfg)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f'  trainable  : {trainable:,} / {total:,} ({100 * trainable / total:.2f}%)')
    print()

    # ── format + tokenize ──────────────────────────────────────────────────────
    def format_example(row: dict) -> dict:
        user_msg = PROMPT_TEMPLATE.format(text=row['text'])
        prompt = tok.apply_chat_template(
            [{'role': 'user', 'content': user_msg}],
            tokenize=False, add_generation_prompt=True,
        )
        full = prompt + row['label'] + tok.eos_token
        prompt_ids = tok(prompt, add_special_tokens=False)['input_ids']
        full_enc = tok(full, max_length=args.max_length, truncation=True, padding=False, add_special_tokens=False)
        labels = list(full_enc['input_ids'])
        # Mask the user-prompt portion so loss is computed only on the label
        plen = min(len(prompt_ids), len(labels))
        for i in range(plen):
            labels[i] = -100
        return {
            'input_ids': full_enc['input_ids'],
            'attention_mask': full_enc['attention_mask'],
            'labels': labels,
        }

    print('## Tokenizing')
    train_ds = Dataset.from_list(train_rows).map(format_example, remove_columns=['id', 'text', 'label', 'chat_type', 'is_group', 'score', 'ts'])
    val_ds = Dataset.from_list(val_rows).map(format_example, remove_columns=['id', 'text', 'label', 'chat_type', 'is_group', 'score', 'ts'])
    print(f'  train tokenized: {len(train_ds)} examples')
    print(f'  val   tokenized: {len(val_ds)} examples')

    # ── training ───────────────────────────────────────────────────────────────
    args.out_dir.mkdir(parents=True, exist_ok=True)
    train_args = TrainingArguments(
        output_dir=str(args.out_dir / 'checkpoints'),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        gradient_checkpointing=True,
        learning_rate=args.lr,
        lr_scheduler_type='cosine',
        warmup_ratio=0.05,
        weight_decay=0.01,
        bf16=True,
        logging_steps=20,
        eval_strategy='steps',
        eval_steps=200,
        save_strategy='steps',
        save_steps=200,
        save_total_limit=2,
        load_best_model_at_end=True,
        metric_for_best_model='eval_loss',
        greater_is_better=False,
        report_to='none',
        seed=args.seed,
    )

    collator = DataCollatorForSeq2Seq(tokenizer=tok, padding=True, label_pad_token_id=-100)

    trainer = Trainer(
        model=model,
        args=train_args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        data_collator=collator,
    )

    print('## Training start')
    trainer.train()

    # ── save final adapter + tokenizer + manifest ──────────────────────────────
    print('## Saving final adapter')
    final_dir = args.out_dir / 'final'
    final_dir.mkdir(parents=True, exist_ok=True)
    trainer.model.save_pretrained(str(final_dir))
    tok.save_pretrained(str(final_dir))
    (final_dir / 'training_manifest.json').write_text(json.dumps({
        'base_model': args.base,
        'epochs': args.epochs,
        'effective_batch_size': args.batch_size * args.grad_accum,
        'learning_rate': args.lr,
        'lora_r': args.lora_r,
        'lora_alpha': args.lora_alpha,
        'labels': labels,
        'prompt_template': PROMPT_TEMPLATE,
        'train_rows': len(train_rows),
        'val_rows': len(val_rows),
        'seed': args.seed,
    }, indent=2))
    print(f'  saved → {final_dir}')

    # ── quick val accuracy via greedy decode ───────────────────────────────────
    print('## Validation accuracy (greedy decode)')
    model.eval()
    correct = 0
    invalid = 0
    label_set = set(labels)
    sample_n = min(len(val_rows), 100)  # fast eyeball; eval-classifier.py does full
    with torch.no_grad():
        for r in val_rows[:sample_n]:
            user_msg = PROMPT_TEMPLATE.format(text=r['text'])
            prompt = tok.apply_chat_template(
                [{'role': 'user', 'content': user_msg}],
                tokenize=False, add_generation_prompt=True,
            )
            ids = tok(prompt, return_tensors='pt').to(model.device)
            out = model.generate(**ids, max_new_tokens=8, do_sample=False, pad_token_id=tok.eos_token_id)
            gen = tok.decode(out[0][ids['input_ids'].shape[1]:], skip_special_tokens=True).strip().split()[0] if out[0].numel() > 0 else ''
            gen_clean = gen.lower().strip('.,!?\'\"')
            if gen_clean not in label_set:
                invalid += 1
            elif gen_clean == r['label']:
                correct += 1

    acc = correct / sample_n
    print(f'  sample size       : {sample_n}')
    print(f'  correct           : {correct}')
    print(f'  invalid generation: {invalid}  (model produced non-label text)')
    print(f'  accuracy          : {acc:.3f}')
    print()
    print('Done. Run eval-classifier.py for full per-class precision/recall/F1 on test set.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
