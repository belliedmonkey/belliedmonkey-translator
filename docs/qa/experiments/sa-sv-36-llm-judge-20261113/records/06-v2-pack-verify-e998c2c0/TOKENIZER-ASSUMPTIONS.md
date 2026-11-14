# Tokenizer assumptions (v2 dry-run counters)

These counters are the same official QA helpers used for the 2026-11-13 formal run.
They are not part of the judge pack. `inputBound.kind=counter`, `exact=false`.
System UTF-8 byte length (2507) is not treated as a token count or as `maxInputTokens`.

## openai/gpt-4.1-mini

- Library: `tiktoken`, `encoding_for_model("gpt-4.1-mini")`.
- Required encoding name: `o200k_base` (the script exits if the name differs).
- Chat count formula (OpenAI cookbook-style, same as the official counter):
  - start at 0
  - for each message: add 3, then add `len(encode(value))` for each field; if the field key is `name`, add 1
  - add 3 for the reply primer
- This is an assumption about how GPT-4.1-mini request tokens are counted. It is not a provider guarantee.
- On the official v1 72-call run, declared counts from this formula matched billed `prompt_tokens` / `inputTokens` with delta 0 on every call. That is historical evidence, not a proof for v2.

## qwen/qwen3-235b-a22b-2507

- Pinned files (copied, hashes unchanged):
  - `tokenizers/qwen/tokenizer.json` sha256 `aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4`
  - `tokenizers/qwen/tokenizer_config.json` sha256 `a62ff0a2472a0fa1b8eaabcb57c59b58afa42a22831dc141400b6e0cf2b65ce3`
- Apply the tokenizer_config `chat_template` with Jinja2, `add_generation_prompt=True`, then `len(tokenizer.encode(text).ids)`.
- Also `exact=false`. Official v1 72-call run also had declared=actual delta 0 for Qwen.

## Usage

`JUDGE_QWEN_TOKENIZER_DIR` points at this directory's `tokenizers/qwen`.
Python: `/tmp/judge-tok-venv/bin/python` (tiktoken + tokenizers + jinja2).
