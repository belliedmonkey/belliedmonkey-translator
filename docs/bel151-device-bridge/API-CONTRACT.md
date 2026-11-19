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
- Bearer **must be an MCP OAuth access token** (public client, PKCE S256,
  `token_endpoint_auth_method=none`, scope `mcp:read mcp:write offline_access`).
  A LearnAuth / GoTrue session token is **not** an MCP grant and must never be
  presented here; a probe that sees one calls the path wrong, not passing.
- The App registers its public client with DCR (`/oauth/register`, client_name
  `belliedmonkey-app <flavor>`, redirect `belliedmonkey://oauth/mcp/callback` /
  `belliedmonkeycn://oauth/mcp/callback`) and exchanges only **after** the local
  pairing confirm and **before** `register` (src/app/mcp-oauth-client.js).
- Refresh token → system Keychain service `mt.mcp.oauth` (account `mcp_refresh`),
  a separate slot from `device_cred`; never UserDefaults / a plaintext file.
- oauth_sub from token only; ban cross-account.

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
`{ "device_id", "device_cred" }` · pairing TTL beat every 2–5 min · TTL 10–15 min cloud · 401→clear

200 also carries the Worker-owned confirms bound to this session (B-PUSH, BEL-151):

```json
{ "ok": true, "ttl_sec": 900, "last_seen": 0,
  "pending": [{ "pending_id": "uuid", "action": "start_live_subtitles",
                "expires_at": 0, "expires_in_sec": 0 }] }
```

- `pending` is **always present** (`[]` when none) and never carries args / text /
  translation. It is scoped to the same `oauth_sub` + `device_id` as the beat.
- Worker `PENDING_TTL_SEC = 120` is the authority. The paired foreground App opens a
  **separate 5 s** watch that calls this same endpoint while `visibilityState=visible`
  (429 → 15 s); background keeps only the 2–5 min pairing beat. A pending outside the
  120 s window is not shown and never becomes a silent `openedSubtitles`.
- The watch hands each new `pending_id` to the in-memory `presentPending`, which reuses
  the copy-locked 「确认调用」 sheet. No `NSWorkspace` / `open` / shell / dsh is on this
  path; the user still clicks allow or cancel, and only allow reaches `/confirm`.

### bootstrap
`{ "device_id", "platform":"mac", "source":"open_setup", "ttl_sec":300 }` · after open_setup allow only · ≠ permanent pair

### revoke
`{ "device_id", "device_cred" }`

## App hard rules
1. No permanent register without visible confirm（将把本机可达状态告知已连接的助手）
2. Ban localhost companion as Remote truth
3. Ban 听译已通 / 完整 D3 copy
4. Mac P0 only
5. 401 → clear MCP access + device_cred, stop heartbeat; status says
   「需重新允许连接此设备」 (never a fake paired)
6. Refresh rejected for good (invalid_grant) → clear both Keychain slots + owner;
   a network failure keeps them (one retry) and is reported as network, not revoked
7. Launch is an entry **even when WKWebView reports `hidden`** — it can show the
   window without a `visibilitychange`. The first heartbeat must not be gated on
   visibility (2026-10-31 D.8: the App sent zero device-sessions requests after
   every restart, so a revoked session was never discovered).
8. **One fallout for every 401/403**, whichever POST carried it: foreground beat,
   the client's own interval, `bootstrap`, `register`, `revoke`. Clear
   `device_cred` + Keychain `mcp_access`, stop the loop, persist the re-allow
   reason (`device_reconnect`) across relaunch, and show
   「需重新允许连接此设备」. The client reports through `onUnauthorized`; call
   sites must not each invent their own cleanup.
