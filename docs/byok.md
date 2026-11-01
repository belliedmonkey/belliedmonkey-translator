# Bring your own key (BYOK)

This is the default translation path: **your browser talks to the provider you chose,
with your key, and no server of ours is in between.** It needs no account, no
subscription and no hosted backend.

The provider list is generated at build time from
[`build/providers.config.js`](../build/providers.config.js) into
`content/providers.gen.js`. Do not copy model names or endpoints out of that registry into
your own notes; read the settings UI (or the registry) for the current values.

## 1 · One concrete direct path

The example below uses a hosted provider that takes a standard API key. The same steps
work for any built-in provider; only the key and the model access differ.

1. Create an API key in the provider's own console. Keep it out of this repository, out of
   issue trackers, and out of screenshots.
2. Open the extension's **Settings**.
3. Under **Quick setup** (the card that configures translation, speech and transcription
   together) choose the provider. If you only want to change translation, use the
   **Engine** section instead.
4. Paste the key into the **API Key** field.
5. Leave the endpoint at the built-in default unless the provider told you to use a
   different one. The default is a complete request URL; the client sends that exact
   address and concatenates nothing.
6. Press **Test connection**. A green result shows the status and the route used.
7. Save, open any page, and translate it.

The key is stored in `chrome.storage.local`, on this device. It is not synced, not sent to
us, and not written to telemetry. The only network request that carries it is the request
to the provider you selected.

### If you use another OpenAI-/Anthropic-compatible service

Choose **Custom** in the engine list, then fill in:

- **API Key** — the key that service issued (or a non-empty placeholder if the local
  server ignores keys);
- **Endpoint** — the **complete** request URL, for example
  `https://gateway.example.com/v1/chat/completions`;
- **Model** — the model id that gateway expects.

The transport is keyed by request format, not by vendor. A company gateway or a
self-hosted server that speaks `chat/completions` works without a code change.

## 2 · What "no hosted path" means here

- The **own-key** request goes from the extension (content script) or the App directly to
  the provider endpoint.
- The extension also has a **local background fetch fallback** (`proxyFetch`) for pages
  whose CSP or CORS rules block a direct request. That fallback runs in the extension's
  own service worker on your machine; it is not a server of ours. It still sends your key
  to the provider endpoint you configured.
- The **free credit** (`bmg_...` token) is a different path. It is opt-in, appears only
  after sign-in and claim, and is relayed through the hosted gateway. The BYOK path never
  uses that token and is never redirected into the relay.

To verify on a machine:

```bash
# In DevTools → Network, inspect the translation request:
# - request URL host = the provider you configured, not a hosted/relay host
# - Authorization = your provider key, or no Authorization for the free Google channel
# - no "Authorization: Bearer bmg_..." on a BYOK request
```

A quick static check (the source of truth for the route):

```bash
grep -n "sentRealKey\|bmg_" extension/content/translation-api.js
```

## 3 · When it fails, what the UI should tell you

The UI distinguishes the cause instead of pushing a subscription:

| Status / code | Meaning | What to do |
|---|---|---|
| `auth` / 401 / 403 | the provider rejected the key | paste a valid key; check the key's model access |
| 404 | endpoint or model is wrong | use the complete endpoint and the exact model id |
| 429 / `busy` | the provider is rate-limiting | wait, or switch engines |
| `network` / `Load failed` | the endpoint is unreachable, DNS/TLS failed, or CORS refused | check the address and the provider's CORS policy |
| `timeout` | no answer in time | check the network; retry on the line |
| `credit_exhausted` | the optional free credit ran out | **use your own key** (the UI offers this) or wait for the pool |

A failure on the own-key path never says "subscribe to continue". The free-credit card
also offers **use my own key** as the primary escape hatch.

## 4 · Keys and privacy

- Store keys only in the extension's local storage or the App's local credential store.
- Never commit a key. The repository's `gitleaks` configuration and the build boundary
  gate will reject one.
- Never put a key in a URL, a screenshot, an issue, or a crash report.
- A key is per provider. The **Quick setup** card groups only engines that share a host;
  if you use two providers, configure them separately.
- Deleting the extension's data (or the App's local data) removes the key. Sync does not
  carry it.

For the optional hosted path, see [`docs/oss-quickstart.md`](oss-quickstart.md) §7 and
[`BOUNDARY.md`](../BOUNDARY.md) §3.
