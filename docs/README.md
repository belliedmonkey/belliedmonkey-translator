# Documentation index

Start here if you are new to the public tree.

## First five minutes

1. [`docs/oss-quickstart.md`](oss-quickstart.md) — clone the **MIT orphan** root, build
   the extension, load it, add your own key, translate a page. This is the single entry
   page for ACCEPT-P1-1…P1-6.
2. [`docs/byok.md`](byok.md) — bring your own key: one direct provider path, where the
   key lives, what the failure messages mean, and how to verify no hosted hop.
3. [`docs/local-model.md`](local-model.md) — Ollama, LM Studio, or a self-hosted gateway.
4. [`CONTRIBUTING.md`](../CONTRIBUTING.md) — PR lane, gates, and the rule against
   merging this MIT tree into `main`.

## The two lanes

| Lane | Branch / tag | License | Use |
|---|---|---|---|
| OSS release | `oss/mit-orphan`, `oss-v*` tags | **MIT** | public source, contracts, mocks, docs |
| Store tip | `main`, `release/**` | **GPL-3.0-or-later** | App Store / Chrome / Firefox submissions |

Never merge one into the other. See [`docs/oss-release.md`](oss-release.md) and
[`BOUNDARY.md`](../BOUNDARY.md).

## Build, test, release

- [`docs/oss-release.md`](oss-release.md) — how an OSS tag is cut (checks, commands,
  read-back criteria).
- [`docs/release-checklist.md`](release-checklist.md) — store-release gates (separate
  from the OSS lane).
- [`docs/verification-spec.md`](verification-spec.md) — the verification matrix and the
  honesty rules.
- [`docs/conventions-digest.md`](conventions-digest.md) — conventions before changing
  code.

## Architecture and product

- [`docs/domain-design.md`](domain-design.md) — translation domain model, provider
  registry, device principle.
- [`docs/learning-design.md`](learning-design.md) — the learning/memory layer and the
  free-credit design.
- [`docs/interaction-spec.md`](interaction-spec.md) — user-visible interaction rules.
- [`docs/telemetry-design.md`](telemetry-design.md) — the anonymous event whitelist.
- [`docs/troubleshooting.md`](troubleshooting.md) — runtime troubleshooting.
- [`docs/p2-client.md`](p2-client.md) — client route selection, hosted contract v0.1 call
  points, and the dependency on the growth lane.

## P0/P1 background

- [`docs/architecture-p0/P0-SPLIT-opencode-b-prime-2026-11-01.md`](architecture-p0/P0-SPLIT-opencode-b-prime-2026-11-01.md)
- [`docs/architecture-p0/CONTRACT-v0-hosted-gateway-2026-11-01.md`](architecture-p0/CONTRACT-v0-hosted-gateway-2026-11-01.md)
- [`docs/relicensing/O1-A-CONSENT.md`](relicensing/O1-A-CONSENT.md)
