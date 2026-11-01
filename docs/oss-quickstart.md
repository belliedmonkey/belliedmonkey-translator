# OSS quickstart — clone, build, load, translate

This is the **single entry page** for the public MIT source tree. It is written for a
stranger on a clean machine: no private repository, no internal SSH, no real grant key,
and no hosted backend are required for the path below.

> **Which tree is this?** This page lives on the **MIT orphan root**
> (`oss/mit-orphan`, tag `oss-v0.1.0-bel172-p0`). The App Store / Chrome / Firefox store
> builds are cut from a separate **GPL-3.0-or-later** branch (`main`). The two lanes are
> never merged. If you cloned `main`, you are on the store lane, not this one.
> See [`docs/oss-release.md`](oss-release.md) and [`BOUNDARY.md`](../BOUNDARY.md).

## 0 · Five-minute path

1. `git clone` the orphan branch (or the tag) below.
2. `npm ci` — build-time devDependencies only.
3. `node build.js` — produces `dist/` plus a Chrome ZIP.
4. Load `dist/` unpacked in Chrome/Edge.
5. Open the extension settings, choose a provider, paste **your own** key, press
   **Test connection**, save.
6. Translate a page. Nothing in that path goes through a server of ours.

The detailed steps and the evidence to check at each one are below.

## 1 · Prerequisites

- **git**
- **Node.js ≥ 20** (see `package.json` → `engines`). Node 22+ is needed only for the
  real-Chrome layout gate.
- **npm** (ships with Node)
- For the Safari/App lane only: macOS with a **full Xcode** install (the
  `safari-web-extension-converter` is not in the Command Line Tools).

The built extension has **zero runtime npm dependencies** and loads no CDN. `npm ci` is
for the build step (`esbuild` and `react` are build-time devDependencies, pinned by
`package-lock.json`).

## 2 · Clone the MIT root

Track the branch:

```bash
git clone --branch oss/mit-orphan \
  https://github.com/belliedmonkey/belliedmonkey-translator.git
cd belliedmonkey-translator
```

Or check out the exact P0 snapshot:

```bash
git clone https://github.com/belliedmonkey/belliedmonkey-translator.git
cd belliedmonkey-translator
git checkout oss-v0.1.0-bel172-p0
```

**Do not** clone `main` and call it the OSS tree. `main` is the GPL store lane.

Confirm you are on the MIT root:

```bash
head -1 LICENSE          # MIT License
test -f NOTICE && echo "NOTICE present"
git log --oneline -1     # the orphan root / a descendant of it
```

## 3 · Build the extension

```bash
npm ci
node build.js                 # global Chrome/Safari → dist/ + belliedmonkeytranslator.zip
node build.js --flavor china  # China flavor       → dist-china/ + belliedmonkeytranslator-china.zip
node build.js firefox         # Firefox            → dist-firefox/ + belliedmonkeytranslator-firefox.xpi
```

All three commands must exit 0. The build prints its own gates (manifest validation,
palette, compliance, telemetry/disclosure gates) and stops on a failure.

- **Chrome / Edge:** open `chrome://extensions` (or `edge://extensions`) → enable
  **Developer mode** → **Load unpacked** → pick `dist/`.
- **Firefox:** open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** →
  pick `dist-firefox/manifest.json`. The `.xpi` is the packaged form.
- **China flavor:** load `dist-china/` the same way. It is a separate build; do not point
  the global build at a China backend or vice versa.

## 4 · Safari / App (optional, macOS + full Xcode)

```bash
bash build-safari.sh            # iOS Xcode project at safari-project/
# or: bash build-safari.sh global macos
```

`build-safari.sh` generates the project and re-applies version/bundle-id/Info.plist
settings. It does **not** copy the host App assets. For a complete App:

```bash
node scripts/fetch-native-deps.js   # sherpa-onnx + onnxruntime, ~330 MB, gitignored
node build.js
npm run app:sync                    # copies dist-app/ and patches the Xcode project
```

Then open `safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj`,
set your Team on both targets, and Run. On a device, enable the extension under
**Settings → Safari → Extensions** and allow access to all websites.

A command-line compile check (no signing) is:

```bash
env -u MARKETING_VERSION xcodebuild \
  -project "safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj" \
  -scheme "BelliedMonkey Translator (iOS)" -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

`fetch-native-deps.js` is optional for the browser extension and required for the App's
on-device speech/LID features. Without it, `app:sync` refuses to claim a complete App
instead of silently shipping a stubbed one.

## 5 · Configure your own key (BYOK)

The detailed provider-neutral guide is [`docs/byok.md`](byok.md). The short version:

1. Open the extension's **Settings**.
2. In **Quick setup** (or the **Engine** section), pick a provider that takes a key — for
   example OpenAI or DeepSeek — or **Custom** for any OpenAI-/Anthropic-compatible
   endpoint.
3. Paste the key you obtained from that provider. The key is stored in
   `chrome.storage.local` on this machine.
4. Press **Test connection**. A 2xx answer means the request reached the provider
   directly with your key.
5. Save, then translate a page.

What to verify (the point of ACCEPT-P1-2):

- The request goes to the provider's host, **not** to a `HOSTED_*` / relay host.
- There is **no** `Authorization: Bearer bmg_...` token on a BYOK request. `bmg_` is the
  free-credit token; it only appears after you explicitly claim credit and choose it.
- The default path never requires an account or a subscription.
- If the provider rejects the key (401/403), the UI tells you to fix the key. It does not
  tell you to subscribe.

## 6 · A local model (no key, stays on your machine)

See [`docs/local-model.md`](local-model.md) for Ollama and LM Studio. The short version:

```bash
ollama serve                 # CORS: OLLAMA_ORIGINS=* ollama serve
ollama pull qwen2.5:7b
```

Then in Settings choose **Custom** (OpenAI-compatible), enter the complete endpoint
`http://localhost:11434/v1/chat/completions`, the model name you pulled, and any
non-empty placeholder key if the field requires one. The request stays on your machine.

## 7 · Hosted path (optional, and not this repo's backend)

The own-key path is the default and is fully capable. The optional **free credit** and any
future **subscription quota** are the only paths that use the hosted gateway, and both
require an explicit opt-in (sign in / claim / subscribe). In this public tree:

- the client call points and the contract live in `contracts/` and `src/shared/`;
- the runnable stand-in is `mocks/hosted-gateway/` (`npm run mock:hosted-gateway`);
- the real gateway, ledger and upstream provider keys live in the private `*-hosted`
  repository — they are not in this tree and are not needed for the path above.

When quota is exhausted, the client falls back to your own key. The server never
redirects a request that declared BYOK.

## 8 · Troubleshooting

| Symptom | Likely cause | Next step |
|---|---|---|
| `esbuild 不在 node_modules` | `npm ci` was skipped | run `npm ci`, then rebuild |
| Build exits on a gate | a generated file or disclosure drifted | read the gate line; do not bypass it |
| 401 / 403 from the provider | key wrong, expired, or lacks the model | paste a valid key; check the provider's model access |
| 404 | endpoint URL or model name wrong | use the complete endpoint; check the model id |
| 429 | provider rate limit | wait, or pick another engine |
| `Load failed` in Safari | CORS / endpoint unreachable | check the endpoint and its CORS policy |
| App compile: `cannot find MTDeviceLid` | native deps not fetched | `node scripts/fetch-native-deps.js`, `node build.js`, `npm run app:sync` |
| `app:sync` says `dist-app/` is older | build ran before a source change | `node build.js`, then `npm run app:sync` |

## 9 · What not to do

- Do not open a PR that merges this MIT tree into `main`; that is the half-wash path and
  is rejected. See [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- Do not commit keys, `.local/backend.env`, or real backend hosts.
- Do not push a tag from `main` for an OSS release; tags come from the orphan root.
- Do not treat a successful local build as a store release. Store submission is a
  separate lane with its own gates.

## 10 · Where the rules live

- [`BOUNDARY.md`](../BOUNDARY.md) — what may be public, and what must stay in the private
  hosted/compliance repositories.
- [`docs/oss-release.md`](oss-release.md) — how an OSS tag is cut.
- [`docs/byok.md`](byok.md) — the own-key guide.
- [`docs/local-model.md`](local-model.md) — local models.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — PR lane and gates.
- [`AGENTS.md`](../AGENTS.md) — project rules (read this before changing code).
