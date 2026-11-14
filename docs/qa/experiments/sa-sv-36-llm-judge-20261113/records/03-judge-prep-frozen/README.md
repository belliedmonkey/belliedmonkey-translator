# Judge-prep for the SA/SV 36 independent contrast

Timezone: Asia/Shanghai (UTC+8).

This directory is independent verification output. Original SA, SV, and pack evidence under `results/` and `PACK-MANIFEST.json` was read only and not modified. The judge package archive was not modified. No `--run`, no real LLM call, no credential or environment-secret read, no network.

## Status

- Two-arm anonymous ASR input is ready: `input-asr-36.json` (36 items, 15 English / 15 Chinese / 6 ASCEND).
- Identity of the arms is only in `arm-mapping.json` (`hx9q2w` = SA aef9aa8f, `jt4m8c` = SenseVoice f6ec838b). Do not copy that file into a judge request.
- `blockedOnSecondArm` is false. SenseVoice official 36 arrived with `processExit=0` and 36 nonempty hypotheses; empty strings and SA copies were not used as a second candidate.
- Official v1 edit rates are not in the judge input and were not recomputed. They remain in the original score files (`editRates` in dry-run output is null).
- Judge provider is not selected. `config.placeholders.json` is not an official run config. See `formal-run-config-requirements.json`.
- Real LLM has not been called. CLI dry-run of the real 36 is `code=dry-run`, `called=false`, `results=null`.

## Evidence to cite

See `SHA256SUMS` in this directory. The pair ledger is `pair-manifest.json`. Dry-run evidence is `dryrun-real36/` and `dryrun-synthetic/`. Audit findings and minimal fixtures are `audit/`.

The reviewed package copy is `pkg-unpacked/` (inner SHA256SUMS verified). The original archive remains:

`/cursor/stores/user/grok-bot/agents/e8195c0f-e3a2-46a7-bda6-acf61585317c/assets/01M7A2YMDT938TGQV83BY7T8KT.gz`
(12101 bytes, sha256 `f4a58b85f79c7e8da13d2049f987802bcd0fbebbdb70320c85b0aaf422302d55`).
