# ASR stage: how these hypotheses were produced

Run: 2026-11-18 10:34 CST, on the Mac that holds the QA audio caches.

| | |
|---|---|
| backend | `sa` (Apple SpeechAnalyzer, on-device) |
| runner | `/Users/belliedmonkey/qa/baseline-sa-sv-36-20261113/reviewed-36-runner-aef9aa8f/run-reviewed-36.js` |
| command | `node run-reviewed-36.js --run --backend sa --out /tmp/e2e-sa-20261118/run --fleurs-cache …/audio/fleurs --ascend-cache …/audio/ascend` |
| set | reviewed-36: FLEURS `en_us` 15 + `cmn_hans_cn` 15 + ASCEND 6 |
| macOS | 27.0 (build 26A428), Swift 6.4 |
| hypotheses | `hypotheses.json` (36 rows, copied verbatim) |

## Result

| stage | value |
|---|---|
| preflight | 19 ms |
| stage (hash check + copy) | 63 ms |
| swiftc compile | 2478 ms |
| asset install | 504 ms |
| **recognize (36 files)** | **10 256 ms** (≈285 ms/utterance) |
| score | 7 ms |

| subset | metric | errors / length | rate |
|---|---|---|---|
| `en_us` (15) | WER | 36 / 363 | 9.92% |
| `cmn_hans_cn` (15) | CER | 57 / 624 | 9.13% |
| ASCEND (6) | MER | 24 / 42 | 57.1% |

These match the frozen `aef9aa8f` record exactly, and all 36 hypotheses are **byte-identical** to `records/01-sa-official-aef9aa8f/sa-smoke-aef9aa8f-r1/hypotheses.json`. The ASR stage is deterministic on this machine.

Not measured here: per-utterance first-result latency (the runner reports a batch phase only), and anything about the app UI.
