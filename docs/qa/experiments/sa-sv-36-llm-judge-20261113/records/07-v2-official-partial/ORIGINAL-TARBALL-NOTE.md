# 官方 v2 证据包原件（本包未内嵌完整 tar）

- 盒路径：`/workspace/baseline-sa-sv-36-20261113/judge-prep/v2-real-run-20261114-0015/llm-judge-v2-real-20261114-0015-evidence.tar.gz`
- sha256：`e9e088f1c479f24e69eaf017591638c6f0d121974c077b257874dae001a3f002`（约 2.32MB）
- Mac QA（未覆盖 v1）：`/Users/belliedmonkey/qa/llm-judge-v2-real-20261114-0015`
- 原 tar 未压缩约 12.5MB，其中 Qwen `tokenizer.json` 约 11.43MB，并含 `input/arm-mapping.json`。本包摘录 judge-run / ledger / config / input（无 mapping）/ scripts / provenance / probe / 报告，不附 tokenizer 与 mapping。
- tokenizer 仍可在原盒/Mac 原 tar 中按官方 EXPECTED-SHA256 核对。本步不重跑计数器。
- 官方状态保持 partial，归档不得改成 complete。
