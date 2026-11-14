# 入库时拿掉了什么（2026-11-14）

交接包解包后是 1269 个文件、5010940 字节。入库是 1268 个文件。

拿掉的只有一份自动生成的字节码缓存：

- `records/06-v2-pack-verify-e998c2c0/scripts/__pycache__/count-tokens.cpython-313.pyc`
- sha256 `f70386a529057f543cf56195121676e04557066956fac516b14dc4a5693415a3`（仍留在本目录 `SHA256SUMS` 的对应行，文件本身不入库）

同目录的 `count-tokens.py` 源文件保留。根目录 `SHA256SUMS` 不改写；核对时跳过这一行。

gitleaks 的 `generic-api-key` 会把字段名里的 `Token` 配上旁边的 sha256 看成密钥。命中的三处都是摘要，不是凭证：`tokensSha256` = `f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc`（`tokens.txt`），`countTokensPy` = `8be0c606efcbfc9c36998f186600db6119a8b56648f4e75e8999a8c7c23d5af1`。`.gitleaks.toml` 只把这三个证据文件加进路径允许列表，不放行整个实验目录。授权字段仍是 `redacted`。

没有改 request、response、parsed、usage、reports、fixtures、replay、selection、provenance，也没有改官方分数或 RESULT 的 `partial`。封袋时已有的文件字节未改，包括 `README.md` 与 `records/15-plans-unrun/BEL-258-DeepSeek.md`。

`SHA256SUMS` 是封袋清单，不收录它自己。它也不含封袋之后新增的这些文件：

- `INDEX.md`
- `CURATION.md`
- `SCRIPTS-AND-PATHS.md`
- `OPENBOT-HANDOFF.zh.md`
- `records/15-plans-unrun/BEL-258-URLS.md`

包内已声明剔除、本步再次确认不在树里的：`arm-mapping.json` 正文、`tokenizer.json`、wav、`.env`、`.local`。见 `EXCLUSIONS-AND-BOUNDARIES.md`。
