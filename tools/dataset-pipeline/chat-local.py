#!/usr/bin/env python3
"""
Run the local MLX-quantized neo-voice model on the same 8 test prompts used
in the RunPod comparison, so we can verify it works on Mac and check that
4-bit quantization didn't degrade quality much.

Usage:
  ./.venv/bin/python chat-local.py
  ./.venv/bin/python chat-local.py --interactive
"""
import argparse
import json
from pathlib import Path

from mlx_lm import load, generate

MODEL_PATH = Path.home() / "models" / "neo-voice-mlx"
PROMPTS_PATH = Path(__file__).parent / "test-prompts.json"
SYSTEM_PROMPT = (
    "You are Neo Todak (Ahmad Fadli Bin Ahmad Dahlan), Malaysian, casual BM-EN "
    "code-switching style. Reply in your natural WhatsApp tone."
)


def build_chat_prompt(tokenizer, user_text):
    return tokenizer.apply_chat_template(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_text},
        ],
        tokenize=False,
        add_generation_prompt=True,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interactive", action="store_true")
    ap.add_argument("--temp", type=float, default=0.8)
    ap.add_argument("--max-tokens", type=int, default=160)
    args = ap.parse_args()

    print("Loading MLX model...")
    model, tokenizer = load(str(MODEL_PATH))
    print("Loaded.\n")

    if args.interactive:
        print("Interactive chat. Format prompts like '[DM from X] message' or '[group: NAME] X: message'.")
        print("Ctrl-C to exit.\n")
        while True:
            try:
                user = input("> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return
            if not user:
                continue
            full = build_chat_prompt(tokenizer, user)
            out = generate(model, tokenizer, prompt=full, max_tokens=args.max_tokens, verbose=False)
            print(f"\nNEO LLM: {out.strip()}\n")
        return

    # Batch mode: run all 8 test prompts
    prompts = json.loads(PROMPTS_PATH.read_text())
    print(f"Running {len(prompts)} test prompts on LOCAL Mac model...\n")
    for p in prompts:
        user_text = f"[{p['incoming_setting']}] {p['incoming_speaker']}: {p['incoming']}"
        full = build_chat_prompt(tokenizer, user_text)
        out = generate(model, tokenizer, prompt=full, max_tokens=args.max_tokens, verbose=False)
        print(f"--- #{p['id']} {p['label']}")
        print(f"  IN  : {p['incoming'][:120]}")
        print(f"  YOU : {p['ground_truth'][:120]}")
        print(f"  LLM : {out.strip()[:200]}")
        print()


if __name__ == "__main__":
    main()
