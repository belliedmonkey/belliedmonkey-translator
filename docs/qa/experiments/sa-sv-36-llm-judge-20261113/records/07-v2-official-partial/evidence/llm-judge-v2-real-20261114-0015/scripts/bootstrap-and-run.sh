#!/bin/bash
# Mac QA bootstrap for the v2 official run. Does not touch the product repo or .local files.
# Does not print secrets. Does not overwrite the v1 QA directory.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Refuse to run inside the v1 QA path
case "$ROOT" in
  */qa/llm-judge-real-20261113-2253) echo "refusing to overwrite v1 QA dir"; exit 2 ;;
esac
mkdir -p ledger package/unpacked

echo "verify outer checksums"
shasum -a 256 -c EXPECTED-SHA256.txt

echo "unpack frozen v2 package"
rm -rf package/unpacked
mkdir -p package/unpacked
tar -xzf package/01M7ASY5H5YT8XV1NH4Y291ZFP.gz -C package/unpacked
(cd package/unpacked && shasum -a 256 -c SHA256SUMS)
python3 - <<'PY'
import hashlib, pathlib
root = pathlib.Path("package/unpacked")
checks = {
    "run-judge.js": "7bfc4a52e7c9b5bb0d57994d99ab0c049a5ff392d2134e743fb66472dd14226c",
    "verdict-contract.js": "27df3fecfddd4312fc4913295cd8fa12cdf56088c3db6b07fee57176d1ade454",
    "rubric.js": "999d8cc2aaaca54fa008e817d55040d16d5952e0be9a54ca73d6f686ba7ef3b4",
    "parse.js": "b636aa1f73a056dd202be5d9bb1655fc6001ffd68101ec9c172173086268cfed",
}
for name, want in checks.items():
    h = hashlib.sha256((root / name).read_bytes()).hexdigest()
    if h != want:
        raise SystemExit(name + " sha mismatch: " + h)
print("inner v2 pack hashes ok")
PY

echo "python venv + official tokenizers"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q 'tiktoken>=0.9' tokenizers jinja2
.venv/bin/python -c 'import tiktoken; assert tiktoken.encoding_for_model("gpt-4.1-mini").name=="o200k_base"; print("tiktoken o200k_base ok")'

echo "node $(node -v)"
export JUDGE_TOKEN_PYTHON="$ROOT/.venv/bin/python"
export JUDGE_QWEN_TOKENIZER_DIR="$ROOT/tokenizers/qwen"
# Do not export OpenRouter secrets. The runner reads them in memory.
exec node scripts/run-official-v2.js
