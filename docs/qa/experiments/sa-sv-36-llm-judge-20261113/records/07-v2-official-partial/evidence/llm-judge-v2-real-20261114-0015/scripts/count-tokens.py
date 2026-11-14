#!/usr/bin/env python3
"""Official public tokenizer counter for the QA runner. Not part of the frozen judge pack.
Reads one JSON object from stdin: {"model": "...", "messages": [...]}
Prints a single integer token count. No network, no keys.
"""
import json, os, sys
from pathlib import Path

QWEN_ID = "qwen/qwen3-235b-a22b-2507"
OPENAI_ID = "openai/gpt-4.1-mini"
HERE = Path(__file__).resolve().parent
DEFAULT_TOK = HERE.parent / "tokenizers" / "qwen"
TOK_DIR = Path(os.environ.get("JUDGE_QWEN_TOKENIZER_DIR") or DEFAULT_TOK)

def openai_count(messages):
    import tiktoken
    enc = tiktoken.encoding_for_model("gpt-4.1-mini")
    if enc.name != "o200k_base":
        raise SystemExit("unexpected encoding " + enc.name)
    n = 0
    for message in messages:
        n += 3
        for key, value in message.items():
            n += len(enc.encode(value))
            if key == "name":
                n += 1
    n += 3
    return n

_qtok = None
_qcfg = None
_qtmpl = None

def qwen_count(messages):
    global _qtok, _qcfg, _qtmpl
    from tokenizers import Tokenizer
    from jinja2 import Template
    if _qtok is None:
        _qcfg = json.loads((TOK_DIR / "tokenizer_config.json").read_text())
        _qtok = Tokenizer.from_file(str(TOK_DIR / "tokenizer.json"))
        _qtmpl = Template(_qcfg["chat_template"])
    text = _qtmpl.render(
        messages=messages,
        add_generation_prompt=True,
        tools=None,
        bos_token=_qcfg.get("bos_token"),
        eos_token=_qcfg.get("eos_token"),
        pad_token=_qcfg.get("pad_token"),
        unk_token=_qcfg.get("unk_token"),
    )
    return len(_qtok.encode(text).ids)

def main():
    doc = json.loads(sys.stdin.read())
    model = doc.get("model")
    messages = doc.get("messages")
    if not isinstance(messages, list):
        raise SystemExit("bad messages")
    if model == OPENAI_ID:
        print(openai_count(messages))
    elif model == QWEN_ID:
        print(qwen_count(messages))
    else:
        raise SystemExit("unknown model")

if __name__ == "__main__":
    main()
