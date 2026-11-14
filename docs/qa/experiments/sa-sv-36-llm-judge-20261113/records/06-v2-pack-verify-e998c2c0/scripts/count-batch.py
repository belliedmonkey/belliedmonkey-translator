#!/usr/bin/env python3
"""Batch wrapper around the official count-tokens.py functions. Offline, no keys, no network.
Stdin: {"jobs":[{"id":"...","judgeId":"...","model":"...","messages":[...]}, ...]}
Stdout: {"results":[{"id","judgeId","model","tokens":int}, ...]}
"""
import json, os, sys
from pathlib import Path

# Reuse the official helper in this directory.
import importlib.util
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("count_tokens", HERE / "count-tokens.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def main():
    doc = json.loads(sys.stdin.read())
    jobs = doc.get("jobs")
    if not isinstance(jobs, list):
        raise SystemExit("bad jobs")
    out = []
    for job in jobs:
        model = job["model"]
        messages = job["messages"]
        if model == mod.OPENAI_ID:
            n = mod.openai_count(messages)
        elif model == mod.QWEN_ID:
            n = mod.qwen_count(messages)
        else:
            raise SystemExit("unknown model " + str(model))
        out.append({
            "id": job.get("id"),
            "judgeId": job.get("judgeId"),
            "model": model,
            "tokens": n,
        })
    json.dump({"results": out}, sys.stdout)
    sys.stdout.write("\n")

if __name__ == "__main__":
    main()
