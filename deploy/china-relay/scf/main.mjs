// 入口：先装垫片，再加载中继。ESM 的静态 import 按书写顺序求值，所以 relay.mjs 顶层
// 读 Deno.env 时垫片已经在了。
import './deno-shim.mjs';
import './relay.mjs';
