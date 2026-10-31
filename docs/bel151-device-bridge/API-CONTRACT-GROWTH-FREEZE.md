# BEL-151 Device Bridge · API contract (growth FREEZE · Worker P0)

- **status:** FROZEN by growth RESULT
- **intl base:** `https://mcp.belliedmonkey.cc`
- **china base:** `https://mcp.belliedmonkey.com`
- Paths unchanged: `/api/mcp/device-sessions/{register,heartbeat,bootstrap,revoke}`
- TTL: pair/heartbeat 900s · bootstrap cap 300 · DOWN 900s
- Auth: Bearer → oauth_sub
- DIFF vs 首稿: 仅 base 纠正；字段同
