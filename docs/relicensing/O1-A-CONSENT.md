# O1-A · Relicensing record — GPL-3.0-or-later → MIT

- **ID:** `O1-A-CONSENT` (BEL-172, parent BEL-171, tracker BEL-175)
- **Date:** 2026-11-01 (Asia/Shanghai)
- **Status:** written relicensing instrument + authorship proof for the **orphan MIT root**.
  **Not** a public announcement of MIT. This file lives on the orphan root
  (`oss/mit-orphan`), whose `LICENSE` is MIT; `main` / `release/**` keep GPL-3.0-or-later
  until they are moved onto an orphan root by a separate product decision.

## 1. Consenting party

| 项 | 值 |
|---|---|
| Copyright holder | **Zhang Zhao** (GitHub `belliedmonkey`) `<belliedmonkey@gmail.com>` |
| Capacity | sole human author and copyright holder of the code in `belliedmonkey/belliedmonkey-translator` |
| Authorization instrument | user order `order-rd-bel172-p0-scrub-relicense`, 2026-11-01 — SHA-256 `5a62d18bed08ca0d3101ff5d7d08d9261714e8cdb79a50d7685820599a12683a` |
| Architecture steer | `STEER-FROM-ARCH.md` + `P0-SPLIT-opencode-b-prime-2026-11-01.md` §0 ("O1=A · MIT orphan · 禁半洗 GPL history 改牌"), SHA-256 `4465373f112563e7f9cf9d0613c2f9abaa3529c973d67d526ad7d340cbb9baff` |
| Product sign-off | ARCH-SHORT OpenCode B′ = **PASS-WITH-ACCEPT**; **O1 = path A** (2026-11-01 user card) |

The user card is the written direction. This file transcribes it into the repository so the
relicensing is a durable, path-level record rather than a verbal change of the badge. A
countersigned copy may be attached before publication; no wet signature is fabricated here.

## 2. Scope of the grant

All original code and documentation authored in the repository
`https://github.com/belliedmonkey/belliedmonkey-translator` at tip
`04b3cde6c6a3dab4bfc619aa005db36312e409ac` (origin/main as examined) **and all earlier
commits reachable from it**, across every path in the tree — **except** the third-party
components listed in §4 — is relicensed from **GPL-3.0-or-later** to the **MIT License**
(SPDX: `MIT`), effective at the orphan root commit on branch `oss/mit-orphan`.

- The relicensing does **not** rewrite, squash, or "half-wash" the GPL history. The old
  history stays as it is; the OSS release starts from a **new orphan root** with a fresh
  `LICENSE` (MIT) and `NOTICE`.
- The GPL-licensed public history remains available under GPL-3.0-or-later for anyone who
  received it. MIT is granted **in addition** for the orphan tree; it does not revoke
  anyone's existing GPL rights.
- Store-tip / release branches keep their own license state until they are moved onto the
  orphan root. This拍 does not change `main`'s LICENSE.

## 3. Authorship proof (path-level)

Full evidence: `evidence/authors.txt` (OUT) — every path in the tip tree mapped to the
identities that touched it, plus the raw author/committer tables.

Summary (165 commits, 1327 paths at the tip):

| Raw identity | Commits | Role |
|---|---:|---|
| `Zhang Zhao <belliedmonkey@gmail.com>` | 74 | owner (GitHub squash-merge author identity) |
| `belliedmonkey <belliedmonkey@gmail.com>` | 72 | owner (local commits) |
| `Cursor Agent <cursoragent@cursor.com>` | 19 | AI agent committing under the owner's direction |
| `GitHub <noreply@github.com>` | 74 (committer only) | GitHub merge machinery, not an author |

- **External human authors: none.** No identity outside the owner / his agents appears as
  `%an`, `%ae`, `%cn`, or `%ce`.
- `Co-Authored-By` trailers name AI coding agents (`opencode`, `DeepSeek V4.1 Flash`,
  `GLM 5.3`, `Claude *`, `Cursor Agent`) and the owner himself. Those are attribution
  conventions adopted by the project (AGENTS.md, 2026-09-30), not independent copyright
  holders. Bot commits are made on the owner's behalf and vest in the owner.
- `.mailmap` is absent; no display-name collapsing was applied. The raw identities above
  are authoritative.

## 4. Third-party components (NOT relicensed)

| Component | License | Location / delivery | Compatible with MIT distribution? |
|---|---|---|---|
| PDF.js | Apache-2.0 | `extension/vendor/pdfjs/` (LICENSE retained) | yes, with NOTICE + license retained |
| Figtree (variable) | SIL OFL 1.1 | `extension/fonts/figtree-latin-var.woff2` + `OFL-Figtree.txt` | yes, font kept under OFL |
| Caprasimo | SIL OFL 1.1 | `extension/fonts/caprasimo-latin.woff2` + `OFL-Caprasimo.txt` | yes, font kept under OFL |
| SpeechBrain ECAPA VoxLingua107 | Apache-2.0 (model), CC-BY-4.0 (training set, not redistributed) | downloaded at runtime, not bundled | yes |
| OpenAI Whisper tiny | MIT | downloaded at runtime | yes |
| Silero VAD | MIT | downloaded at runtime | yes |
| Kokoro-82M | Apache-2.0 | downloaded at runtime | yes |
| sherpa-onnx / ONNX Runtime | Apache-2.0 / MIT | fetched native deps, not vendored in this tree | yes |

**No third-party GPL-only source was found in the tree.** A scan for GPL license text
outside the project's own `LICENSE` found only the project's own README references; the
vendored trees carry Apache-2.0 / OFL licenses. Therefore O1-A is **not blocked** on a
non-relicensable third-party source.

## 5. What this record does *not* authorize

- It does **not** change the license of the current `main` / store tip.
- It does **not** authorize a public MIT announcement (README badge, marketing copy, store
  copy) before product sign-off.
- It does **not** relicense the hosted gateway / ledger / compliance implementations — those
  move to private side repositories (see `BOUNDARY.md`).

## 6. Effective artifact

| 项 | 值 |
|---|---|
| Branch | `oss/mit-orphan` (local orphan root) |
| Commit | recorded in `evidence/orphan-root.txt` (OUT) and `tip/orphan.txt` |
| LICENSE at root | MIT, `Copyright (c) 2026 Zhang Zhao (belliedmonkey)` |
| NOTICE | root `NOTICE` (third-party licenses retained) |
| Verification | `git log --max-parents=0 oss/mit-orphan` has exactly one root; no GPL-licensed ancestor |

## 7. Attestation

```
Relicensed by:  Zhang Zhao <belliedmonkey@gmail.com>  (copyright holder)
Direction:      order-rd-bel172-p0-scrub-relicense, 2026-11-01, O1 = A
Recorded by:    BEL-172 executing agent (dsh headless), 2026-11-01
Scope:          GPL-3.0-or-later -> MIT at orphan root; third-party licenses retained
```
