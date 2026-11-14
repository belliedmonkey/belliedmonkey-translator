#!/usr/bin/env python3
"""Build the official `openbot-agent-import` v1 ZIP from an existing Grok Bot export.

This is the quota-free path for OpenBot 0.58+ (Server settings → Import → Grok Bot):
instead of running the Migrator agent inside Grok Bot, reuse `/workspace/backup*` that
the Bots already wrote, and produce the same manifest OpenBot expects.

Usage:
  python3 build_official_zip.py --root <export> --config <config.json> --out <zip>
"""
import argparse
import json
import os
import re
import zipfile
from datetime import datetime, timezone


def norm(value):
    return re.sub(r"\s+", " ", value).strip().casefold()


def bullets(text):
    out = []
    for line in text.splitlines():
        match = re.match(r"^\s*-\s+(.+)$", line)
        if match:
            value = match.group(1).strip()
            if value and not value.startswith("#"):
                out.append(value)
    return out


def facts_json(path):
    data = json.load(open(path, encoding="utf-8"))
    out = []
    for category, rows in data.items():
        if not isinstance(rows, dict):
            continue
        for key, item in rows.items():
            item = item or {}
            out.append(
                {
                    "category": category,
                    "text": item.get("text") or key,
                    "date": item.get("date"),
                    "via": item.get("via"),
                }
            )
    return out


def load_sources(root, sources):
    out = []
    for rel in sources:
        path = os.path.join(root, rel)
        if not os.path.exists(path):
            raise SystemExit(f"missing source: {path}")
        if rel.endswith("_profile_facts.json"):
            out += [
                {"category": "profile", "text": text, "date": None, "via": None}
                for text in json.load(open(path, encoding="utf-8"))
            ]
        elif rel.endswith(".json"):
            out += facts_json(path)
        else:
            out += [
                {"category": "md", "text": text, "date": None, "via": None}
                for text in bullets(open(path, encoding="utf-8").read())
            ]
    return out


def parse_routines(root, rel):
    if not rel:
        return []
    path = os.path.join(root, rel)
    if not os.path.exists(path):
        return []
    text = open(path, encoding="utf-8").read()
    out = []
    for section in re.split(r"(?m)^##\s+", text)[1:]:
        match = re.search(r"(?mi)^\s*-\s*schedule:\s*`?([^`\n]+)`?", section)
        if not match:
            continue
        raw = match.group(1).strip()
        zone = "Asia/Shanghai"
        zone_match = re.search(r"CRON_TZ=([A-Za-z0-9_+./-]+)", raw)
        if zone_match:
            zone = zone_match.group(1)
        cron = re.sub(r"^CRON_TZ=\S+\s+", "", raw).strip()
        if len(cron.split()) != 5:
            continue
        prompt = re.search(
            r"(?mis)^###\s*prompt\s*\n(.*?)(?=^---\s*$|^##\s+|\Z)", section
        )
        if not prompt:
            prompt = re.search(
                r"(?mis)^\s*-\s*prompt:\s*\|\s*\n(.*?)(?=^##\s+|\Z)", section
            )
        if not prompt:
            continue
        instruction = re.sub(r"(?m)^    ", "", prompt.group(1).strip())
        if not instruction:
            continue
        name = re.sub(r"^\d+[\.\)]\s*", "", section.splitlines()[0].strip())[:80]
        out.append(
            {
                "name": name,
                "instruction": instruction,
                "active": False,
                "timezone": zone,
                "schedule": {"kind": "custom", "expression": cron},
            }
        )
    return out


def priority(category):
    return {
        "profile": 5,
        "journal": 4,
        "md": 4,
        "shared_profile": 3,
        "shared_journal": 2,
    }.get(category, 1)


def build_memory_md(facts):
    lines = []
    for item in facts:
        bits = []
        if item.get("date"):
            bits.append(item["date"])
        if item.get("category"):
            bits.append(item["category"])
        if item.get("via"):
            bits.append("via " + item["via"])
        prefix = ("[" + " · ".join(bits) + "] ") if bits else ""
        lines.append(f"- {prefix}{item['text']}")
    return "\n".join(lines)


def select_memories(facts, limit=64):
    bot = [item for item in facts if not item["category"].startswith("shared_")]
    shared = [item for item in facts if item["category"].startswith("shared_")]
    key = lambda item: (-priority(item["category"]), item.get("date") or "", item["text"])
    bot.sort(key=key)
    shared.sort(key=key)
    chosen = [item["text"][:500] for item in bot[:48]]
    chosen += [item["text"][:500] for item in shared[:16]]
    if len(chosen) < limit:
        used = set(chosen)
        rest = [item for item in bot[48:] + shared[16:] if item["text"][:500] not in used]
        chosen += [item["text"][:500] for item in rest[: limit - len(chosen)]]
    return chosen[:limit]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    config = json.load(open(args.config, encoding="utf-8"))
    manifest = {
        "format": "openbot-agent-import",
        "version": 1,
        "source": {
            "app": "grok-bot",
            "exportedAt": datetime.now(timezone.utc).isoformat(),
        },
        "agents": [],
        "channels": [],
    }
    files = {}
    stats = []

    for spec in config["agents"]:
        key = spec["key"]
        seen = set()
        facts = []
        for item in load_sources(args.root, spec.get("sources", [])):
            text = (item["text"] or "").strip()
            if not text:
                continue
            text = text[:3000]
            folded = norm(text)
            if folded in seen:
                continue
            seen.add(folded)
            facts.append({**item, "text": text})

        notes_path = os.path.join(args.root, spec["notes"]) if spec.get("notes") else None
        notes = ""
        if notes_path and os.path.exists(notes_path):
            notes = open(notes_path, encoding="utf-8").read().strip()
        description = notes or spec.get("role", "")
        if not description:
            description = spec["name"]
        if len(description) > 2000:
            description = description[:1900].rstrip() + "\n\n完整说明见 imported/INSTRUCTIONS.md。"
        description = description[:2000]

        routines = parse_routines(args.root, spec.get("routines"))
        memories = select_memories(facts)

        agent_files = {}
        if notes:
            agent_files["INSTRUCTIONS.md"] = notes
        if facts:
            agent_files["MEMORY.md"] = build_memory_md(facts)
        if routines:
            agent_files["ROUTINES.md"] = "\n\n".join(
                f"## {r['name']}\n- cron: `{r['schedule']['expression']}`\n"
                f"- timezone: {r['timezone']}\n\n{r['instruction']}"
                for r in routines
            )
        connectors_path = (
            os.path.join(args.root, spec["connectors"]) if spec.get("connectors") else None
        )
        if connectors_path and os.path.exists(connectors_path):
            agent_files["CONNECTORS.md"] = open(connectors_path, encoding="utf-8").read()

        for name, content in agent_files.items():
            files[f"agents/{key}/files/{name}"] = content

        manifest["agents"].append(
            {
                "key": key,
                "name": spec["name"][:80],
                "title": spec.get("title", "")[:120],
                "description": description,
                "avatar": None,
                "skills": [],
                "routines": routines[:64],
                "memories": memories,
                "files": f"agents/{key}/files" if agent_files else None,
            }
        )
        stats.append(
            f"{key}: facts={len(facts)} memories={len(memories)} routines={len(routines)}"
        )

    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "openbot-import.json", json.dumps(manifest, ensure_ascii=False, indent=2)
        )
        for path, content in files.items():
            archive.writestr(path, content)

    print(f"wrote {args.out} ({os.path.getsize(args.out)} bytes)")
    print("\n".join(stats))


if __name__ == "__main__":
    main()
