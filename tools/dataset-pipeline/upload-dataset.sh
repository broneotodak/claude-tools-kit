#!/bin/bash
# Push prepared training dataset to HuggingFace as private repo.
# Pulls HF token from neo-brain credentials vault on the fly (no plaintext on disk).

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/../.." && pwd )"

DATASET_REPO="${1:-broneotodak/neo-voice-train}"
TRAIN_FILE="${2:-$HOME/datasets/neo-corpus/training/$(date +%Y-%m-%d)/train.jsonl}"

if [[ ! -f "$TRAIN_FILE" ]]; then
  echo "ERROR: training file not found: $TRAIN_FILE" >&2
  exit 1
fi

echo "→ Pulling HF token from neo-brain vault..."
HF_TOKEN=$(cd "$REPO_DIR" && node --input-type=module -e "
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY);
const { data, error } = await sb.rpc('get_credential', {
  p_owner_id: '00000000-0000-0000-0000-000000000001',
  p_service: 'huggingface',
  p_credential_type: 'api_token'
});
if (error) { console.error(error.message); process.exit(1); }
process.stdout.write(data?.[0]?.credential_value || '');
")

if [[ -z "$HF_TOKEN" ]]; then
  echo "ERROR: empty HF token from vault." >&2
  exit 1
fi
echo "  token len: ${#HF_TOKEN}"

export HF_TOKEN
echo "→ Uploading $TRAIN_FILE → $DATASET_REPO"
"$SCRIPT_DIR/.venv/bin/python" "$SCRIPT_DIR/upload-dataset.py" --repo "$DATASET_REPO" --file "$TRAIN_FILE"

echo "Done."
