#!/bin/bash
# Mac QA bootstrap. Does not touch the product repo or .local files.
# Does not print secrets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p ledger package/unpacked

echo "verify outer checksums"
shasum -a 256 -c EXPECTED-SHA256.txt

echo "unpack frozen package"
rm -rf package/unpacked
mkdir -p package/unpacked
tar -xzf package/01M7AJ65AKYJT2H26187ZDN7TW.gz -C package/unpacked
# tarball members are ./file
if [ ! -f package/unpacked/SHA256SUMS ] && [ -f package/unpacked/./SHA256SUMS ]; then
  true
fi
(cd package/unpacked && shasum -a 256 -c SHA256SUMS)
# confirm expected run-judge hash from frozen unpack
python3 - <<'PY'
import hashlib, pathlib
p = pathlib.Path("package/unpacked/run-judge.js")
h = hashlib.sha256(p.read_bytes()).hexdigest()
want = "7bfc4a52e7c9b5bb0d57994d99ab0c049a5ff392d2134e743fb66472dd14226c"
if h != want:
    raise SystemExit("run-judge.js sha mismatch: " + h)
print("run-judge.js sha ok")
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
exec node scripts/run-official.js
