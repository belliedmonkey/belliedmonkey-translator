# supabase/ · public data contract

This directory is the **public data contract** for the optional sync backend. The server
implementations are **not** here — they live in the private
`belliedmonkey-translator-hosted` repository (BEL-172, P0). See
[`../BOUNDARY.md`](../BOUNDARY.md).

| Path | What it is |
|---|---|
| `schema.sql` | Tables, RLS policies, quota constraints. Published as the data contract; `docs/learning-design.md` §8 describes it. |
| `functions/bt-ingest/events.gen.json` | Public event-name/property whitelist (BEL-135: china == intl). No pipeline code. |
| `../contracts/hosted-gateway.v0.yaml` | Hosted API contract (relay / grant / ledger / models / ingest / account deletion). |
| `../mocks/hosted-gateway/` | Runnable mock used by CI and local development. |

## Where the implementation went

| Former path | New home |
|---|---|
| `functions/bt-relay/` | `belliedmonkey-translator-hosted` → `functions/bt-relay/` |
| `functions/bt-grant/` `bt-grant-ledger/` | same repo → `functions/` |
| `functions/bt-ingest/` (pipeline) | same repo → `functions/bt-ingest/` (whitelist stays public here) |
| `functions/bt-models/` | same repo → `functions/bt-models/` |
| `functions/bt-delete-account/` | same repo → `functions/bt-delete-account/` |
| `deploy/china/` (filing/deploy/audit runbooks) | `belliedmonkey-translator-compliance` |
| `deploy/china-relay/` (SCF packaging) | `belliedmonkey-translator-hosted` |

The public repo must never import from either private repo. Deployment and secrets
instructions are in the private repositories; this file deliberately carries none.

## Deploying / self-hosting

The published contract + `schema.sql` are enough to build a compatible backend, but this
repository does not ship one. The project's own hosted backend is closed source.
