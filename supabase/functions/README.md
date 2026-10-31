# supabase/functions/ · public stubs only

Only the public **event whitelist** lives here:

- `bt-ingest/events.gen.json` — event names, property keys and enum values. Generated from
  `build/telemetry.config.js`; china and intl share it (BEL-135).

Every `index.ts` implementation (relay, grant, ledger, ingest pipeline, models, account
deletion) moved to the private `belliedmonkey-translator-hosted` repository in BEL-172 P0.
The public contract is `../../contracts/hosted-gateway.v0.yaml`; the runnable mock is
`../../mocks/hosted-gateway/`.

Do not add an implementation here "temporarily": CI path-deny
(`scripts/check-boundary.js`, `.github/workflows/boundary.yml`) fails the change. See
`../../BOUNDARY.md` §2.
