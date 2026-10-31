# BEL-151 Device Bridge · App↔Worker API contract (provisional P0)

- **when:** 2026-10-31 Asia/Shanghai
- **source:** ARCH-SHORT-bel151-device-bridge ACCEPT-D1…D7
- **owners:** App=研发 · Worker=增长 · align same拍
- **status:** PROVISIONAL until growth RESULT freezes paths/status codes
- **base note:** first-draft www hosts were inverted vs live MCP; App uses flavor-config:
  - intl/global → `https://mcp.belliedmonkey.cc`
  - china → `https://mcp.belliedmonkey.com`
  - **base 以增长冻结为准** — if growth RESULT DIFF paths/fields, follow DIFF.

## Auth
- Bearer OAuth for logged-in App user; oauth_sub from token only; ban cross-account.

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/mcp/device-sessions/register` | Pair after user-visible confirm |
| POST | `/api/mcp/device-sessions/heartbeat` | Refresh last_seen |
| POST | `/api/mcp/device-sessions/bootstrap` | Short-lived after open_setup C1 |
| POST | `/api/mcp/device-sessions/revoke` | Clear + tell cloud |

### register body
`{ "device_id", "platform":"mac", "app_version", "confirm": true }`
→ 200 `{ "ok":true, "device_cred", "ttl_sec":900 }` · 401/403/400

### heartbeat
`{ "device_id", "device_cred" }` · every 2–5 min · TTL 10–15 min cloud · 401→clear

### bootstrap
`{ "device_id", "platform":"mac", "source":"open_setup", "ttl_sec":300 }` · after open_setup allow only · ≠ permanent pair

### revoke
`{ "device_id", "device_cred" }`

## App hard rules
1. No permanent register without visible confirm（将把本机可达状态告知已连接的助手）
2. Ban localhost companion as Remote truth
3. Ban 听译已通 / 完整 D3 copy
4. Mac P0 only
5. 401 → clear device_cred, stop heartbeat
