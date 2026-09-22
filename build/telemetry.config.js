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
  // 2026-09-22（§3.6 提案评审通过）：加 `result` 与 `step`，**不加事件**。
  //
  // 此前这条只有「完成」一个观测点，而且**跳过也发** —— 于是「走完」与「放弃」在表里
  // 长得一模一样（§3.4 那条教训的又一种形状：结果看得见，过程全黑）。
  //
  // `step` = 离开引导时停在哪一屏，**只在离开的那一刻记一条**，不是每屏一条 ——
  // 每屏一条回答不了 §1 的任何一问，只是噪声。取值与两个宿主的屏序数组**同源**
  // （`app/app.js` 的 OB 与 `extension/onboard/onboard.js` 的 OB），所以是并集；
  // 屏序改了这里要跟着改（加枚举值，门禁只认事件名，不会自己红）。
  onboarding_done: {
    // app_resume / shown / dismissed / expired（2026-09-22，§3.8，用户评审通过）：「继续设置」卡 ——
    // 出现（每次启动至多一条）· 点 ✕ · 第 4 次启动自动收起。点「继续」之后仍由 surface:'app' 那条回答。
    surface: ['ext', 'app', 'app_resume'],
    result: ['done', 'skipped', 'shown', 'dismissed', 'expired'],
    // 2026-09-22 屏序重排后：App 加了 firstuse；browser / read / capture 三屏已删，
    // 但**值留着** —— 线上历史行还在用它们，删掉会让回读旧数据时这些行被当成非法。
    step: ['welcome', 'ext', 'browser', 'read', 'signin', 'engine', 'capture', 'try', 'firstuse'],
  },
  engine_set: { provider: 'id' },
  // engine_test（2026-09-16，telemetry-design §3.3.1）：「填 key → 点测试 → 失败 → 放弃」
  // 这一整段此前零遥测，而 learn/engine-test.js 的四个调用方全在激活路径上（设置页、
  // 字段行、一键卡、**引导页**）。只记「哪一槽、成没成、哪一类错」。
  //
  // code 用**自己的**枚举，不复用 translate_fail 的。提案里写的是复用，落地时改了：
  // engine-test 抛的码有一半不在那张表里（no_key / bad_url / no_path / bad_output /
  // empty_audio…），而那几个恰恰是最有价值的——「没填 key 就点了测试」「地址写错了」。
  // 不在枚举里的 code 会被客户端白名单**静默丢掉**（同 credit_exhausted 那条教训），
  // 于是失败原因分布会是一片空白。`other` 兜住 reason() 的 default 分支（无 code 的错）。
  engine_test: {
    slot: ['chat', 'notes', 'tts', 'stt'],
    result: ['ok', 'fail'],
    code: ['no_key', 'no_base', 'no_path', 'bad_url', 'no_engine', 'unknown_provider',
      'network', 'timeout', 'http', 'bad_output', 'empty_output', 'empty_audio',
      'reasoning_starved', 'device_no_file', 'other'],
  },
  translate_ok: { provider: 'id', kind: ['page', 'subtitle', 'doc', 'quick'], ms: 'int' },   // doc：文档翻译（2026-09-11，learning-design §9.7）
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
  // 文档翻译（2026-09-11，learning-design §9.7）：一份文档打开一次。只有格式与页数 —— 不带文件名、字数、页文本。
  doc_open: { kind: ['pdf', 'docx', 'txt', 'image'], pages: 'int' },
  // result / left（2026-09-22，§3.7 A）：离开复习面也发；done 与 left 互斥、每轮一条。
  review_session: { graded: 'int', result: ['done', 'left'], left: 'int' },
  // 免费额度（§8.10）。两个都**无属性** —— 需要的只是「多少人领了」与「多少人用完了」
  // 这两个计数。台账（谁花了多少）是账号级数据，与遥测**永不 join**（telemetry-design
  // 原则 7）：那张表在我们的库里，遥测只有匿名 install_id，两边没有可对上的列。
  grant_claimed: {},
  grant_exhausted: {},
  sync_on: {},
  // 第六问（telemetry-design §1，2026-09-10）：我们的提示被看见了吗、有人点吗。
  // 只有一个枚举属性，永不带页面、文案或输入。
  rate_prompt: { action: ['shown', 'tap', 'dismiss'] },   // 译文末尾的评分行
  ext_banner: { action: ['shown', 'setup', 'done', 'check'] },     // App 首页「扩展还没打开」横幅；check = 「打开检测页」那一行（§3.7 B）
  // 扩展在自家域名上检测到自己（亮绿灯那一刻），每装机一次（§3.7 B）。
  setup_detected: {},
  // 第九期（2026-09-11，telemetry-design §3.2）：转写功能上线以来零遥测。两个枚举，不带 URL。
  // `app_home`（2026-09-16）= App 首页那两张模式卡。App 的听译/实时字幕**不经过**
  // asr-source.js，前三个值都是网页里的入口，一个都落不到它头上（telemetry-design §3.3）。
  // `popup_app_row` / `to_app`（2026-09-17）：实时档从扩展端下掉之后，弹窗里多了一条
  // **常驻**的「用 App 听设备的声音」，走不通的媒体也统一落到去 App 的出口。这两处点击
  // 需要自己的具名值 —— 第一版用 `no_media` 记它，那是拿「没找到媒体」冒充「用户选择
  // 去 App」，与 engine_set 那次语义漂移同型（§3.3.1）。
  //
  // `gesture_needed` **保留但不再产生**：Safari 页内手势那套机制随 Tier B 一起下掉了
  // （domain-design §2.4 第 3 条）。枚举留着是因为历史行还在表里，删掉会让旧数据读不回来。
  asr_entry: {
    surface: ['popup', 'notice', 'pill', 'app_home', 'popup_app_row'],
    result: ['started', 'no_media', 'no_engine', 'no_live', 'gesture_needed', 'to_app'],
  },
  telemetry_off: {},       // 服务端收到即删该 install_id 的全部行，不落这一条
};

// ── 发送点（docs/telemetry-design.md §3.4，2026-09-19）────────────────────────────
//
// **构建期元数据，不出这个文件**：不进 events.gen.json（服务端不需要知道谁在发），不进
// window.MT_TELEMETRY（客户端不需要）。它只有一个读者 —— test/telemetry-registry.test.js，
// 对着代码核每一项。
//
// 为什么要有它：白名单守得住「发了不该发的」，守不住「该发的没人发」。一个登记了却没接线的
// 事件，对所有测试与「一切正常」无法区分；到了线上，与「没人触发」同样是 0。这个洞发作过三次
// （§3.1 `<all_urls>` 漏统计、§3.3 App 侧核心事件全黑、§3.4 领取与听译），第三次离第二次
// 只隔三天 —— 第二次的教训写成了一句话，没写成门禁。
//
// 每个事件、每个宿主（ext = 扩展，app = 宿主 App）：
//   { host, file, match? }   file 里必须有 track/once('<事件>'…；带 match 的，那个字面量也必须在
//                            同一个文件里（区分同名事件的不同表面，如 kind: 'subtitle'）。
//                            host:'app' 而 file 在 extension/ 下 ⇒ 还要在 build/app-bundle.js 的
//                            MODULES 里：「同名模块进了包」与「接上了」是两件事，两件都核。
//   { host, none: '理由' }   这个宿主**有意**不发。不许留空 ——「不做」也要有机器可读的形状。
//                            可带 surface 标出是哪个表面（同一宿主另有发送点时）。
//
// 新增事件、新增宿主、挪动发送点 = 改这里。门禁红了先问「接上了吗」，不是改门禁。
const SHARED = (file, extra) => [Object.assign({ host: 'ext', file }, extra), Object.assign({ host: 'app', file }, extra)];
const SEAMS = {
  installed: SHARED('extension/learn/telemetry.js'),
  heartbeat: SHARED('extension/learn/telemetry.js'),
  onboarding_done: [
    { host: 'ext', file: 'extension/onboard/onboard.js', match: "surface: 'ext'" },
    { host: 'app', file: 'app/app.js', match: "surface: 'app'" },
    { host: 'app', file: 'app/app.js', match: "surface: 'app_resume'" },
  ],
  engine_set: [
    { host: 'ext', file: 'extension/options/options.js' },
    // 一键卡与领免费额度两条路都走 trackEngineSet()；后者由 verify-onboard 的行为断言守着。
    { host: 'app', file: 'app/settings.js' },
  ],
  engine_test: SHARED('extension/learn/engine-test.js'),
  translate_ok: [
    { host: 'ext', file: 'extension/content/content-webpage.js', match: "kind: 'page'" },
    { host: 'ext', file: 'extension/content/subtitle-adapter.js', match: "kind: 'subtitle'" },
    ...SHARED('extension/learn/doc-view.js', { match: "kind: 'doc'" }),
    { host: 'app', file: 'app/listen.js', match: "kind: 'subtitle'" },
    // quick：Mac 快速翻译（telemetry-design §3.5）。面板页不初始化遥测，经 mtQuick 中继到主页面，由 handoff.js 代发。
    { host: 'app', file: 'app/handoff.js', match: "kind: 'quick'" },
    { host: 'ext', surface: 'translate-fill', none: '补译文是学习层给已捕获的卡片补一个译文，不是一次用户发起的翻译会话（§3.3 裁定 2）' },
    { host: 'app', surface: 'translate-fill', none: '同一份 translate-fill.js，同一条裁定：后台补译文不算翻译会话' },
  ],
  translate_fail: [
    { host: 'ext', file: 'extension/content/content-webpage.js' },
    { host: 'ext', file: 'extension/content/subtitle-adapter.js' },
    ...SHARED('extension/learn/doc-view.js'),
    { host: 'app', file: 'app/listen.js' },
    { host: 'app', file: 'app/handoff.js' },
  ],
  subtitle_on: [
    { host: 'ext', file: 'extension/content/subtitle-adapter.js' },
    { host: 'app', none: "App 没有网页字幕会话；它的入口由 asr_entry{surface:'app_home'} 回答" },
  ],
  capture_first: [
    { host: 'ext', file: 'extension/content/learn-collector.js' },
    { host: 'app', file: 'app/docs.js' },
    { host: 'app', file: 'app/listen.js' },
  ],
  doc_open: SHARED('extension/learn/doc-view.js'),
  review_session: SHARED('extension/learn/review.js'),
  grant_claimed: SHARED('extension/learn/grant.js'),
  grant_exhausted: SHARED('extension/learn/telemetry.js'),
  sync_on: SHARED('extension/learn/sync.js'),
  rate_prompt: [
    { host: 'ext', file: 'extension/content/content-webpage.js' },
    { host: 'app', none: '评分提示挂在网页译文末尾，App 没有这个表面' },
  ],
  setup_detected: [
    { host: 'ext', file: 'extension/content/content-main.js' },
    { host: 'app', none: '自家官网上的扩展标记只由扩展的内容脚本注入；App 不是浏览器' },
  ],
  ext_banner: [
    { host: 'app', file: 'app/app.js' },
    { host: 'ext', none: '「扩展还没打开」横幅只在 App 首页' },
  ],
  asr_entry: [
    { host: 'ext', file: 'extension/content/asr-source.js' },
    { host: 'ext', file: 'extension/content/content-main.js', match: "surface: 'popup'" },
    { host: 'ext', file: 'extension/popup/popup.js', match: "surface: 'popup_app_row'" },
    { host: 'app', file: 'app/listen.js', match: "surface: 'app_home'" },
  ],
  telemetry_off: SHARED('extension/learn/telemetry.js'),
};

// 这些词出现在任何键名里都说明有人在往遥测里塞内容或身份 —— 测试会红。
const FORBIDDEN_KEY_WORDS = ['url', 'href', 'text', 'title', 'email', 'user', 'uid', 'key',
  'token', 'name', 'hostname', 'domain', 'message', 'body', 'ip'];

const LIMITS = { batch: 50, eventBytes: 1024, bodyBytes: 64 * 1024, perMinute: 60, strMax: 64 };

module.exports = { COMMON, EVENTS, SEAMS, FORBIDDEN_KEY_WORDS, LIMITS };
