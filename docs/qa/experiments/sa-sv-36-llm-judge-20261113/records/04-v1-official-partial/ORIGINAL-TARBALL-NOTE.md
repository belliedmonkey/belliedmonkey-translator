# 官方 v1 证据包原件（本包未内嵌）

- 盒路径：`/workspace/baseline-sa-sv-36-20261113/judge-prep/real-run-20261113-2253/llm-judge-real-run-20261113-2253-evidence.tar.gz`
- sha256：`dfc9e572939f8064b14e628076ff627fbd9f6bf8b2347390caff18cfed8221e4`
- Mac QA：`/Users/belliedmonkey/qa/llm-judge-real-20261113-2253`
- 原 tar 含 `input/arm-mapping.json` 与 AppleDouble `._*`，本包改为摘录关键 JSON/报告，并剔除 mapping 与 tokenizer。
- 另有较大的准备包 `/workspace/baseline-sa-sv-36-20261113/judge-prep/llm-judge-real-20261113-2253.tar.gz`（sha256 `36143f842d199d54d8035db2c1afc5118c1c823d5edd962a3b83e34138c0827b`，约 3.9MB），内含 Qwen tokenizer 与完整 OpenRouter models catalog，本包不收录。
- 官方状态保持 `ok=false` / `code=partial`，归档不得改成 complete。
