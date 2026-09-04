# Verification spec (验证规约) — the single source of truth

This file is the **single, authoritative source** for how any change or bug in
「大肚猴翻译 / BelliedMonkey Translator」 is **verified**. It is referenced by
[`AGENTS.md`](../AGENTS.md); the verification rules formerly scattered across
`AGENTS.md`, `docs/device-verification.md`, and `docs/regression-tests.md` now live
here. **Every verification / testing task MUST follow this spec exactly.**

---

## 0. The rule (load-bearing)

> **Every verification runs the FULL MATRIX of every surface the product has been
> adapted to — a full regression, every time. Once a device or browser is adapted,
> it is permanently added to the matrix and included in every future verification.**

Corollaries:

- **No single-surface "canonical" pass.** Verifying a fix on iPhone alone (or Chrome
  alone) is **not** verification. A change is "verified" only when it has been
  exercised across the **entire current matrix** (§1) or its inapplicability to a
  surface is stated explicitly.
- **The matrix only grows.** When a new device/browser is adapted (e.g. a new iOS
  version, Firefox Android, Edge), add a row to §1 and it is thereafter part of every
  regression. Never quietly drop a surface.
- **State honestly what was and wasn't run.** For each task, report the per-surface
  result: verified-live (screenshot/recording) · documented-not-run · N/A. Never imply
  full coverage you didn't perform. (See §4 honesty rules.)
- **两个宿主的同一个控件族，必须由同一个组件渲染。** 扩展页与宿主 App 是两个
  origin、两份存储（`docs/domain-design.md` §9.3），但**规则只能有一份**。手写第二份
  的代价不是重复代码，是**静默漂移**：它不报错、不被任何现有门禁看见，只在某个引擎的
  某个字段上表现为「另一边没有这个框」。2026-09-04 实测到六处，全部来自
  `app/settings.js` 手抄 options 页的显隐规则：`supportsKey ?? needsKey` 只有一半的
  地方判 · 解析引擎那处干脆不判 `needsKey`（选了引擎就露 Key 框）· 示例地址只有一半
  的地方给 · 一半用 `hidden` 一半用 `style.display`（前者会被后者压掉）· 四个输入框
  id 与注册表对不上 · 同一概念两份 i18n key。**守它的门禁必须覆盖每一个 host** ——
  原来那道只 grep `options.js`，于是 App 那三份从来不会让任何测试变红。见 §3.1.4。
- **Drive real surfaces via cua-driver only** — never `claude-in-chrome` or other
  browser/computer-use tools — for every surface, including desktop Chrome.
- **Configure DeepSeek on every surface before verifying — never verify on the free
  Google endpoint (mandatory, 2026-07-27).** The free `translate_a/single` is not a
  stable baseline and derailed one full-matrix pass three separate ways: it returned a
  real translation and a verbatim echo for the *same* input minutes apart; its `sl=auto`
  classified a Chinese-dominant mixed block as zh and echoed the whole block, so the
  mixed-language cases never reached the code under test; and it echoed a Chinese line
  with the spaces around embedded Latin words stripped, manufacturing a duplicate-row
  symptom. Any of these turns "not exercised" into something that reads as a pass or a
  failure. **Check the provider first; do not settle for the default and explain
  afterwards.** The key lives only in the browser's extension storage — never in git,
  never baked into a build artifact. Safari's temporary extension and a default
  `web-ext` profile both wipe storage on quit, so either use a persistent profile
  (§2.E) or count "re-enter the key" as a setup step for that surface.

Scope: the full matrix applies to any change with an observable runtime surface —
a URL/page render, a subtitle/overlay, layout, a control, a provider, i18n. A
pure-logic change with **no** on-device surface needs only the automated gate (§3),
but say so.

---

## 1. Current surface matrix

The product is adapted to these surfaces (`README.md` 平台支持). **Only iPhone + iPad
run in the Xcode Simulator** (it only simulates iOS-family devices); the three desktop
browsers run on the **real Mac, fully sandboxed** (throwaway profiles / snapshot+restore
— nothing permanent left behind).

| # | Surface | Execution mode | Status |
|---|---|---|---|
| 1 | **iPhone Safari** | Xcode iOS Simulator (e.g. iPhone 15, iOS 17.2) | ✅ verified（2026-09-04 重验：启用扩展 → 授权站点 → FAB 注入 → 整页双语，走 DeepSeek）|
| 2 | **iPad Safari** | Xcode iOS Simulator (e.g. iPad Air 5th) — same iOS build, different UDID | ✅ verified（2026-09-04 重验：同上，且目录侧栏/正文/图注三种容器都正确双语）|
| 3 | **macOS Safari** | Real Mac, sandboxed. **Side-load `dist/` via 开发者→添加临时扩展** (no Xcode/signing; auto-clears on quit; **SNAPSHOT — re-add after every rebuild**, see §2.C) | ✅ verified（2026-09-05 重验：引导页语音哨兵 + DeepSeek 测试连接 663ms 通过 + 整页双语）— see §2.C；勾选与选文件夹是仅有的两步人工 |
| 4 | **macOS Chrome / Edge** | Real Mac, throwaway profile — **CDP `Extensions.loadUnpacked`** (CLI `--load-extension` blocked on Chrome ≥137) | ✅ verified (FAB + 11 translations) — see §2.D |
| 5 | **Firefox (desktop)** | Real Mac, `npx web-ext run` (throwaway profile, live-references `dist-firefox/`) + WebDriver BiDi driving | ✅ verified (FAB + page bilingual + podcast playback + 0px click) — see §2.E |
| 6 | **iOS host app** | Xcode iOS Simulator, `BelliedMonkey Translator (iOS)` scheme | ✅ Stage 2 verified (登录 → 拉到 11 张卡 → 收敛 → 重启仍在) — see §2.F |
| 7 | **macOS host app** | Real Mac, **signed** build copied to `/Applications` | ✅ verified（拉取 → 复习 → 落盘 → 退出后重启仍是退出）— see §2.G |

Rows 6–7 were added 2026-08-07 with the learning surface moving into a companion app
(`learning-design.md` §7.2). **They are learning-layer rows only** — translation does
not run there, and `domain-design.md` §9.4's constraint (the app is an *additional*
surface, never the only working path) means a change to translation is N/A for them by
construction, not by exemption.

Every regression must cover **all rows**, or explicitly mark a row N/A for the change.

### 0.1 凭证与登录：两件事，两个固定来源（2026-08-23）

验证要花的两样东西——**引擎凭证**和**一个登录态**——都有固定来源。两条都是**纪律**，
不是建议：每次开口问，验证就从「跑一遍」变成「等人回话」，而这两样东西一直都在机器上。

1. **API key 一律从 `.local/keys.md` 读，不要问用户。** 那个文件是本机唯一的凭证册
   （`node scripts/local-keys.js check` 只报槽位填没填、不回显内容），按引擎分行，
   国内/国际分开。**永远不要**把值贴进对话、日志、提交或 PR —— 读它、用它、不复述它。
   解析测试用 **DeepSeek**，不要用免费 Google 通道（响应不稳，曾三次把全矩阵验证带偏）。
   要验音频缓存那一路，语音引擎必须选**会返回字节**的（`returnsAudio: true`，
   例如 `openai_speech`）：设备内置语音按构造就不产生缓存（§9.1），用它等于没验。

2. **App 的登录走用户已连接的 Gmail 取验证码，不要让用户手输。** App 不登录就没有语料
   （learning-design §7.2），所以任何 App 侧的验收都从这一步开始。走 App 自己那条 API，
   不要去戳模拟器的键盘：

   ```
   POST {MT_BACKEND.url}/auth/v1/otp     {email, create_user:true}   # 发信
   # → 从 Gmail 读 6 位码（主题「大肚猴翻译 · 登录验证码」）
   POST {MT_BACKEND.url}/auth/v1/verify  {type:'email', email, token} # 换 session
   ```

   拿到的 `{accessToken, refreshToken, expiresAt, email, userId}` 就是 `learnAuth`
   的形状（`learn/auth.js` 的 `sessionFrom`），直接写进目标设备的存储即可。

**为什么是写存储而不是在界面里打字（模拟器实测 2026-08-23）**：iOS 模拟器上
`type_text` 会把每个字符都变成 `a`，`⌘A`/`⌘V` 被吞，长按与双击的手势识别器对合成鼠标
事件不响应——`press_key` 单键是准的，但一次调用一个字符，50 位的 key 根本不现实。
设置界面本身已经由 `test:app` / `test:learn` 覆盖；模拟器要验的是**运行时行为**，
所以设置从存储层灌进去，操作用点击驱动。App 的 `chrome.storage.local` 就是
`localStorage`（`app/chrome-shim.js` 加 `mt:` 前缀），落在容器里的
`…/WebsiteData/Default/<salt>/<salt>/LocalStorage/localstorage.sqlite3`，
表是 `ItemTable(key, value)`，**value 是 UTF-16LE**。写之前先把 App 停掉。
（脚本形态见 §2 F 行的 simulator 记录。）

### 0.2 真机：一律走 iPhone 镜像驱动（2026-08-23 用户裁定）

**真机验收由 iPhone 镜像（iPhone Mirroring）全程驱动，用户只做两件物理动作：把包弄上机、
把手机锁屏。** 其余（点按、翻页、截图取证、判定）都不该再麻烦人 —— 一个每步都要人伸手的
「真机验证」，跑一次就没有下一次了。

- **镜像要求手机处于锁屏状态。** 屏幕上写着「iPhone 使用中，锁定 iPhone 以连接」时，
  不是坏了，是手机正被拿在手里。装完包请把它放下、锁屏、别再碰。
- **窗口底部约 70px 是悬浮条，会吃掉点击** —— 目标落在那一带时先滚动，别硬点。
- **`⌘V` 在镜像里会被吞**，同模拟器。要填长文本就别走键盘（见 §0.1）。

**把包弄上机的两条路，代价不同：**

| 路 | 代价 | 什么时候用 |
|---|---|---|
| USB + `devicectl device install app` | 要用户插线并信任一次；`xcrun devicectl list devices` 显示 `unavailable` / `tunnelState: unavailable` 就是没连上 | 默认。不碰 TestFlight、不占构建号、不对外发任何东西 |
| TestFlight | 不用插线，但**会把一个未合并分支的构建推到 Apple 服务器并占掉一个构建号**，其他测试员也看得见 | 用户明确点头才走 |

**镜像里的输入实测（2026-08-23，与模拟器不同，别把两套结论混用）：**

| 动作 | 真机镜像 | 模拟器 |
|---|---|---|
| `type_text` 打字 | **准** —— 邮箱、验证码都一次打对 | 每个字符都变成 `a` |
| `⌘V` | 吞 | 吞 |
| 长按 / 双击唤出「粘贴」 | 不响应合成事件 | 不响应合成事件 |
| 滚动 | **只有指针压在纯文本上时才滚**；压在 `<select>` 或页面外边距上，滚轮事件不落到页面滚动器 | 拖拽即可 |
| 拖拽当滑动 | 会变成**选中文字**，不是滚动 | 可用 |

由此得到两条操作纪律：

- **短文本直接打，长凭证别想着粘。** 密钥这类长串在镜像里没有可靠的自动输入路径 ——
  `type_text` 虽然准，但把密钥当参数传属于凭证处理，会被拦；而所有粘贴路径都不通。
  真机上要配引擎，**目前只能请用户自己粘一次**（把值放到 Mac 剪贴板，用户在手机上
  长按 → 粘贴，通用剪贴板会带过去）。
- **别用拖拽滚动**，用滚轮，并且把指针放在一段纯文本上。

**飞行模式与 iPhone 镜像互斥。** 镜像走 Wi-Fi/蓝牙，飞行模式把两个都关了，屏幕会变成
「未找到 iPhone」。所以**真飞行模式的离线验收只能人眼看**，驱动不了也截不了图 —— 自动化
那一版要用「把端点地址指到死地址」代替（`cacheKey` 不含 baseUrl，缓存照样全命中，而任何
真发出的请求都会响亮失败）。两者证明力还不一样：飞行模式只证明「发不出去」，死地址证明
「根本没发」。真机那一遍的增量仅仅是「真把无线电关掉也一样」，值得跑一次，但别指望能自动化。

**锁屏与灵动岛：镜像验不了，模拟器可以（2026-08-25 实证）。**

- **iPhone 镜像不能用来验这两个面。** 镜像自己会占掉灵动岛的一个位置（右边那个
  「正在镜像」指示），于是我们的媒体活动被挤成一个通用喇叭图标 —— 看上去像「没生效」，
  其实是观察工具在污染观察对象。锁屏更直接：镜像要求手机锁屏，所以镜像期间根本看不到
  锁屏。**这两个面在镜像下的任何结论都不作数。**
- **模拟器锁屏是可信的观察面**，而且是这一轮唯一把根因照出来的东西：`⌘L` 锁屏 →
  `xcrun simctl io booted screenshot`。**灵动岛在模拟器上不可信**（它对灵动岛的支持
  不完整，空着不代表真机空）。
- 判据要连着看四样，不能只看封面：标题是不是卡片原文（是**页面标题**就说明 WebKit 自己
  那套 now-playing 赢了）、有没有拖动条、是不是 ⏪10/⏩10、封面是不是空方块。
  **四样同时不对时是同一个病因**，分开看会当成四个 bug —— 这一轮就差点这么查。

**后台播放的验收怎么做（2026-08-24，播客模式 §9.5）。** 镜像的两条既有性质在这里
恰好变成工具：

- **「按 Home 退到后台」可以驱动**：镜像里回主屏，App 真的进后台，而镜像本身还在 ——
  所以「退后台 60 秒后还在不在播」这一段全程可自动化、可截图。
- **「关掉镜像窗口」就是锁屏**：手机回到自己的锁屏并熄屏。**这是唯一一个不可驱动的
  时刻**，所以被测的东西必须自己留下证据（页面里 append-only 的时间戳日志 +
  `localStorage`），重开镜像后一次读回来 —— 而不是指望有人盯着看。
- **锁屏卡片有一个可驱动的代理**：镜像会话里下拉**控制中心的 Now Playing 小组件**，
  它读的就是 `MPNowPlayingInfoCenter` 的同一份数据。真锁屏那一张请用户拍照。
- **一律用手机扬声器，不要蓝牙耳机。** 镜像占蓝牙，用 AirPods 会让「声音停了」分不清
  是后台策略还是耳机被抢走 —— 测的又变成了环境不是功能。

**还有两处会吃掉点击**：窗口底部约 70px 的悬浮条（既有结论），以及 App 切换器里的
横向滑动 —— 想「上滑关掉某个 App」时，合成的拖拽会变成横向翻卡，翻出用户的其它 App。
**真要杀进程请让用户自己动手**：在别人的手机上乱翻是隐私问题，不是操作问题。

**走 TestFlight 之前，三件事顺序不能错**（2026-08-23 各踩一次）：

1. **先 bump 版本，再 `build-safari.sh`。** `MARKETING_VERSION` 是生成工程时从
   `package.json` 写进 pbxproj 的。顺序反了，工程里还是旧版本号，而 `xcodebuild` 不会说
   什么 —— 归档出来的 Info.plist 仍是旧版，直到上传被 Apple 拒了才发现。
   版本是**两处**：`package.json` 与 `extension/manifest.json`，`build.js` 有漂移门会拦。
2. **已发布版本的 train 是关着的。** 同一个 `CFBundleShortVersionString` 不能再传新
   build（`Invalid Pre-Release Train … is closed for new build submissions`）。要传就必须
   进下一个版本号 —— 也就是说，**真机验收会顺带消耗一个版本号**，这也是它比 USB 贵的地方。
3. **`npm run verify:ios` 必须对着这一次的 `.xcarchive` 跑**：
   `npm run verify:ios -- /tmp/mt-ios.xcarchive`。不给参数它读的是 `/tmp/bt-dd` 里
   **上一次**的产物 —— 2026-08-23 它就这样对着两周前的旧 appex 报「少了
   `content/request-shape.js`」，而工程其实刚重新生成过、是好的。**假红和假绿同样致命**：
   同一个默认路径也可能让一个真的漏文件的包通过。

### 1.0 Provider matrix — every shipped engine must have been reached at least once

> **Every entry in `build/{providers,tts,stt}.config.js` that we ship must have been
> driven against its REAL endpoint at least once, and the result recorded in §1.0's
> table. An engine nobody has ever reached is an untested claim in the settings list.**

`build/model-params.config.js` (#159) inherits this rule with **one asymmetry that is
deliberate**, spelled out in the file's own header:

- A row saying a parameter **is** accepted (`true`) may come from vendor documentation.
  If it is wrong, we send the field, the server answers 400, and the user sees the
  server's own sentence. Visible, recoverable.
- A row saying a parameter is **not** accepted (`false`) must come from a **real
  server rejection**, with the sentence quoted in that row's `note`. If it is wrong,
  we silently stop sending a value the user set, and no server will ever complain
  about a field it did not receive. That failure has no reporter, so it needs evidence
  up front.

An undated 「能用」 still is not a verification. A `false` with no quoted rejection is
not one either.

**The ledger (#160).** `build/perf-ledger.config.js` records what was actually observed
per (host, model): baseline, every candidate tried, and the verdict. It exists because a
conclusion without its evidence rots into a docs excerpt — and because the three outcomes
must stay distinguishable:

| verdict | means | cost of not recording it |
|---|---|---|
| `adopted` | a better parameter was found and shipped | — |
| `rejected` | reached it; nothing worth writing (no gain, unstable, doesn't think) | the next person adds it back from vendor docs, undoing a measured decision |
| `unreachable` | no key / no balance / no usable model id | the gap is silently forgotten |
| `inferred` | not measured on this host; carries the conclusion from another domain of the **same vendor** | — |

**Inheritance is bounded by one rule** (#161): a conclusion may be carried from one host
to another **only when both hosts share a `model-params` row**. That test is exactly
equivalent to "same vendor, different domain" — the capability table already groups a
vendor's regional domains into one row and gives `openrouter.ai` a row of its own — so
gateway-to-first-party inheritance is structurally impossible, and no hand-maintained
gateway list exists to go stale.

Why gateways are excluded is measured, not assumed. The same `deepseek-v4-flash` thinks
278 tokens by default on `api.deepseek.com` (silenced by `thinking:{type:'disabled'}`)
and **zero** by default through `openrouter.ai`, where `reasoning:{effort:'low'}` *raises*
it to 78–233. Same model, two endpoints, opposite defaults — and the spellings are not
portable either (`api.openai.com` answers 400 `Unknown parameter` to all three of the
others' spellings). Two further limits: an `inferred` row may not descend from another
`inferred` row, and a measured row always displaces an inferred one for the same
(host, model).

`test/perf-ledger.test.js` locks the ledger to `model-params.config.js` in both
directions: a shipped parameter with no `adopted` evidence is red, and an `adopted`
measurement nobody shipped is red too. Adding a provider without any ledger row is red,
naming the engine and pointing at `/perf-tune`. CI has neither network nor keys, so the
gate checks that the measurement was recorded and landed — it cannot check that it was
done carefully. That is the right division: 2026-08-20's failure was not a careless
measurement, it was **no measurement at all**.

This matrix is **orthogonal to the surface matrix above**, and deliberately so. Which
provider answers, and whether we speak its wire format correctly, is a **transport**
property — it does not vary by device, so verifying it on all seven surfaces would be
7× the cost for zero extra information. The two rules compose like this:

- **Per surface (§1, every regression):** DeepSeek, per §0. It is the stable baseline;
  that rule is unchanged.
- **Per provider (§1.0, once per entry, and again whenever its transport changes):** one
  live call on any ONE surface, recorded below.

**A row is per (entry × flavor), not per entry.** `glm`, `qwen` and `kimi` ship
*different endpoints* in the china and global builds (`build/providers.config.js`), and
in at least the DashScope case a key issued for one region is not valid for the other.
Two endpoints are two things that can be broken; they are two rows. `deepseek` ships the
same endpoint in both flavors and is therefore one row.

**What a row's pass means** — all four, or it is not a pass:

1. The endpoint answered `200` and we extracted non-empty text/audio from its response
   shape (i.e. the `type`'s wire format is right, not merely that the host is up).
2. **The URL actually requested was the one intended.** Read it off the 「测试连接」
   result line, which echoes it (`options.js` `runTest`). This is the check that would
   have caught a mis-folded endpoint, and it costs one glance.
3. The failure paths are named, not raw: a wrong key gives `http 401/403` with the
   key hint, a wrong address gives something other than the bare CORS copy.
4. Recorded here with a date. An undated "works" is not a verification (§4).

**How the two brand-free custom entries are verified.** `custom_chat` / `custom_msg`
have no endpoint of their own — the thing under test is "user supplies a complete
endpoint URL of this wire shape, and we speak it".

Pointing `custom_chat` at an endpoint that ALSO ships as its own registry row (say
DeepSeek's) exercises the code path but proves almost nothing that row 4 does not
already prove: same host, same body, same response shape, and an address we ourselves
chose. The feature being claimed is different — **someone else's endpoint, whose path
convention we do not control**. So the driver for row 11 is a third-party aggregator:

> `custom_chat` → **OpenRouter**, `https://openrouter.ai/api/v1/chat/completions`
> (`base_chat_custom_chat` / `key_chat_custom_chat` in `.local/keys.md`; the model is
> a required field here — OpenRouter ids are namespaced, e.g. `openai/gpt-4o-mini`).

Why this one specifically: it is a real aggregator in front of many vendors, its path
is not any single vendor's, its model ids are not any single vendor's, and it is
reachable without a corporate network — so it is the row that actually stands behind
the sentence 「中转代理与自建服务都适用」 in the settings hint. It also exercises the
address→shape rule end to end: the suffix `/chat/completions` is what selects the
transport, and nothing in the registry names OpenRouter at all.

`custom_msg` still reuses any Messages-shaped endpoint we hold a key for (row 3).

**Self-hosted rows need a server, not a key.** `local` (TTS) needs any
`/v1/audio/speech`-shaped server; `local` (STT) has one in-repo already —
`scripts/dev-whisper-server.js` on `127.0.0.1:18790`. Both must be reached from the
surface under test, which on a real device means the Mac's LAN IP and a server that
**allows cross-origin requests** — without CORS, WebKit reports only a bare
`TypeError` and the run looks like "unreachable" (§9.4 of `learning-design.md`).

| # | Entry | Flavor | Wire format | Needs | Last verified |
|---|---|---|---|---|---|
| 1 | `google` | global | `google` | — (free endpoint, no key) | ❌ 未记录 |
| 2 | `openai` | global | `chat-compat` | OpenAI key | ❌ 未记录（key 在手） |
| 3 | `claude` | global | `messages-compat` | Anthropic key | ❌ **缺 key** |
| 4 | `deepseek` | global + china（同一端点） | `chat-compat` | DeepSeek key | ✅ 长期基线（§0） |
| 5 | `glm` | global (`api.z.ai`) | `chat-compat` | Z.ai key | ❌ **缺 key** |
| 6 | `glm` | china (`open.bigmodel.cn`) | `chat-compat` | 智谱 key | ❌ **缺 key** |
| 7 | `qwen` | global (`dashscope-intl`) | `chat-compat` | DashScope 国际版 key | ❌ **缺 key** |
| 8 | `qwen` | china (`dashscope`) | `chat-compat` | DashScope 国内版 key | ❌ **缺 key** |
| 9 | `kimi` | global (`api.moonshot.ai`) | `chat-compat` | Moonshot 海外 key | ❌ **缺 key** |
| 10 | `kimi` | china (`api.moonshot.cn`) | `chat-compat` | Moonshot 国内 key | ❌ **缺 key** |
| 11 | `custom_chat` | global + china | `chat-compat` | OpenRouter key（第三方中转，见上） | ✅ 2026-08-18 Chrome 真机（`qwen/qwen3.8-27b`；`/v1/chat/completions` 自检 3538ms + 整页翻译；**同 host 换 `/v1/responses` 后自检 10317ms 通过**，同一把 key，形状由后缀判定） |
| 12 | `custom_msg` | global + china | `messages-compat` | 需一个 Messages 形状端点 | ❌ **依赖第 3 行的 key** |
| 13 | `browser` (TTS) | global + china | `browser` | — (系统语音) | ✅ 随复习流程长期在跑 |
| 14 | `local` (TTS) | global + china | `speech-compat` | 自建 `/v1/audio/speech` 服务 | ❌ **缺服务** |
| 15 | `openai_speech` | global | `speech-compat` | OpenAI key | ✅ 已在用 |
| 16 | `local` (STT) | global + china | `transcribe-compat` | `scripts/dev-whisper-server.js` | ✅ M10 真机跑通 |
| 17 | `openai_transcribe` | global | `transcribe-compat` | OpenAI key | ✅ M10 真机跑通（1.3MB 音频） |
| 18 | `openrouter` | global | `chat-compat` | OpenRouter key | ✅ 2026-08-30 探针（`google/gemini-3.7-flash` 2162ms；11 个模型全通，见 §1.0 备注） |
| 19 | `openrouter_transcribe` | global | `transcribe-compat` | 同一把 OpenRouter key | ✅ 2026-08-30 探针（5 个模型逐字转对；`gpt-4o-mini-transcribe` 600ms/$0.000035） |
| 20 | `openrouter_speech` | global | `speech-compat` | 同一把 OpenRouter key | ✅ 2026-08-30 探针（`deepgram/aura-2` 692ms / 99884B；⚠ 声明 `audio/pcm` 实为 RIFF） |
| 21 | `openrouter_audio` | global | `speech-audio-chat` | 同一把 OpenRouter key | ✅ 2026-08-30 端到端（`openai/gpt-audio-mini` SSE→pcm16→WAV，1368ms / 108KB，transcript 逐字相符） |
| 22 | `qwen_asr` | china | `transcribe-dashscope` | 千问AI平台 key | ✅ 2026-08-30 端到端（base64 data URI，1036ms，转写正确） |
| 23 | `qwen_tts` | china | `speech-dashscope` | 同一把千问 key | ✅ 2026-08-30 端到端（两步：合成 1.7s → 取音频 0.15s，141KB WAV） |

> **⚠️ 以上 6 行都是「桌面 Node 走扩展代码路径」级别的实证，不是真机。** 三条新语音链路
> （`transcribe-dashscope` / `speech-dashscope` / `speech-audio-chat`）**一条都没在
> iOS / macOS 真机上跑过**：录音采集、WKWebView 的音频解码、`data:` URI 的大小上限
> 各有脾气，而 Node 里一个都测不到（混合内容策略就是这样漏掉的 —— 见 request-shape.js
> 里 http→https 那处注释）。发版前必须补全矩阵。


**这张表是活的**：注册表加一个条目就加一行（`node scripts/local-keys.js init` 会从注册表
重新生成本地凭证模板，不要手抄引擎清单）。一个条目在没有任何一行记录之前**不得出现在
出货的引擎列表里**——那是在向用户承诺一件我们从没试过的事。

**凭证从哪来**：`.local/keys.md`（`node scripts/local-keys.js init` 生成，在 `.gitignore`
里，永不提交）。每个需要 key 的条目在那里各占一个槽位——一个 `apiKey` 槽位只能验证一个
provider，逐条验证要求逐条填。

**Mandatory: desktop fullscreen playback with bilingual subtitles.** For any change
touching video subtitles, **entering native fullscreen on every desktop browser × every
video site is a required check** — the bilingual overlay must remain inside the
fullscreened player and keep advancing (and exiting fullscreen must restore it). This is
a **permanent matrix item** (per §0; it was a shipped x.com regression — overlay vanished
in fullscreen — so it is added forever):

| Desktop browser | YouTube fullscreen | x.com fullscreen | Podcast |
|---|---|---|---|
| macOS Safari | required | required | N/A (audio, no video) |
| macOS Chrome / Edge | required | required | N/A |
| Firefox | required | required | N/A |

**iOS (iPhone/iPad) fullscreen = N/A**: iOS uses the OS's *native* video-player
fullscreen (a system surface), which a DOM overlay cannot cover — a documented platform
limitation, **never** reported as passing. Verify iOS subtitles only in inline
(non-fullscreen) playback.

**Mandatory: the same-language skip, checked in BOTH directions.** The skip has a
browser-capability layer (`docs/domain-design.md` §5.3 — `chrome.i18n.detectLanguage`
exists on Chrome/Edge/Firefox, on no Safari), so the surfaces that *lack* it need a
check of their own. Testing only the rows where the feature fires would let a broken
probe — one that throws, or silently skips everything — ship to Safari unnoticed. This
is a **permanent matrix item** for any change touching the skip:

**Check the REQUEST, not the rendered line.** With an `en` target on an English paragraph
the DOM is byte-identical on every surface — a unit the engine skipped and a unit whose
echoed translation the renderer's identical-output backstop suppressed both render as
"no translation line". The only observable difference is whether the provider was
called. (Burned 2026-07-28: this table originally said Safari would "still get a
translation line"; it does not, and reading the DOM would have passed a broken detector.)

| Surface | Target `en`, long English paragraph | Target `zh-CN`, Chinese page |
|---|---|---|
| iPhone / iPad / macOS Safari | the paragraph **IS sent** to the provider (no detector — today's behaviour); no translation line is drawn either, and **no console error** mentioning `detectLanguage`. Measured on all three: macOS Safari 2026-07-28, iPhone (iOS 26.5) and iPad Air (iOS 17.2) 2026-07-28 via §1.1 | no translation lines, nothing sent (script layer, unchanged) |
| macOS Chrome / Edge | the paragraph is **NOT sent**; a French paragraph and a <60-letter English one still are | no translation lines (script layer — the detector must **not** be consulted) |
| Firefox | same as Chrome / Edge | same as Chrome / Edge |

**Mandatory: speech (TTS) is a per-surface expectation.** The on-device engine is
a browser capability, so per `docs/domain-design.md` §5.3.4 its per-surface behaviour
is named here rather than assumed:

| Surface | Expected |
|---|---|
| macOS Chrome / Edge · Firefox · macOS Safari | ▶ plays; autoplay on card open works |
| **iPhone / iPad Safari** | ▶ plays (verified 2026-08-03, iOS 17.2, 111 voices in the extension page). **Autoplay is REFUSED** — the card renders with the ▶ control enabled and nothing is spoken until tapped. This is expected; a run that reports iOS autoplay working is reporting a bug in the *test*, not a feature |

**Check that silence is reported as silence.** iOS drops `speechSynthesis.speak()`
without a gesture with no exception, no error event and no sound — so a test that
only asserts "speak() did not throw" passes over total silence. Assert on the
utterance's `start` event, or on the ▶ label flipping to its replay wording (which
only happens on a confirmed start).

**Mandatory: the learning layer (记忆层).** Permanent matrix item for any change
touching `content/learn-*.js`, `learn/**`, or the two capture attachment points
(`content-webpage.js` `renderUnit`, `subtitle-adapter.js` after `renderOverlay`). See
[`docs/learning-design.md`](learning-design.md).

Each row runs the same five steps, in order:

| # | Step | What proves it |
|---|---|---|
| 1 | **Non-interference** — translate a long article with capture **off**, then with capture **on** | Same unit count, same translation lines, no new console output. Domain-design §9.1 law 1 says translation must be *byte-for-byte* identical; a screenshot pair is the minimum, a DOM unit-count comparison is better |
| 2 | **Capture** — read 2–3 paragraphs for >3 s each, scroll past others fast | Only the dwelled ones appear in the review page. **The fast-scrolled ones must be absent** — that is the assertion that matters, and it is invisible unless you look for it |
| 3 | **Review** — open the review page, complete one full grading round | Cards render, all four grades present, source link resolves back to the page |
| 4 | **Persistence** — quit the browser / kill the app, reopen, open the review page | Scheduling state survived. On iOS this is also the only real check that a dead service worker did not take the corpus with it |
| 5 | **Origin isolation** — on the host page, evaluate `indexedDB.databases()` | **`mt-learn` must NOT be there.** The corpus lives in the extension origin; if it shows up under the host page, laws in domain-design §9.3 are broken and the user's reading history is readable by every site |

**Video cards must be verified during real playback** (§4): capture from a YouTube
video requires the playhead to actually cross the sentence, so a paused player
captures nothing — a run that "looked fine" without ≥20–30 s of playback has verified
nothing about subtitle capture.

**iOS rows:** `xcrun simctl erase` is still the only thing that refreshes content
scripts (§1.1), and any instrumentation must ship a build marker. Purge the `tr:`
cache *and* the `lq:` outbox between runs, or a previous run's captures will be
mistaken for this one's.

### 1.1 Request-level checks on the iOS simulators — the working recipe

**Achieved 2026-07-28.** An earlier note here claimed this was impossible because
simulator text entry is broken. The text entry *is* broken — cua-driver's synthesized
keystrokes arrive mangled (`http://127.0.0.1:8788` became `Aaaaaaaa…`, then `Vfff`),
`⌘V` types a literal "V" even after `xcrun simctl pbcopy`, and `⇧⌘K` does not restore
host-key delivery. But typing was never actually required: **stop configuring the app
and configure the build.**

1. Copy `dist/` to a throwaway dir and instrument the COPY only — never the repo:
   - `content/providers.gen.js` → point the provider's `defaultEndpoint` at a local
     logging endpoint. Leaving 自定义 API 地址 empty then resolves to it, no typing.
   - `background.js` `DEFAULT_SETTINGS` → preset `targetLang` / `provider` / `apiKey`.
   - `content/translation-api.js` → `apiKey = apiKey || '<key>'`, because storage may
     already hold an empty key and `onInstalled` only fills **absent** keys.
2. `xcrun safari-web-extension-converter <throwaway-dist> --ios-only --copy-resources`,
   build with `CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO`, `simctl install`.
3. Enable the extension (page menu → 管理扩展 → toggle) and grant host access. Both are
   taps; the target-language and engine pickers are taps too. Only free text is broken.
4. Read the endpoint's log for which texts were sent.

**⚠️ `simctl install` does NOT refresh the extension's content scripts.** Reinstalling
the host app, terminating Safari, and rebooting the simulator all left the PREVIOUS
build's scripts running — with a correct new bundle verifiably on disk
(`simctl get_app_container` + grep confirmed it). Only **`xcrun simctl erase`** picked
up the new resources. Budget for that: erase wipes extension enablement, host
permission and all settings, so plan to re-grant afterwards.

**⚠️ Ship a build marker with any instrumented build.** Without one you cannot tell
"instrumented build running" from "stale copy", and every downstream reading is
uninterpretable. A fixed banner painted by a content script works:

```js
var b = document.createElement('div');
b.textContent = 'BUILD=instrumented base=' + provider.defaultEndpoint;
b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b00;color:#fff';
(document.body || document.documentElement).appendChild(b);
```

Paint it **immediately** — content scripts run at `document_idle`, so a
`DOMContentLoaded` listener never fires and the marker silently never appears. That
false negative cost an incorrect "Safari is serving stale scripts" conclusion.
Note the banner is itself page text, so it shows up as a translatable unit in the log.

**How to see the requests.** Chrome exposes them over CDP `Network.requestWillBeSent`.
Firefox's BiDi `network.beforeRequestSent` proved **unreliable** (a run that demonstrably
translated reported zero requests) — do not trust it; and Safari has no such channel at
all. The portable instrument is to point 自定义 API 地址 at a local Chat-Completions-shaped
endpoint that logs each text and answers with a marked echo, so "was it sent" becomes
both logged and visible in the page. Always assert a **positive control** (a text you
know was translated must appear in the log); without one, "no request seen" is
indistinguishable from "I could not see".

**Purge the translation cache between runs.** It is keyed `tr:{provider}:{lang}:{text}`
with a 12h TTL, so a rerun serves the previous run's answers and issues no requests at
all — which reads as "the skip fired" for every paragraph. Either clear the `tr:` keys or
weave a per-load nonce into every paragraph of the fixture.

**And on all five rows**: set the target to something other than `zh-CN` (e.g. `ja`) and
play a subtitled video — the subtitle path must honour that target. It previously froze
to `DEFAULT_TARGET_LANG` at construction regardless of settings.

> **Measured in real content scripts (2026-07-27), keep for the next person.** Chrome:
> `chrome.i18n` exposes `detectLanguage`, returns a Promise *and* fires a callback.
> Firefox: `detectLanguage` is present but **callback-only** — it returns `undefined`,
> so a promise-only implementation never resolves there. The same English paragraph
> scores 100% on Chrome and **99%** on Firefox, which is why the confidence gate sits at
> 90 rather than 100. Neither of these is guessable from the compat tables; re-measure
> rather than assume if the wrapper is rewritten.

---

## 2. Per-surface build → install → enable → open-URL → drive

### 2.0 一台机器上只能装一份大肚猴翻译 —— 国际版与中国版**不可并存**

任何浏览器上，**同一时刻只允许安装一份**大肚猴翻译。国际版和中国版是两个 bundle id
（`com.belliedmonkeytranslator` / `…​.cn`），系统允许它们同时存在，但**我们的验证不允许**：
测完一个，**卸载**，再装另一个。

不是「建议先关掉另一个」——是**卸载**。关掉的那一份仍然出现在扩展列表里、仍然参与
LaunchServices 的注册竞争，于是「跑的是哪一份」这个最基本的问题就没有确定答案，
而验证的全部价值就建立在这个答案上。

**这条规矩是被违反出来的**（2026-08-21）：为了同时验四条线，两个版本被同时装进
一台 iPhone 和一台 Mac，结果：

- macOS Safari 的扩展列表里出现 **4 条同名「大肚猴翻译」**（还有历史副本掺进来），
  AX 树只给 bundle id、不给版本号，无法分辨哪条对应哪个包；
- iPhone 上两份并存、一开一关，随后出现**部分标签页翻译卡在「翻译中…」不动**，
  而同一时刻新开的页面翻译正常 —— 排查时无法排除「另一份的残留状态」这个变量。

**执行判据**（每个宿主一条，先读再动手）：

```bash
# macOS：认的是哪一份，只信这一行的版本号（不是「App 起来了」）
pluginkit -m -p com.apple.Safari.web-extension | grep -i belliedmonkey
# 期望：**恰好一行**

# iPhone：设置 → App → Safari浏览器 → 扩展
# 期望：「大肚猴翻译」**恰好一条**（不是「一条打开一条关闭」）
```

出现两条 ⇒ **先卸载多余的那一份再开始验证**，这一轮此前的观测全部作废。

Shared first step for all Safari surfaces:

```bash
node build.js            # → dist/
# Regenerate the Xcode project WITH macOS targets — do NOT use --ios-only:
xcrun safari-web-extension-converter dist \
  --app-name "BelliedMonkey Translator" \
  --bundle-identifier com.belliedmonkeytranslator \
  --project-location /tmp/mt-safari --force --no-open --no-prompt
```

Confirmed generated schemes: **`BelliedMonkey Translator (iOS)`** and
**`BelliedMonkey Translator (macOS)`**.

> **更正（2026-08-22）**：这里原来写着「`build-safari.sh` 传 `--ios-only`，所以不要用它
> 跑全矩阵」。**那句话已经不成立** —— 脚本现在 `CONVERTER_PLATFORM=""`，一个 flavor 出
> 的就是一棵双平台树（`Shared (App)` / `iOS (App)` / `macOS (App)`），而 `app:sync` 的
> 六个补丁全按双平台布局写死。所以全矩阵**应该**用 `build-safari.sh`，
> 不该再手敲上面那条 converter 命令。发布路径见 `/store-release`。

### A. iPhone Safari (Xcode Simulator) — ✅ verified

```bash
xcodebuild -project "/tmp/mt-safari/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj" \
  -scheme "BelliedMonkey Translator (iOS)" -sdk iphonesimulator \
  -configuration Debug -derivedDataPath /tmp/mt-dd CODE_SIGNING_ALLOWED=NO build
APP="/tmp/mt-dd/Build/Products/Debug-iphonesimulator/BelliedMonkey Translator.app"
xcrun simctl install <iPhone-UDID> "$APP"
xcrun simctl launch  <iPhone-UDID> com.belliedmonkeytranslator   # container shows "turn on in Settings"
xcrun simctl openurl <iPhone-UDID> "<test-url>"
```

Enable (once per fresh install; cua-driver AX clicks): Settings → `Safari浏览器` → `扩展`
→ the extension row → **允许扩展** ON → per-site permission → **始终允许 → 在此网站上始终允许**,
then terminate + reopen Safari. **Per-site grant resets to "ask" on a fresh install** —
until granted, content scripts silently don't inject (no FAB); this masquerades as a
code bug. (A reinstall sometimes *preserves* the toggle+grant — environment-dependent.)

Drive: `xcrun simctl io <UDID> screenshot x.png` to view cheaply; the FAB/overlay are
**web content, not AX-bridged** → locate them in a `get_window_state` window screenshot
and **pixel-click**. Record time-based behavior: `xcrun simctl io <UDID> recordVideo out.mov`.

> **不要在模拟器里打字或滚动 —— 直接写扩展存储。**（2026-09-04 全矩阵实测）
>
> 这一轮 cua 对模拟器窗口的 AX 全程解析不到（`ax_window_unresolved`），后果是：
> **像素点击照常работа，但 `type_text` 一个字符都进不去、`scroll` 与 `drag` 都不滚页**。
> 长按也调不出「粘贴」菜单，`ios-sim-input-only-longpress-paste` 那条配方在这个状态下
> 整条失效。绕过去的办法不是重试，是**换一个面**：
>
> ```bash
> DB=$(find ~/Library/Developer/CoreSimulator/Devices/<UDID>/data/Containers/Data/Application \
>       -path '*Safari/WebExtensions*' -name 'local.db' | head -1)
> sqlite3 "$DB" "select key, value from extension_storage;"   # 就是 chrome.storage.local
> ```
>
> 表是 `extension_storage(key TEXT PRIMARY KEY, value TEXT)`，value 是 **JSON**
> （字符串带引号）。写完 **terminate + relaunch Safari** 才会被读到。
> 两个前置条件：**扩展先在设置里启用过**（否则这个库根本不存在），
> 且目录名带团队 id（`com.belliedmonkeytranslator.extension (X2Q85MABWK)`）——
> 旁边可能还躺着一个 `(UNSIGNED)` 的旧安装，别写错那个。
>
> 顺带：这个库也是**回读本机默认值**最便宜的地方。2026-09-04 就是在这里读到
> `ttsEngine=""` · `ttsMode="off"` · `sttEngine=""`，一次 sqlite 查询顶一屏截图。
>
> 页面太长看不全时，用 Safari 自己的**「大小」→「小」**缩到 50%（下限），
> 比试图滚动可靠 —— 但 50% 仍装不下整个设置页，够不到的那几段要另找判据。

### B. iPad Safari (Xcode Simulator) — ✅ verified

**Same iOS build**, different simulator UDID. `xcrun simctl install <iPad-UDID> "$APP"`
→ launch → openurl → drive. iPad Safari uses the **desktop-layout** (two-column) page;
the FAB injects at the bottom-right of the content column. Enable path is the same
Settings → Safari → 扩展 flow (its split-view Settings layout differs from iPhone — map
AX tokens fresh).

### C. macOS Safari (real Mac, sandboxed) — ⚠️ version-sensitive

**Snapshot first** (for restore): `cp ~/Library/Preferences/com.apple.Safari.plist <backup>`
and note whether the **Develop (开发)** menu is already visible. Then:

```bash
xcodebuild -project "/tmp/mt-safari/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj" \
  -scheme "BelliedMonkey Translator (macOS)" -sdk macosx \
  -configuration Debug -derivedDataPath /tmp/mt-dd-mac CODE_SIGNING_ALLOWED=NO build
open "/tmp/mt-dd-mac/Build/Products/Debug/BelliedMonkey Translator.app"   # registers the extension
```

**Critical (verified 2026-07-11, macOS 26.5.1):** a build made with
`CODE_SIGNING_ALLOWED=NO` (or merely `codesign -s -` ad-hoc) does **NOT** register with
pluginkit/LaunchServices, so it **never appears in Settings → 扩展** — even after enabling
"允许未签名的扩展", even copied to `~/Applications` + `lsregister -f` + ad-hoc signed.
(Confirmed: the working extensions 1Password / 沉浸式翻译 DO show in `pluginkit -m`; ours
never does.) "允许未签名的扩展" governs Safari *loading*, not pluginkit *registration*.

So there are two real paths for macOS Safari — **prefer the first**:

- **(A) Recommended — side-load `dist/` unpacked, no Xcode:** Safari → Settings (`⌘,`) →
  **开发者 (Developer)** tab → check **允许未签名的扩展 (Allow Unsigned Extensions)** →
  **添加临时扩展… (Add Temporary Extension)**. Its prompt is *"选取包含扩展资源的文件夹或
  归档"* — it loads an **unpacked folder with `manifest.json`, like Chrome's Load
  Unpacked**, so you point it straight at **`dist/`**. No `xcodebuild (macOS)`, no signing.
  It loads as a *temporary* extension (auto-cleared on Safari quit → self-cleaning for
  verification). On macOS 26 the "允许未签名的扩展" toggle lives on this **开发者** Settings
  tab (on macOS ≤ 15 it's Develop menu → 允许未签名的扩展). **Session-scoped on every macOS
  version, 26 included — see the password/persistence note below.** Then grant host
  access **在每个网站上始终允许**, open the test URL, drive the FAB by pixel-click.

  **⚠️ Update semantics — the temporary extension is a SNAPSHOT (verified 2026-07-12).**
  Unlike Chrome (Load-Unpacked / CDP `Extensions.loadUnpacked` read from the `dist/` path,
  so rebuild + page reload runs new code), Safari **copies the folder at add-time**:
  - Rebuilding `dist/` does **NOT** update the loaded temporary extension — page reloads
    keep running the old snapshot. (Verified live: after a fix was built, Safari still
    reproduced the pre-fix bug on a fresh page load while Chrome and the iOS sims ran the
    new code — a stale snapshot masquerades as "fix didn't work", or worse, silently
    passes a regression check against the OLD build.)
  - The snapshot survives page loads and window closes while Safari stays running; it is
    cleared only when Safari quits.
  - **After re-adding, RELOAD the test page (⌘R) before observing.** An already-open tab
    keeps running the PREVIOUS injection's content scripts — and keeps their injected DOM
    artifacts — so observing it says nothing about the newly added build (burned
    2026-07-12: a playing tab predating the re-add still showed the old bug signature).
  - **Never let TWO copies of the extension be loaded at once (burned 2026-07-12).**
    Re-adding does not replace the previous temporary extension — both stay installed,
    each injecting content scripts into a **separate isolated world** (the
    `window.__mtMainLoaded` double-init guard cannot dedupe across worlds). Symptom: the
    two instances FIGHT — the inactive one removes the 译 button every tick while the
    active one re-creates it → **the button visibly blinks**; fixed-position FABs stack
    invisibly. Before verifying, Settings → 扩展 must show exactly ONE copy; the
    deterministic reset is **quit Safari (clears all temp extensions) → reopen → add
    once**.
  - **Rule: after EVERY `node build.js`, re-add the temporary extension** (开发者 →
    添加临时扩展 → `dist/`) before verifying anything on macOS Safari — treat "re-add" as
    part of the build step for this surface. Before trusting a Safari result, confirm the
    loaded code is current (e.g. check a marker introduced by the change under test via
    Web Inspector, such as an attribute or log the new build emits).
  - **⚠️ Multiple `dist/` folders exist — verify the PATH picked in the file dialog
    (burned 2026-07-12).** The main checkout (`~/mobiletranslator/dist`, built from
    `main`) and each git worktree (`…/.claude/worktrees/<name>/dist`, built from the
    feature branch) all have a `dist/`, plus `dist-china/` / `dist-firefox/`. A re-add
    that picks the WRONG dist silently loads code without the change under test — the
    symptom looks exactly like "the fix doesn't work on Safari". Before re-adding, state
    the **absolute path** of the dist being verified and confirm its freshness
    (`ls -la <dist>/content/<changed-file>` mtime, or grep the fix marker in the file).
- **(B) Signed app path:** build the `(macOS)` scheme **with a real Apple Development
  signing identity** (not `CODE_SIGNING_ALLOWED=NO`), `open` the container so it registers,
  then it appears in Settings → 扩展 → enable + grant host.

  - **⚠️ 允许未签名的扩展 needs the user's macOS PASSWORD (2026-07-27).** Ticking it raises a
    system authorization prompt ("Safari浏览器正尝试允许未签名的扩展"). An agent must not type
    it — hand this step to the user together with the folder pick, in ONE ask, so they are
    interrupted once rather than twice. `defaults write com.apple.Safari
    AllowUnsignedAppExtensions` is **not** a way around it: Safari's prefs live in a
    sandboxed container and the write fails outright without Full Disk Access.
  - **⚠️ That authorization is SESSION-SCOPED — it does NOT persist (corrected 2026-07-28,
    macOS 26.5.1).** The checkbox is clear again after every Safari quit and the password
    prompt returns. So **once the user has authorized, do not quit Safari** for the rest of
    the run — quitting throws their authorization away and costs them a second interruption
    for nothing. (Burned 2026-07-28: quitting to force a clean snapshot did exactly that.)
    This supersedes the earlier "once granted the setting persists".
  - **⚠️ Do NOT use the extension detail pane's 重新载入 to pick up a rebuild (2026-07-27).**
    It left the extension loaded but inert — the FAB injected and no unit ever translated.
    (Re-confirmed 2026-07-28: after 重新载入 the extension's own options page renders blank
    and a ⌘R does not revive it — its old UUID is dead.) To load a fresh build **without
    quitting**, use 卸载 then 添加临时扩展 again; reserve quit → reopen for when no
    authorization is at stake.
  - **⚠️ An off-screen Safari window screenshots BLANK — that is a capture artifact, not a
    bug (2026-07-27).** `list_windows` reporting `is_on_screen: false` while the title is
    correct means the capture will be empty white; `bring_to_front` first. Cost an
    incorrect "the extension broke the page" conclusion.
  - **⚠️ 加临时扩展之前先清空「已安装」里的同名扩展（2026-09-05）。** 每一次
    `open` 一个本地 Debug 构建的宿主 App，Safari 就多注册一份扩展条目；这一轮跑完
    矩阵后设置里躺着**四份**「大肚猴翻译」，而且**全部勾着** —— 正是上面那条
    「两份同时加载会打架」的形状，只是更糟。`pluginkit -m` 看不到它们（Debug 构建
    本来就不注册到 pluginkit），所以**判据是 Safari 设置 → 扩展这个列表本身**，
    不是 pluginkit。清理要连**磁盘上的 App 副本**一起删（`/tmp/mt-dd-*/…/*.app`），
    否则下次 `open` 它又回来了。
  - **原生 `<select>`：用首字母跳转，别用方向键（2026-09-05）。** 每一次
    `press_key(down)` 都会把下拉重新打开，净位移不等于按键次数（实测「按 3 次 ↓
    + 回车」只移动了一格）。按目标项的**首字母**（DeepSeek → `d`）一次到位。
  - **⌘V 在 Safari 网页里也被吞，但 `type_text` 可用（2026-09-05）。** 与
    `macos-webview-input-unreliable` 记的宿主 App 情况不同：这里 `type_text` 把
    35 字符的 API key 一字不差地打进去了（判据不是看框里的圆点数，是**点「测试连接」
    让服务端回读** —— 它返回 200 就证明没有字符错位）。

**Restore after:** if you enabled "允许未签名的扩展", uncheck it; remove any temporary
extension / app copy; return Develop-menu visibility to its snapshotted state.

> **Verified 2026-07-12 (macOS 26.5.1) ✅:** path A works end-to-end. Confirmed the
> unsigned/ad-hoc build won't register (path A required); 允许未签名的扩展 + 添加临时扩展 →
> `dist/` loaded (folder selection in the Open panel was done by hand — its ⌘⇧G/keyboard
> navigation resists the automation layer under multi-app focus contention; ~10s manual
> step, everything else scriptable). On `latent.space/p/modal2026`: FAB injected; a
> **foreground-delivery pixel click** (background click did NOT land on Safari web content —
> escalate per the click ladder) turned translation on → full-page bilingual render (title,
> description, in-player title) + the 译 podcast control. Screenshot captured. Reproduces the
> same cross-surface podcast bugs (duplicate 字幕加载中 loaders, sidebar translation
> overflowing its card).

**Dead end — safaridriver CANNOT load extensions (probed live 2026-07-12, Safari 26.5).**
Do not attempt a Chrome-style automated load via safaridriver; three-way evidence:
1. **Classic protocol:** the man page documents no extension capability, and a session
   created with every plausible key (`safari:extensions`, `safari:loadExtension`,
   `safari:webExtensions`, `webextension:path`, `safari:enableExtensions` → all pointing at
   `dist/`) navigated to the test page with **no FAB, zero extension nodes**. (safaridriver
   echoes back ALL requested capability keys, known or not — echo ≠ recognized.)
2. **WebDriver BiDi:** supported, but the standard `webExtension.install` command's domain
   does not exist — *"'webExtension' domain was not found"*. Available BiDi domains are only
   `session`, `browsingContext`, `script`, `browser`, `storage` (no private extension domain
   either: `extensions`/`safariExtensions`/`safari`/`permissions` all absent).
3. WebDriver sessions run in an isolated automation profile where extensions are off anyway.

Useful safaridriver facts discovered for OTHER purposes: enabling needs Settings → 开发者 →
**允许远程自动化** (or `safaridriver --enable`, needs sudo); **BiDi socket is gated behind the
undocumented capability `safari:experimentalWebSocketUrl: true`** (with `webSocketUrl: true`;
response then carries a real `ws://127.0.0.1:<port>/session/<id>` URL); safaridriver can also
target **iOS simulators** (`platformName: iOS`, `safari:useSimulator`, `safari:deviceUDID`) —
possibly useful for scripted page-level checks on the sim rows, untested with extensions.

### D. macOS Chrome / Edge (real Mac, throwaway profile) — ⚠️

**Critical (verified 2026-07-11, Chrome 150):** modern Chrome (since ~v137) **disables the
`--load-extension` command-line switch by default** (`DisableLoadExtensionCommandLineSwitch`),
so a throwaway `--user-data-dir --load-extension=dist` launch **silently does not load the
extension** — content scripts never inject (verified via CDP: no extension execution
context, `#mt-fab` absent on both latent.space AND example.com). `--disable-features=
DisableLoadExtensionCommandLineSwitch` did **not** re-enable it on Chrome 150. This is a
**harness limitation, not an extension defect** (the same `dist/` injects fine on iOS/iPad
Safari).

**⚠️ Rebuilding `dist/` is NOT enough — reload the extension (burned 2026-07-26, twice).**
An already-loaded unpacked extension keeps serving the content scripts it loaded with;
a page reload runs the OLD code. Symptom: you rebuild with a fix, reload the tab, the bug
is still there, and you conclude the fix does not work. On a **long-lived** Chrome
(`chrome://extensions` → the extension's ⟳ **reload** icon) this is mandatory after every
`node build.js`; then reload the page. **Firefox has the same trap** (§2.E:
`about:debugging` → **重载 / Reload** on the temporary add-on, then reload the page) — and
Safari's temporary extension is worse still, being a snapshot (§2.C). Only the throwaway
CDP flow below is exempt, because it loads the extension fresh each run.

**Recommended — CDP `Extensions.loadUnpacked` (no GUI, no CLI flag):** launch a throwaway
profile with only `--remote-debugging-port`, then load the extension over the browser-level
CDP endpoint. This bypasses **both** the `--load-extension` block **and** the GUI file-picker:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PROF" --no-first-run --no-default-browser-check \
  --remote-debugging-port=9225 "chrome://newtab/" &
# browser WS endpoint from http://localhost:9225/json/version → call:
#   Extensions.loadUnpacked  {path: "<abs path to dist>"}   → returns {id}
# then open the test URL and eval  !!document.querySelector('#mt-fab')
```

Alternatives if you prefer: `chrome://extensions` → Developer mode → **Load unpacked** →
`dist/` (GUI, has the file-picker keyboard-nav caveat); or **Chrome for Testing**
(`npx @puppeteer/browsers install chrome`), whose automation build still honors
`--load-extension`. A fresh Chrome may show its *own* Google-Translate bubble — unrelated;
don't mistake it for the extension.

**⚠️ Chrome unpacked extensions CACHE the loaded build (burned 2026-07-12).** Same trap
class as the Safari temp-extension snapshot: rebuilding `dist/` on disk does NOT update an
already-loaded unpacked extension in a long-running Chrome (the daily browser, not a
throwaway). **After every `node build.js`: `chrome://extensions` → click the extension
card's reload (⟳) → then RELOAD the test page** (existing tabs keep the previous
injection's scripts). A stale cached build reproduces already-fixed bugs and reads exactly
as "the fix doesn't work" — verified live: on the user's real Chrome, the pre-reload build
flashed on 3/3 body clicks (whole-page translations vanish/return, ~194k px A→B→A on the
display recording); after ⟳ + page reload, the same tab showed 0/3. Before trusting a
result from a persistent Chrome profile, confirm the loaded code is current (reload ⟳ is
cheap — just do it).

> **Verified 2026-07-11 (Chrome 150) ✅:** loaded `dist/` via `Extensions.loadUnpacked`,
> opened `latent.space/p/modal2026` → FAB present (`title:开启翻译`); clicking it → `关闭翻译`
> and **11 `.mt-translation` lines** rendered (e.g. "潜在空间：人工智能工程师播客", title →
> "为什么 AI 基础设施必须发展以提供座席体验 —…"). Screenshot captured. **Chrome surface works.**
> It also reproduces the same podcast-overlay bugs as iOS/iPad (duplicate "字幕加载中…"
> loaders floating over the article). Cleanup: `pkill -f "$PROF"; rm -rf "$PROF"` + remove any
> staged `dist/` copy.

### E. Firefox desktop (real Mac, throwaway profile) — ✅ verified

```bash
node build.js firefox        # → dist-firefox/ (MV3, gecko id set)
npx --yes web-ext run --source-dir dist-firefox \
  --firefox /Applications/Firefox.app/Contents/MacOS/firefox \
  --profile-create-if-missing --keep-profile-changes \
  -p "$HOME/.mt-verify-firefox" \
  --start-url "<test-url>" --no-config-discovery
```

> **驱动扩展自己的页面（options / onboard）—— 2026-09-04 首次跑通，三个坑**
>
> 上面这条配方验的是**内容脚本**那一面（FAB、整页双语），那些是普通网页，BiDi 直接
> 能开。**扩展自己的页面不行**，要另一套做法：
>
> 1. **`--args` 必须合成一个 argv token**：`--args=--remote-debugging-port=9333`。
>    分开写会被 web-ext 的 yargs 当成它自己的参数（实测报「无法识别这些选项」）。
> 2. **Firefox 的 BiDi 没有 CDP 那套 `/json/version` 发现端点**（实测 404）。
>    WebSocket 直接在 `ws://127.0.0.1:<port>/session` 上，握手就是 `session.new`。
> 3. **BiDi 拒绝把内容标签页导航到 `moz-extension://`** ——
>    实测报 `Navigation to "moz-extension://…" is not allowed in this context`。
>    **出路是跑两趟**：UUID 在同一个 profile 里是稳定的（存在 `prefs.js` 的
>    `extensions.webextensions.uuids`），所以第一趟只为把它写进去，第二趟用
>    `--start-url <那个地址>` 让 **Firefox 自己打开**，BiDi 只负责读、不负责导航。
>
> 还有一条进程卫生：**web-ext 把 Firefox 起成孙进程**，`child.kill()` 杀不到它，
> 上一轮残留的 Firefox 会一直占着 BiDi session，下一轮 `session.new` 直接报
> 「Maximum number of active sessions」。启动前和收尾都要按端口特征 `pkill` 一次。

**Use a PERSISTENT profile, not the default throwaway one.** §0 requires DeepSeek, and
the API key lives in extension storage — a throwaway profile wipes it on every quit, so
each run would need the key re-entered by hand. `--profile-create-if-missing
--keep-profile-changes -p <dir>` keeps the key (and the granted permissions) across
runs. The profile dir is outside the repo and holds only the key, so it never reaches
git; delete it to reset. This is still fully sandboxed — it is NOT the daily browser
profile.

`web-ext run` (Mozilla's official tool, npx-fetched — not a repo dependency) launches a
**fresh throwaway profile** with the add-on temporarily installed (auto-clears on quit;
it live-references `dist-firefox/`, and about:debugging has a per-extension **Reload**
button — friendlier than Safari's snapshot semantics).

**⚠️ A PENDING Firefox update blocks this row entirely (2026-07-27).** If an update is
staged under `~/Library/Caches/Mozilla/updates/Applications/Firefox/updates/0/`
(`update.mar` present), every launch hands off to `org.mozilla.updater`, which then waits
for **all** Firefox instances to quit — so the daily browser being open leaves it spinning
forever and `web-ext` dies with `ECONNREFUSED` on its debugger port. It looks like a
web-ext/harness failure and is not. `--pref app.update.*=false` does **not** help: the
staged update is applied by the launcher before prefs are read. Check first:

```bash
ls ~/Library/Caches/Mozilla/updates/Applications/Firefox/updates/0/update.mar 2>/dev/null
pgrep -x firefox; pgrep -f org.mozilla.updater
```

The fix is the user's call, not the agent's — ask them to quit Firefox so the update
applies (they get the security update and it stops recurring). Moving the staged update
aside works too but touches their update cache, so it needs explicit consent.

**⚠️ That Reload button is mandatory, not optional (burned 2026-07-26).** Like Chrome
(§2.D), a loaded add-on keeps serving the content scripts it started with: after
`node build.js firefox` you must hit **重载 / Reload** on the add-on in
`about:debugging`, *then* load the page — otherwise you are testing the previous build
and will wrongly conclude the fix failed. **A logged-in session is a reason to prefer
the real profile over `web-ext run`:** the throwaway profile has no cookies, so for a
login-gated site load the temporary add-on into your normal Firefox instead
(`about:debugging` → 临时载入附加组件 → `dist-firefox/manifest.json`; it still
auto-clears when Firefox quits). Manual alternative:
`about:debugging#/runtime/this-firefox` → 临时载入附加组件 → `dist-firefox/manifest.json`.

Drive/verify over **WebDriver BiDi** (Firefox ≥129 removed CDP): raw WebSocket at
`ws://127.0.0.1:<port>/session` → `session.new` → `browsingContext.getTree` →
`script.evaluate` for DOM assertions, `input.performActions` for TRUSTED clicks,
`browsingContext.captureScreenshot` for pixel-diff evidence.
**Gotcha: Firefox allows exactly ONE BiDi session and does not reap it promptly when the
socket closes** — "Maximum number of active sessions" on reconnect. Do the ENTIRE
verification in one connection, or restart web-ext between attempts.

> **Verified 2026-07-12 (Firefox 152.0.5) ✅:** FAB injects; FAB on → page bilingual (8
> units incl. sidebar); podcast playback (spec §4 playback rule) → overlay exactly 2
> clean pilled lines, 0 `.mt-translation` / 0 `data-mt-processed` inside, live pair
> advancing ("That this was your natural choice." / "这是你自然的选择。"); trusted click
> on body text → **0 changed px** across before/+150ms/+500ms/+1.7s screenshots (overlay
> band masked). Screenshot captured. Firefox is fully adapted.

### Stage 2 spike — what the app's `WKWebView` can actually do (2026-08-07)

`ViewController.swift` uses `loadFileURL`, so the whole learning UI would run on a
**`file://` origin**. Everything the corpus and sync need is a platform capability
there, and §5.3 forbids basing a baseline on an unverified one — so it was measured on
all three surfaces before any app code was written. **Identical on all three:**

| | macOS | iOS 17.2 | iOS 26.5 |
|---|---|---|---|
| `isSecureContext` | ✅ true | ✅ | ✅ |
| `indexedDB` (write + read back) | ✅ | ✅ | ✅ |
| `crypto.subtle` / `CompressionStream` | ✅ | ✅ | ✅ |
| `fetch` → Supabase auth / rest | ✅ 200 | ✅ 200 | ✅ 200 |

Two results worth keeping, because both are the opposite of the safe assumption:

- **`file://` is a secure context here.** In a browser it is not, which is exactly why
  `domain-design` §9.3 has content scripts using FNV-1a instead of `crypto.subtle`.
  The app is not under that constraint.
- **CORS does not block Supabase**, despite a `file://` page sending `Origin: null`.
  A custom `WKURLSchemeHandler` to manufacture a real origin — the obvious fallback —
  is **not needed**.

So the app needs **no Swift for capabilities**. The only Swift change Stage 2 requires
is `isScrollEnabled = false` on iOS, which exists to keep the converter's one-screen
template from bouncing and would trap a scrolling review list.

> **Measuring this cost one wrong turn worth recording:** the first iOS run reported
> the *previous* `Main.html`. Xcode's incremental build had not re-copied the changed
> resource, and the app came up looking fine — a stale-resource result that reads
> exactly like a real one. `rm -rf` the derivedData before believing an app-resource
> measurement. (Related to, but distinct from, the ios-sim issue where *new* files
> never enter the bundle at all.)

### F. iOS host app (Xcode Simulator) — ✅ Stage 2 + 3 verified 2026-08-07

**Stage 3 (review in the app).** iPhone 17 Pro · iOS 26.5, continuing from the Stage 2
corpus: 开始复习 → a real card (`en.wikipedia.org · Forgetting curve`, synced from a
browser) → 显示译文 → 记得 → 待复习 1→0, 「下一张卡片约 6 小时后到期」,「本次完成 1
张」 → terminate + relaunch → **schedule still there**. The review surface is the
extension's own `review.js` / `review.html` / `review.css`, inlined at build time.

> **The bug inlining creates, found by screenshot on the first build: id collisions.**
> Both documents were written as whole pages, each free to use any id. Merged, a
> duplicate is not an error anywhere — `getElementById` returns the first match — so
> `review.js` wrote its counts into the app shell's `#counts` and the app's card
> totals silently vanished. `build/app-bundle.js` now **fails the build** on any
> clash, and the app shell is the side that renames (`review.html` is shared source).
> The DOM assertions in `test:app` could not see this: they use `getElementById` too,
> which is exactly what the collision fools.

**Push-back verified the same session.** The grade given above was still local; with
`doSync()` switched from `pull()` to `sync()` it uploaded as **「已上传 1 条复习记录」**
(复习记录 11→12), and the next run settled to 「已经是最新的」 — §8.4.2 convergence, in
both directions, on a real device against the real backend.

> **The same wording confusion, shipped twice in one file.** A converged pull still
> READS a chunk — the cursor does not skip rows this device just wrote — so keying the
> message on `r.chunks` announced 「收到 0 张卡 · 0 条复习记录」 immediately after a
> perfectly successful sync. Earlier the same day, keying it on `!r.chunks` announced
> 「服务器上还没有内容」 next to a count of 11. **Both times the healthy state was
> rendered as a failure**, and both times the fix was to key on what was actually NEW
> (`r.cards || r.reviews`) rather than on transport-level activity.

**iPhone 17 Pro · iOS 26.5, real backend, real email OTP.** The full loop:

| Step | Result |
|---|---|
| Sign in (`LearnAuth.signIn` → GoTrue → email OTP → `verify`) | ✅ |
| Auto-pull on verify | ✅ **11 cards · 11 reviews · 2 sources** — material captured in a browser arrived in the app |
| Sync again | ✅ 0 chunks — converged (§8.4.2's criterion) |
| Reinstall over the top + relaunch | ✅ session, corpus and last-sync time all survived |

That is Stage 2's acceptance criterion met: the extension's corpus reaches the app, and
the server is the only thing between them (§7.2).

**Simulator text input — the recipe, and one correction to it.** `type_text` still
turns every character into `a` (23 a's, reproduced again here). The working path is
`pbcopy` → `xcrun simctl pbsync host <udid>` → focus the field → **原地 `drag` with
`duration_ms: 2200`** (that is the long-press; there is no hold-click) → **Select All**
→ **Paste**.

- **Do NOT press ⌘⇧K "to enable the hardware keyboard".** It is a toggle and the
  hardware keyboard is already on — pressing it *disconnects* it and raises the
  software keyboard, which is the opposite of the intent and looks like the fix failed.
- **The two coordinate spaces are different and it is easy to mix them up.** cua-driver
  wants window-local pixels from `get_window_state` (device screen + simulator chrome);
  `xcrun simctl io … screenshot` gives device pixels only. Locate tap targets in the
  `get_window_state` image, never in a `simctl` screenshot.

**Stage 4 (settings) verified 2026-08-07.** 设置 reachable from both the header and
the review page footer — and that second path is the whole point: before this it
called `chrome.runtime.openOptionsPage()`, which the shim throws on, so a user could
reach a dead end in two taps. The page carries 每日新卡上限 / 自动朗读 / 朗读速度
(written to the SAME `chrome.storage` keys `review.js` reads, so there is no second
settings model to drift), 学习库 counts + §7.1's targeted 清理已掌握的卡, and 账号:
退出登录 plus **删除账号与云端数据**.

> **The account deletion is a release gate, not a feature.** §10 Gate B: Apple
> requires in-app account deletion wherever accounts exist. `npm run test:app` now
> fails by name if that button goes missing, and the failure message says why.

### G. macOS host app (real Mac) — ✅ verified 2026-08-08

Same three built files as row F, same Xcode project, so what this row tests is the
macOS *host*, not the product logic. Signed build → `/Applications` → `open` (§2.G's
recipe below). Verified: launch and layout; signed-in state pulling **11 cards · 12
reviews**; sync; grading a card **persisted to IndexedDB** (+66 KB, `grade` +3,
`lastReviewAt` +6 on disk); and — the one that matters most — **explicit sign-out
survives a relaunch**.

> **Two operator lessons, both cost real time.**
>
> 1. **Driving the app's `WKWebView` from outside is unreliable on macOS.**
>    `type_text` interleaves characters (`belliedmonkey@gmail.com` came out
>    `bellicedmoonkdey@gmaeil.com`), and ⌘A/⌘V do not land in the web view at all.
>    Unlike the simulator there is no long-press-paste fallback. **Hand text entry to
>    the human on this row** rather than burning attempts; everything else drives fine.
> 2. **When a human is in the loop, ASK before investigating an anomaly.** The app
>    appeared signed-in without an OTP, and the possibility that it was a broken auth
>    path justified looking — but the first move should have been one question. It
>    cost a container audit, two IndexedDB inspections and a full data wipe to
>    establish something the user answered in three words: they had signed in
>    themselves. **A wipe is also destructive**, and it was aimed at a hypothesis that
>    a question would have eliminated for free.
>
> The reflex worth keeping is the other half: what made this safe to conclude was not
> the explanation, it was the **falsifying test** — sign out, relaunch, confirm it
> stays out. That distinguishes "a session I forgot about" from "sessions resurrect"
> without needing to know where the session came from.

> **两条 2026-09-04 花了十几轮买来的（同一行、同一个 App）**
>
> 3. **这个 App 的 localStorage 有两个可能的位置，先用 `lsof` 问它在读哪一份。**
>    带 App Sandbox 的构建（正式签名 / 有 provisioning profile）落在
>    `~/Library/Containers/com.belliedmonkeytranslator/Data/Library/WebKit/…`；
>    去掉沙箱的本地 Debug 构建落在 `~/Library/WebKit/com.belliedmonkeytranslator/…`。
>    **两份都可能存在、都装着看起来很像的 `mt:` 键**，而旧的那份是历史遗留。
>    我对着没在用的那份改了六轮种子，每次都得到「没生效」，并据此推出了一个
>    错误的结论（「macOS 上外部写 WKWebView 的 localStorage 不生效」）。判据是：
>
>    ```bash
>    for q in $(pgrep -f WebKit.Networking); do
>      lsof -p $q 2>/dev/null | grep "localstorage.sqlite3$"
>    done
>    ```
>
>    顺带：种子要写进 **WebKit 自己建过的**那个库（它是 WAL），别用 sqlite3 新建一个。
>
> 4. **窗口截图全白 ≠ App 挂了。** 先证明渲染进程是死是活，再谈回归。同一个
>    `lsof` 就够了：WebContent/Networking 还打开着那个 sqlite，就说明页面在跑 JS。
>    这一条把「是不是我刚才那次改动把 App 改白屏了」从猜测变成可判定的事 ——
>    而它当时的答案是「不是」（`npm test` 与两个 flavor 的 `test:app` 全绿）。
>
> 5. **⚠️ 未决：2026-09-04 这台 Mac 上，本地 Debug 构建的宿主 App 起来是白屏。**
>    进程活着、WebKit 打开了 localStorage（JS 在跑），但窗口没有任何 AX 内容。
>    三种签名配置（完全不签 / 正式签名带 App Sandbox / 签名去掉 sandbox）表现一致。
>    **不是产品回归**：同一份 `dist-app/` 的 `Script.js` 在 iOS 模拟器宿主 App 上、
>    在 `test:app` 的真 Chrome 上，两个 flavor 全都正常。同一天更早、同一份代码的
>    一个构建也是好的 —— 变量在构建侧，尚未定位。**这一行的语音断言因此改由
>    iOS 宿主 App（行 6）与 `test:app` 承担，如实记为 not-run 而不是 pass。**

**Scope note:** relaunch-persistence of the graded state was not re-driven here (the
on-disk write is the evidence, and the same IndexedDB path was verified end-to-end on
row F). Not claimed as more than that.

Same loop as F. The one thing that must not be improvised is the install:

```bash
node build.js
xcodebuild -project "safari-project/…/BelliedMonkey Translator.xcodeproj" \
  -scheme "BelliedMonkey Translator (macOS)" -configuration Debug \
  -derivedDataPath /tmp/bmt-mac-signed -allowProvisioningUpdates build   # NOT CODE_SIGNING_ALLOWED=NO
rm -rf "/Applications/BelliedMonkey Translator.app"
cp -R "/tmp/bmt-mac-signed/Build/Products/Debug/BelliedMonkey Translator.app" /Applications/
open "/Applications/BelliedMonkey Translator.app"
pluginkit -m -p com.apple.Safari.web-extension | grep belliedmonkey     # proof it registered
```

**An app built with `CODE_SIGNING_ALLOWED=NO` is never registered by Safari, even from
`/Applications`** (measured). This is also what finally explained a full day of
intermittent 「扩展突然不跑了」 on row 3: an unsigned temporary extension is switched
off at every Safari restart and needs an admin password to re-enable, whereas a really
signed container app installs once and survives. **Prefer the signed app to 添加临时扩展
for any session longer than a few minutes.**

---

## 3. Automated gates (mandatory, before every push)

### 3.1 `npm test` — pure logic (every push)

`npm test` (`node test/run.js`, zero-dep, Node ≥18) covers the pure-logic core: the
translate-ahead subtitle engine + state machine, cue→sentence merge, i18n/locale
resolution, and every provider's request-building / caching / retry-fallback. **It must
be green before you push.** When you change logic, add/update tests in the same commit.
**Never push on a red suite.**

**Learning layer (记忆层).** `learn-model.js` and `learn-scheduler.js` are pure by
construction and belong here in full; `learn-collector.js` is testable with an
injected clock and an `IntersectionObserver` stub. All three land in §3.1.1's line of
fire, and the mapping is not optional:

- **(1) production config** — the scheduler must be asserted against the exported
  `DEFAULTS`, with one case passing a deliberately partial config. A scheduler whose
  `dailyNew` silently reads `undefined` still returns a plausible-looking deck.
- **(2) work not done** — a segment below the dwell threshold must produce **zero**
  storage writes, and a mature card must be **absent** from the deck. Both are
  invisible in the output; only call counts see them.
- **(3) resource lifetime** — `disable()` must disconnect every `IntersectionObserver`
  and clear the flush timer. Inject recording stubs; do not assume cleanup.

#### 3.1.1 Three blind spots a green suite does not cover

Found the hard way (2026-07-28): a pre-landing review caught three defects in a
feature whose suite was 76/76 green, one of which silently disabled the whole
feature. None were oversights — each sat in a place the assertions structurally
could not look. When you add a test, ask which of these it needs:

1. **Assert on the config PRODUCTION builds, not one the test assembles.** The
   detector tests passed `createEngine` a window object they had built correctly;
   the bug was in the partial literal an *adapter* writes. A default that a caller
   can silently omit fails open (`n <= undefined` is false), so the guard vanishes
   with every test still green. Prefer merging over defaults (`Object.assign({},
   WINDOW, cfg.window)`) so a partial override cannot be wrong, and keep one test
   that passes the *incomplete* shape on purpose.
2. **Assert on work NOT done, not only on output.** A wasted provider call, a
   redundant IPC, or a skipped unit produces byte-identical output. If the feature's
   value is a negative — "this is not sent", "this is not asked" — then only a
   call-count or a request log can see it. This project's whole same-language skip
   is such a feature; `expectNotRequested` (§3.2) and `asked === 0` unit assertions
   exist for exactly this reason.
3. **Assert on resource lifetime where it matters.** Timers, caches and retained
   strings are invisible to outcome assertions. The vm harness merges whatever
   globals you pass, so inject a recording `setTimeout`/`clearTimeout` rather than
   assuming cleanup happens.

The recurring shape behind all three: **a green suite proves the happy path
produced the right output; it proves nothing about cost, cleanup, or wiring.**

### 3.1.2 `npm run test:idb` — the IndexedDB upgrade, on every `DB_VERSION` bump

**Mandatory whenever `learn/store.js`'s `DB_VERSION` changes.** Real Chrome, throwaway
profile (Node ≥22, same launcher as §3.2): it seeds a database at the *previous*
shipped schema, opens it through `LearnStore.open()` itself, and asserts the old
items, reviews, meta and indexes all survive and the new store is writable.

This is the one migration that touches data **users already have**, and `npm test`
structurally cannot see it — the zero-dep harness has no IndexedDB. The comment in
`store.js` ("every create is guarded by `contains`, so bumping the version never
touches existing data") is true of *added stores* and says nothing about an index
added to an existing one, which is the shape that would actually eat a corpus.

Three ways of getting it wrong were confirmed to make this fail, by breaking
`store.js` on purpose: not bumping the version, adding an index to an existing store,
and deleting-then-recreating a store. Keep that habit — a migration check that has
never been seen red is not evidence.

> **The checker itself had this bug first.** `db.transaction([...])` throws
> *synchronously* for a missing store, so the initial version's promise never settled
> and a genuinely broken upgrade came out as a 90-second hang rather than a ✗. Same
> family as §4's rule about `close()`: **a check that hangs is indistinguishable from
> one that is still working.** Wrap the body, and give every long-running check a
> hard timeout that prints a verdict.

### 3.1.3 `npm run test:learn` — the learning suite, end to end, in both hosts

**Mandatory whenever the learning surface changes** (`extension/learn/**`,
`extension/content/learn-*`, review-related `app/**`). Real Chrome, two hosts —
the shipped app bundle (dist-app, shipped layout) and the extension review page
(dist/learn/review.html plus the app's own chrome shim) — walked through the whole
loop with a seeded per-tier corpus, asserting against the DATABASE for behavior and
sweeping the visible surface after every step (non-empty labels, foreground ≠
background — the class of bug that only exists where CSS cascades differ per host).
Case list and manual-matrix complement: [`learn-regression.md`](learn-regression.md).

### 3.1.4 引擎配置的**跨宿主一致性** — `npm test` + `npm run test:app`

**Mandatory whenever any of these change**：`app/settings.js` · `app/index.html` 的
设置区 · `extension/options/**` · `extension/learn/engine-fields.js` ·
`build/app-bundle.js` 的 `MODULES`。

促成它的报障（2026-09-04）：用户报「App 的设置页居然没有与扩展端保持一致」。
根因是 `engine-fields.js` —— 那个为消灭手抄而抽出来的组件 —— **不在 App 包的
`MODULES` 里**，所以 `app/settings.js` 只能继续手抄，而守它的门禁只 grep
`options.js`。两件事叠在一起，等于这条路修了一半、且没有人会被告知。

两层，缺一不可：

- **静态（`npm test` · `test/engine-fields.test.js`）** —— App 侧不许再自己判
  `supportsKey/needsKey/supportsBaseUrl/supportsModel`；三组引擎配置都接在
  `EngineFields.visibility()` 上；下拉一律走 `populate()`；输入框 id 从
  `EngineFields.SLOTS` 取而**不是第八份手抄表**；组件（含 `engine-test.js`）
  真的在 `MODULES` 里且排在 `app/settings.js` 之前。
- **真渲染（`npm run test:app`）** —— 在真 Chrome 里进设置页、切到「详细」，
  把三个下拉的**每一个引擎**都选一遍，断言三个字段行的**渲染后可见性**与
  `EngineFields.visibility(entry)` 逐项相等。

**同一族里的第三条（`npm test`）：App 读得到的设置，设置页必须管得到。**
`app/driving.js` 的读取清单减去 `app/settings.js` 的键集，差集必须**恰好等于**一张
写明理由的白名单。多出来的那个键会**静默赢过**设置页写的值，而用户看不见也清不掉它。

> ⚠️ 这条不许用「把那半组从读取清单里删掉」来修。`extension/learn/review.js` 是与
> 扩展**同一份字节**打进 App 包的，它自己也读 notes* 也调 `resolveConfig`；只删一处
> 的结果是同一个 App 里播客模式回落到基础组、复习页仍用 notes 组 —— 从「一个静默赢」
> 变成「两处解出两个不同引擎」。而 review.js 那份不能动：扩展那边 notes 组是真实可配的。
> **所以钉的是不变量本身，不是某一处读取。** 2026-09-04 动手前查出来的。

今天白名单上有六个，其中 `uiLang` 是**已知缺口而不是设计**：`driving.js` 已经在读它，
App 里却没有任何控件，界面语言永远落到 `navigator.language`。

两条判据上的纪律：

- **问渲染后的可见性（`offsetParent`），不问 `.hidden` 的属性值。** 一条 display
  声明就能把 `hidden` 压掉（`test/hidden-guard.test.js` 就是为它立的），而那正是
  六处漂移里最难发现的一处。
- **期望值来自组件，不是一张写死的表。** 写死的表是第八份手抄，注册表一变它就成了谎话。
- 断言必须**先真的进设置页**：祖先 `hidden` 时 `offsetParent` 对每一个后代都是 null，
  于是「全部不可见」会以一种很像真发现的方式全线报错。这条已经踩过一次。
- 门禁要**证伪**过：删掉 `MODULES` 里的一行、恢复一处手写显隐、把旧 id 放回来、
  让某个字段恒显 —— 四种破坏方式当场各红一次，才算这道门存在。

### 3.2 `npm run test:layout` — layout regression corpus

`npm run test:layout` (`node test/layout/run-layout.js`, zero-dep, Node ≥22 for the
built-in WebSocket) drives the **real sibling renderer in a real Chrome layout engine**:
it builds `dist/`, loads it into a throwaway-profile Chrome via the §2.D CDP
`Extensions.loadUnpacked` flow, serves the local fixture pages in
`test/layout/fixtures/` over localhost, intercepts the Google translate endpoints with
canned deterministic responses (fully offline), and asserts geometry invariants on the
injected `.mt-translation` siblings (below the original, same column, no parent-style
pollution, no horizontal overflow, …). A fixture can also declare a **mid-run
viewport change** (`resize` in its manifest — `Emulation.setDeviceMetricsOverride`),
which re-runs every assert after the renderer's debounced re-measure: that is the
rotation / window-resize / media-query-breakpoint path. Screenshots land in
`test/layout/artifacts/` (gitignored, pid-locked so concurrent runs don't clobber
each other) for human eyeballing. ~80s wall time (headless Chrome — the behavioral
phases' in-page settles account for the growth past the old ~50s).

Five manifest keys reach beyond geometry, because some behaviour is **invisible in the
DOM**:

- `"cfg": {…}` overlays the run's settings for that fixture — `targetLang` above all.
  Fixtures default to a `zh-CN` target; the same-language rules behave differently under
  a Latin target, and that path needs its own fixture (29).
- `"expectNotRequested"` / `"expectRequested"` assert on the **provider requests the
  page actually issued** (the harness already intercepts them). This is the only way to
  test a unit the engine skips ahead of time: the renderer's identical-output backstop
  would suppress that line anyway, so the rendered DOM is byte-identical with and
  without the skip — what changes is the request that was never sent, i.e. the user's
  quota. A DOM-only fixture for such a change passes for the wrong reason and would
  stay green if the feature were deleted.
- `"selection": { from, to, movesFrom? }` drives a real drag-shaped selection and
  asserts it survives the page's SPA re-render (interaction-spec: 「…never destroy
  the user's text selection」, fixture 33). Async in-page phase; outcomes cross the
  isolated/main world boundary via DOM `dataset` attributes written by the
  fixture's main-world script, with an anti-vacuous guard (the fixture must prove
  its reconciler actually moved nodes — `movesFrom` names the container whose
  child moves are counted, default `#article`).
- `"interaction": { counters, clicks, contextmenu, pageSelection }` asserts the
  page's OWN content still behaves as the page wrote it after translation
  (interaction-spec: 翻译文字插入后不要影响网页原有内容的交互动作 — fixtures
  34–35): page links stay visible and their listeners still fire, `contextmenu`
  on originals is not default-prevented, and a page-programmatic selection is
  never overridden by the selection keeper. Same dataset channel; the fixture
  seeds every counter with a pre-enable self-test, so a listener that never
  worked fails the run instead of passing vacuously.
- `"keeperGuards": { from, to, movePartial, editor, moveEditor, moveOther,
  moveOther2 }` pins the selection keeper's load-bearing behaviors that no
  geometry can see (fixture 36): the partial-kill repair restores the EXACT
  text, selections inside editors are never snapshotted or restored, a gesture
  deselect and a quiet programmatic `removeAllRanges()` both stay deselected
  across later mutation batches. Verified to bite: neutering the keeper turns
  the partial-kill case red; removing the hideOriginal no-clobber guard turns
  fixture 34's resize-phase `hiddenAttrEquals` red.

**Mandatory before every push that touches `extension/content/**` or
`extension/styles/**`; recommended otherwise.** No Chrome on the machine is a hard
failure (set `CHROME_BIN=/path/to/chrome`), never a silent skip.

**The incremental-adaptation contract** (the reason this suite exists):

1. Every site-specific layout fix MUST land with a new fixture in
   `test/layout/fixtures/` distilled from that site's minimal layout pattern, and that
   fixture must **fail before the fix** (record the red run in the GitHub issue).
2. The fixture passes after the fix.
3. **All pre-existing fixtures stay green.** A fixture is never edited to accommodate a
   new fix — unless the fixture's own assertion is demonstrably wrong, justified in the
   issue. This is what guarantees each adaptation is an increment, not a regression.

**Learning layer.** The Collector is a sink and must be geometrically inert, so it
owes this suite a fixture of its own: with capture enabled, **every geometry
invariant must hold unchanged**, and the injected `.mt-translation` siblings must
never themselves be collected (domain-design §9.1 law 4). When the in-page review
card lands, it injects DOM into the page and therefore falls under the contract above
in full — new fixture, **red before the change**, all pre-existing fixtures green.

Scope honesty: this gate catches **renderer-logic regressions** (`flowFixCss`,
`layoutCss`, `ensureSibling`, interleave) in Chromium's layout engine. It does NOT
cover WebKit/Gecko engine differences, real devices, subtitles/overlays, or visual
color/contrast — those remain owned by the §1 full matrix via cua-driver.

---

## 4. Verification-honesty rules (mandatory)

**A DOM element existing is NOT proof the user sees it.** This burned us: the YouTube
`.mt-yt-dual` element was present (`querySelectorAll` found it) but invisible — clipped
by an ancestor's `overflow:hidden`.

- For anything the user looks at (translations, subtitles, layout), **verify with a
  screenshot of the built + loaded extension** showing the actual rendered result — not
  a DOM/console check. Confirm the text is really visible and correctly placed.
- **Interaction / visual bugs (behavior over time) MUST be verified with a screen
  RECORDING, not a screenshot** — a flash on click, a layout that shifts then reverts,
  subtitle timing, scroll jank. A still cannot capture the transient. Keep the **before
  (repro)** and **after (fix)** clips. Simulators: `xcrun simctl io <UDID> recordVideo`.
  **Desktop Chrome and desktop Safari: record with the `cap` CLI** (Cap.app's bundled
  CLI, `~/.cap/bin/cap` — agent-oriented, `--json` everywhere). Not installed? One-liner
  (also works for contributors on a fresh machine):

  ```bash
  curl -fsSL https://cap.so/install-cli.sh | sh
  ```

  Proven pipeline:

  ```bash
  export PATH="$HOME/.cap/bin:$PATH"
  cap doctor --json                    # permissions.screenRecording must be "granted"
  cap record windows --json            # window list; ids match CGWindowIDs (list_windows)
  cap record start --window <id> --duration <N> --fps 15 --path out.cap --json
  cap export out.cap --output out.mp4 --json
  ffmpeg -y -i out.mp4 -vframes 1 frame0.png   # then per-frame extraction as needed
  ```

  Gotchas (all hit live):
  - **The target window must be FRONTMOST while recording.** `--window` capture is
    region-style: an occluding window (e.g. the terminal running the command) is what
    gets recorded. Activate the target app once (`osascript -e 'tell application
    "Safari" to activate'`), then drive it with **background** cua-driver clicks only —
    a foreground-delivery click restores the prior frontmost app and ruins the clip.
  - **Frame-0 honesty check is mandatory**: extract the first frame and confirm it shows
    the target window (not the terminal) before trusting anything in the clip.
  - `--duration N` self-stops (no detach/stop dance needed for short clips); the `.cap`
    project dir and exported `.mp4` land in `--path`/`--output` (use the scratchpad).
- **截图/录像之前先确认屏幕真的在显示 —— `bash scripts/ensure-screen-awake.sh`。**
  屏保运行时 WebKit 会节流不渲染，而这件事伪装得非常像产品缺陷：

  | 现象 | 真相 |
  |---|---|
  | 窗口标题栏截得到，网页内容一片空白 | 标题栏是 AppKit 画的，WKWebView 被节流了 |
  | 整屏截图只有壁纸，连别的 App 都没有 | 屏保盖住了一切 |
  | `list_windows` 仍报 `is_on_screen: true` | 它只管几何，不管有没有真被画出来 |
  | 每条输入路由都是 `off_space_or_ax_unresolved` | **工具已经在提示了** |

  2026-08-29 因此判错一小时：把「macOS 未签名 Debug 包白屏」当成了包的问题，
  甚至做了对照实验（未打补丁的旧包也白屏）却把两次都归因成「包有问题」——
  共同原因其实是「屏幕没在显示」。随后又误怪到 `codesign --deep` 和
  LaunchServices 陈旧注册头上。解锁后同一个包立刻正常渲染。

  **教训不是「记得看屏保」，是：抓不到画面时，先怀疑观察手段，再怀疑被观察对象。**
  这与本节开头那条同源 —— DOM 里有 ≠ 用户看得见；反过来，截图里没有 ≠ 产品坏了。

  ⚠️ 脚本只能解屏保，**解不了锁屏**（要密码，脚本给不了也不该给）。
  `sysadminctl -screenLock status` 若是 `immediate`（本机即是），自动解除那条路
  永远走不通，脚本必然落到「请手动解锁」。所以它的价值是**检测 + 大声失败**，
  不是无人值守续命 —— 但正是这声失败能挡住上面那种误判。

- Don't trust your own injected test hacks as proof of the shipped code — verify the
  **built/loaded** extension.
- **Be honest about what was vs wasn't verified** (static check vs runtime vs screenshot
  vs recording; which surfaces of §1 were actually run). State it plainly.
- Real captions/overlays only render in a **foreground** tab — background tabs throttle
  `requestAnimationFrame`, so automated screenshots of a backgrounded tab may miss them.
- **Pages with a podcast/video MUST be verified DURING PLAYBACK.** Press play and let it
  run (≥20-30s): the subtitle pipeline (transcript fetch → cue sync → overlay pair →
  pager) only exercises while the clock advances. A loader-state-only check
  (`⏳ 字幕加载中…` visible, playback never started) verifies almost nothing — it misses
  stale-fragment accumulation, cue-sync errors, pager bugs, and ad/seek behavior.
  Capture the overlay showing a **matched bilingual pair advancing with playback**
  (screenshot for a moment-in-time claim; recording for anything about timing).

---

## 5. Manual scenario checklist

The itemized, per-feature scenarios (controls, webpage bilingual, YouTube, podcast,
i18n, providers, cross-platform, build) live in
[`docs/regression-tests.md`](regression-tests.md). For any change touching UI/DOM/layout/
a platform surface/a provider, work through the relevant sections **on every matrix
surface (§1)** and screenshot every visual item.

---

## 6. cua-driver tooling reference

- **Setup (one-time, needs the user):** install `com.trycua.driver`; grant **Accessibility
  + Screen Recording** (`cua-driver permissions grant`); register at **user scope**
  (`claude mcp add --scope user --transport stdio cua-driver -- cua-driver mcp`). Gotcha:
  before grants, `cua-driver mcp` prints a plain-text line on stdout that corrupts the
  JSON-RPC handshake — grant, then restart, then tools appear.
- **Native macOS / iOS-Simulator UI is AX-bridged** → click by `element_token` (no pixel
  math), works on backgrounded windows. Find the Simulator window
  (`com.apple.iphonesimulator`) or Safari window via `list_windows`.
- **Injected web content (our FAB/overlay) is NOT AX-bridged** → **pixel clicks**: take a
  `get_window_state` window screenshot (`screenshot_out_file` + low `max_elements` to
  avoid dumping a 10k-node tree), Read it, locate the element in window pixels, click
  `{x, y, window_id}`.
- **Big AX trees overflow context** — a Safari Settings tree is 250k+ chars. Pass
  `screenshot_out_file` + `max_elements`, or when it spills to a file, `jq`/`python3` out
  only the `element_token` you need. Do **not** Read the raw dump.
- **See the iOS screen cheaply:** `xcrun simctl io <UDID> screenshot x.png` then Read it.
- The cua-driver `page` tool does **not** support the Simulator
  (`Unsupported browser: com.apple.iphonesimulator`); for the sim's web DOM use Safari
  Web Inspector (Mac Safari → Develop → Simulator). On real desktop Safari/Chrome the
  `page` tool works for DOM inspection.
- **Watch for system dialogs.** Running `screencapture` from the terminal can trigger a
  macOS "allow <terminal> to record the screen" prompt — a real permission change; leave
  it for the user, don't auto-approve. Avoid triggering JS `alert/confirm` dialogs, which
  freeze the automation channel.

---

## 7. Governance

This spec is the single source of truth for verification. Changes to it should be made
deliberately and referenced from `AGENTS.md`. The separate **change-documentation rule**
(every change gets a GitHub issue capturing problem / solution / reasoning) lives in
[`AGENTS.md`](../AGENTS.md) — it is a process rule, not a verification rule, and is
unaffected by this consolidation.

---

## Safari bundle completeness — a gate, because the build cannot see this

`xcrun safari-web-extension-converter` captures the extension's **file list** at
conversion time. Files added to `extension/` afterwards are never referenced by the
Xcode project, so they are silently absent from the built `.appex` — while the build
succeeds, the manifest validates, and every one of our own gates stays green.

**This had already happened.** The entire `learn/` directory was missing from the iOS
build. The visible consequence was not "the learning feature is absent": `options.html`
loaded seven scripts that were not there, `options.js` threw on the first undefined
global, and **the whole settings page was dead — including the field where the API key
is entered**. Found by running the matrix, not by any test.

Before any iOS/macOS verification run, and before any Safari release:

```bash
node build.js
xcodebuild -scheme "BelliedMonkey Translator (iOS)" \
  -destination 'id=<SIM_UDID>' -configuration Debug \
  -derivedDataPath /tmp/bt-dd CODE_SIGNING_ALLOWED=NO build
npm run verify:ios            # every dist/ file must exist in the .appex
```

A non-zero exit means **regenerate the project** (the command is printed in the
failure) and rebuild. Do not hand-add files in Xcode: the next added file reproduces
the same silent gap.

---

## 更正与未决（iPhone 行，2026-08-05）

**更正一条已推送的错误声明。** commit `8036d83` 的信息里写着「同一篇 Wikipedia、同一个
DeepSeek key……改后 30 秒内全部渲染」。**那次的译文其实来自免费 Google 端点**，不是
DeepSeek——覆盖安装（`simctl install` 不卸载）**会清空扩展设置**，而我只验证了代码
刷新、没验证存储保留，就把结论说满了。

识别它的信号当时就在眼前：那段译文前后大半是**原文回显**，正是本文件 §0 记录的免费
端点典型故障，我却当成模型质量问题带过去了。**「验证用的是不是你以为的那条路」必须
在每次重装后重新确认，不能沿用。**

重配 DeepSeek 后已重新验证：译文全中文、无回显。所以

- 悬挂 promise 的修复 **成立**（该 bug 在 fetch 之前，与引擎无关）；
- 「iOS 上 DeepSeek 端到端翻译」**现在才成立**。

### 本行仍未验证

- 采集是否真的写入学习库、复习页、TTS、长按加星。
- **已修但未在设备上验证**：Safari iOS 上**扩展页读不回 `chrome.storage.local`**。
  决定性证据：设置页重新加载后显示 Google，而**同一时刻内容脚本正拿着已保存的
  DeepSeek key 成功翻译**。所以写入是好的，读不回来的只有扩展页（设置页、弹窗、
  复习页）。用户的真实体验是「每次打开设置页配置都像消失了，得重填 API Key」。
  修法见 `extension/learn/page-settings.js`：**机制尚未隔离**（需要 Web Inspector），
  所以不赌任何一种——正常数组读一次；仅当结果里一个目标 key 都没有时才回退到整桶读
  并过滤。数组形式正常的平台上零变化。有 5 个单测，其中一条专门断言「正常路径只有
  一次调用」，避免让所有平台替 Safari 买单。
  **真因（2026-08-05 用 Safari Web Inspector 查明）。** 同一个调用的两种形式互相矛盾：

  ```
  回调形式   → cb(undefined)，一声不吭
  promise 形式 → reject: "Invalid call to browser.storage.local.get().
                          Failed to create extension storage directory."
  ```

  **存储层是坏的，而回调形式把它报成了「空结果」。** 我们的代码拿到空结果只能画默认值，
  于是用户看到自己的引擎和 API Key 悄悄退回免费通道——从外面看，和「从没保存过」
  完全一样。

  两条更正，都是我先前判断错的：
  - 「回调永远不执行」**是错的**。它执行，只是带着 `undefined`。
  - 「promise 一直 pending」**也是错的**——`Promise {pending}` 只是**创建瞬间**的状态，
    任何异步调用都长这样，它什么也不证明。**这个 console 里 `console.log` 的输出根本
    不显示**，只有表达式返回值会显示；我据此做的推断全部作废。正确的做法是把结果存进
    全局变量，隔几秒再以表达式读它。

  **已修的是那份沉默**（`page-settings.js` + 三个扩展页）：优先用 promise 形式（唯一说
  真话的那个），检查 `chrome.runtime.lastError`，把「读失败」和「配置为空」区分开，并在
  设置页顶部明确告知——**且提醒不要在此保存，否则会覆盖原有配置**。

  **结案：那是脏模拟器的环境故障，不是 iOS 上的产品缺陷。** `simctl erase` 后重装、
  重新配置，设置页离开再回来**正常显示 DeepSeek**。扩展页在 iOS 上读得到
  `chrome.storage.local`；先前那台模拟器建不出扩展存储目录，是它自己被反复安装/卸载
  折腾出来的状态。

  `page-settings.js` 保留，但**目的不是绕过某个平台缺陷**——而是让**下一次存储失败，
  无论来自哪里，都不能再伪装成「配置为空」并被默认值悄悄覆盖**。查明过程暴露的那个真
  问题依然成立：存储坏掉时只有 promise 形式说真话。

  > **核心约束 — 平台「不可能」时，先 erase 再下结论。** 一台被反复安装/卸载折腾过的
  > 模拟器能制造出与产品缺陷难以区分的症状（本次是扩展存储目录建不出来）。判据：当某个
  > 平台 API 的行为**在文档上讲不通**时，`simctl erase` 一次的成本远低于沿着错误前提
  > 继续排查。本次没有先做，代价是数轮返工。

### 本行仍未验证

- 采集是否真的写入学习库、复习页、TTS、长按加星。
- **已修但未在设备上验证**：Safari iOS 上**扩展页读不回 `chrome.storage.local`**。
  决定性证据：设置页重新加载后显示 Google，而**同一时刻内容脚本正拿着已保存的
  DeepSeek key 成功翻译**。所以写入是好的，读不回来的只有扩展页（设置页、弹窗、
  复习页）。用户的真实体验是「每次打开设置页配置都像消失了，得重填 API Key」。
  修法见 `extension/learn/page-settings.js`：**机制尚未隔离**（需要 Web Inspector），
  所以不赌任何一种——正常数组读一次；仅当结果里一个目标 key 都没有时才回退到整桶读
  并过滤。数组形式正常的平台上零变化。有 5 个单测，其中一条专门断言「正常路径只有
  一次调用」，避免让所有平台替 Safari 买单。
  **状态：验证不通过，缺陷仍然存在。** 2026-08-05 在设备上按预先写死的判据验收——
  配好 DeepSeek → 离开设置页 → 重新打开——**仍然显示 Google**。

  否定结果缩小了范围：整桶读 `get(null)` 也拿不回来，**所以不是「数组形式不被支持」**。
  扩展页在该平台上似乎完全读不到 `chrome.storage.local`，而同一设备上的内容脚本读得到，
  且这个页面自己的写入确实持久化了（内容脚本能看到）。

  `page-settings.js` 保留但**已在文件头标注它不是修复**——只是让扩展页的读取变得防御性
  （不抛、不挂、不返回 undefined），并把重试收在一处。**下一步只有 Safari Web Inspector**：
  除了 console，没有别的办法区分「读返回了空」和「读根本没返回」。
- **（此前记为独立缺陷的）弹窗显示 Google**：同一根因，不是两个 bug——设置页显示
  DeepSeek 且译文确由 DeepSeek 产生时，弹窗仍显示「Google 翻译（免费）」并展示免费
  通道提示。状态本身（已翻译/未翻译）是对的。用户会因此以为自己的 key 没生效。
  与 `options.js` 的 init 失败同族（`chrome.storage.local.get` 在该平台上的回调行为），
  但 popup 有 `s || {}` 兜底，所以不是崩溃而是**静默退回默认值**——更难发现。

### 一条操作纪律

`simctl install` 覆盖安装**会重置扩展存储**（也会重置 Safari 的扩展开关与站点授权）。
每次重装后：重新配 provider + key，并**用「译文里有没有原文回显」确认自己确实在验
预期的那条路径**。

---

## 矩阵执行记录：iPhone 与 iPad（2026-08-05 / 08-06）

### iPhone 17 Pro · iOS 26.5 —— 已跑完

**6 个真缺陷，全部已修并在设备上复验**：

| # | 缺陷 | 症状 |
|---|---|---|
| 1 | `learn/` 整个目录从未进过 Safari 包 | 设置页全死，含填 API Key 处 |
| 2 | `init()` 在 `s0.uiLang` 上抛错，且 `init()` 无 `.catch()` | 页面渲染正常但所有 JS 行为失效 |
| 3 | 失败后静默回退 Google | 掩盖真错误、违反 §0、误导用户 |
| 4 | `try` 只包住 `get()` 调用而非回调体 | promise 永久悬挂，翻译永不落地 |
| 5 | 存储读失败被当成「配置为空」 | 用默认值悄悄覆盖用户配置 |
| 6 | `.pressure{display:flex}` 打败 `[hidden]` | 空库上虚报「清理已掌握的卡」 |

**通过**：扩展加载 · 内容脚本 · FAB · popup · 设置页 · 引擎注册表 · API Key 保存 ·
IndexedDB · 同步区正确缺席 · **DeepSeek 端到端翻译** · 双语渲染 · **采集写入（候选 6）** ·
**复习页** · **TTS（进入 onstart 后才有的激活态）**

### iPad (A16) · iOS 26.5 —— 已跑，含一个未修的排版缺陷

**通过**：扩展加载 / 启用 / 站点授权 · 内容脚本 · **popup 以 popover 渲染**（非 iPhone
的底部抽屉）· **FAB 出现**——即 `isMobileLayout()` 正确将 iPad 判为触摸设备 · 引擎与
语言选择器 · 宽屏下引导提示不溢出

**已补跑**：配置持久化（引擎选择在弹窗与设置页之间正确保留）· **DeepSeek 端到端翻译**
（整段捐款横幅、标题、正文均为干净中文，无原文回显）。

**已修的缺陷 — `table-caption` 的译文压在原文上**：en.wikipedia.org 上图注译文与原文
重叠。**我最初把症状读成「`|` 分隔的链接行重叠」，据此写的 fixture 是绿的——形状猜错了。**
用 Web Inspector 读真实 DOM 才看清：

```
prevTag: FIGCAPTION   parentTag: FIGURE   prevDisplay: table-caption
```

Wikipedia 的 `<figure>` 是 `display:table`，`<figcaption>` 是它的 caption；往 caption
后面插一个 block 兄弟节点会被浏览器包进**匿名表格盒**，于是译文压在图注上、caption 宽度
被撑大。**与 issue #59（表格单元格必须把译文作为子节点）是同一机制**，只是 `isCell()`
当初只测了 `table-cell`，漏了 `table-caption`。判据已改为一组表格 display 值。

按 §3.2 先红后修，全程有据：`32-figcaption-table-caption.html` 先红——
`belowOriginal: trans.top 240.4 < 328.7`、`width 320.0 -> 510.7`——修完转绿。

**两条我自己的错误，记下来比结论更有用：**

1. **猜形状不如读 DOM。** 那个绿 fixture 什么都没钉住，已删除。
2. **「Firefox 上那页没重叠 ⇒ 这是 Safari 特有的」这个推断是错的。** 它在 headless
   Chrome 里就能复现——我当时比较的根本不是同一个元素。**跨浏览器的目视比对不能替代
   读 DOM。**

**值得记的信号**：iPhone 上修的六个缺陷在 iPad 上**一个都不复现**。这说明它们修在了
共用路径上，而不是某台设备的怪癖——否则第二行会重现其中一部分。

### Firefox (desktop) —— 结构与合规声明通过，DeepSeek 链路未跑

`node build.js firefox` → `dist-firefox/` 完整（`learn/` 下新文件全部在包内）。
`npx web-ext run` 临时载入后验证通过：

- 扩展载入 · 内容脚本运行 · FAB 渲染 · 页面无异常
- `about:addons` 里**版本显示 1.3.0**——即版本号来自 manifest 的修复在 Firefox 上同样
  生效（此前十一份译文各写死一个 v1.0.0）
- 扩展描述正确本地化
- **「权限与数据」页：数据收集 → 必要 →「开发者称此扩展收集：网站内容」。** 这是
  `data_collection_permissions: ["websiteContent"]` 渲染给用户看的样子——**Gate A 的
  声明在用户真正会看到的界面上得到了验证**，且未提及浏览活动或个人数据，对 V1 正确。
  权限列表亦正确：所有网站（可选）、youtube/x/twitter，**本地文件为关**。
- 内联链接行（`|` 分隔）译文正确排在下方。**当时据此推断「iPad 上那个重叠是 Safari
  特有的」——后来证明是错的**（真凶是 `table-caption`，headless Chrome 里就能复现）。
  留在这里作为提醒：**目视比对两个浏览器时，先确认你比的是同一个元素。**

**未跑，且不含糊**：

- **DeepSeek 链路。** 页面上观察到的翻译来自**默认的免费 Google 通道**，按 §0 这不算
  验证。Firefox 的扩展选项入口没能通过 `about:addons` 打开（该页只有「详细信息 / 权限
  与数据」两个标签，没有首选项），需要改从工具栏弹窗配置。
- 采集 → 复习页 → TTS。
- 「同语言跳过」的 Firefox 侧：§1 要求**看请求而不是看 DOM**，需要 devtools。

---

## 矩阵当前进度（2026-08-06）

| 行 | 状态 |
|---|---|
| iPhone Safari | ✅ 跑完，6 个缺陷已修并复验 |
| iPad Safari | ◐ 结构通过；翻译链路待补（需 key） |
| macOS Safari | ✅ 跑完（读 DOM 代替截图）；DeepSeek 链路未跑 |
| macOS Chrome | ✅ 跑过（抓到 3 个缺陷，均已修） |
| Firefox | ◐ 结构通过；翻译链路 + 探测器请求检查待补 |

按 §0，**这不构成一次完整验证**。上表就是「诚实说明哪些跑了、哪些没跑」本身。

### macOS Safari —— 跑完（用「读 DOM」代替截图）

**两处与旧笔记不符，已更正：**

1. **「允许未签名的扩展」这次已经是勾上的**（距上次授权多日、Safari 中间退出过多次），
   **没有再要密码**。旧结论「session-scoped、每次都要重新授权」不成立。**先读 AX 里那个
   复选框的 value 再决定要不要麻烦用户。**
2. **卡住 agent 的不是密码，是「添加临时扩展…」按钮**：AX `AXPress` 返回 -25204，前台
   像素点击也不弹面板——文件夹选择器由 macOS 沙盒的 Open/Save Panel Service **出进程**
   托管。§2.C 把「选文件夹」标为人工步骤是对的，实测它是**唯一**的人工步骤。

**观察手段：`osascript … do JavaScript`，不是截图。** `get_window_state` 抓 Safari 的
窗口时内容区**永远是空白**——而实测 `document.body.innerText.length` 是 11566，页面渲染
完全正常。**那张空白截图什么都不是**（§见「抓不到画面时不要用『看起来没问题』代替验证」）。
需要临时打开「允许 Apple 事件中的 JavaScript」（会弹确认框），**用完必须关回去**——它让
本机任何脚本都能在 Safari 页面里执行 JS。本次已关回。

**已验证**：临时扩展载入并启用 · 版本 1.3.0 · 描述本地化 · **内容脚本运行（`#mt-fab`
存在）** · 页面渲染正常 · 点 FAB 后 **76 个 unit、14 条译文**（分段与渲染管线在 Safari
上工作）。

**`table-caption` 修复在本引擎上的前后对照**（同一页面、同一段测量代码、同一引擎）：

| | trans | overlaps | 图注译文作为子节点 |
|---|---|---|---|
| 修复前快照 | 14 | **2**（均为 FIGCAPTION / table-caption / FIGURE） | 0 |
| 修复后快照 | 14 | **0** | **2** |

这同时**彻底否掉了「那个缺陷是 Safari 特有」的推断**：headless Chrome、iPad Safari、
macOS Safari 三处都复现。

**未跑**：DeepSeek 链路（上述译文来自默认的免费 Google 通道，按 §0 不算翻译验证）、
采集 / 复习页 / TTS。Safari 的临时扩展没有可从 `about:` 页打开的选项入口，配置 key 需要
走弹窗 UI。

> **核心约束 — 抓不到画面时，不要用「看起来没问题」代替验证。** 本次差一点把一张空白
> 截图读成结论。判据：若某个观察手段**在成功与失败下产出相同的输出**，它就不是证据。
> 下一步需要换手段（Safari Web Inspector 读 DOM，或屏幕录制），而不是再截一张图。

## 多设备同步端到端（2026-08-06）—— 两台真实浏览器 + 真实后端

**这是同步 UI 第一次被点过。**此前所有验证都是直接调用客户端模块，那只能证明模块
能跑，说明不了那个界面。V1 发布不带这个功能（`enabled: false`），本轮是为它转正做
准备。

### 环境搭建（可复现）

- Chrome 150 起，`--load-extension` **已被封死**，`--disable-features=DisableLoadExtensionCommandLineSwitch`
  这个老办法也失效：扩展被静默忽略，profile 里一个扩展都没有。
- 走 **CDP `Extensions.loadUnpacked`**（浏览器级 target）。完全脚本化，且两个
  `--user-data-dir` 各自独立，互不共享 `chrome.storage` 与 IndexedDB，构成两台设备。
- 交互一律派发**真实输入事件**（`Input.dispatchMouseEvent` / `insertText`），不是直
  接调扩展的函数——本轮的全部意义就在那个从没被点过的界面上。
- 登录验证码从 Gmail 读取，全流程无人值守。

### 跑通的闭环

采集（真实翻译一篇维基文章，DeepSeek）→ 复习 5 张 → 登录（邮箱验证码）→ 推送 →
第二台设备登录 → 拉取 → 在第二台设备上采集并学习 → 推回 → 第一台设备收到，
**排程逐字段一致**（`lastReviewAt`、难度 `d`）→ 删除账号（含账号本身）。

### 发现并修复的三条缺陷

全部对既有门禁不可见：单元测试从没把同一个块重放两次，也从没合并过带排程的条目。

| 症状 | 根因 |
|---|---|
| 每个块被拉下来后原样推回，新设备登录即复制整份语料 | push 只看 `touchedAt > PUSHED`，分不清本地改动与刚收到的内容 |
| 同一条卡的 dwellMs 在两台设备上差约 2 倍 | `mergeItem` 相加，而拉取游标不跳过自己写的行，重放即放大 |
| 在 A 上复习完，B 上照旧到期 | `sched` 不在 `mergeItem` 的覆盖列表里，本地排程永远赢 |

领域结论写进 `learning-design.md` §8.4.2。

### 验收判据：收敛

无任何用户活动时，连续三轮双向同步稳定在「收到 0 · 上传 0」。这条比任何单点断言都
难糊弄——回声、非幂等累加、水位算错都会让它一直不为零。

### 两条本轮暴露的操作纪律

1. **`node build.js` 会 `rm -rf dist/`，而 Chrome 正加载着那个目录。** 扩展会被静默
   卸载：页面照常打开、`readyState` 是 `complete`，但整段界面不在 DOM 里、
   `MT_BACKEND` 未定义。看起来像产品缺陷，其实是重建。**构建之后必须重新装载扩展。**
2. **关闭 CDP 连接不等于关闭标签页。** 驱动里 `close()` 只断了 WebSocket，被「关掉」
   的维基页全都还开着，采集器每 60 秒照常刷一次外发箱——于是每轮同步都真的有新材料
   要推，看起来完全像同步不收敛。**改变了被观察对象的观察工具，产出的是假象。**

### 仍未做

- 三条链路只在 macOS Chrome 上跑过。**iOS / iPadOS Safari 上的同步一次都没跑过**，
  而那才是产品的地板；Safari 的存储与网络行为与 Chrome 不同（见 §「更正与未决」）。
- 远端删号后，另一台设备仍显示已登录、同步照常报成功，直到令牌过期（约 1 小时）后
  刷新失败才登出。无状态 JWT 下难以更好，但界面此刻在说一件不真的事。
- 设置页一关，待输验证码的状态就没了，必须重新发码。


### 同步在 iOS Safari 上跑通（2026-08-06，iPhone 17 Pro · iOS 26.5）

上一节的同步闭环只在 macOS Chrome 上跑过，而 iOS 才是产品地板。这一行补上。

**结果（关键判据全部成立）：**

| 断言 | 实测 |
|---|---|
| 设置页与「多设备同步」区块在 iOS 上渲染 | ✅ 首次在真机形态上看到这个区块 |
| 邮箱验证码登录 | ✅ 「已登录：belliedmonkey@gmail.com」 |
| 新设备拉取 | ✅ **收到 9 张**，学习库 8 → 17 条 |
| **新设备不回推**（ISSUE-081 的地板验证） | ✅ **上传 0 张**。修复前这台 `PUSHED=0` 的设备会立刻把整份语料推回 |
| 收敛 | ✅ 再点一次：**收到 0 · 上传 0** |
| 排程随卡片同步 | ✅ 「待复习 0」——那 9 张刚在桌面端复习过，iOS 知道它们没到期 |

翻译走的是 **DeepSeek**（弹窗里引擎选择器显示 DeepSeek、Key 字段已填，是直接读到的状态，
不是推断——§0 与 2026-08-05 那次误判要求这里必须有直接证据）。

**包完整性：** 重新生成 + `npm run verify:ios` → 62/62 文件齐全，含本轮修复（`syncedAt`）。

### 更正两条既有笔记

1. **卸载重装并不会重置 Safari 扩展开关与站点授权。** 旧笔记说会，本轮实测：重装后打开
   维基页，FAB 直接出现，翻译引擎、API Key、学习库（8 条）全部保留。设置 App 那一整段
   导航可以跳过。
2. **模拟器里的文字输入不需要人工介入。** 旧笔记说「pbcopy + 长按粘贴也可能不通，试满三次
   就请人手动 ⌘V」。可行的配方是：

   - `xcrun simctl pbcopy <dev>` 写剪贴板
   - 点一下字段**先聚焦**（这一步不能省）
   - **长按 ≈2 秒、位移 1px** 的 drag（`delivery_mode: "foreground"`，背景 drag 在 macOS 上不可用）
   - 弹出 粘贴 / 选择 / 全选 / 自动填充 → 需要替换就先「全选」，再长按一次点「粘贴」

   另外：`ConnectHardwareKeyboard` 打开后，**单键 `press_key` 的键码是准的**（6 位验证码逐键
   输入一次成功），但 `type_text` 的字符合成**全部映射成 `a`**（23 个字符 → 23 个 a），
   而**修饰键仍然被吞**（⌘V 只落一个 `v`）。所以：数字/字母用 `press_key`，含 `@`、`.`
   或大写的串一律走剪贴板长按粘贴。


#### 补完：iOS 侧的上行（同日稍后）

上一节只验了 iOS 拉取。这一节补上「在 iOS 学 → 推回 → 桌面收到」。

**做法：** iPhone 上翻译一篇两端都没见过的文章（`Mnemonic`，DeepSeek），滚动停留让 dwell
真实累积，在复习页评了 2 张卡（一张「记得」、一张「太简单」——**故意给不同评分**，这样
排程差异本身就是一个可判别的信号），然后「立即同步」。

| 环节 | 实测 |
|---|---|
| iOS 采集 + 复习 | 学习中 9 → 11、候选 18 → 16 |
| iOS 推送 | **上传 2 张**（数据块 10 → 11）。不是整份语料，也不是 0 |
| 桌面拉取 | **收到 2 张 · 上传 0 张** —— 收到之后没有回声推回 |
| 桌面已评分卡 | 9 → **11** |
| 排程是否跟着走 | ✅ 两张的 `d` 分别是 **5** 与 **4.1**，对应 iOS 上按的两个不同评分 |
| 收敛 | ✅ 桌面连跑两轮、iOS 再跑一轮，全部「收到 0 · 上传 0」 |

`d` 的差异是这一节最有用的断言：如果排程在传输中被重置或用默认值重建，两张卡会拿到
同一个难度。它们没有。

**至此闭环双向验证完毕**：桌面 ⇄ 桌面、桌面 → iOS、**iOS → 桌面**，且每次结束都收敛。

### 仍未做

- iPad 那台没跑（第三台设备的边际价值低，收敛判据已在 iPhone 上成立）。
- ~~iOS 侧的上行未验证~~ —— **已于同日补完，见上一小节**（iOS 上传 2 张、桌面收到 2 张、
  排程随卡片同行、两端收敛）。


## #80 收尾：iPad ✅ / Firefox ✅（并发现 Firefox 独有缺陷）/ macOS Safari 仍缺（2026-08-06）

### 判据改了，比原来硬

原判据是「看译文里有没有原文回显」。**#74 移除静默回退之后有更硬的判据**：既然失败不会再
悄悄退回免费 Google，那么「引擎选的是 DeepSeek + 段落出译文（不是 ⚠️）」本身就证明请求
走的是 DeepSeek。不再依赖对译文风格的肉眼判断。

### iPad Safari ✅

发布配置重建 + 重装（`verify:ios` 62/62）。弹窗里引擎显示 DeepSeek、Key 已填（**直接读到的
状态，不是推断**），点「翻译本页」后整页流畅译文，无 ⚠️。

顺带更正一条旧笔记：**卸载重装并不会重置 Safari 扩展开关、站点授权与扩展存储**——重装后
FAB 直接出现，引擎/Key/学习库全部保留。

### Firefox ✅，但暴露了一个 Firefox 独有的真缺陷（issue #84）

用 `web-ext run` 装临时扩展（免文件选择器，可脚本化）。同一个 Firefox、同一份扩展、同一个 key：

| 页面 | 页面 CSP | 结果 |
|---|---|---|
| en.wikipedia.org | `default-src` 白名单**不含** `api.deepseek.com` | **每一段都翻译失败** |
| plato.stanford.edu | **无 CSP** | **整页流畅译文** |

**Firefox 让内容脚本的 `fetch` 受宿主页面 CSP 约束；Chrome 豁免；WebKit 也豁免**——今天 iPad
在**同一个维基页面**上用 DeepSeek 翻译成功，这就是对照。

所以之前几轮 Firefox「看起来能翻译」是因为 `*.googleapis.com` 恰好在维基的白名单里。

**这条同时说明：#80 原来的怀疑方向（key 没填对）是错的，真因是浏览器差异。**
DeepSeek 链路本身在 Firefox 上是通的，详见 #84。

### macOS Safari ❌ 仍未验证 —— 卡在人工步骤

macOS 目标已编译（`xcodebuild -scheme "BelliedMonkey Translator (macOS)"`）、容器 app 已运行、
Safari 已注册该扩展。卡在最后两步，自动化打不进去：

1. Safari → 设置 → **开发者 → 允许未签名的扩展**（新版 Safari 已不在「开发」菜单里，
   移进了设置的开发者分页）
2. Safari → 设置 → **扩展 → 勾选大肚猴翻译**

实测不通的手段：合成 ⌘,、`invoke_menu`（Safari浏览器 → 设置…，AX 返回成功但窗口不出现）、
AppleScript 打开设置。设置窗口在 WindowServer 与 AX 两个视角下都不出现。

**这是 iOS 输入解决之后，矩阵里剩下的唯一一处真正需要人的地方。** 值得写下来而不是每次
重新发现。


### macOS Safari ✅（同日补完，#80 收尾）

macOS 目标编译 → 运行容器 app → Safari 注册扩展。人工两步：设置 → 开发者 → **允许未签名的
扩展**；设置 → 扩展 → **勾选**。之后引擎选 DeepSeek、粘贴 key、点「翻译本页」。

实测（`do JavaScript` 直接读 DOM，非截图）：

```
{"total":26,"real":26,"pending":0,"failed":0}
```

最长一段译文抽样通顺完整。**页面是 en.wikipedia.org** —— 就是那个 CSP 白名单里没有
`api.deepseek.com` 的页面。

#### 这一行同时给了 #84 一个桌面对桌面的对照

| 浏览器 | 同一页面（维基，含限制性 CSP） | 同一服务商 | 结果 |
|---|---|---|---|
| macOS Safari | ✅ | DeepSeek | **26/26 全译** |
| Firefox | ✅ | DeepSeek | **全线失败** |

此前的对照是 iPad 对 Firefox（跨设备），现在是**同一台 Mac 上两个浏览器**。
「内容脚本 fetch 受页面 CSP 约束」确定是 Firefox 独有。

#### 一条测量纪律

这个 Safari 窗口的**截图全程是全白的**，而 DOM 里有 37 段正文、FAB 已注入。
照截图下结论会报出一个根本不存在的「页面渲染失败」。**截图不渲染 ≠ 页面是空的**——
窗口被遮挡/未合成时，`get_window_state` 的截图可以是空白而窗口内容完好。
可读 DOM 的场合一律以 DOM 为准。

（前置条件：Safari → 设置 → 开发者 → **允许 Apple 事件中的 JavaScript**。这个开关
AX 可点，不必麻烦人；只有「允许未签名的扩展」和扩展勾选需要人。）

### #80 结论

| 行 | DeepSeek 链路 |
|---|---|
| iPhone Safari | ✅ |
| iPad Safari | ✅ |
| macOS Chrome | ✅ |
| macOS Safari | ✅ |
| Firefox | ✅（无 CSP 页面；有 CSP 页面见 #84） |

**五行全部用 DeepSeek 验证过。** 用免费 Google 通道跑矩阵不仅不算数，而且会掩盖缺陷——
#84 正是因为坚持用 DeepSeek 才暴露的。


## Safari 扩展的可重复启用 —— 用真签名，不要临时扩展（2026-08-07）

**今天一整天反复出现的「扩展突然不跑了」，根因是一直在用未签名的临时扩展。**

| | 临时扩展（未签名） | 容器 App 真签名 |
|---|---|---|
| 每次 Safari 重启 | 「允许未签名的扩展」被关闭，重开要**管理员密码** | 不需要 |
| 添加方式 | 设置 → 开发者 → 添加临时扩展… → **文件选择器**（必须人点） | `cp` 到 `/Applications` + `open`，全脚本化 |
| 列在哪 | 「临时」 | **「已安装」** |
| 跨重启 | 丢失 | 存活 |

可脚本化的流程：

```bash
node build.js
xcodebuild -project "safari-project/…/BelliedMonkey Translator.xcodeproj" \
  -scheme "BelliedMonkey Translator (macOS)" -configuration Debug \
  -derivedDataPath /tmp/bmt-mac-signed -allowProvisioningUpdates build     # 不要 CODE_SIGNING_ALLOWED=NO

rm -rf "/Applications/BelliedMonkey Translator.app"
cp -R "/tmp/bmt-mac-signed/Build/Products/Debug/BelliedMonkey Translator.app" /Applications/
open "/Applications/BelliedMonkey Translator.app"

pluginkit -m -p com.apple.Safari.web-extension | grep belliedmonkey   # 登记成功的证据
```

**`CODE_SIGNING_ALLOWED=NO` 构建出的 app，即使放进 `/Applications` 也不会被 Safari 注册**
（实测确认）。必须用 `Apple Development` 身份真签名，工程里 `DEVELOPMENT_TEAM` 与
`CODE_SIGN_STYLE = Automatic` 都要在。

首次仍需人点两下（一次性，此后存活）：设置 → 扩展 → 勾选；以及详情里的
**「在每个网站上始终允许…」**。勾选框在 AX 里可读可点（id 形如
`com.belliedmonkeytranslator.extension (X2Q85MABWK)-checkbox`），站点授权按钮要按像素点。

## Stage 0 尖刺结论：原生消息在哪些上下文可用（2026-08-07）

学习模块迁入 App 的方案，基线假设是「扩展能把采集到的内容送进原生」。实测：

| 上下文 | `sendNativeMessage` | 说明 |
|---|---|---|
| **内容脚本** | **不存在** | `chrome` 与 `browser` 命名空间下都是 `undefined`——不是调用失败，是 API 根本不暴露 |
| **background** | **存在且可用** | 见下方时延 |

background 实测（macOS Safari，回声型 handler）：

```
tiny      ERR   289ms   "未能与帮助应用程序通信"   ← 冷启动，第一次必然失败
batch40   OK    821ms   40 条草稿，含帮助 app 启动
batch400  OK     10ms   400 条草稿（约 200KB）
serial10  OK      8ms   10 次调用 ≈ 0.8ms/次
```

### 三条直接影响设计的结论

1. **采集器写不了原生。** 采集跑在内容脚本里，那里没有这个 API。数据通路只能是
   `内容脚本 → chrome.storage.local 外发箱 → background/扩展页 → 原生`。
   外发箱保持不变这一点因此不是可选项，而是唯一可行解。
2. **第一次调用必然失败。** 帮助 app 冷启动时报「未能与帮助应用程序通信」。排空逻辑
   必须容忍并重试首次失败，否则每次冷启动都丢一批。**这条不实测就发现不了。**
3. **吞吐不是瓶颈。** 200KB 往返 10ms，热态下每次调用不到 1 毫秒。批量大小可以放心设计。

### 尚未验证

- **Safari iOS 上 background service worker 锁屏后永久失效**（本项目最老的约束）。若排空
  依赖 background，锁屏之后就再也不会发生，直到扩展重新加载。因此排空**还必须**能从
  用户打开的扩展页面发起——扩展页是否可用尚未实测（探针已写好，卡在 macOS 上打不开
  options 页；background 可用强烈提示扩展页同样可用，但**这是推断，不是测量**）。
- App Group 共享容器尚未验证（标准能力，风险低，但没测就是没测）。

---

## 尖刺：WKWebView 能不能后台播（2026-08-24）—— **模拟器已跑，真机未跑**

播客模式的后台/锁屏播放（`docs/learning-design.md` §9.5「后台与锁屏播放」）建立在几条
**没有测过的平台假设**上。按本文档 §0 的规矩，没测就是没测 —— 所以先量，再决定要写多少
原生代码。**下面的表在跑完之前一格都不许填。**

**只能在真 App 里测，不能在 iOS Safari 里测。** 问的是「一个声明了
`UIBackgroundModes: audio` 的宿主 App 的 web 视图」；Safari 标签页没有那个能力，
在那里测只会得到一个正确但无关的答案。（顺带钉住一个容易读错的地方：播客模式**不进扩展
任何字节**，App 的界面是 `app/**` 由 `loadFileURL` 加载进 App 自己的 web 视图 ——
那是这个 App 的渲染层，不是一个浏览器。）

**这个尖刺只为 iOS 存在。** macOS 上进程不会被挂起，最小化 / ⌘H / 切走都不会停，
所以那边没有「能不能」的问题，只有「我们有没有多余地停下来」的问题 —— 那是一条回归用例
（`learn-regression` M17），不是一次测量。macOS 唯一值得看一眼的是控制中心的
「正在播放」长什么样，跟着 M17 一起看。

**装机走 USB**（`xcrun devicectl device install app`，§0.2 的默认路径），不碰 TestFlight
—— 尖刺不该消耗一个构建号，更不该消耗一个版本号。

**音频素材内联，运行期零网络**：照 `scripts/verify-sim-audio.js` 的做法用 `say` +
`afconvert` 生成真 AAC，构建时内联成 data:URL。这样「没声了」不会和「网断了」混在一起，
而且播放形状与 `learn/tts.js` 的 `speech-compat` 分支逐字节同构（`new Audio('data:…')`，
禁 blob，同一条纪律）。

> **实际怎么跑的（2026-08-24）：没有造探针页，直接用真功能量。** 计划里写的是一个一次性
> 探针 App，但真功能本身就是最好的探针 —— 把播放顺序切成**顺序播放**（序号单调递增），
> 退到后台放一段固定时间，回来看序号涨了几张。这一个数同时回答了 A1 和 B：
> 序号要涨，音频链必须在播（A1）**且** JS 必须在跑（B），因为下一张卡是 `ended`
> 事件驱动出来的。**「跨了几张」是要害** —— 只看「当前这张播完了没有」分不出
> 「播完一张就停」和「一直在播」，而那正是这个功能的全部内容。
>
> 判据的力量来自对照：把「播放解析」关掉能让每张卡长度接近一致，两个引擎才可比。

| 探针 | 测什么 | 结论 |
|---|---|---|
| A1+B | data:URL 链播跨「退后台」（顺序播放，数跨了几张卡） | **✅ 模拟器绿**（iPhone 15 Pro · iOS 17.2，`openai_speech` 引擎但端点指向死地址 ⇒ 全部走本地音频缓存，纯离线）：后台 120 秒，**第 1 张 → 第 3 张**，回来仍在播。音频在播且 JS 在跑，两件事一个数就证完了 |
| C | 设备内置语音（`speechSynthesis`）在后台停不停 | **✅ 模拟器绿，与预期相反**：把 `backgroundCapable()` 临时改成只看 `ready()`（探针改动，测完当场还原），设备语音 + 关掉播放解析，后台 **240 秒 → 第 1 张走到第 6 张**（跨 5 张），回来仍在「第 2 遍 · 播放译文」。速率与 A1 那组相当（≈120 秒 2~2.5 张），所以不是「播一张就停」。**结论：`speechSynthesis` 并不因为 App 退到后台而停 —— 只要宿主声明了 `UIBackgroundModes: audio` 且会话是 `.playback`** |
| A2 | 段间插 5 秒真静默 —— 静默期容忍度 | ⬜ 未跑（A1/C 都绿，暂时没有做保活的理由；真机若发现空档挂起再补） |
| D | `navigator.mediaSession` 的 action handler 在锁屏上按下时进不进 JS | ⬜ 未跑 —— 已改为直接走原生 `MPRemoteCommandCenter`（macOS 侧已实证可用，见 D-mac），所以这条不再是必答题 |
| D-mac | macOS：控制中心的「正在播放」是否显示我们的元数据、按钮是否真的到得了 JS | **✅ 真 Mac 绿**：面板里显示原句/译句、只有 ⏸ 与 ⏭、无进度条；退出会话后菜单栏那一项消失。见 `learn-regression` M17 |
| E | 后台时 Swift 的 `evaluateJavaScript` 还通不通 | ⬜ 未单测；C 与 D-mac 都要求这条通，但那是推断不是测量 |

**判读规则先写死，结论不能事后编：**

| 观察到 | 结论 | 后果 |
|---|---|---|
| `hidden` 期间新的 `ended` 继续出现且有声 | data:URL 链跨后台成立 | 不需要原生播放队列，按 §9.5 的方案走 |
| 有声但不再出现新的 `play()` | web 进程被挂起 | 连播必须整卡/整轮交给原生排队 —— **另一个规模的改动，停下来重新评审** |
| 一进后台就没声 | 会话类别 / plist 没生效 | 先修这个再重测，别急着下别的结论 |
| 心跳停但 `ended` 照常 | 只是定时器节流 | 链路安全 |
| A2 挂而 A1 不挂 | 静默期容忍有限 | 要做保活（音量 0 的静音循环），并把「冷卡等网络」列进 §9.5 已知风险 |
| C 停 | 设备语音后台必停 | **必须做原生语音合成桥**（`AVSpeechSynthesizer`），让默认引擎也走 App 自己的音频会话出声 —— 中国版没有云端语音，而「中国版没有后台播放」被 AGENTS.md 规则 10 直接禁止（§9.5 的 2026-08-24 裁定）。不是「说明一下就算了」<br>**模拟器上 C 没停**（见上表），所以这条暂时没有触发。**但模拟器不是真机**：它对后台挂起的执行宽松得多，这个绿只够撤销「必须现在就做原生桥」的紧迫性，不够撤销那道 `returnsAudio` 门 —— 门要等真机 |
| D 绿 | Media Session 够用 | 原生只剩「设音频会话」几行，不建消息桥 |
| E 绿 | 后台 Swift→JS 通 | 遥控链路成立 |

> **模拟器的绿是弱证据，红才是强证据。** 模拟器不像真机那样严格挂起后台 App，所以
> 「在模拟器上没停」推不出「在 iPhone 上不会停」；反过来「在模拟器上都停了」则一定
> 在真机上也停。上表里的 ✅ 全部按这个折扣读 —— 它们撤销的是**紧迫性**（不必现在就
> 抢着做原生语音合成桥），不是**判据**（那道 `returnsAudio` 门要等真机才动）。

> **证据必须是回前台后读得到的东西。** 后台时没有屏幕可看：日志 append 进
> `localStorage`（跨挂起、跨杀进程存活）+ 一个 `<pre>`，回前台一次读回。
> 往 Mac 上 `fetch` 是旁证，可选，且**失败不得被读成「JS 停了」** —— 无线电可能只是
> 休眠了。仲裁者永远是 `localStorage` 那一份。
