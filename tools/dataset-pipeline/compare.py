#!/usr/bin/env python3
"""
Side-by-side comparison: base Malaysian-Qwen2.5-7B-Instruct vs Neo-voice fine-tune.

For each test prompt in test-prompts.json:
  1. Run base model
  2. Run fine-tune (base + LoRA adapter)
  3. Print: incoming → ground_truth → base_output → finetune_output
  4. Save markdown report

Usage on RunPod after training:
  export HF_TOKEN=...
  python compare.py --adapter broneotodak/neo-voice-qwen-v1 --output compare-results.md
"""
import argparse
import json
import os
import sys
from pathlib import Path

BASE_MODEL = "mesolitica/Malaysian-Qwen2.5-7B-Instruct"
SYSTEM_PROMPT = (
    "You are Neo Todak (Ahmad Fadli Bin Ahmad Dahlan), Malaysian, casual BM-EN "
    "code-switching style. Reply in your natural WhatsApp tone."
)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--adapter", required=True, help="HF repo id of the trained LoRA adapter")
    p.add_argument("--base", default=BASE_MODEL)
    p.add_argument("--prompts", default=str(Path(__file__).parent / "test-prompts.json"))
    p.add_argument("--output", default="compare-results.md")
    p.add_argument("--max-new-tokens", type=int, default=180)
    p.add_argument("--temperature", type=float, default=0.8)
    p.add_argument("--top-p", type=float, default=0.95)
    return p.parse_args()


def build_messages(prompt):
    setting = prompt["incoming_setting"]
    speaker = prompt["incoming_speaker"]
    body = prompt["incoming"]
    user_text = f"[{setting}] {speaker}: {body}"
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_text},
    ]


def main():
    args = parse_args()
    token = os.environ.get("HF_TOKEN")
    if not token:
        print("ERROR: HF_TOKEN not set", file=sys.stderr)
        sys.exit(1)

    print("→ Loading test prompts:", args.prompts)
    prompts = json.loads(Path(args.prompts).read_text())
    print(f"  {len(prompts)} prompts")

    print("→ Importing torch / transformers / peft ...")
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from peft import PeftModel

    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    print(f"→ Loading tokenizer + base model: {args.base}")
    tokenizer = AutoTokenizer.from_pretrained(args.base, token=token)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    base_model = AutoModelForCausalLM.from_pretrained(
        args.base,
        quantization_config=bnb,
        device_map="auto",
        torch_dtype=torch.bfloat16,
        token=token,
    )

    def generate(model, msgs):
        text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        inputs = tokenizer(text, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(
                **inputs,
                max_new_tokens=args.max_new_tokens,
                do_sample=True,
                temperature=args.temperature,
                top_p=args.top_p,
                pad_token_id=tokenizer.pad_token_id,
            )
        gen = out[0][inputs["input_ids"].shape[1]:]
        return tokenizer.decode(gen, skip_special_tokens=True).strip()

    # ─── PASS 1: BASE MODEL ───────────────────────────────────────────────────
    print("\n=== PASS 1: BASE MODEL ===")
    base_outputs = []
    for p in prompts:
        msgs = build_messages(p)
        out = generate(base_model, msgs)
        base_outputs.append(out)
        print(f"\n[{p['id']}] {p['label']}")
        print(f"  IN  : {p['incoming'][:120]}")
        print(f"  OUT : {out[:200]}")

    # Free base model VRAM, load adapter on top
    del base_model
    torch.cuda.empty_cache()

    print(f"\n→ Loading fine-tune (base + LoRA adapter: {args.adapter})")
    base_model_2 = AutoModelForCausalLM.from_pretrained(
        args.base,
        quantization_config=bnb,
        device_map="auto",
        torch_dtype=torch.bfloat16,
        token=token,
    )
    ft_model = PeftModel.from_pretrained(base_model_2, args.adapter, token=token)

    # ─── PASS 2: FINE-TUNE ───────────────────────────────────────────────────
    print("\n=== PASS 2: FINE-TUNE ===")
    ft_outputs = []
    for p in prompts:
        msgs = build_messages(p)
        out = generate(ft_model, msgs)
        ft_outputs.append(out)
        print(f"\n[{p['id']}] {p['label']}")
        print(f"  IN  : {p['incoming'][:120]}")
        print(f"  OUT : {out[:200]}")

    # ─── REPORT ──────────────────────────────────────────────────────────────
    md = ["# Neo-voice fine-tune comparison\n"]
    md.append(f"- Base: `{args.base}`")
    md.append(f"- Adapter: `{args.adapter}`")
    md.append(f"- Sampling: temp={args.temperature}, top_p={args.top_p}, max_new={args.max_new_tokens}\n")
    for i, p in enumerate(prompts):
        md.append(f"\n## {p['id']}. {p['label']}")
        md.append(f"**Tests:** {p['tests']}\n")
        md.append(f"**Incoming** ({p['incoming_setting']}):")
        md.append(f"> {p['incoming']}\n")
        md.append(f"**Ground truth (Neo's actual reply):**")
        md.append(f"> {p['ground_truth']}\n")
        md.append(f"**🤖 Base Qwen:**")
        md.append(f"```")
        md.append(base_outputs[i])
        md.append(f"```\n")
        md.append(f"**🧠 Neo fine-tune:**")
        md.append(f"```")
        md.append(ft_outputs[i])
        md.append(f"```\n")
        md.append("---")

    Path(args.output).write_text("\n".join(md))
    print(f"\nWritten: {args.output}")


if __name__ == "__main__":
    main()
