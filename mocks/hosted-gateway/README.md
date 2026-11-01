# mocks/hosted-gateway

Public **mock** of [`contracts/hosted-gateway.v0.1.yaml`](../../contracts/hosted-gateway.v0.1.yaml).
The real gateway lives in the private `*-hosted` repository; this mock is what CI and local
development may use. It implements the v0.1 semantics (billing checkout/portal, balance,
idempotent consume, BYOK-400 relay, minimal sync, account export/delete) plus the legacy
`bt-relay` aliases, with no real credentials and no network egress.

The mock completes a checkout instantly (sets `product` and `balance`) so the balance path
is testable without a payment processor. The real gateway waits for a signed webhook from
its hosted billing rail; webhook handling is **not** part of the public contract.

## Run

```bash
node mocks/hosted-gateway/server.js            # 127.0.0.1:8787
node mocks/hosted-gateway/server.js --port 0   # ephemeral port, printed on stdout

# ACCEPT-C-1 gate (starts an ephemeral mock, asserts every v0.1 addition)
node mocks/hosted-gateway/selftest.mjs
```

## Samples

```bash
BASE=http://127.0.0.1:8787
TOKEN='Authorization: Bearer bmg_test_demo'
JSON='Content-Type: application/json'

# Public pricing: enterprise is a grayscale coming_soon placeholder
curl -s "$BASE/v0/billing/plans"

# 200 — balance (free, then monthly after a mock checkout)
curl -s -H "$TOKEN" "$BASE/v0/grant/balance"

# 200 — checkout monthly (mock completes immediately)
curl -s -H "$TOKEN" -H "$JSON" -d '{"product":"monthly","flavor":"global"}' \
  "$BASE/v0/billing/checkout"

# 200 — customer portal (after a checkout created a mock customer)
curl -s -H "$TOKEN" "$BASE/v0/billing/portal"

# 401 — no token
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/v0/grant/balance"

# 200 — relay (chat shape)
curl -s -H "$TOKEN" -H "$JSON" \
  -d '{"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"hi"}]}' \
  "$BASE/v0/relay"

# 400 — a BYOK provider key in the body is rejected, never forwarded
curl -s -H "$TOKEN" -H "$JSON" \
  -d '{"model":"deepseek/deepseek-v4-flash","upstream_api_key":"sk-test-not-a-real-key"}' \
  "$BASE/v0/relay"
# {"error":"byok_key_rejected",...}

# 200 — sync settings (ETag returned); 409 on an If-Match mismatch
curl -s -D - -H "$TOKEN" -H "$JSON" -X PUT \
  -d '{"data":{"theme":"dark"}}' "$BASE/v0/sync/settings"
curl -s -H "$TOKEN" "$BASE/v0/sync/settings"

# 200 — legacy alias still answers during the v0 window
curl -s -H "$TOKEN" "$BASE/functions/v1/bt-relay/balance"
```

## Rules

- Bearer tokens must start with `bmg_test_`; anything else is `401`.
- Requests carrying `sk-...` or a key-shaped field (`upstream_api_key`, `api_key`, …) get
  `400 byok_key_rejected`, and the value is never echoed.
- Sync collections are only `settings` / `session-meta`; key-shaped fields/values get
  `400` and are never stored. `If-Match` mismatch returns `409` with the current envelope.
- Checkout only accepts `monthly` / `yearly`; `enterprise` returns
  `400 enterprise_not_available` and has no mock ledger API.
- Request bodies are never logged. This mirrors the relay's "不碰内容" discipline.
- `POST /v0/grant/consume` requires `Idempotency-Key` and replays the same result.
