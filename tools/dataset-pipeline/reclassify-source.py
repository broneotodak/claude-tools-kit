#!/usr/bin/env python3
"""
Re-classify a by-source jsonl file (e.g. wa-chat-importer) using Gemini with the
v2 topic-classifier vocabulary, so it can be merged with wa-primary for v4 training.

Usage:
  export GEMINI_API_KEY=...
  python3 reclassify-source.py \\
    --in  ~/datasets/neo-corpus/2026-05-03/by-source/wa-chat-importer.jsonl \\
    --out ~/datasets/neo-corpus/2026-05-03/by-source/wa-chat-importer-relabel-v2.jsonl

Behavior:
  - Reuses strip_wrapper() from prepare-classifier-data.py (same parsing as v2 dataset)
  - For each row: send raw text to Gemini, get one of 10 labels back
  - Writes output rows in the same schema as wa-primary (so prepare-classifier-data
    can ingest them as-is)
  - classification_score is fixed to 7 (Gemini-class confidence; default min-score=5 lets it through)
  - Resumable: if --out exists, skips any IDs already classified
  - Prints per-100 progress + class distribution at end

Cost estimate: Gemini 2.5 Flash @ ~$0.000125/call · 1700 rows ≈ $0.21 (RM1)
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

# ── shared with prepare-classifier-data.py ────────────────────────────────────

_LEAD_BRACKET = re.compile(r'^\[(?:dm|group:[^\]]+)\]\s+')
_SAID_PREFIX = re.compile(r'^[^:]+ said(?: to [^:]+)?(?: in [^:]+)?:\s+')
_TRAILING_ENRICHMENT = re.compile(
    r'\n\n(?:Person facts|People facts|Topic|Summary|Context|Tags|Mentions|Entities):',
    re.IGNORECASE,
)
_TRAILING_GROUP_ANNOTATION = re.compile(r'\s*\(in group:[^)]*\)\s*$')


def strip_wrapper(content: Optional[str]) -> str:
    if not content:
        return ''
    s = _LEAD_BRACKET.sub('', content)
    s = _SAID_PREFIX.sub('', s)
    s = _TRAILING_ENRICHMENT.split(s, maxsplit=1)[0]
    s = _TRAILING_GROUP_ANNOTATION.sub('', s).rstrip()
    if len(s) >= 2 and s[0] in ('"', "'") and s[-1] == s[0]:
        s = s[1:-1]
    return s.strip()


# ── prompt (v2 vocabulary, 10 labels) ─────────────────────────────────────────

LABELS = ['family', 'finance', 'food', 'health', 'identity', 'opinion', 'plan', 'social', 'technical', 'work']

PROMPT = """You are a strict classifier for a single WhatsApp message.

Pick the BEST single topic label from this exact list (return ONLY the label, lowercase, nothing else):

- family — household, kids, parents, siblings, immediate-family logistics
- finance — money, payments, bills, investments, budgets, cost-of-things
- food — meals, restaurants, recipes, hunger, food orders, cravings
- health — illness, fitness, sleep, doctor visits, medication, mental health
- identity — religion, race, nationality, personal beliefs, who-I-am statements
- opinion — taking a stance, judgments, "I think...", reactions, debates
- plan — scheduling something, "let's do X at Y time", future arrangements
- social — chit-chat, banter, jokes, lepak, "hahaha", casual hello/bye
- technical — code, tools, software, debugging, deploys, AI/ML, hardware fixes
- work — job tasks, projects, business decisions, meetings (non-technical work)

Rules:
- If a message could fit two labels, pick the one closest to the message's INTENT (what is the speaker trying to do?), not its surface words.
- Casual greetings, jokes, banter without other content → social.
- Discussing tech (servers, code, AI, devices) → technical, even if at work.
- "Let's meet/eat/do X" arrangements → plan, even if about food (it's a plan ABOUT food).
- Output ONLY the lowercase label. No punctuation, no explanation."""

VALID_LABEL_SET = set(LABELS)


# ── Gemini call ──────────────────────────────────────────────────────────────

def classify(text: str, api_key: str, model: str = 'gemini-2.5-flash') -> Optional[str]:
    import urllib.request

    body = json.dumps({
        'systemInstruction': {'parts': [{'text': PROMPT}]},
        'contents': [{'parts': [{'text': text}]}],
        'generationConfig': {
            'temperature': 0,
            'maxOutputTokens': 8,
            'thinkingConfig': {'thinkingBudget': 0},
        },
    }).encode('utf-8')
    req = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}',
        data=body,
        headers={'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
        # Extract first candidate text
        cand = data.get('candidates', [{}])[0]
        parts = cand.get('content', {}).get('parts', [])
        text_out = ''.join(p.get('text', '') for p in parts).strip().lower()
        # Strip any punctuation, take first word
        text_out = re.sub(r'[^a-z]', '', text_out.split()[0]) if text_out else ''
        if text_out in VALID_LABEL_SET:
            return text_out
        return None  # invalid
    except Exception as e:
        print(f'  err: {e}', file=sys.stderr)
        return None


# ── main ──────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument('--in', dest='in_path', type=Path, required=True)
    p.add_argument('--out', dest='out_path', type=Path, required=True)
    p.add_argument('--model', default='gemini-2.5-flash')
    p.add_argument('--max-rows', type=int, default=0, help='cap for testing (0 = all)')
    p.add_argument('--rate-limit-ms', type=int, default=200,
                   help='sleep between calls; gemini-2.5-flash allows ~10 req/s')
    return p.parse_args()


def main() -> int:
    args = parse_args()
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print('ERROR: GEMINI_API_KEY not in env', file=sys.stderr)
        return 1

    # Resume support: skip IDs already in output
    seen_ids = set()
    if args.out_path.exists():
        with args.out_path.open() as f:
            for line in f:
                try:
                    seen_ids.add(json.loads(line).get('id'))
                except json.JSONDecodeError:
                    pass
        print(f'  resume: skipping {len(seen_ids)} already-classified rows')

    args.out_path.parent.mkdir(parents=True, exist_ok=True)

    counts = {'classified': 0, 'invalid': 0, 'no_text': 0, 'skipped': 0}
    label_dist = {}
    started = time.time()

    with args.in_path.open('r', encoding='utf-8') as fin, \
         args.out_path.open('a', encoding='utf-8') as fout:
        for i, line in enumerate(fin, 1):
            if args.max_rows and counts['classified'] >= args.max_rows:
                break
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue

            row_id = row.get('id')
            if row_id in seen_ids:
                counts['skipped'] += 1
                continue

            text = strip_wrapper(row.get('content'))
            if not text or len(text) < 2:
                counts['no_text'] += 1
                continue

            label = classify(text, api_key, model=args.model)
            if label is None:
                counts['invalid'] += 1
                continue

            # Mirror wa-primary schema
            new_row = {
                'id': row_id,
                'content': row.get('content'),
                'category': label,
                'actor': row.get('actor'),
                'domain': row.get('domain'),
                'memory_type': row.get('memory_type'),
                'related_people': row.get('related_people'),
                'source': row.get('source'),
                'source_ref': row.get('source_ref'),
                'subject_id': row.get('subject_id'),
                'ts': row.get('ts'),
                'visibility': row.get('visibility'),
                'importance': row.get('importance'),
                'metadata': {
                    **(row.get('metadata') or {}),
                    'classification_score': 7,
                    'classification_source': f'gemini-{args.model}-relabel-v2',
                    'classification_relabel_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                    'original_category': row.get('category'),
                },
            }
            fout.write(json.dumps(new_row, ensure_ascii=False) + '\n')
            fout.flush()
            counts['classified'] += 1
            label_dist[label] = label_dist.get(label, 0) + 1

            if counts['classified'] % 100 == 0:
                elapsed = time.time() - started
                rate = counts['classified'] / max(elapsed, 0.01)
                print(f'  {counts["classified"]:4} done · {rate:.1f}/s · {elapsed:.0f}s elapsed')

            time.sleep(args.rate_limit_ms / 1000.0)

    elapsed = time.time() - started
    print()
    print(f'## done in {elapsed:.0f}s')
    print(f'  classified : {counts["classified"]}')
    print(f'  invalid    : {counts["invalid"]}  (Gemini returned non-label)')
    print(f'  no text    : {counts["no_text"]}')
    print(f'  skipped    : {counts["skipped"]}  (already in output)')
    print()
    print('## new label distribution:')
    for label, n in sorted(label_dist.items(), key=lambda x: -x[1]):
        print(f'  {label:12} {n:5}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
