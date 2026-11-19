#!/usr/bin/env python3
"""Build an idempotent-ish OpenBot import SQL file from a Grok Bot export.

Usage:
  python3 build_import.py --root <export> --config <config.json> --out <file.sql>

The config maps Grok Bot names to OpenBot agent ids and export-relative sources. Memory facts
become bot-scoped rows (formed_by='bot'), shared_* facts become person-level rows once, and
routines become paused rows in a private channel per Bot. Review the SQL before running it.
"""
import argparse
import json
import os
import random
import re
import uuid
from collections import OrderedDict


def norm(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def bullets(text: str):
    out = []
    for line in text.splitlines():
        match = re.match(r"^\s*-\s+(.+)$", line)
        if match:
            value = match.group(1).strip()
            if value and not value.startswith("#"):
                out.append(value)
    return out


def facts_json(path: str):
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


def load_sources(root: str, sources):
    items = []
    for rel in sources:
        path = os.path.join(root, rel)
        if not os.path.exists(path):
            raise SystemExit(f"missing source: {path}")
        if rel.endswith("_profile_facts.json"):
            items += [
                {"category": "profile", "text": text, "date": None, "via": None}
                for text in json.load(open(path, encoding="utf-8"))
            ]
        elif rel.endswith(".json"):
            items += facts_json(path)
        else:
            items += [
                {"category": "md", "text": text, "date": None, "via": None}
                for text in bullets(open(path, encoding="utf-8").read())
            ]
    return items


def parse_routines(path: str):
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
        out.append(
            {
                "title": section.splitlines()[0].strip(),
                "cron": cron,
                "timezone": zone,
                "instruction": instruction,
            }
        )
    return out


class Quoter:
    def __init__(self):
        self.index = 0

    def __call__(self, value: str) -> str:
        self.index += 1
        tag = f"$q{self.index}$"
        while tag in value:
            self.index += 1
            tag = f"$q{self.index}$"
        return f"{tag}{value}{tag}"


def thread_id(prefix: str) -> str:
    raw = bytes.fromhex(prefix) + bytes(random.randrange(256) for _ in range(10))
    raw = bytearray(raw)
    raw[6] = (raw[6] & 0x0F) | 0x80
    raw[8] = (raw[8] & 0x3F) | 0x80
    hexed = raw.hex()
    return (
        f"{hexed[0:8]}-{hexed[8:12]}-{hexed[12:16]}-"
        f"{hexed[16:20]}-{hexed[20:32]}"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, help="export root")
    parser.add_argument("--config", required=True, help="JSON config")
    parser.add_argument("--out", required=True, help="SQL output")
    args = parser.parse_args()

    config = json.load(open(args.config, encoding="utf-8"))
    user = config["user"]
    prefix = config.get("threadPrefix", "").replace("-", "").lower()
    if prefix and (len(prefix) != 12 or not re.fullmatch(r"[0-9a-f]{12}", prefix)):
        raise SystemExit("threadPrefix must be 12 hex chars (first 6 bytes of a thread id)")

    q = Quoter()
    sql = ["BEGIN;"]
    stats = {"shared": 0, "bots": OrderedDict(), "routines": OrderedDict()}
    shared_seen = set()
    shared_rows = []

    for bot, spec in config["bots"].items():
        agent = spec["agentId"]
        seen = set()
        rows = []
        for item in load_sources(args.root, spec.get("sources", [])):
            text = (item["text"] or "").strip()
            if not text:
                continue
            text = text[:6000]
            key = norm(text)
            if item["category"].startswith("shared_"):
                if key not in shared_seen:
                    shared_seen.add(key)
                    shared_rows.append({**item, "text": text, "key": key})
                continue
            if key in seen:
                continue
            seen.add(key)
            rows.append({**item, "text": text, "key": key})

        stats["bots"][bot] = len(rows)
        for item in rows:
            provenance = f"Grok Bot 迁移 · {bot} · {item['category']}"
            if item.get("date"):
                provenance += f" · {item['date']}"
            observed = (
                f"DATE '{item['date']}'"
                if item.get("date")
                and re.fullmatch(r"\d{4}-\d{2}-\d{2}", item["date"])
                else "NULL"
            )
            sql.append(
                "INSERT INTO personal_memories (id, owner_user_id, content, provenance, "
                "enabled, review_state, formed_by, formed_by_agent_id, source_app, "
                "observed_at, created_at, updated_at) VALUES "
                f"(gen_random_uuid()::text, {q(user)}, {q(item['text'])}, "
                f"{q(provenance[:500])}, true, 'confirmed', 'bot', {q(agent)}, "
                f"'Grok Bot', {observed}, now(), now()) ON CONFLICT DO NOTHING;"
            )

        routine_rel = spec.get("routines")
        if not routine_rel:
            continue
        routine_path = os.path.join(args.root, routine_rel)
        if not os.path.exists(routine_path):
            raise SystemExit(f"missing routines: {routine_path}")
        routines = parse_routines(routine_path)
        if not routines:
            continue
        channel = f"channel_{uuid.uuid4()}"
        channel_thread = thread_id(prefix) if prefix else str(uuid.uuid4())
        sql.append(
            f"INSERT INTO channels (id, name, description) VALUES "
            f"({q(channel)}, {q(bot)}, 'Private agent channel.');"
        )
        sql.append(
            f"INSERT INTO channel_memberships (channel_id, user_id) VALUES "
            f"({q(channel)}, {q(user)});"
        )
        sql.append(
            f"INSERT INTO channel_agents (channel_id, agent_id) VALUES "
            f"({q(channel)}, {q(agent)});"
        )
        sql.append(
            f"INSERT INTO intelligence_channel_mappings (user_id, channel_id, thread_id) "
            f"VALUES ({q(user)}, {q(channel)}, {q(channel_thread)});"
        )
        stats["routines"][bot] = len(routines)
        for routine in routines:
            sql.append(
                "INSERT INTO routines (id, owner_user_id, agent_id, channel_id, instruction, "
                "cron, timezone, enabled, next_run_at) VALUES "
                f"({q('routine_' + str(uuid.uuid4()))}, {q(user)}, {q(agent)}, "
                f"{q(channel)}, {q(routine['instruction'])}, {q(routine['cron'])}, "
                f"{q(routine['timezone'])}, false, now() + interval '1 day');"
            )

    for item in shared_rows:
        provenance = "Grok Bot 共享记忆"
        if item.get("via"):
            provenance += f" · via {item['via']}"
        if item.get("date"):
            provenance += f" · {item['date']}"
        observed = (
            f"DATE '{item['date']}'"
            if item.get("date") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", item["date"])
            else "NULL"
        )
        sql.append(
            "INSERT INTO personal_memories (id, owner_user_id, content, provenance, enabled, "
            "review_state, formed_by, formed_by_agent_id, source_app, observed_at, created_at, "
            "updated_at) VALUES "
            f"(gen_random_uuid()::text, {q(user)}, {q(item['text'])}, "
            f"{q(provenance[:500])}, true, 'confirmed', 'person', NULL, 'Grok Bot', "
            f"{observed}, now(), now()) ON CONFLICT DO NOTHING;"
        )

    sql.append("COMMIT;")
    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write("\n".join(sql) + "\n")

    stats["shared"] = len(shared_rows)
    stats["total_memories"] = stats["shared"] + sum(stats["bots"].values())
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print(f"wrote {args.out} ({os.path.getsize(args.out)} bytes)")


if __name__ == "__main__":
    main()
