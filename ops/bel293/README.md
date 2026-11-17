# BEL-293 P0 草稿（不执行）

架构形检通过、拿到 GO 之前，**这里的 DDL 一条都不执行**。本目录只提交草稿：

- `bt_events_pack_fail_dedup.sql` — `pack_download_fail` 按 `(install_id, download_id)`
  去重的视图；无 `download_id` 的老行逐行保留并标 `legacy=true`。
- `bt_events_rejected.sql` — ingest 拒收聚合表：只记 `name` + 非法键名集合 + 计数，
  **不记任何值 / install_id / 原始 body**。

执行顺序（GO 之后）：先 `bt_events_rejected` 建表，再建去重视图；两步都只读回之后
才接 ingest 写入。部署与 DDL 都不在本拍范围内。
