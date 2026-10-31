# mocks/hosted-gateway

Public **mock** of [`contracts/hosted-gateway.v0.yaml`](../../contracts/hosted-gateway.v0.yaml).
The real gateway lives in the private `*-hosted` repository; this mock is what CI and local
development may use. It implements the v0 semantics plus the legacy `bt-relay` aliases, with
no real credentials and no network egress.

## Run

```bash
node mocks/hosted-gateway/server.js            # 127.0.0.1:8787
node mocks/hosted-gateway/server.js --port 0   # ephemeral port, printed on stdout
```

## Samples

```bash
BASE=http://127.0.0.1:8787
TOKEN='Authorization: Bearer bmg_test_demo'

# 200 — balance
curl -s -H "$TOKEN" "$BASE/v0/grant/balance"
# {"remaining":0.2,"unit":"usd","resets_at":null,"product":"free"}

# 401 — no token
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/v0/grant/balance"

# 200 — relay (chat shape)
curl -s -H "$TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"hi"}]}' \
  "$BASE/v0/relay"

# 400 — a BYOK provider key in the body is rejected, never forwarded
curl -s -H "$TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"deepseek/deepseek-v4-flash","upstream_api_key":"sk-test-not-a-real-key"}' \
  "$BASE/v0/relay"
# {"error":"byok_key_rejected",...}

# 200 — legacy alias still answers during the v0 window
curl -s -H "$TOKEN" "$BASE/functions/v1/bt-relay/balance"
```

## Rules

- Bearer tokens must start with `bmg_test_`; anything else is `401`.
- Requests carrying `sk-...` or a key-shaped field (`upstream_api_key`, `api_key`, …) get
  `400 byok_key_rejected`, and the value is never echoed.
- Request bodies are never logged. This mirrors the relay's "不碰内容" discipline.
- `POST /v0/grant/consume` requires `Idempotency-Key` and replays the same result.
