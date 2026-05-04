#!/usr/bin/env python3
"""
Prepare wa-primary slice for topic-classifier fine-tuning (Phase 6 Step 5).

Sister of prepare-training.js (which builds chat pairs for the voice rewriter).
This one builds (raw_message → category_label) supervised classification data.

Pipeline:
  1. Read by-source/wa-primary.jsonl
  2. Strip the [dm]/[group:] wrapper + trailing "Person facts:" enrichment
     (mirrors prepare-training.js stripWrapper logic)
  3. Filter rows: classification_score >= --min-score (default 5)
  4. Drop categories with < --min-class-count examples (default 50);
     no merge into "other" — just exclude (cleaner signal)
  5. Stratified 80/10/10 train/val/test split — every label appears in val + test
  6. Emit JSONL: {id, text, label, chat_type, score} per row
  7. Write manifest.json with distribution, sizes, hashes

Usage:
  python3 prepare-classifier-data.py
  python3 prepare-classifier-data.py --in PATH --out DIR --min-score 6 --min-class-count 100
  python3 prepare-classifier-data.py --dry-run    # print stats, no writes
"""

import argparse
import hashlib
import json
import os
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional

# ── parsing helpers (mirror tools/dataset-pipeline/prepare-training.js stripWrapper) ──

_LEAD_BRACKET = re.compile(r'^\[(?:dm|group:[^\]]+)\]\s+')
_SAID_PREFIX = re.compile(r'^[^:]+ said(?: to [^:]+)?(?: in [^:]+)?:\s+')
_TRAILING_ENRICHMENT = re.compile(
    r'\n\n(?:Person facts|People facts|Topic|Summary|Context|Tags|Mentions|Entities):',
    re.IGNORECASE,
)
# Trailing "(in group: NAME)" annotation that wa-primary appends after the body.
# 26% of train rows in V1 had this residue — it leaks group identity into the
# input and lets the classifier shortcut-learn via group name. Strip it.
_TRAILING_GROUP_ANNOTATION = re.compile(r'\s*\(in group:[^)]*\)\s*$')


def strip_wrapper(content: Optional[str]) -> str:
    """Extract the raw inbound message text from an enriched content field.

    Handles:
      [dm] X said: "msg"                                     → msg
      [group: G] X said to Neo: "msg"                        → msg
      [group: G] X said to Neo: "msg" (in group: G)          → msg
      "msg\\n\\nPerson facts: ..."                            → msg
      "msg" (already raw)                                    → msg
    """
    if not content:
        return ''
    s = _LEAD_BRACKET.sub('', content)
    s = _SAID_PREFIX.sub('', s)
    # Drop trailing enrichment block (anything after the first marker)
    s = _TRAILING_ENRICHMENT.split(s, maxsplit=1)[0]
    # Strip trailing "(in group: NAME)" annotation BEFORE the quote-stripping pass,
    # so the quote-stripper sees true matched-quotes-at-both-ends.
    s = _TRAILING_GROUP_ANNOTATION.sub('', s).rstrip()
    # Strip surrounding quotes if present
    if len(s) >= 2 and s[0] in ('"', "'") and s[-1] == s[0]:
        s = s[1:-1]
    return s.strip()


# ── main ──────────────────────────────────────────────────────────────────────

def find_latest_wa_primary() -> Path:
    root = Path.home() / 'datasets' / 'neo-corpus'
    if not root.exists():
        raise SystemExit(f'No extract root at {root}. Run extract.js first.')
    dated = sorted(d.name for d in root.iterdir() if d.is_dir() and re.match(r'^\d{4}-\d{2}-\d{2}$', d.name))
    if not dated:
        raise SystemExit(f'No dated extracts under {root}.')
    return root / dated[-1] / 'by-source' / 'wa-primary.jsonl'


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument('--in', dest='in_path', type=Path, default=None,
                   help='wa-primary.jsonl input (default: latest extract)')
    p.add_argument('--out', dest='out_dir', type=Path,
                   default=Path.home() / 'datasets' / 'neo-corpus' / 'training' / 'topic-classifier-v1',
                   help='output dir (default: ~/datasets/neo-corpus/training/topic-classifier-v1/)')
    p.add_argument('--min-score', type=int, default=5,
                   help='drop rows where metadata.classification_score < this (default 5)')
    p.add_argument('--min-class-count', type=int, default=50,
                   help='drop categories with fewer examples than this (default 50)')
    p.add_argument('--seed', type=int, default=42, help='RNG seed for split (default 42)')
    p.add_argument('--dry-run', action='store_true', help='print stats but write nothing')
    return p.parse_args()


def main() -> int:
    args = parse_args()
    in_path: Path = args.in_path or find_latest_wa_primary()
    out_dir: Path = args.out_dir

    print(f'# Phase 6 classifier-data prep')
    print(f'  input         : {in_path}')
    print(f'  output dir    : {out_dir}{"  (DRY-RUN)" if args.dry_run else ""}')
    print(f'  min-score     : {args.min_score}')
    print(f'  min-class-cnt : {args.min_class_count}')
    print(f'  seed          : {args.seed}')
    print()

    if not in_path.exists():
        raise SystemExit(f'Input not found: {in_path}')

    # 1. Load + parse
    raw_rows = 0
    parsed: list[dict] = []
    skip_no_text = 0
    skip_low_score = 0
    skip_no_category = 0
    score_dist = Counter()

    with in_path.open('r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            raw_rows += 1
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue

            text = strip_wrapper(r.get('content'))
            if not text or len(text) < 2:
                skip_no_text += 1
                continue

            cat = r.get('category')
            if not cat:
                skip_no_category += 1
                continue

            meta = r.get('metadata') or {}
            score = meta.get('classification_score')
            if score is None:
                # Treat missing score as conservative pass-through (don't drop)
                score = args.min_score
            score_dist[score] += 1
            if score < args.min_score:
                skip_low_score += 1
                continue

            parsed.append({
                'id': r.get('id'),
                'text': text,
                'label': cat,
                'chat_type': meta.get('chat_type', 'unknown'),
                'is_group': bool(meta.get('chat_type') == 'group'),
                'score': score,
                'ts': r.get('ts'),
            })

    print(f'## Load + parse')
    print(f'  raw rows           : {raw_rows}')
    print(f'  passed parse       : {len(parsed)}')
    print(f'  skipped (no text)  : {skip_no_text}')
    print(f'  skipped (no cat)   : {skip_no_category}')
    print(f'  skipped (score<={args.min_score-1}): {skip_low_score}')
    print(f'  score distribution : {dict(sorted(score_dist.items()))}')
    print()

    # 2. Class distribution + filter
    label_counts_pre = Counter(r['label'] for r in parsed)
    dropped_classes = [l for l, c in label_counts_pre.items() if c < args.min_class_count]
    kept_classes = sorted(l for l, c in label_counts_pre.items() if c >= args.min_class_count)
    if dropped_classes:
        before = len(parsed)
        parsed = [r for r in parsed if r['label'] in kept_classes]
        print(f'## Class filter (min-class-count={args.min_class_count})')
        print(f'  dropped classes: {sorted((l, label_counts_pre[l]) for l in dropped_classes)}')
        print(f'  rows dropped   : {before - len(parsed)}')

    label_counts = Counter(r['label'] for r in parsed)
    print(f'## Final class distribution ({len(label_counts)} classes, {len(parsed)} rows)')
    for label, n in label_counts.most_common():
        bar = '█' * max(1, int(60 * n / max(label_counts.values())))
        print(f'  {label.ljust(14)} {str(n).rjust(5)}  {bar}')
    print()

    # 3. Stratified 80/10/10 split
    rng = random.Random(args.seed)
    by_label: dict[str, list[dict]] = defaultdict(list)
    for r in parsed:
        by_label[r['label']].append(r)
    train, val, test = [], [], []
    for label, rows in by_label.items():
        rng.shuffle(rows)
        n = len(rows)
        n_test = max(1, n // 10)
        n_val = max(1, n // 10)
        test.extend(rows[:n_test])
        val.extend(rows[n_test:n_test + n_val])
        train.extend(rows[n_test + n_val:])
    rng.shuffle(train); rng.shuffle(val); rng.shuffle(test)

    print(f'## Stratified split')
    print(f'  train: {len(train)} rows')
    print(f'  val  : {len(val)} rows')
    print(f'  test : {len(test)} rows')
    print()

    if args.dry_run:
        print('DRY-RUN — no files written.')
        return 0

    # 4. Write
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        'pipeline_version': '1.0',
        'generated_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
        'input': str(in_path),
        'min_score': args.min_score,
        'min_class_count': args.min_class_count,
        'seed': args.seed,
        'classes': kept_classes,
        'class_counts': dict(label_counts),
        'splits': {},
        'dropped_classes': {l: label_counts_pre[l] for l in dropped_classes},
        'score_distribution': dict(score_dist),
    }

    for split_name, split_rows in [('train', train), ('val', val), ('test', test)]:
        out_path = out_dir / f'{split_name}.jsonl'
        h = hashlib.sha256()
        with out_path.open('w', encoding='utf-8') as f:
            for r in split_rows:
                line = json.dumps(r, ensure_ascii=False) + '\n'
                f.write(line)
                h.update(line.encode('utf-8'))
        manifest['splits'][split_name] = {
            'path': str(out_path),
            'rows': len(split_rows),
            'sha256': h.hexdigest(),
            'class_counts': dict(Counter(r['label'] for r in split_rows)),
        }
        print(f'  wrote {out_path} ({len(split_rows)} rows)')

    manifest_path = out_dir / 'manifest.json'
    with manifest_path.open('w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f'  wrote {manifest_path}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
