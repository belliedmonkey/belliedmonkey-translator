# BEL-293 P0 草稿（不执行）

架构形检通过、拿到 GO 之前，**这里的 DDL 一条都不执行**。本目录只提交草稿：

- `bt_events_pack_fail_dedup.sql` — `pack_download_fail` 按 `(install_id, name, download_id)`
  去重的视图；`download_id IS NULL` 的 1.23.3 老行原样透传并标 `dedupe='legacy'`，
  老行缺 `detail` 就是 NULL，不回填成 `other`。非 NULL 才 `row_number()=1`
  （按 `received_at desc`）。
- `bt_events_rejected.sql` — ingest 拒收聚合表：只记 `hour` / `name` /
  非法键名集合 `keys`（排序去重、最多 8 个）/ 计数 `n`，唯一键
  `(hour, name, keys)`；`bt_event_rejected_bump()` 是唯一写入口，upsert 累加。
  **不记任何值 / install_id / 原始 body。**

`supabase/schema.sql` 与 hosted 仓 `schema/schema.sql` 的这两段是同一条 SQL；
`bt_rollup_day` 也从去重视图读，否则 `bt_daily` 仍会把同一次下载尝试算两次。

执行顺序（GO 之后）：先 `bt_events_rejected` 建表，再建去重视图，最后换
`bt_rollup_day`；全部只读回之后才接 ingest 写入。部署与 DDL 都不在本拍范围内。
