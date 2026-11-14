# SenseVoice f6ec838b single 36-clip component smoke

Asia/Shanghai (UTC+8). Exploratory single run; not a performance ranking; not a completed SA/SV blind comparison. No product/default/merge changes. SA aef9aa8f v1 artifacts were not overwritten. LLM review was not invoked. Diagnostic normalizer variants were not used as official scores.

## Hardware and run config

- Machine: belliedmonkeydeMacBook-Pro-491.local, macOS 27.0, Apple M2 Pro, 12 cores, 16 GB, darwin arm64
- Node: /opt/homebrew/bin/node v26.10.0
- Runner: /Users/belliedmonkey/qa/baseline-sa-sv-36-20261113/reviewed-36-runner-f6ec838b (new dir; aef9aa8f/6d25fa8d untouched)
- Bundle: 01M7A23XQJ3153DSC5ER92SZF3.gz, 59555 bytes, sha256 c20e1216bad1edd0a6da2f7c057dea14e7e562bb9894f131f849fa0289dff345, head f6ec838bcb7841ff0a12ff394b93ac5e941592b0
- Backend binary: sherpa-onnx-offline v2.0.1 osx-arm64-static-no-tts, Mach-O arm64, 29996336 bytes, sha256 5a2d733a900cd6956a04432026fbf625e5912e694a8c8698fa69929659e0cf66
- Model: cpu, 2 threads, language zh, ITN true (confirmed in sensevoice-inspect.json and probe OfflineSenseVoiceModelConfig: language="zh", use_itn=True, num_threads=2, provider="cpu")
- Caches reused: fleurs and ascend original trees plus existing hardlink aliases; originals not rewritten (00004.wav remained b1d784c7c355c79febc73733f61a9faa2564c9f07cdf12caa3dd470f381c0149)
- CLI: node run-reviewed-36.js --run --backend sensevoice --out sv-smoke-f6ec838b-r1 --sensevoice-dir <verified model> --sensevoice-bin <verified bin> --fleurs-cache <real> --ascend-cache <real> --process-cap-ms 1620000
- env caps: itemCount 36, itemCapMs 45000, processCapMs 1620000, audioSeconds 371.07, approvedPlannedSetCount 0
- backend-pin obtained=false, relayInvoked=false

## Resource acquisition

Pack and PR 663 body had no cursor.com-hosted resource URL. The GitHub asr-models zip was not retried (prior 404s). The product relay api.belliedmonkey.com was not called.

Model zip URL actually used (public ModelScope resolve documented in /workspace/qa/e1/evidence/e1-bc-modelscope-ensureready-20261025/RESULT.md, previously SHA-verified to the same pin):
https://www.modelscope.cn/models/belliedmonkey/belliedmonkey-device-models/resolve/master/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.zip

Official backend URL actually returned by GET https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/v2.0.1 (asset size 236481414):
https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/sherpa-onnx-v2.0.1-osx-arm64-static-no-tts.tar.bz2

Box ordinary curl (no credentials/cookie jar/private API) pin-matched both archives. CopyFromBox of 90 MiB chunks failed with "temporarily unreachable" (tool also caps at 100 MiB). The Mac then curled the same public URLs into a new independent directory and pin-matched again. Safe extract rejected absolute paths and symlinks.

Pinned hashes (all matched on box and Mac):

- zip 160304482 sha256 286a4b89c62be15c78f195b908bf746c80a655f07588346ee0383a8f20f21e04
- model.int8.onnx 239233841 sha256 c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51
- tokens.txt 315894 sha256 f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc
- backend tar 236481414 sha256 e2496931fd955ab449c2df1a6839e4c17cedf451e018cc3efd1a77180980c49b

## Diagnostic one-clip schema probe (not in official denominator)

- Clip: existing ASCEND 00004.wav, pcm_s16le 16 kHz mono (not a listen-PCM16 stand-in)
- Time: 2026-11-13 17:11:11–17:11:13 Asia/Shanghai, /usr/bin/time real 1.50s, bin_exit=0
- Stdout: one JSON object with nonempty string text "我死的。"
- Official parser parseSenseVoiceStdout: {ok:true, code:"ok", hypotheses:["我死的。"]}
- stderr: recognizer created in 0.611 s; RTF 0.136/1.360=0.100
- This probe is not mixed into the official 36 rates

## Official 36 single run

- Start 2026-11-13 17:11:51 Asia/Shanghai, end 17:13:11 Asia/Shanghai, official_exit=0, processExit=0, ok=true, senseVoiceResult=true, appleResult=false, exploratory=true, ranking=false, endToEnd=false
- Wall ( /usr/bin/time -p ): real 80.57s, user 155.45s, sys 2.11s
- Phases ms: preflight 29.868, stage 55.515, compile null, assetInstall null, modelLoad 674, recognize 80146.724, score 7.579, pack 17.362
- Load: before 4.78 / 4.11 / 3.36; after and env.json 5.34 / 4.55 / 3.60
- 36 nonempty hypotheses, 36 child-stdout JSON lines, recognition failures 0
- FLEURS originals are pcm_f32le; v2.0.1 accepted them. No conversion was performed or needed. Original bytes were not altered.

Official and independent v1 rescore (score.js 7f94ff10… / codeswitch-score.js df82e421…, same rules as SA v1) match:

- en15 WER 29/363 = 0.07988980716253444
- zh15 CER 57/624 = 0.09134615384615384
- ASCEND6 MER 17/42 = 0.40476190476190477 (ranking false)

ASCEND item errors (v1 MER, not a new score): 00004 4/5, 00009 6/13, 00028 3/3, 00055 1/14, 00066 1/4, 00068 2/3.

Same-rule SA aef9aa8f v1 official rates remain 36/363, 57/624, 24/42. The zh numerators being equal is a coincidence of totals, not a claim that item errors are identical, and this is not a rankable comparison or a completed dual-model blind.

## Pack and archive

First-run evidence.tar.gz was frozen before pack-existing: sha256 bbc4a0cae169d5e66557fc4cd73cca05055c4ec8928119ea6778ff4faacdaa0c. pack-existing wrote a new directory only; first hashes were unchanged after pack. Pack evidence sha256 8a57cea938cce2dd05cc9afc845e84a2db5a110f7dd2642163d6331705596076.

Mac paths (new, independent):

- runner: /Users/belliedmonkey/qa/baseline-sa-sv-36-20261113/reviewed-36-runner-f6ec838b
- resources: /Users/belliedmonkey/qa/baseline-sa-sv-36-20261113/sv-resources-f6ec838b/
- probe: /Users/belliedmonkey/qa/baseline-sa-sv-36-20261113/sv-schema-probe-f6ec838b/
- run: /Users/belliedmonkey/qa/baseline-sa-sv-36-20261113/sv-smoke-f6ec838b-r1/
- pack: /Users/belliedmonkey/qa/baseline-sa-sv-36-20261113/sv-smoke-f6ec838b-r1-pack/

Box archive: /workspace/baseline-sa-sv-36-20261113/results/f6ec838b-sv/ (SA results/aef9aa8f and analysis-aef9aa8f were not written).
