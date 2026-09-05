// build/telemetry.config.js — 匿名用量事件的**唯一**登记处（docs/telemetry-design.md §3）。
//
// 客户端 (learn/telemetry.js) 与服务端 (supabase/functions/bt-ingest) 都从这里取白名单：
// 服务端读的是 `node scripts/gen-telemetry.js` 生成的 events.gen.json（Deno 不能 require）。
// test/telemetry-registry.test.js 钉住两边一致，且钉住这张表**永远不含**内容/身份类字段。
//
// 加一个事件或一个属性 = 改 docs/telemetry-design.md 过评审 → 改这里 → 重新生成。
// 不是「顺手在 track() 调用处多传一个字段」—— 服务端会把它整条拒掉。
//
// 值类型（服务端逐条校验，客户端 track() 同样校验后才入队）：
//   'int'    非负整数，≤ 10 位
//   'id'     /^[a-z0-9_-]{1,32}$/   —— 引擎 id 这种
//   [...]    枚举，只允许列出的值
'use strict';

const COMMON = {
  install_id: 'uuid',      // 本机随机生成，与账号无关；关掉开关即删
  ts: 'iso',               // 客户端时间，取整到分钟；服务端只接受 ±7 天内
  v: 'semver',             // 扩展版本
  flavor: ['global'],      // 中国版永远不发（AGENTS.md 规则 4）—— 'china' 直接拒
  host: ['safari', 'chrome', 'firefox', 'app'],
  device: ['iPhone', 'iPad', 'Mac', 'Windows', 'Android', 'Linux', ''],
  ui: 'lang',              // 界面语言，粗到 zh / en 这一级；/^[a-z]{2,3}$/
};

const EVENTS = {
  installed: {},
  heartbeat: {},
  onboarding_done: { surface: ['ext', 'app'] },
  engine_set: { provider: 'id' },
  translate_ok: { provider: 'id', kind: ['page', 'subtitle'], ms: 'int' },
  translate_fail: {
    provider: 'id',
    code: ['timeout', 'network', 'http', 'reasoning_starved', 'no_base', 'unknown_provider'],
    status: 'int',
    route: ['direct', 'proxy', ''],
    ms: 'int',
  },
  subtitle_on: { site: ['youtube', 'substack', 'podcast', 'other'] },
  capture_first: {},
  review_session: { graded: 'int' },
  sync_on: {},
  telemetry_off: {},       // 服务端收到即删该 install_id 的全部行，不落这一条
};

// 这些词出现在任何键名里都说明有人在往遥测里塞内容或身份 —— 测试会红。
const FORBIDDEN_KEY_WORDS = ['url', 'href', 'text', 'title', 'email', 'user', 'uid', 'key',
  'token', 'name', 'hostname', 'domain', 'message', 'body', 'ip'];

const LIMITS = { batch: 50, eventBytes: 1024, bodyBytes: 64 * 1024, perMinute: 60, strMax: 64 };

module.exports = { COMMON, EVENTS, FORBIDDEN_KEY_WORDS, LIMITS };
