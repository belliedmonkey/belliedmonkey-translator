---
name: grokbot-openbot-migration
description: Migrate a Grok Bot account's memories, routines and files into a local OpenBot deployment — export `/workspace/backup*` and `~/.pi` from the cloud box, parse facts.json / memory.md / routines.md, import into OpenBot's PostgreSQL (`personal_memories`, `routines`, private channels), verify via DB/API/UI plus a real recall turn, and apply the remote-memory seam needed because `HttpAgent.run` bypasses `.use()` middleware. Use when moving Grok Bots to OpenBot, re-running the import after a reset, or debugging "the Bot says it has no memory" after an import.
---

# Grok Bot → OpenBot migration

This is an ordered, backup-first procedure. It was run against a local OpenBot
(`openbot-postgres-1`, app `http://127.0.0.1:3010`, server on `3001`) and a real Grok Bot
export. Every number below is from that run; treat them as expected shape, not constants.

## When to use

- Moving one or more Grok Bots (memories, routines, files) to OpenBot.
- Re-importing after an OpenBot database reset.
- A remote OpenBot Bot answers "I have no memory" even though `/capabilities/memory` shows rows.

## Official ZIP import first (newer OpenBot)

OpenBot now documents a first-party path:
<https://openbot.run/guides/import-grok-bot-agents> — **Server settings → Import → Grok Bot**,
then add **Migrator by OpenBot** in Grok Bot and ask it to export. The ZIP carries instructions,
skills, memories, routines and optional files; OpenBot previews it and creates **new** agents
(usually built-in, with provider/model chosen in OpenBot).

Prefer that path when all three are true:

- the checkout actually has the import UI (`find app/src/routes -iname '*import*'` is non-empty);
- Grok Bot still has usage left to run the Migrator agent;
- creating new agents is acceptable (the ZIP import does **not** update existing agents).

Use this skill instead when the checkout predates the importer, when Grok Bot quota is exhausted and
you already have `/workspace/backup*`, or when the target must be an **existing remote_ag_ui Bot**.
The official importer creates built-in agents, so it does not need the Phase 4 memory seam; the seam
is specifically for in-place imports into remote agents.

## Safety rules

1. **Back up OpenBot PostgreSQL before any write.** No exceptions:
   ```bash
   docker exec openbot-postgres-1 pg_dump -U openbot -d openbot -Fc > ~/Downloads/openbot-before-import.dump
   ```
2. **Do not delete the Grok Bot source** (`/workspace/backup*`, `~/.pi`) until the Mac copy is verified.
3. **Import routines paused** (`enabled=false`). OpenBot runs them for real and spends model usage.
4. **Do not put secrets in a public repo.** Exports can contain `auth.json`, connector state and
   `box-secrets.json`; encrypt archives and rotate keys after migration.
5. **Do not write to `main` directly** in OpenBot; use a feature branch and a clean commit.

## Export layout this skill expects

```
<export-root>/
  backup-<bot>/memory.md              # or shards/*.txt
  backup-<bot>/routines.md
  backup-<bot>/connectors.md
  backup-<bot>/notes.md
  backup-<bot>/profile.json
  backup-<bot>/raw/facts.json         # categories: profile, journal, shared_profile, shared_journal
  memory-backup-<bot>.zip             # optional duplicate
  pi/.pi/agent/...                    # optional pi CLI data
  library/<bot>/...                   # optional Library files
```

`facts.json` is a dict of category → {fact text: {date, type, text, via}}; it is the cleanest
source. `memory.md` is Markdown bullets and is the fallback. Shards are plain bullets.

## Phase 0 — inventory the target

```bash
docker exec openbot-postgres-1 psql -U openbot -d openbot -c \
  "SELECT id, name, type FROM agents ORDER BY created_at;"
docker exec openbot-postgres-1 psql -U openbot -d openbot -c \
  "SELECT id, email, name FROM users;"
docker exec openbot-postgres-1 psql -U openbot -d openbot -c \
  "SELECT count(*) FROM personal_memories; SELECT count(*) FROM routines;"
```

Map each Grok Bot display name to an OpenBot `agents.id`. Names may differ (`CEO` vs
`大肚猴公司CEO`); match on the human name, not the id. Bots that do not exist in OpenBot cannot be
imported — create them first or skip and record the gap.

## Phase 1 — build the import SQL

Copy `scripts/import-config.example.json` and fill:

- `user`: OpenBot user id (single-user dev installs use `dev-local-user`).
- `threadPrefix`: first 12 hex chars of an existing `intelligence_channel_mappings.thread_id`
  (the deployment fingerprint); used only for channels created for routines.
- `bots.<name>.agentId`, `.sources`, `.routines` (omit `routines` when none).

Then:

```bash
python3 .claude/skills/grokbot-openbot-migration/scripts/build_import.py \
  --root ~/Downloads/grok-bot-export-20261102 \
  --config /tmp/grokbot-import.json \
  --out /tmp/openbot_import.sql
```

The script:

- imports `profile`/`journal`/`md` facts as `formed_by='bot'`, `formed_by_agent_id=<agent>`;
- dedupes `shared_*` across bots and imports them once as `formed_by='person'`
  (visible to every Bot — this matches Grok's shared memory);
- sets `review_state='confirmed'`, `source_ref=NULL`, `import_digest=NULL`;
- parses routines with `### prompt` **and** `- prompt: |`, strips `CRON_TZ=`, inserts them
  `enabled=false`, and creates one private channel per Bot with routines.

**Dry-run first** (replace `COMMIT` with `ROLLBACK`, run with `ON_ERROR_STOP=1`), then execute:

```bash
docker exec -i openbot-postgres-1 psql -U openbot -d openbot -v ON_ERROR_STOP=1 \
  -f - < /tmp/openbot_import.sql
```

## Phase 2 — verify data, API, UI

```bash
# integrity
docker exec openbot-postgres-1 psql -U openbot -d openbot -v user=dev-local-user \
  -f .claude/skills/grokbot-openbot-migration/scripts/verify_import.sql

# API
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3010/api/memory
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3010/api/routines
```

UI: `/capabilities/memory` must show `Grok Bot 迁移 · …` rows; `/routines` must show the imported
routines as **Paused**. Screenshot both.

## Phase 3 — prove a Bot actually recalls

Do not stop at the memory page. The page proves rows exist; only a turn proves injection.

1. Pick a fact from the **first 40 loaded rows** for that Bot (they are what goes into the prompt):
   ```sql
   SELECT left(content, 120) FROM personal_memories
   WHERE owner_user_id='dev-local-user' AND enabled AND deleted_at IS NULL
     AND ((formed_by='bot' AND formed_by_agent_id='<agent>') OR formed_by <> 'bot')
   ORDER BY updated_at DESC LIMIT 40;
   ```
2. Ask the Bot that fact, read-only: “只回答一句，不要调用工具：…”. A correct answer proves memory.
3. A "no memory" answer for a fact that is **not** in those 40 is normal: OpenBot injects
   latest 40 / 24 KB and leaves the rest to `recall_personal_memory`. Check the DB before
   declaring failure.

## Phase 4 — the remote-memory seam (required for remote AG-UI Bots)

**Symptom:** built-in Bots recall; every `remote_ag_ui` Bot says it has no memory.

**Cause:** `PersonalMemoryMiddleware` is attached with `.use()`, which `@ag-ui/client`'s
`HttpAgent.run` bypasses. `CloningRemoteAgent.run` also delegates straight to the remote.

**Fix:** apply `patch/openbot-personal-memory.patch` in the OpenBot checkout
(committed there as `d65db5e0` on `fix/remote-personal-memory`):

```bash
cd ~/openbot
git apply /path/to/.claude/skills/grokbot-openbot-migration/patch/openbot-personal-memory.patch
cd server && bun run typecheck
```

It adds an optional `personalMemory` loader to `CloningRemoteAgent`, passes
`loadPersonalMemory` down from `buildAgent`, and prepends the memory system message in `run`;
`clone()` keeps it.

Also set these in OpenBot `.env` (otherwise the remote endpoint is refused or answers 401):

```dotenv
AGENT_ENDPOINT_ALLOWED_HOSTS=localhost:4201,localhost:4200
MANAGED_AGENT_AG_UI_URL=http://localhost:4201/ag-ui
```

Restart only the API server (keeps Docker, app and worker):

```bash
PID=$(lsof -tiTCP:3001 -sTCP:LISTEN | head -1); kill "$PID"
cd ~/openbot/server && nohup bun --env-file=../.env src/production-entry.ts >> ../.logs/server.log 2>&1 &
```

Then repeat Phase 3. A remote Bot answering a first-40 fact is the pass condition.

## Phase 5 — routines

- All imported routines are paused. Review `instruction`, `cron`, `timezone` first.
- OpenBot's floor is **15 minutes**; `*/5`, `*/10` and `* * * * *` will be refused on enable.
  Rewrite the schedule before enabling.
- `instruction` is capped at 2000 characters by the app's validation; a direct insert can hold
  more, but editing it later in the UI may require shortening.
- Enabling routines spends model usage and can perform real actions. Enable one, watch one run.

## Gotchas found the hard way

| Symptom | Cause / fix |
|---|---|
| `This deployment will not dial http://localhost:4201/ag-ui` | Add `AGENT_ENDPOINT_ALLOWED_HOSTS=localhost:4201`; restart server. |
| `HTTP 401: {"error":"Unauthorized."}` | Set `MANAGED_AGENT_AG_UI_URL=http://localhost:4201/ag-ui`; restart server. |
| Built-in recalls, remote does not | Apply Phase 4 patch; `.use()` never reaches `HttpAgent.run`. |
| Bot says no memory for a fact that is in the DB | Check whether it is in the latest 40; if not, use recall/search or raise the context limit deliberately. |
| Routines refuse to enable | Cron is below 15 minutes or zone invalid. |
| Routines show but never fire | `enabled=false` by design; `routine_runs` stays 0. |
| Duplicate/wrong bot data | The Grok export raced a shared `backup/`; prefer isolated `backup-<bot>/` and verify headers. |
| `personal_memories` insert conflicts | `import_digest` is unique for `formed_by='bot'`; the script leaves it NULL and dedupes itself. |

## Rollback

```bash
docker exec -i openbot-postgres-1 pg_restore -U openbot -d openbot --clean --if-exists \
  < ~/Downloads/openbot-before-import.dump
```

Restoring needs the OpenBot services stopped; restart them afterwards.

## Files

- `scripts/build_import.py` — export → SQL (facts, memory.md, shards, routines, channels).
- `scripts/import-config.example.json` — config shape with this run's bot mapping.
- `scripts/verify_import.sql` — counts, orphans, duplicates, routines, channels.
- `patch/openbot-personal-memory.patch` — Phase 4 seam (git-am-able).
