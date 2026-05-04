#!/usr/bin/env python3
"""
Evaluate a trained topic-classifier adapter on the held-out test set.

Loads `final/` adapter from train-classifier.py output, runs greedy decode
across all test rows, and prints per-class precision/recall/F1 + confusion
matrix + sample-of-wrong-predictions for analysis.

Usage on tr-home:
  source ~/.openclaw/phase6/.venv/bin/activate
  python3 eval-classifier.py
  python3 eval-classifier.py --adapter ~/.openclaw/phase6/runs/topic-classifier-v1/final
  python3 eval-classifier.py --base-only    # eval the BASE model with no LoRA — sanity baseline

Outputs:
  - stdout: human-readable report
  - <adapter>/eval-report.json: machine-readable metrics for tracking
  - <adapter>/eval-wrong-samples.txt: 30 misclassifications for eyeball analysis
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument('--adapter', type=Path,
                   default=Path.home() / '.openclaw' / 'phase6' / 'runs' / 'topic-classifier-v1' / 'final',
                   help='trained adapter dir from train-classifier.py')
    p.add_argument('--test', type=Path,
                   default=Path.home() / 'datasets' / 'neo-corpus' / 'training' / 'topic-classifier-v1' / 'test.jsonl',
                   help='test set JSONL')
    p.add_argument('--base-only', action='store_true',
                   help='skip LoRA adapter — evaluate the base model alone (baseline)')
    p.add_argument('--base', type=str, default='Qwen/Qwen2.5-1.5B-Instruct',
                   help='base model id (used for --base-only or fallback)')
    p.add_argument('--max-rows', type=int, default=0, help='cap test rows (0 = all)')
    return p.parse_args()


PROMPT_TEMPLATE = "Classify the topic of this WhatsApp message: {text}"


def main() -> int:
    args = parse_args()

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    print(f'# Phase 6 Step 5 — eval')
    print(f'  test     : {args.test}')
    print(f'  adapter  : {args.adapter if not args.base_only else "(skipped — base only)"}')
    print(f'  base     : {args.base}')
    print()

    if not args.test.exists():
        print(f'ERROR: missing {args.test}', file=sys.stderr)
        return 1

    test_rows = [json.loads(l) for l in args.test.read_text(encoding='utf-8').splitlines() if l.strip()]
    if args.max_rows:
        test_rows = test_rows[:args.max_rows]
    labels = sorted({r['label'] for r in test_rows})
    label_set = set(labels)
    print(f'  test rows: {len(test_rows)}')
    print(f'  labels   : {labels}')
    print()

    # Load
    if args.base_only:
        tok = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(args.base, dtype=torch.bfloat16, device_map='auto', trust_remote_code=True)
    else:
        if not args.adapter.exists():
            print(f'ERROR: adapter not found at {args.adapter}. Train first or pass --base-only for baseline.', file=sys.stderr)
            return 1
        manifest = json.loads((args.adapter / 'training_manifest.json').read_text())
        base_id = manifest['base_model']
        tok = AutoTokenizer.from_pretrained(args.adapter, trust_remote_code=True)
        base = AutoModelForCausalLM.from_pretrained(base_id, dtype=torch.bfloat16, device_map='auto', trust_remote_code=True)
        model = PeftModel.from_pretrained(base, str(args.adapter))
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    model.eval()

    # Predict
    print('## Predicting')
    preds = []
    invalid = 0
    with torch.no_grad():
        for i, r in enumerate(test_rows):
            if i % 50 == 0 and i > 0:
                print(f'  {i}/{len(test_rows)}')
            user_msg = PROMPT_TEMPLATE.format(text=r['text'])
            prompt = tok.apply_chat_template(
                [{'role': 'user', 'content': user_msg}],
                tokenize=False, add_generation_prompt=True,
            )
            ids = tok(prompt, return_tensors='pt').to(model.device)
            out = model.generate(**ids, max_new_tokens=8, do_sample=False, pad_token_id=tok.eos_token_id)
            gen = tok.decode(out[0][ids['input_ids'].shape[1]:], skip_special_tokens=True).strip()
            first_token = gen.split()[0] if gen.split() else ''
            pred = first_token.lower().strip('.,!?\'\"')
            if pred not in label_set:
                invalid += 1
                preds.append({'gold': r['label'], 'pred': '__INVALID__', 'raw': gen, 'text': r['text']})
            else:
                preds.append({'gold': r['label'], 'pred': pred, 'raw': gen, 'text': r['text']})

    # Aggregate
    correct = sum(1 for p in preds if p['gold'] == p['pred'])
    acc = correct / len(preds)

    # Per-class P/R/F1
    per_class = {}
    for label in labels:
        tp = sum(1 for p in preds if p['gold'] == label and p['pred'] == label)
        fp = sum(1 for p in preds if p['gold'] != label and p['pred'] == label)
        fn = sum(1 for p in preds if p['gold'] == label and p['pred'] != label)
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
        per_class[label] = {'precision': prec, 'recall': rec, 'f1': f1, 'support': tp + fn}

    macro_f1 = sum(c['f1'] for c in per_class.values()) / len(per_class)

    # Confusion matrix (top mistakes)
    confusions = Counter()
    for p in preds:
        if p['gold'] != p['pred'] and p['pred'] != '__INVALID__':
            confusions[(p['gold'], p['pred'])] += 1

    # Report
    print()
    print(f'## Results ({len(preds)} test rows)')
    print(f'  accuracy        : {acc:.3f}')
    print(f'  macro F1        : {macro_f1:.3f}')
    print(f'  invalid generations: {invalid} ({100 * invalid / len(preds):.1f}%)')
    print()
    print('  per-class:')
    print(f'    {"label".ljust(14)} {"prec".rjust(6)} {"rec".rjust(6)} {"F1".rjust(6)} {"support".rjust(8)}')
    for label, m in sorted(per_class.items(), key=lambda x: -x[1]['support']):
        print(f'    {label.ljust(14)} {m["precision"]:6.3f} {m["recall"]:6.3f} {m["f1"]:6.3f} {m["support"]:8d}')

    if confusions:
        print()
        print('  top confusions (gold → pred · count):')
        for (gold, pred), n in confusions.most_common(10):
            print(f'    {gold:<14} → {pred:<14}  {n}')

    # Save report
    if not args.base_only:
        report_path = args.adapter / 'eval-report.json'
        report_path.write_text(json.dumps({
            'accuracy': acc,
            'macro_f1': macro_f1,
            'per_class': per_class,
            'confusions': {f'{g}->{p}': n for (g, p), n in confusions.most_common()},
            'invalid_generations': invalid,
            'n_test': len(preds),
            'invalid_rate': invalid / len(preds),
        }, indent=2))
        print()
        print(f'  → wrote {report_path}')

        wrong_path = args.adapter / 'eval-wrong-samples.txt'
        wrong_lines = ['# 30 sample misclassifications for eyeball analysis\n']
        wrong = [p for p in preds if p['gold'] != p['pred']][:30]
        for p in wrong:
            wrong_lines.append(f'GOLD={p["gold"]:<12} PRED={p["pred"]:<12}\n  text: {p["text"][:200]}\n  raw : {p["raw"][:80]}\n')
        wrong_path.write_text('\n'.join(wrong_lines))
        print(f'  → wrote {wrong_path}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
