---
name: geoflow-stack
description: >-
  Use when Growth needs GEOFlow or GEOInflow on Omarchy Tailscale: login, pull
  KB/articles/G-cov dashboard numbers, or refresh the daily board — Hangzhou Mac
  curl/API only, never 1Password or browser.
---
# GEOFlow + GEOInflow stack (Omarchy)

## When
Growth daily board, GEO probes, or any ask to read Flow/Inflow numbers. Path is **Hangzhou Mac → Tailscale** only. Never cloud/box egress to the Tailscale IP. Never 1Password. Never open a browser for this stack. Never mark Linear **BEL-145** Done.

## Endpoints
| Stack | Base (Tailscale) | Role |
|---|---|---|
| **GEOFlow** | `http://100.69.15.88:18080` | Content engineering: knowledge base → drafts → review → distribute. Admin UI under `/geo_admin`. |
| **GEOInflow** (Liekan / Umami API 1.2.0) | `http://100.69.15.88:3002` | GEO observation: crawler findings, coverage gaps, cite signals. |

**Ownership split:** KB status and articles = **GEOFlow**. G-cov / findings / crawler analysis = **GEOInflow** API. Linear remains the only kanban.

## GEOInflow HTTP API (preferred)
- Spec: `GET http://100.69.15.88:3002/openapi.json` (~236 routes).
- Health (no auth): `GET /api/heartbeat` → `{"ok":true}`.
- Login: `POST /api/auth/login` with JSON `{"username","password"}` → `token` (+ `user`). Then `Authorization: Bearer <token>` (`bearerAuth`).
- Useful authenticated reads: `GET /api/websites`, `GET /api/liekan/websites/summary`, per-site `.../crawler-analysis`, `.../crawler-findings/{findingKey}`, analytics under `/api/liekan/websites/{websiteId}/...`.
- Password change (needs current password): `POST /api/me/password`.
- Demo `liekan.com` / seed volume **must not** become business conclusions.

## Credentials (Hangzhou Mac only)
- File: `~/.config/belliedmonkey/geoinflow-admin.env` (mode **600**).
- Keys: `URL`, `USERNAME`, `PASSWORD` (and optional `STACK`/`UPDATED_AT`).
- **Do not** use 1Password / `op` / RequestOnePasswordLogins for this stack. Old 1Password item names are stale after local rotates.
- GEOFlow admin may still live in Omarchy `GEOFLOW_ADMIN_PASSWORD` / Flow login cookie path; prefer documented Mac-side file if present under the same config dir. Never print secrets to chat.

## Workflow
1. Confirm Mac → Tailscale: `curl -sS -o /dev/null -w '%{http_code}\n' http://100.69.15.88:3002/api/heartbeat` (expect 200). Same idea for Flow `http://100.69.15.88:18080/geo_admin/login`.
2. Read credential file on the Mac (do not cat into chat logs). `POST /api/auth/login` with username/password from the file.
3. Pull Inflow one-liners via API (websites summary + crawler/findings for `.cc` / `.com` only). Label demo sites separately.
4. Pull Flow KB/articles via Flow admin session or DB-backed read already used in Growth ops — not via Inflow API.
5. Update Growth daily plan + board canvas GEO dual-stack lines (AS_OF timestamp). BEL-145 / BEL-148 / BEL-149 stay unfinished unless the user explicitly Done.
6. Ops playbook companion: `/workspace/seo/measurement/geoflow-geoinflow-ops-2026-10-30.md` (box) when present.

## Hard rules
- No browser UI for login or dashboard scrape when API works.
- No 1Password for GEO stack auth.
- No password in chat, voice, Linear, or git.
- No BEL-145 Done from tooling availability alone.
