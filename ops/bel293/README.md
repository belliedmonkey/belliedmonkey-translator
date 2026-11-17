# BEL-293 只读查询

DDL 的唯一源是 `supabase/schema.sql`（hosted 同步 `schema/schema.sql`）。
本目录只放只读查询；不要再放建表/建视图 SQL，避免两个源先后执行产生形状冲突。

> 任何 BEL-293 DDL 之后必须执行 `notify pgrst, 'reload schema';`，再做 RPC 冒烟；否则新函数会 404 PGRST202，写入被 catch 吞掉，表现为表一直空。
