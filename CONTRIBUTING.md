# Contributing

Thanks for looking. Two kinds of contribution are the most useful, and both start with a form:

- **A site that renders badly** → [open a site request](https://github.com/belliedmonkey/belliedmonkey-translator/issues/new?template=site_adaptation.yml).
  The fields on it are exactly what decides whether the page can be reproduced. Site requests
  are how the roadmap gets decided.
- **A bug** → [bug report](https://github.com/belliedmonkey/belliedmonkey-translator/issues/new?template=bug_report.yml).
  Say which surface (Safari iOS / Safari macOS / Chrome / Firefox / the app) and which engine.

Questions, ideas, "what do you use it for" — [Discussions](https://github.com/belliedmonkey/belliedmonkey-translator/discussions), any language.

## Good first issues

Looking for a first PR? Start from issues labeled
[`good first issue`](https://github.com/belliedmonkey/belliedmonkey-translator/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22)
— for example [#83](https://github.com/belliedmonkey/belliedmonkey-translator/issues/83)
(keep the pending sync code-entry state when settings close) or
[#385](https://github.com/belliedmonkey/belliedmonkey-translator/issues/385)
(validate engine endpoint shape on blur / every test entry).
Read `AGENTS.md` before coding. Open a PR against **`oss/mit-orphan`** — this is the MIT
OSS lane. **Never** open a PR that merges this tree into `main`: `main` is the
GPL-3.0-or-later store lane, and mixing the two is the half-wash path this repository
rejects. If you want to work on the store lane, start from `main` in its own worktree.

## First build

The five-minute path is [`docs/oss-quickstart.md`](docs/oss-quickstart.md). For the
own-key path see [`docs/byok.md`](docs/byok.md); for a local model see
[`docs/local-model.md`](docs/local-model.md). The clone URL there is the orphan branch or
the `oss-v0.1.0-bel172-p0` tag, never `main`.

## Pull requests

- Read [`AGENTS.md`](AGENTS.md) first. It is short on ceremony and long on the rules that are
  load-bearing: the provider registry is the only place a model name lives, the palette
  registry is the only place a brand colour lives, the telemetry whitelist is the only place an
  event lives. A PR that restates one of those elsewhere will be asked to move it.
- Anything that touches the domain design (the extractor/engine/renderer boundary, the
  segmenter rules, the learning layer's Collector boundary) updates
  [`docs/domain-design.md`](docs/domain-design.md) **first** and gets a human design review
  before code.
- `npm test` must be green (Node ≥ 20). Changes under `extension/content/**` or `styles/**`
  also run `npm run test:layout` (real Chrome, Node ≥ 22). A new site fix comes with a new
  fixture that is red before the fix and green after; old fixtures stay green.
- Every change is recorded in an issue capturing the problem, the fix, **and the reasoning**,
  so the thinking survives, not just the diff.

## Building

```bash
npm ci               # build-time devDependencies only (esbuild/react — domain-design §10); runtime stays zero-dep
node build.js        # extension/ → dist/ and the Chrome ZIP
npm test             # pure-logic suite
```

See the [For developers](README.md#for-developers) section of the README for the rest.

## License

By contributing you agree your contribution is licensed under [MIT](LICENSE), the same
as this branch. The store lane (`main`) remains GPL-3.0-or-later and is not merged with
this tree; a contribution to that lane is governed by that lane's license.
