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
//   'id'     /^[a-z0-9_-]{1,32}$/   —— 引擎 id 这种；launch_id / setup_id 的 32-hex 也走这条
//   [...]    枚举，只允许列出的值
'use strict';

const COMMON = {
  install_id: 'uuid',      // 本机随机生成，与账号无关；关掉开关即删
  ts: 'iso',               // 客户端时间，取整到分钟；服务端只接受 ±7 天内
  v: 'semver',             // 扩展版本
  flavor: ['global', 'china'],  // 中国版与国际版同一份白名单（BEL-135）；入口仍是境内，不在这张表里
  host: ['safari', 'chrome', 'firefox', 'app'],
  device: ['iPhone', 'iPad', 'Mac', 'Windows', 'Android', 'Linux', ''],
  ui: 'lang',              // 界面语言，粗到 zh / en 这一级；/^[a-z]{2,3}$/
};

// BEL-223（2026-11-08）：归因用的**五个功能面**。这不是「入口」（那是 asr_entry.surface
// 的 popup / notice / …），而是「这次动作发生在哪个产品面」。五个值来自 BEL-223 验收口径：
// listen（对话听译）· live_caption（实时字幕）· quick（Mac 快速翻译）· doc（文档）·
// web_caption（网页字幕）。新增值 = 改提案 + 过评审 + 同步 docs §3，不是顺手加。
const SURFACES = ['listen', 'live_caption', 'quick', 'doc', 'web_caption'];

// BEL-226（2026-11-14）：语言包下载的入口面。与上面五个**功能面**并列登记：
//   first_run_packs = 首启「下载并继续」那一屏
//   settings_packs  = 设置页 › 语言包管理（openPackManager）
// 旧 P0 客户端发的是功能面（listen / …），所以枚举是**并集**，不是替换 —— 删旧值会让
// 1.23.3 老行在回读时被当成非法。值与 src/app/telemetry-session.js 的 PACK_SURFACES 同源。
const PACK_SURFACES = SURFACES.concat(['first_run_packs', 'settings_packs']);

// BEL-226：下载单元与失败原因。pack_kind 四种 = 票面；reason 六值 = 票面的错误分类。
// pack_id 用 'id' 型（小写字母/数字/_/-, ≤32）：共享包 tts:zh-en 在这里写成 tts_zh_en
// —— 扩展冻结的 okValue 只认 /^[a-z0-9_-]{1,32}$/，冒号会让**整条**事件被丢掉。
const PACK_KINDS = ['asr', 'tts', 'lid', 'vad'];
const PACK_SOURCES = ['system', 'github', 'modelscope', 'other'];
const PACK_FAIL_REASONS = ['network', 'timeout', 'disk', 'hash', 'unsupported', 'other'];

// BEL-247（2026-11-13）：translate_ok 与 translate_fail 共用的**同一个** kind 枚举。
// 以前只有 ok 有 kind，失败那条无法按功能面拆成功率；复制一份枚举就是下一次漂移的起点，
// 所以抽成常量、两边引用。加一个值 = 改这里 + docs/telemetry-design.md §3。
const TRANSLATE_KINDS = ['page', 'subtitle', 'doc', 'quick'];

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
  // （`src/app/shell-model.js` 的 OB 与 `src/pages/onboard.jsx` 的 OB），所以是并集；
  // 屏序改了这里要跟着改（加枚举值，门禁只认事件名，不会自己红）。
  onboarding_done: {
    // app_resume / shown / dismissed / expired（2026-09-22，§3.8，用户评审通过）：「继续设置」卡 ——
    // 出现（每次启动至多一条）· 点 ✕ · 第 4 次启动自动收起。点「继续」之后仍由 surface:'app' 那条回答。
    surface: ['ext', 'app', 'app_resume'],
    // web_only（2026-09-24，§3.9 提案 B，用户评审通过）：第一屏那条「我只要网页翻译 →」。
    // 它与 done / skipped **并列**，不是 skipped 的子类 —— 说的是「他自己讲了要哪一半」，
    // 不是「他放弃了」。只有 surface:'app' 会发（扩展引导里人已经在浏览器里，没有这条出口）。
    // **2026-10-02（#547）那条出口撤了 ⇒ 这个取值不再产生**；枚举照留，收老客户端的行。
    result: ['done', 'skipped', 'shown', 'dismissed', 'expired', 'web_only'],
    // 2026-09-22 屏序重排后：App 加了 firstuse；browser / read / capture 三屏已删，
    // 但**值留着** —— 线上历史行还在用它们，删掉会让回读旧数据时这些行被当成非法。
    step: ['welcome', 'ext', 'browser', 'read', 'signin', 'engine', 'capture', 'try', 'firstuse'],
    // dwell（2026-09-24，§3.9 提案 A，用户评审通过）：从引导出现到离开，**分桶的秒数**。
    // 为什么要它：1.15.0 出货后 `skipped@welcome` 占了装机的一半还多，而 `step` 只说
    // 「停在第 1 屏」，分不开「没读就跳」（动线问题：「以后再设置」和主按钮等宽）与
    // 「读了还是跳」（文案问题）—— 这两种的修法完全相反。
    // 为什么分桶不是秒数：原则 1 的延伸，精确停留时长在小样本上接近指纹。
    // 只有 surface ext / app 带它；app_resume 那张卡没有「停留」可言，不带（键缺席是合法的）。
    dwell: ['0-2', '3-9', '10-29', '30+'],
  },
  // onboard_intent（2026-09-28，#486/#487，用户评审通过）：迎新首屏「你想怎么用」的选择。
  // 粗粒度枚举，只回答「他第一目的是什么」—— 此前没有这条读数（#384 调查里那句「缺的第一目的」）。
  // 选 'listen' 的人首页不挂扩展横幅（interaction-spec「迎新页意图分叉」）。只记选择，不含内容。
  onboard_intent: { goal: ['read', 'listen', 'both'] },
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
    // BEL-223（2026-11-08）：从哪个功能面发起测试、哪次启动。键可缺。
    // launch_id = 32 位小写十六进制（uuid 去掉连字符），与 UUID 同义；用 'id' 规则见 app_open。
    launch_id: 'id',
    surface: SURFACES,
  },
  translate_ok: { provider: 'id', kind: TRANSLATE_KINDS, ms: 'int' },   // doc：文档翻译（2026-09-11，learning-design §9.7）
  translate_fail: {
    provider: 'id',
    // BEL-247：与 translate_ok 共用 TRANSLATE_KINDS —— 「哪个功能面的失败」必须能
    // 和成功数对齐，否则成功率只能按 provider 粗算。
    kind: TRANSLATE_KINDS,
    // 免费额度那三个必须在枚举里（§8.10 / telemetry-design §3）：不在枚举里的 code
    // 会被客户端白名单**静默丢掉**，于是「有多少人把 0.2 美元用完了」这个数永远是 0
    // —— 而那正是判断这笔钱该不该继续花的唯一依据。
    code: ['timeout', 'network', 'http', 'reasoning_starved', 'no_base', 'unknown_provider',
      'credit_exhausted', 'grant_unavailable', 'model_not_allowed',
      // auth（2026-09-10，第八期）：401/403 且请求带了非空、非 bmg_ 额度令牌的 key ——
      // 「这把 key 被服务商拒绝」，引擎停机。5 天里 308 条 401 来自同一台机器逐段重试。
      'auth',
      // stalled（BEL-247）：单单元 120 s 不落地。与 timeout 分开 —— 「promise 没回来」
      // 和「请求超时」不是同一种病，混一列会让连续超时熔断读错。
      'stalled'],
    status: 'int',
    route: ['direct', 'proxy', ''],
    ms: 'int',
  },
  subtitle_on: { site: ['youtube', 'substack', 'podcast', 'other'] },
  capture_first: {},
  // 文档翻译（2026-09-11，learning-design §9.7）：一份文档打开一次。只有格式与页数 —— 不带文件名、字数、页文本。
  doc_open: { kind: ['pdf', 'docx', 'txt', 'image'], pages: 'int' },
  // result / left（2026-09-22，§3.7 A）：离开复习面也发；done 与 left 互斥、每轮一条。
  // opened / nothing_due（2026-09-24，§3.10，用户裁定「每天或每周回来就好，养成习惯
  // 远比学很大量重要」）：判据从「刷完」换成「有没有回来」。
  //   · opened     露出第一张卡**立刻**发 —— 这一套里**唯一不依赖「善终」的观测点**。
  //                 done / left 都要求清空或走正门，而 App 被直接杀掉两个都不触发，
  //                 于是这个事件在线上**全历史零行**（同期 capture_first 65 台）。
  //   · nothing_due 打开了复习面，但今天没有到期卡 —— 他来了，而我们没有东西给他。
  //                 这是新用户第二天最常见的画面，此前连「他来了」都看不见。
  // 每轮：opened 一条 + 结局一条（done / left / nothing_due 三选一，互斥）。
  review_session: { graded: 'int', result: ['done', 'left', 'opened', 'nothing_due'], left: 'int' },
  // 免费额度（§8.10）。两个都**无属性** —— 需要的只是「多少人领了」与「多少人用完了」
  // 这两个计数。台账（谁花了多少）是账号级数据；2026-11-08 起 bt_auth_ok 把 user_id 与
  // install_id 写进同一张第一方表、bt_grant_usage 也带 install_id，所以与遥测**可连接**
  // （仅支持与滥用排查，不进第三方；telemetry-design 原则 7）。
  grant_claimed: {},
  grant_exhausted: {},
  // ── BEL-224／225／226（2026-11-08）归因遥测 ──────────────────────────────────
  // 本拍（P0）只登记名字、属性与枚举；**客户端发送点留 P1**（BEL-223/225/226）。
  // 事件正文仍守规则 4：没有 user_id / 邮箱 / 凭证 / 原文 / URL。user_id 只进第一方
  // bt_auth_ok（BEL-222）；该表的 install_id 与这里的事件可对上（仅支持与滥用排查，不进第三方）。
  //
  // 免费额度记账（BEL-224）：只在 hosted `bt_grant_charge` 写成功 / 写失败时各记一条，
  // 不按请求重试次数记。`kind` 与 bt_grant_usage.kind 同源；`surface` 是这次花费落在
  // 哪个功能面（BEL-223 五值）。失败事件不另造错误枚举 —— 区分「成功/失败」靠事件名。
  grant_debited: { surface: SURFACES, kind: ['chat', 'tts', 'stt'] },
  grant_debit_fail: { surface: SURFACES, kind: ['chat', 'tts', 'stt'] },
  // 冷启（BEL-225）：登录墙**之前**也记，所以必须能分开已登录/未登录。`launch_id` 是
  // 一次进程启动的**32 位小写十六进制**（同一次冷启里的事件可串起来；不是安装 id，也不是账号）。
  // 2026-11-08（BEL-227）：值仍然是 UUID 的 32-hex 同义写法（uuid 去掉连字符），但注册表
  // 类型从 'uuid' 改成 'id'。**卡面写 UUID，因扩展冻结只能用 id 规则**：扩展 1.23.3 已冻结
  // （CWS 在审），其 okValue 只认 数组 / int / id —— 36 字符带连字符的 uuid 过不了
  // /^[a-z0-9_-]{1,32}$/，app_open 会被整条丢掉。所以 App 发 32-hex、白名单按 'id' 收。
  // `auth_state` 的 unknown 只给「启动瞬间会话还没读出来」这一种情况，不拿来兜底别的事。
  // `entry_kind` **没有约定 ⇒ 不加**（研发令明确：没约定就不带）。
  app_open: {
    launch_id: 'id',
    surface: SURFACES,                 // home / 登录墙这种不在这五面时**不带这个键**（props 可缺）
    auth_state: ['signed_in', 'signed_out', 'unknown'],
  },
  // 登录成功（BEL-223）。P3 要求「signup / signin 各一次」⇒ method 必须能分开这两种；
  // provider 与 auth_fail.provider 同一套值（apple / google / email / phone）。
  // 服务端另写第一方 bt_auth_ok（含 user_id），这条匿名事件不带 user_id；两边可由
  // install_id 对上（仅支持与滥用排查，不进第三方）。
  auth_ok: {
    surface: SURFACES,
    provider: ['apple', 'google', 'email', 'phone', 'unknown'],
    method: ['signup', 'signin'],
  },
  // 实时字幕的开门判定（BEL-223）：`ok` 是这次判定过没过。注册表没有 bool 类型，
  // 所以钉成字符串枚举 'true' / 'false'；P1 发之前自己 String(ok)，不要发 JSON 布尔。
  live_gate: { surface: SURFACES, ok: ['true', 'false'] },
  // 领取失败（BEL-223）。code 的七个值来自 extension 的 grant_err_* 文案键
  // （exhausted / unavailable / misconfigured / revoked / invalid / model / busy）——
  // 与 translate_fail.code 同一条纪律：不在枚举里的码会被服务端整条拒，宁可先钉全。
  grant_claim_fail: {
    surface: SURFACES,
    code: ['exhausted', 'unavailable', 'misconfigured', 'revoked', 'invalid', 'model', 'busy'],
  },
  // 语言包下载（BEL-226）。`setup_id` 是一条「把包配齐」的流程 id，**跨启动保持不变**，
  // 所以「上次没下完、这次接着下」能串成一条；start/ok/fail 用同一个 setup_id。
  // 2026-11-08（BEL-227）：`setup_id` 与 app_open.launch_id 一样是 **32 位小写十六进制**
  // （uuid 去掉连字符的 32-hex 同义标识）。**卡面写 UUID，因扩展冻结只能用 id 规则** ——
  // 36 字符带连字符的 uuid 过不了扩展的 /^[a-z0-9_-]{1,32}$/，pack_* / packs_ready 会被
  // 整条丢掉；旧 uuid 值由 App 迁移成 32-hex（同一标识，不换新的）。
  //
  // 2026-11-14（BEL-226 补全）：每个**真正去下的资源**一条 start/ok/fail，不按字节进度发。
  //   pack_kind  asr / tts / lid / vad
  //   pack_id    短标识；共享包（中英朗读）用显式共享 id `tts_zh_en`，泰语 `tts_th`，
  //              识别包 `asr_<lang>`。用 'id' 型（不是 uuid）：见上面 32-hex 那条。
  //   locale     语言短码（共享包写 zh-en；lid / vad 没有语言，键可缺）
  //   download_id 本次下载尝试的 32-hex；start/ok/fail 三态共用
  //   launch_id  本次打开 App 的 32-hex
  //   source     system（系统语音资产）/ github / modelscope / other（含自家中继：
  //              真实托管由服务端按 IP 选，客户端看不见 ⇒ 只报 other，不猜）
  //   attempt    同一 setup 内同一 pack_id 的第几次尝试（持久化、跨启动继续）
  // 旧 P0 属性 `setup_id` / `surface` 照发；`code` 在 fail 上保留，收 1.23.3 老客户端的行。
  pack_download_start: {
    setup_id: 'id',
    surface: PACK_SURFACES,
    pack_kind: PACK_KINDS,
    pack_id: 'id',
    locale: 'id',
    download_id: 'id',
    launch_id: 'id',
    source: PACK_SOURCES,
    attempt: 'int',
  },
  pack_download_ok: {
    setup_id: 'id',
    surface: PACK_SURFACES,
    pack_kind: PACK_KINDS,
    pack_id: 'id',
    locale: 'id',
    download_id: 'id',
    launch_id: 'id',
    source: PACK_SOURCES,
    attempt: 'int',
  },
  pack_download_fail: {
    setup_id: 'id',
    surface: PACK_SURFACES,
    pack_kind: PACK_KINDS,
    pack_id: 'id',
    locale: 'id',
    download_id: 'id',
    launch_id: 'id',
    source: PACK_SOURCES,
    attempt: 'int',
    // 六值真实原因；`code` 是旧 P0 的 id 型码（timeout / tts_failed / base_failed /
    // download …），过渡期同发。原始报错 / URL 永远不进 reason 或 code。
    reason: PACK_FAIL_REASONS,
    code: 'id',
  },
  // 「包齐了」的过渡（BEL-226）：**整套所需资源**都校验就绪时记一条；单语言下完不能代替。
  // 按 setup_id + selection_id 的就绪过渡去重（同一 selection 只发一次；未齐不发；
  // 从不齐再变齐可再记）。旧 P0 的 ready_kind（base/asr/tts/all）与 required/ready 保留，
  // 新客户端发 downloaded/preexisting/mixed + 分项计数；旧值仍在枚举里收老行。
  packs_ready: {
    setup_id: 'id',
    selection_id: 'id',       // 所需 kind/id/locale 集合的稳定派生（32-hex）
    launch_id: 'id',
    surface: PACK_SURFACES,
    ready_kind: ['base', 'asr', 'tts', 'all', 'downloaded', 'preexisting', 'mixed'],
    asr_required: 'int',
    asr_ready: 'int',
    tts_required: 'int',
    tts_ready: 'int',
    base_ready: ['true', 'false'],
    required_count: 'int',
    ready_count: 'int',
    // 旧 P0 字段（1.23.3 老客户端）：整批要求数 / 已就绪数。
    required: 'int',
    ready: 'int',
  },
  sync_on: {},
  // auth_fail（2026-10-02，telemetry-design §3.14，用户报障 + 评审通过）：**新账号第三方登录
  // 第一次失败、第二次成功**，扩展与 App 都有。此前登录失败只在用户眼前一闪，我们这边零行。
  // 只记形状 —— 哪条路（provider）、断在哪个断点（stage）、什么码（code）、HTTP 几位、本页面/
  // 会话里第几次失败（attempt）。**永不带账号 / 邮箱 / 令牌 / 正文**：那几样在注册表的
  // FORBIDDEN_KEY_WORDS 里，是机器判据（原则 1）。
  //
  // stage 与 `extension/learn/auth.js` 的断点同源：
  //   prepare   = prepareProviderSignIn 没备好 PKCE（还没点开登录页）
  //   authorize = providerSignInUrl 返回空（点下去开不了登录页）
  //   exchange  = completeProviderSignIn 换票失败（扩展托管回调 / App 系统鉴权会话那条路）
  //   id_token  = signInWithIdToken 失败（App 原生 Sign in with Apple）
  //   native    = 原生那一步本身失败（App 的 apple-result 带 error），由宿主 App 报
  //   otp       = 邮箱/手机号发码失败   verify = 验码失败   password = 密码 grant 失败
  //   post_login= 交换成功、但「登录之后」那一步失败（show() / doSync()）。2026-10-02 补：
  //               App 的红字「连不上服务器」也可能从这条来，而它此前完全没有记录 ——
  //               用户很确定自己装的是带埋点的包，却没有一条 auth_fail，这就是那个洞。
  // code 用 'id' 型（小写字母数字下划线连字符，≤32）：`errorFrom()` 的 GoTrue error_code，
  // 或调用方传的字面码（pkce_missing / storage_error / native_error…）。没归一化的会**静默
  // 丢掉**（同 translate_fail.code 那条教训），所以 authFail() 负责归一化。
  auth_fail: {
    provider: ['apple', 'google', 'email', 'phone', 'unknown'],
    stage: ['prepare', 'authorize', 'exchange', 'id_token', 'native', 'otp', 'verify', 'password', 'post_login', 'unknown'],
    code: 'id',
    http: 'int',              // 没有 HTTP 响应（网络不通 / 本地失败）时为 0
    attempt: ['1', '2+'],     // 本页面/会话里第几次 auth_fail（'1' = 第一次）
  },
  // 第六问（telemetry-design §1，2026-09-10）：我们的提示被看见了吗、有人点吗。
  // 只有一个枚举属性，永不带页面、文案或输入。
  // 2026-09-25（§3.12，三轮）：译文末尾那一行不再要评分（Safari 撞苹果 5.6.1；Chrome / Firefox 同样 0 点击、
  // 商店评分对量几乎无影响）。shown / tap / dismiss 只剩**老版本客户端**还会发，服务端照收；
  // requested = App 在收获时刻向系统发出了评分请求（requestReview 不回调，所以不是曝光）。
  rate_prompt: { action: ['shown', 'tap', 'dismiss', 'requested'] },
  // 译文末尾「今天读过的句子，去复习 →」（§3.12）。目的地由公共字段 host 区分：safari → App 的复习屏，
  // chrome / firefox → 扩展自己的复习页。seen = 行至少一半进入视口、连续 ≥1 秒（shown 只说明插进了页面）；
  // no_app = Safari 那一跳的 AppLink.open 兜底被触发（没有人接住 scheme）。
  review_nudge: { action: ['shown', 'seen', 'tap', 'dismiss', 'no_app'] },
  ext_banner: { action: ['shown', 'setup', 'done', 'check'] },     // App 首页「扩展还没打开」横幅；check（「打开检测页」那一行）2026-09-27 已从 UI 淘汰，枚举照留以收老客户端（§3.7 B）
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
    // BEL-223：这里的 surface 是「入口」，不是功能面五值；只补 launch_id。
    launch_id: 'id',
  },
  // 首启听译漏斗（2026-10-28，BEL-113，telemetry-design §3.16）。
  // asr_entry 只回答「打开了听译/字幕页」。下面四条把「没授权 / 没真开麦 / 听译失败 /
  // 出了字但翻译没跑」拆开。公共信封已经带 host / v / device，这里不再复制一份。
  // engine / locale_pair 可缺：键不在就不发，发了就必须过 id 型（整条否则被丢掉）。
  mic_permission: {
    permission_state: ['prompted', 'granted', 'denied', 'restricted', 'not_determined'],
    kind: ['mic', 'system'],
    engine: 'id',
    locale_pair: 'id',
    // BEL-223：从哪个功能面读权限、哪次启动。键可缺（老客户端不发）。
    launch_id: 'id',
    surface: SURFACES,
  },
  asr_start: { engine: 'id', locale_pair: 'id', launch_id: 'id', surface: SURFACES },
  asr_fail: {
    fail_reason: ['permission', 'interrupted', 'socket', 'assets', 'device', 'os',
      'capture', 'locale', 'quota', 'timeout', 'other'],
    engine: 'id',
    locale_pair: 'id',
  },
  translate_start: { engine: 'id', locale_pair: 'id' },
  // Mac 完整视频离线字幕（domain-design §2.8 / telemetry-design §3.15，BEL-103）。
  // 不进听译漏斗。成功不带 code。code 里没有路径和原文。
  offline_video_asr_task: {
    result: ['ok', 'fail', 'cancelled'],
    code: ['no_audio_track', 'codec_unsupported', 'media_encrypted', 'drm',
      'model_missing', 'model_hash_mismatch', 'download_failed', 'disk_low',
      'oom', 'sidecar_crash', 'cancelled', 'timeout', 'empty_hyp', 'pin_mismatch', 'busy'],
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
    // ext 侧的发送点已迁 src/pages/onboard.jsx（React 版，§10.9）—— file 指源码，
    // 门禁对源码核 track/once 与 match 字面量。
    { host: 'ext', file: 'src/pages/onboard.jsx', match: "surface: 'ext'" },
    // dwell（§3.9 提案 A）：属性也钉住。少带一个诊断属性不会让任何门禁自己红 ——
    // 事件照发、表照样合法，只是那一列永远是空的（§3.4 那条教训的属性版）。
    { host: 'ext', file: 'src/pages/onboard.jsx', match: 'dwell: d' },
    // app 侧正文已迁 src/app/shell-model.js（原 app/app.js，PR6a）—— 同 ext 侧，file 指源码。
    { host: 'app', file: 'src/app/shell-model.js', match: "surface: 'app'" },
    { host: 'app', file: 'src/app/shell-model.js', match: 'dwell: d' },
    // 2026-10-02（#547）：`obTrackLeave('web_only')` 那条出口撤了 —— 这个 seam 随之删掉。
    // 枚举里的 `web_only` 照留（收老客户端的行），但**不再有发送点**。
    { host: 'app', file: 'src/app/shell-model.js', match: "surface: 'app_resume'" },
  ],
  onboard_intent: [
    // 迎新页只在 App：扩展引导里人已经在浏览器里，没有「你想怎么用」这一步。
    { host: 'ext', none: '迎新页只在 App：扩展引导里人已经在浏览器里，没有「你想怎么用」这一步' },
    { host: 'app', file: 'src/app/shell-model.js', match: "track('onboard_intent'" },
  ],
  engine_set: [
    { host: 'ext', file: 'src/pages/options.jsx' },
    // 一键卡与领免费额度两条路都走 trackEngineSet()；后者由 verify-onboard 的行为断言守着。
    // PR6b：trackEngineSet 落在 src/app/settings-model.js（原 app/settings.js）。
    { host: 'app', file: 'src/app/settings-model.js' },
  ],
  engine_test: SHARED('extension/learn/engine-test.js'),
  // auth_fail（§3.14）：两个宿主都走 extension/learn/auth.js 的同一份字节（该文件在 App 包的
  // MODULES 里）。App 原生那一步（apple-result 带 error）另外经 LearnAuth.noteAuthFail 报，
  // 仍落在这个文件里 —— 发送点只有一处，与「登录即注册」只有一份实现同一条纪律。
  auth_fail: SHARED('extension/learn/auth.js'),
  translate_ok: [
    { host: 'ext', file: 'extension/content/content-webpage.js', match: "kind: 'page'" },
    { host: 'ext', file: 'extension/content/subtitle-adapter.js', match: "kind: 'subtitle'" },
    ...SHARED('src/shared/doc-view.js', { match: "kind: 'doc'" }),
    { host: 'app', file: 'src/app/listen-model.js', match: "kind: 'subtitle'" },
    // quick：Mac 快速翻译（telemetry-design §3.5）。面板页不初始化遥测，经 mtQuick 中继到主页面，由 handoff.js 代发。
    { host: 'app', file: 'app/handoff.js', match: "kind: 'quick'" },
    { host: 'ext', surface: 'translate-fill', none: '补译文是学习层给已捕获的卡片补一个译文，不是一次用户发起的翻译会话（§3.3 裁定 2）' },
    { host: 'app', surface: 'translate-fill', none: '同一份 translate-fill.js，同一条裁定：后台补译文不算翻译会话' },
  ],
  translate_fail: [
    { host: 'ext', file: 'extension/content/content-webpage.js', match: "kind: 'page'" },
    { host: 'ext', file: 'extension/content/subtitle-adapter.js', match: "kind: 'subtitle'" },
    ...SHARED('src/shared/doc-view.js', { match: "kind: 'doc'" }),
    { host: 'app', file: 'src/app/listen-model.js', match: "kind: 'subtitle'" },
    { host: 'app', file: 'app/handoff.js', match: "kind: 'quick'" },
  ],
  subtitle_on: [
    { host: 'ext', file: 'extension/content/subtitle-adapter.js' },
    { host: 'app', none: "App 没有网页字幕会话；它的入口由 asr_entry{surface:'app_home'} 回答" },
  ],
  capture_first: [
    { host: 'ext', file: 'extension/content/learn-collector.js' },
    { host: 'app', file: 'src/app/docs-model.js' },
    { host: 'app', file: 'src/app/listen-model.js' },
  ],
  doc_open: SHARED('src/shared/doc-view.js'),
  review_session: SHARED('src/shared/review.js')
    // §3.10：少带一个取值不会让任何门禁自己红 —— 事件照发、表照样合法，只是那一列
    // 永远是空的。所以两个新取值各钉一条（同 onboarding_done 的 dwell）。
    .concat([
      { host: 'ext', file: 'src/shared/review.js', match: "sessOpened()" },
      { host: 'app', file: 'src/shared/review.js', match: "sessOpened()" },
      { host: 'ext', file: 'src/shared/review.js', match: "'nothing_due'" },
      { host: 'app', file: 'src/shared/review.js', match: "'nothing_due'" },
    ]),
  // PR7b：claim 逻辑与发送点（grant.js:96 track）一起进了 src/shared/grant.js（纯逻辑
  // 层，两宿主同一次编译）。file 指源码，门禁对源码核 track 字面量 —— 同 onboarding_done 先例。
  grant_claimed: SHARED('src/shared/grant.js'),
  grant_exhausted: SHARED('extension/learn/telemetry.js'),
  // BEL-224／225／226（2026-11-08）：P0 已登记白名单；P1（本拍）只接 App 侧。
  // extension/ 在 1.23.3 冻结（CWS 在审），所以 ext 侧仍是 none；这不是漏接。
  // App 的发送点全部收在 src/app/telemetry-session.js 一处（launch_id 也只有一个生成点）。
  grant_debited: [
    { host: 'ext', none: 'hosted bt_grant_charge 记账成功时直接落事件；客户端不直接发（实现不在公仓）' },
    { host: 'app', none: 'hosted bt_grant_charge 记账成功时直接落事件；客户端不直接发（实现不在公仓）' },
  ],
  grant_debit_fail: [
    { host: 'ext', none: 'hosted bt_grant_charge 记账失败时直接落事件；客户端不直接发（实现不在公仓）' },
    { host: 'app', none: 'hosted bt_grant_charge 记账失败时直接落事件；客户端不直接发（实现不在公仓）' },
  ],
  app_open: [
    { host: 'ext', none: 'app_open 只在 App 冷启发；扩展没有 App 生命周期（BEL-225）' },
    { host: 'app', file: 'src/app/telemetry-session.js', match: "track('app_open'" },
  ],
  auth_ok: [
    { host: 'ext', none: 'extension/ 在本拍冻结（CWS 1.23.3 在审）；auth_ok 只接 App' },
    { host: 'app', file: 'src/app/telemetry-session.js', match: "track('auth_ok'" },
  ],
  live_gate: [
    { host: 'ext', none: 'extension/ 在本拍冻结（CWS 1.23.3 在审）；live_gate 只接 App' },
    { host: 'app', file: 'src/app/telemetry-session.js', match: "track('live_gate'" },
  ],
  grant_claim_fail: [
    { host: 'ext', none: 'extension/ 在本拍冻结（CWS 1.23.3 在审）；grant_claim_fail 只接 App' },
    { host: 'app', file: 'src/app/telemetry-session.js', match: "track('grant_claim_fail'" },
  ],
  pack_download_start: [
    { host: 'ext', none: '扩展没有 App 的离线语言包下载流程；BEL-226 只接 App' },
    { host: 'app', file: 'src/app/telemetry-session.js', match: "track('pack_download_start'" },
  ],
  pack_download_ok: [
    { host: 'ext', none: '扩展没有 App 的离线语言包下载流程；BEL-226 只接 App' },
    { host: 'app', file: 'src/app/telemetry-session.js', match: "track('pack_download_ok'" },
  ],
  pack_download_fail: [
    { host: 'ext', none: '扩展没有 App 的离线语言包下载流程；BEL-226 只接 App' },
    { host: 'app', file: 'src/app/telemetry-session.js', match: "track('pack_download_fail'" },
  ],
  packs_ready: [
    { host: 'ext', none: '扩展没有 App 的离线语言包下载流程；BEL-226 只接 App' },
    { host: 'app', file: 'src/app/telemetry-session.js', match: "track('packs_ready'" },
  ],
  sync_on: SHARED('extension/learn/sync.js'),
  rate_prompt: [
    { host: 'ext', none: '§3.12 第三轮：译文末尾不再主动要评分，评分只留常驻链接（不发事件）；老版本客户端仍会发 shown/tap/dismiss，服务端照收' },
    // §3.12：App 在收获时刻向系统请求评分，发 requested。
    { host: 'app', file: 'extension/learn/feedback.js', match: "action: 'requested'" },
  ],
  review_nudge: [
    { host: 'ext', file: 'extension/content/content-webpage.js' },
    { host: 'app', none: '「去复习」那一行挂在网页译文末尾；content-webpage 不进 App 包，App 里没有它' },
  ],
  setup_detected: [
    { host: 'ext', file: 'extension/content/content-main.js' },
    { host: 'app', none: '自家官网上的扩展标记只由扩展的内容脚本注入；App 不是浏览器' },
  ],
  ext_banner: [
    { host: 'app', file: 'src/app/shell-model.js' },
    { host: 'ext', none: '「扩展还没打开」横幅只在 App 首页' },
  ],
  asr_entry: [
    { host: 'ext', file: 'extension/content/asr-source.js' },
    { host: 'ext', file: 'extension/content/content-main.js', match: "surface: 'popup'" },
    { host: 'ext', file: 'src/pages/popup.jsx', match: "surface: 'popup_app_row'" },
    { host: 'app', file: 'src/app/listen-model.js', match: "surface: 'app_home'" },
  ],
  // BEL-113：漏斗只挂在 App 的听译/实时字幕。扩展继续用 asr_entry 与 translate_ok/fail，
  // 不另开一套入口事件。
  mic_permission: [
    { host: 'ext', none: '首启麦克风/系统录音权限只在 App 原生桥上读；扩展网页转写不走这条权限' },
    { host: 'app', file: 'src/app/listen-model.js', match: "track('mic_permission'" },
  ],
  asr_start: [
    { host: 'ext', none: '扩展转写入口已由 asr_entry 回答；asr_start 只记 App 里用户真的开了麦' },
    { host: 'app', file: 'src/app/listen-model.js', match: "track('asr_start'" },
  ],
  asr_fail: [
    { host: 'ext', none: '扩展听译失败不进 App 首启漏斗；网页翻译失败仍是 translate_fail' },
    { host: 'app', file: 'src/app/listen-model.js', match: "track('asr_fail'" },
  ],
  translate_start: [
    { host: 'ext', none: '网页翻译没有「听出字再开翻」这一跳；成功与失败仍是 translate_ok / translate_fail' },
    { host: 'app', file: 'src/app/listen-model.js', match: "track('translate_start'" },
  ],
  offline_video_asr_task: [
    { host: 'ext', none: '完整视频离线字幕只在 Mac App；扩展没有这条入口，也不进听译漏斗' },
    { host: 'app', file: 'app/offline-video-asr.js', match: "track('offline_video_asr_task'" },
  ],
  telemetry_off: SHARED('extension/learn/telemetry.js'),
};

// 这些词出现在任何键名里都说明有人在往遥测里塞内容或身份 —— 测试会红。
const FORBIDDEN_KEY_WORDS = ['url', 'href', 'text', 'title', 'email', 'user', 'uid', 'key',
  'token', 'name', 'hostname', 'domain', 'message', 'body', 'ip'];

const LIMITS = { batch: 50, eventBytes: 1024, bodyBytes: 64 * 1024, perMinute: 60, strMax: 64 };

module.exports = { COMMON, EVENTS, SEAMS, FORBIDDEN_KEY_WORDS, LIMITS, TRANSLATE_KINDS, SURFACES, PACK_SURFACES, PACK_KINDS, PACK_SOURCES, PACK_FAIL_REASONS };
