# Local models (Ollama · LM Studio · a self-hosted gateway)

The own-key path does not have to leave your machine. Any server that speaks the
OpenAI **chat completions** shape works through the **Custom** engine entry; the client
sends the complete endpoint URL you type and concatenates nothing.

This page uses two common local servers. Neither needs a real cloud key, an account, or a
hosted backend of ours.

## 1 · Ollama

Install Ollama from <https://ollama.com/download>, then:

```bash
# Allow the browser extension's origin to call the local server.
# Without this, Ollama's default CORS policy can refuse the extension's origin.
OLLAMA_ORIGINS='*' ollama serve

# In another terminal — pick a model that fits your machine.
ollama pull qwen2.5:7b
```

In the extension **Settings**:

1. Engine → **Custom** (OpenAI-compatible).
2. **Endpoint:** `http://localhost:11434/v1/chat/completions`
   (the complete URL, including `/v1/chat/completions`).
3. **Model:** `qwen2.5:7b` (or whatever you pulled).
4. **API Key:** Ollama ignores it, but the field may require a non-empty value. Any
   placeholder such as `ollama` is fine; it is still stored only on this device.
5. **Test connection**, then save.

If the test fails with `network` / `Load failed`, the usual causes are: Ollama is not
running, the port is different, `OLLAMA_ORIGINS` did not include the extension origin, or
the model name does not match `ollama list`.

## 2 · LM Studio

1. Install LM Studio from <https://lmstudio.ai/> and download a chat model.
2. Open the **Developer** / **Local Server** tab, load the model, and start the server
   (default port 1234).
3. In the extension Settings choose **Custom** and use:
   - **Endpoint:** `http://localhost:1234/v1/chat/completions`
   - **Model:** the model identifier shown by the local server
   - **API Key:** any non-empty placeholder if the field requires one.

## 3 · A self-hosted gateway

The same **Custom** entry works for a company gateway, a LiteLLM/OpenAI-compatible
proxy, or a model server on your LAN:

- use the **complete** request URL (for example
  `https://gateway.example.com/v1/chat/completions`);
- use the model id that gateway expects;
- use the key that gateway issued (or a placeholder if it does not authenticate).

If the gateway is on a private network, the browser or App must be able to reach it. A
page's CSP/CORS policy can still block a direct request from a content script; the
extension's local background fallback exists for that case, and it still talks to your
gateway, not to a server of ours.

## 4 · What stays local

- The prompt and the translated text go to the endpoint you configured. With a local
  endpoint, they do not leave the machine.
- The API key (or placeholder) stays in local storage and is sent only to that endpoint.
- No free-credit token (`bmg_...`) is used on this path. The hosted relay is not involved.
- Telemetry never carries page content, the prompt, the translation, the URL, or the key.

## 5 · Limits worth knowing

- A small local model is usually slower and weaker than a hosted frontier model. That is
  a quality/speed trade-off, not a degraded free path: the same feature is fully
  configurable and the cloud providers remain available if you want them.
- A local server must allow the extension's origin (CORS) and must stay running while you
  translate.
- The App's on-device speech/LID models are separate from translation models and are
  downloaded from the app's model manifest; they are not configured through this page.

## 6 · Related

- [`docs/byok.md`](byok.md) — the full own-key guide and failure table.
- [`docs/oss-quickstart.md`](oss-quickstart.md) — clone, build, load, translate.
- [`docs/domain-design.md`](domain-design.md) §7 — why the endpoint is used exactly as
  stored, and why transport is keyed by request format rather than vendor.
