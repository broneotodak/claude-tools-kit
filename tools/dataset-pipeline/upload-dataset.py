#!/usr/bin/env python3
"""Upload a JSONL training file to HuggingFace as a private dataset repo.

Used by upload-dataset.sh which provides HF_TOKEN via env.
"""
import argparse
import os
import sys
from pathlib import Path

from huggingface_hub import HfApi, create_repo


CARD_TEMPLATE = """---
language: ms
license: other
size_categories:
- 1K<n<10K
task_categories:
- text-generation
tags:
- conversational
- malay
- bahasa-malaysia
- private
---

# Neo Voice Training Set

Curated WhatsApp DM pairs (incoming → Neo's reply) extracted from neo-brain memories
via `claude-tools-kit/tools/dataset-pipeline/`. Used to fine-tune a personal LoRA on
top of `mesolitica/Malaysian-Qwen2.5-7B-Instruct`.

**Visibility:** PRIVATE. Contains personal WhatsApp content. Do not redistribute.

## Format

Each line is a JSON object with a `messages` array (system / user / assistant) suitable
for SFTTrainer.

```json
{{"messages": [
  {{"role": "system", "content": "You are Neo Todak..."}},
  {{"role": "user", "content": "[DM from X] ..."}},
  {{"role": "assistant", "content": "Neo's reply"}}
]}}
```

## Provenance

- Source: neo-brain `memories` table, `source=wa-primary`, `is_from_owner=true` paired
  with the most recent prior incoming message in the same DM within 60 minutes.
- Pipeline: `claude-tools-kit/tools/dataset-pipeline/prepare-training.js`
- Pairs: see manifest in source repo
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="HF dataset repo id, e.g. broneotodak/neo-voice-train")
    ap.add_argument("--file", required=True, help="path to train.jsonl")
    ap.add_argument("--public", action="store_true", help="make repo public (default: private)")
    args = ap.parse_args()

    token = os.environ.get("HF_TOKEN")
    if not token:
        print("ERROR: HF_TOKEN not set", file=sys.stderr)
        sys.exit(1)

    p = Path(args.file)
    if not p.exists():
        print(f"ERROR: file not found: {p}", file=sys.stderr)
        sys.exit(1)
    size_mb = p.stat().st_size / 1024 / 1024
    line_count = sum(1 for _ in p.open("r", encoding="utf-8"))
    print(f"  file size : {size_mb:.2f} MB")
    print(f"  rows      : {line_count}")

    print(f"→ create_repo {args.repo} (private={not args.public})")
    create_repo(repo_id=args.repo, repo_type="dataset", private=not args.public, token=token, exist_ok=True)

    api = HfApi(token=token)
    print(f"→ uploading train.jsonl ...")
    api.upload_file(
        path_or_fileobj=str(p),
        path_in_repo="train.jsonl",
        repo_id=args.repo,
        repo_type="dataset",
        commit_message=f"Upload train.jsonl ({line_count} rows, {size_mb:.2f} MB)",
    )

    print(f"→ uploading dataset card (README.md) ...")
    card = CARD_TEMPLATE
    api.upload_file(
        path_or_fileobj=card.encode("utf-8"),
        path_in_repo="README.md",
        repo_id=args.repo,
        repo_type="dataset",
        commit_message="Add dataset card",
    )

    url = f"https://huggingface.co/datasets/{args.repo}"
    print(f"\nDone. {url}")


if __name__ == "__main__":
    main()
