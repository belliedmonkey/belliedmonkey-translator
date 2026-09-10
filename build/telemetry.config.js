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
    // 免费额度那三个必须在枚举里（§8.10 / telemetry-design §3）：不在枚举里的 code
    // 会被客户端白名单**静默丢掉**，于是「有多少人把 0.2 美元用完了」这个数永远是 0
    // —— 而那正是判断这笔钱该不该继续花的唯一依据。
    code: ['timeout', 'network', 'http', 'reasoning_starved', 'no_base', 'unknown_provider',
      'credit_exhausted', 'grant_unavailable', 'model_not_allowed',
      // auth（2026-09-10，第八期）：401/403 且请求带了非空、非 bmg_ 额度令牌的 key ——
      // 「这把 key 被服务商拒绝」，引擎停机。5 天里 308 条 401 来自同一台机器逐段重试。
      'auth'],
    status: 'int',
    route: ['direct', 'proxy', ''],
    ms: 'int',
  },
  subtitle_on: { site: ['youtube', 'substack', 'podcast', 'other'] },
  capture_first: {},
  review_session: { graded: 'int' },
  // 免费额度（§8.10）。两个都**无属性** —— 需要的只是「多少人领了」与「多少人用完了」
  // 这两个计数。台账（谁花了多少）是账号级数据，与遥测**永不 join**（telemetry-design
  // 原则 7）：那张表在我们的库里，遥测只有匿名 install_id，两边没有可对上的列。
  grant_claimed: {},
  grant_exhausted: {},
  sync_on: {},
  // 第六问（telemetry-design §1，2026-09-10）：我们的提示被看见了吗、有人点吗。
  // 只有一个枚举属性，永不带页面、文案或输入。
  rate_prompt: { action: ['shown', 'tap', 'dismiss'] },   // 译文末尾的评分行
  ext_banner: { action: ['shown', 'setup', 'done'] },     // App 首页「扩展还没打开」横幅
  telemetry_off: {},       // 服务端收到即删该 install_id 的全部行，不落这一条
};

// 这些词出现在任何键名里都说明有人在往遥测里塞内容或身份 —— 测试会红。
const FORBIDDEN_KEY_WORDS = ['url', 'href', 'text', 'title', 'email', 'user', 'uid', 'key',
  'token', 'name', 'hostname', 'domain', 'message', 'body', 'ip'];

const LIMITS = { batch: 50, eventBytes: 1024, bodyBytes: 64 * 1024, perMinute: 60, strMax: 64 };

module.exports = { COMMON, EVENTS, FORBIDDEN_KEY_WORDS, LIMITS };
