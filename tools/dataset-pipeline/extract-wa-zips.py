#!/usr/bin/env python3
"""
Extract individual WhatsApp messages from a directory of WhatsApp Chat Export
zips. Produces a jsonl in the wa-primary-compatible schema, ready to be fed
into reclassify-source.py and merged for v4 training.

Why we need this:
  wa-chat-importer (already in corpus) summarized whole days of conversations
  into single rows — wrong shape for training a per-message classifier. This
  script goes back to the raw export zips and extracts INDIVIDUAL messages,
  then filters out junk (attachments, system events, very-short reactions).

Usage:
  python3 extract-wa-zips.py \\
    --in-dir ~/Downloads/Whatsapp\\ Chat\\ Exports/ \\
    --out ~/datasets/neo-corpus/2026-05-03/by-source/wa-zips-raw.jsonl \\
    --sample-size 10000 \\
    --my-name Broneotodak

Output schema (matches wa-primary minus category — that gets added by reclassify):
  {id, content, actor, source, ts, chat_name, chat_type, sender_name,
   metadata: {chat_name, chat_type, raw_text_chars, ...}}
"""

import argparse
import hashlib
import json
import random
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional

# WhatsApp message line: [DD/MM/YYYY, H:MM:SS AM/PM] Sender: text
MSG_RE = re.compile(
    r'^\[(\d{1,2}/\d{1,2}/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\]\s+([^:]+?):\s*(.*)$'
)
# System / encryption / attachment markers to skip
JUNK_PATTERNS = [
    re.compile(r'Messages and calls are end-to-end encrypted', re.I),
    re.compile(r'<attached:', re.I),
    re.compile(r'<This message was edited>', re.I),
    re.compile(r'image omitted|video omitted|sticker omitted|GIF omitted|audio omitted|document omitted|Contact card omitted|Location:', re.I),
    re.compile(r'^‎'),  # invisible LRM char often prefixes attachment placeholders
    re.compile(r'^\s*$'),  # empty
    re.compile(r'You deleted this message|This message was deleted|You changed the group description|created group|added you|added .+|removed .+|joined using this group\'s invite link|left'),
    re.compile(r"^https?://\S+\s*$"),
]

EMOJI_ONLY = re.compile(r"^[\U0001F300-\U0001FAFF\U00002600-\U000027BF‍️\s\W]+$")


def is_junk(text: str) -> bool:
    if not text:
        return True
    for p in JUNK_PATTERNS:
        if p.search(text):
            return True
    if EMOJI_ONLY.match(text) and len(text) < 40:
        return True
    return False


def parse_zip(zip_path: Path, my_name: str) -> Iterator[dict]:
    """Yield individual messages from one chat export zip."""
    chat_name = zip_path.stem.replace('WhatsApp Chat - ', '').strip()
    # Determine chat_type from filename heuristic — group chats usually have multiple words / "TODAK" / etc
    # WhatsApp doesn't put group/dm in zip metadata; we infer from content (multiple distinct senders)
    senders = set()
    rows_buffer = []

    try:
        with zipfile.ZipFile(zip_path) as zf:
            txt_name = next((n for n in zf.namelist() if n.endswith('.txt')), None)
            if not txt_name:
                return
            with zf.open(txt_name) as f:
                buf_sender = None
                buf_ts = None
                buf_text = []

                def flush():
                    nonlocal buf_sender, buf_ts, buf_text
                    if buf_sender is not None and buf_text:
                        rows_buffer.append({
                            'sender': buf_sender,
                            'ts_raw': buf_ts,
                            'text': ' '.join(buf_text).strip(),
                        })
                    buf_sender = None
                    buf_ts = None
                    buf_text = []

                for raw in f:
                    try:
                        line = raw.decode('utf-8').rstrip('\n').rstrip('\r')
                    except UnicodeDecodeError:
                        continue
                    m = MSG_RE.match(line)
                    if m:
                        flush()
                        date_s, time_s, sender, text = m.groups()
                        buf_sender = sender.strip()
                        buf_ts = f'{date_s} {time_s}'
                        buf_text = [text]
                        senders.add(buf_sender)
                    else:
                        # continuation of previous multi-line message
                        if buf_sender is not None:
                            buf_text.append(line.strip())
                flush()
    except (zipfile.BadZipFile, KeyError) as e:
        print(f'  skip {zip_path.name}: {e}', file=sys.stderr)
        return

    chat_type = 'group' if len(senders) > 2 else 'dm'

    for r in rows_buffer:
        text = r['text']
        if is_junk(text):
            continue
        if len(text) < 15:
            continue
        # Stable id from (chat_name, ts, sender, first 40 chars of text)
        h = hashlib.sha256(f'{chat_name}|{r["ts_raw"]}|{r["sender"]}|{text[:40]}'.encode()).hexdigest()[:16]
        ts_iso = parse_ts(r['ts_raw'])
        is_outgoing = (r['sender'].lower() == my_name.lower())
        # Wrap content with same prefix style as wa-primary so prepare-classifier-data's
        # strip_wrapper finds something familiar (it'll strip [dm]/[group:] + "Sender said:")
        wrapper_prefix = f'[{("group: " + chat_name) if chat_type == "group" else "dm"}] {r["sender"]} said'
        if chat_type == 'group':
            wrapper_prefix += f' in {chat_name}'
        wrapper_prefix += ': '
        content = wrapper_prefix + text
        yield {
            'id': f'wa-zip-{h}',
            'content': content,
            'raw_text': text,
            'actor': 'broneotodak' if is_outgoing else 'other',
            'source': 'wa-zip-export',
            'ts': ts_iso,
            'chat_name': chat_name,
            'chat_type': chat_type,
            'sender_name': r['sender'],
            'visibility': 'private',
            'metadata': {
                'chat_name': chat_name,
                'chat_type': chat_type,
                'is_outgoing': is_outgoing,
                'sender_name': r['sender'],
                'raw_text_chars': len(text),
            },
        }


def parse_ts(ts: str) -> Optional[str]:
    # Try several common WhatsApp formats — DD/MM/YYYY, H:MM:SS AM/PM | HH:MM
    formats = [
        '%d/%m/%Y %I:%M:%S %p', '%d/%m/%Y %I:%M %p',
        '%d/%m/%Y %H:%M:%S', '%d/%m/%Y %H:%M',
        '%d/%m/%y %I:%M:%S %p', '%d/%m/%y %I:%M %p',
    ]
    for fmt in formats:
        try:
            return datetime.strptime(ts, fmt).isoformat()
        except ValueError:
            continue
    return None


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument('--in-dir', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--my-name', default='Broneotodak',
                   help='your sender name in the export (case-insensitive)')
    p.add_argument('--sample-size', type=int, default=0,
                   help='if >0, stratified-sample to this many rows (across chats + outgoing/incoming)')
    p.add_argument('--seed', type=int, default=42)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)

    rng = random.Random(args.seed)
    all_rows = []
    by_chat = defaultdict(list)
    seen_ids = set()
    counts = Counter()

    zips = sorted(args.in_dir.glob('*.zip'))
    print(f'## scanning {len(zips)} zip(s) under {args.in_dir}')

    for z in zips:
        before = len(all_rows)
        for row in parse_zip(z, args.my_name):
            if row['id'] in seen_ids:
                continue
            seen_ids.add(row['id'])
            all_rows.append(row)
            by_chat[row['chat_name']].append(row)
            counts[row['chat_name']] += 1
        added = len(all_rows) - before
        if added:
            print(f'  {added:6d}  {z.stem}')

    print(f'## total clean messages: {len(all_rows)}')

    if args.sample_size and args.sample_size < len(all_rows):
        # Stratified per-chat sample, proportional but min 50/chat
        target = args.sample_size
        per_chat_min = 50
        chat_targets = {}
        # Allocate: at least min per chat (capped to chat size), then proportional remainder
        rem = target - sum(min(per_chat_min, len(rows)) for rows in by_chat.values())
        total_rows_above_min = sum(max(0, len(rows) - per_chat_min) for rows in by_chat.values())
        for c, rows in by_chat.items():
            base = min(per_chat_min, len(rows))
            extra = int(rem * max(0, len(rows) - per_chat_min) / max(1, total_rows_above_min)) if rem > 0 else 0
            chat_targets[c] = min(len(rows), base + extra)
        sampled = []
        for c, rows in by_chat.items():
            n = chat_targets[c]
            sampled.extend(rng.sample(rows, n))
        rng.shuffle(sampled)
        all_rows = sampled
        print(f'## sampled {len(all_rows)} rows (target {target})')

    print(f'## per-chat distribution in output:')
    out_counts = Counter(r['chat_name'] for r in all_rows)
    for c, n in out_counts.most_common():
        ct = next(r['chat_type'] for r in all_rows if r['chat_name'] == c)
        print(f'  {n:5d}  ({ct:5}) {c}')
    print(f'## outgoing / incoming split:')
    outgoing = sum(1 for r in all_rows if r['metadata']['is_outgoing'])
    print(f'  outgoing: {outgoing} ({100*outgoing/max(1,len(all_rows)):.1f}%)')
    print(f'  incoming: {len(all_rows) - outgoing}')

    with args.out.open('w', encoding='utf-8') as f:
        for r in all_rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(f'## wrote {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
