// pages/onboard.jsx — 扩展侧首次引导的 React 化（PR4；范式见 docs/domain-design.md
// §10.9）。前身 extension/onboard/onboard.js（本 PR 删除）。
//
// 内容是 App 六屏的**逆**：App 做了它能做的三屏（选语言 / 去装扩展 / 去登录），
// 这里做 App 结构上做不到的那三件事 —— 配引擎、开采集、翻第一页。
//
// 每一屏都是**真控件**，不是说明文字。理由在 app/app.js:256-262 那段注释里已经论证过：
// 一个「告诉你去哪里点」的引导，把用户送出去之后就失去了他；一个「就在这里点」的引导
// 不会。所以第 2 屏直接写 chrome.storage、第 3 屏直接开采集开关。
//
// 与命令式版本的对应关系：
//   · SETTINGS_KEYS 手抄清单           → SETTINGS_SCHEMA.keysFor('onboard')（schema 是
//                                       唯一登记处；ttsAutoPlay 的「不许给默认值」规矩
//                                       由孤岛的 readSettings 走 PageSettings.read 保住 ——
//                                       schema 默认值只喂 React 自己的派生，不喂 plan()）。
//   · storageGet / storageSet          → SettingsStore.init / SettingsStore.set（乐观更新 +
//                                       回声去重）；唯一的例外是 3 秒读超时 —— 那是
//                                       「回调根本不来就白屏」的保命（见 init effect）。
//   · applyI18n / document.title       → useT() + 一个 uiLang effect（标题跟语言走）。
//   · paint / paintFork / paintModes … → 从 state 派生：at/forkPick/forkLanded/manualMode
//                                       任一变化自动重渲染，「先全 hidden 再逐个打开」
//                                       的顺序约束随命令式重画一起消失。
//   · LearnGrant / QuickSetup / EngineFields 三个渲染器 → 命令式孤岛（§10.9 规则 4）：
//                                       ref 容器 + effect 挂载，render 幂等（都先
//                                       textContent='' 再画），React 只写孤岛容器的
//                                       hidden，孤岛内部 DOM 归孤岛。
//   · grantTail onChanged 监听         → useSettings 快照派生 + prev ref（首帧不算变化，
//                                       等价于原版「只认从空变非空」）；1500ms 自动前进
//                                       用 at ref 守卫（用户已手动走掉就不代点）。
//   · finish 的 extObSeen + onboarding_done  → SettingsStore.set + MTTelemetry.track
//                                       （事件名与字段字面量保真；telemetry-design §3.6）。

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import PageText from '../lib/i18n.js';
import Registry from '../lib/registry.js';
import SETTINGS_SCHEMA from '../store/schema.js';
import SettingsStore from '../store/settings-store.js';
import { useSettings, useSettingsStatus, useUiLang } from '../store/hooks.js';

// 引导页是独立的一页，打开即出现 ⇒ 这一行就是「引导出现」的时刻（telemetry-design §3.9）。
const shownAt = Date.now();

// 屏序：四屏，两个 flavor 同形。
//
// **登录不在引导里**（2026-09-02 用户裁定）。它曾经是第 4 屏，排在「翻一页」之前 ——
// 也就是在人看到第一句译文之前，先要他填邮箱、收验证码。现在登录的请求由官网交接块
// 在**翻译成功那一刻**提出，并由复习页那行「未登录」接住；两处都在他已经看到价值
// 之后。这也正是 2026-09-01「官网试翻页上就地给」那条裁定的落点。
//
// try 仍是**终止屏**：它唯一的按钮开一个新标签，人就走了，引导这个标签留在背后。
// 所以它必须排最后，而且它的 CTA 同时是收尾键（finish 写 extObSeen）。
// 2026-09-22：砍掉原来的第 3 屏 `capture`（画布 #392 第 1 页「扩展 4 → 3 屏」）。
//
// 它教的是一个**默认已开**的开关（`background.js` 首装写 learnEnabled = true），
// 而它自己的文案第一句就是「已经开着了…不想要可以在这里关掉」—— 于是这一屏的净作用
// 是：在用户还没见过一张卡、还不知道复习是什么的时候，专门给他一个关掉它的机会。
// 开关与采集语言在设置页都在（`#learn-enabled` 与 SourcesView 的语言 chips），
// 要关的人找得到。⚠️ 这是**判断不是数据** —— 我们仍然看不到人在第几屏掉队，
// `onboarding_done.step` 出货之后才会告诉我们（telemetry-design §3.6）。
const OB = ['welcome', 'engine', 'try'];

const ONBOARD_KEYS = SETTINGS_SCHEMA.keysFor('onboard');

// store 的当前值拼一个 settings 形状的对象（孤岛的 values / onTest 现读用）。
// get() 对缺失键回落 schema 默认 —— 与原版「启动 raw 快照 + onChange merge」在控件
// 初值上等效（''/false 正是没配置时的显示值）。**QuickSetup 的 readSettings 判据不走
// 这里**（原版注释：plan() 要靠 undefined 区分「从没选过」的 ttsAutoPlay），它仍走
// 下面的 readSettings —— PageSettings.read 只返回存储里实际存在的键，语义原样。
function readSnapshot(keys) {
  const out = {};
  for (const k of keys) out[k] = SettingsStore.get(k);
  return out;
}

// 一键卡在**点下按钮那一刻**用它现读一次，而不是拿加载时的快照。
// 读失败必须报失败，不能回落成 {} —— 空档案会被 state() 判成「什么都没配过」，
// 然后照着这个判断覆盖存储。page-settings.js 的文件头用 27 行论证过同一件事。
// （PageSettings 不在时退回裸 storage —— 原版的防御原样保留。）
function readSettings() {
  if (typeof PageSettings !== 'undefined') return PageSettings.read(ONBOARD_KEYS);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => done({ ok: false, data: {} }), 3000);
    try {
      chrome.storage.local.get(ONBOARD_KEYS, (res) => {
        clearTimeout(timer);
        done({ ok: !!res, data: res || {} });
      });
    } catch (_) { clearTimeout(timer); done({ ok: false, data: {} }); }
  });
}

// 写局部 patch，**不是** options.js 的 saveAll()：那一份是整体覆盖式的，而这一页没有
// notes / 音色 / 语速 的控件，覆盖会把它们全部清空。逐键走 SettingsStore.set（乐观
// 更新 + 回声去重 + 失败回滚），最终状态与原版一次 storageSet 相同。
async function writePatch(patch) {
  for (const k of Object.keys(patch)) await SettingsStore.set(k, patch[k]);
}

// ── 第 1 屏的三幅插图 ────────────────────────────────────────────────────────
// 原来是 <template> + cloneNode；SVG 进 JSX（「图标用 JSX 子元素不用字符串」）。
// 只用令牌表里真实存在的变量（organic-tokens.gen.css）。写死 hex 会被 build.js 的
// 调色板门禁拦下 —— 那道门禁存在的理由就是防止品牌色出现第二份副本。
// 插图里**一个要翻译的字都没有** —— 文字放在 <li> 里，否则 8 种语言就要 8 套素材。
function Art1() {
  return (
    <svg viewBox="0 0 280 150" aria-hidden="true">
      <rect x="20" y="14" width="240" height="92" rx="10" fill="var(--card-bg)" stroke="var(--border)" strokeWidth="2" />
      <rect x="36" y="30" width="120" height="8" rx="4" fill="var(--text-secondary)" opacity=".55" />
      <rect x="36" y="48" width="196" height="6" rx="3" fill="var(--border)" />
      <rect x="36" y="62" width="180" height="6" rx="3" fill="var(--border)" />
      <rect x="36" y="76" width="196" height="6" rx="3" fill="var(--border)" />
      <rect x="36" y="90" width="140" height="6" rx="3" fill="var(--border)" />
    </svg>
  );
}
function Art2() {
  return (
    <svg viewBox="0 0 280 150" aria-hidden="true">
      <rect x="20" y="14" width="240" height="92" rx="10" fill="var(--card-bg)" stroke="var(--border)" strokeWidth="2" />
      <rect x="36" y="30" width="120" height="8" rx="4" fill="var(--text-secondary)" opacity=".55" />
      <rect x="36" y="48" width="150" height="6" rx="3" fill="var(--border)" />
      <rect x="36" y="62" width="130" height="6" rx="3" fill="var(--border)" />
      <circle cx="228" cy="82" r="17" fill="var(--accent)" />
      <circle cx="228" cy="82" r="25" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 4" opacity=".8" />
    </svg>
  );
}
function Art3() {
  return (
    <svg viewBox="0 0 280 150" aria-hidden="true">
      <rect x="20" y="14" width="240" height="92" rx="10" fill="var(--card-bg)" stroke="var(--border)" strokeWidth="2" />
      <rect x="36" y="28" width="180" height="6" rx="3" fill="var(--border)" />
      <rect x="36" y="40" width="150" height="6" rx="3" fill="var(--sage)" />
      <rect x="36" y="58" width="196" height="6" rx="3" fill="var(--border)" />
      <rect x="36" y="70" width="168" height="6" rx="3" fill="var(--sage)" />
      <rect x="36" y="88" width="96" height="10" rx="5" fill="var(--sage)" opacity=".45" />
    </svg>
  );
}

// ── 免费额度孤岛（§8.10）────────────────────────────────────────────────────
// 这一页**只展示、只指路**，不自己实现领取：登录表单与写盘路径都在设置页，而两个
// 页面同时备 PKCE verifier 会互相覆盖。唯一的动作是把人送到设置页的 #grant 锚点上。
//
// 这一页**不加载 auth.js**（那会把整套同步栈拉进引导流程），所以一律按未登录画：
// 引导中的人几乎必然还没登录；万一登录了，卡上那句把他送到设置页，那里是真实状态。
// 中国版走的是另一张卡（官方免费额度）—— flavor 与地址都从生成的注册表来，
// 不在这一页判 flavor 名。
//
// LearnGrant.render 画不出卡时自己会把容器 hidden 置真（「有没有卡要画」是它的
// 判断，不是调用方的）；画得出时它会把 hidden 置假 —— 这一步发生在 React 的
// DOM 之外，React 的 diff 看不见。所以 render 之后必须**立刻**把 hidden 对齐回
// props 的值（复刻原版 paintQuick 的分工：渲染器画内容，调用方定显隐），否则
// 挂载屏之外每一屏这张卡都会漏出来。hidden 的最终落定由此收敛在 props 一处。
// onShown 回读的是对齐**之前**的值 —— 那是 render 自己的「有没有卡要画」判断，
// 才是 grantShown 该记录的语义。
//
// useLayoutEffect 而非 useEffect：渲染器是同步 DOM 操作，而外部的验收门禁在
// click()/导航之后**同步**读渲染（getClientRects）—— 异步 effect 赶不上那次读。
// 原版 handler 里的 paint 也是同步的，这是同一份时序承诺。
function GrantIsland({ t, onShown, hidden }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    if (typeof LearnGrant === 'undefined') { onShown(false); return; }
    LearnGrant.render(ref.current, {
      t,
      status: LearnGrant.status(readSnapshot(ONBOARD_KEYS), { signedIn: false }),
      flavor: Registry.flavor(),
      keyUrl: (Registry.providers().find((x) => x.keyUrl) || {}).keyUrl || '',
      // 这一屏的主行动是「配好」（一键卡那个填色按钮）。两个填色按钮并排时用户
      // 看不出该点哪个 —— 2026-09-02 就为这件事把「继续」降过一次级，门禁也是
      // 那次立的。所以额度卡在引导页上是**次级**样式；到了设置页它是那张卡里
      // 唯一的按钮，不需要降级。
      secondary: true,
      onAction: () => {
        try { window.open(chrome.runtime.getURL('options/options.html') + '#grant', '_blank'); } catch (_) {}
      },
    });
    const drawn = !ref.current.hidden;
    ref.current.hidden = hidden;
    onShown(drawn);
    // mount 一次：卡内容与启动快照一一对应，显隐走 props（原版 render 也只跑一次）。
    // eslint 未启用；deps 空数组是有意为之。
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div id="ob-grant" ref={ref} hidden={hidden} />;
}

// ── 一键配置孤岛（QuickSetup）────────────────────────────────────────────────
// 原版 quickMounted 守卫 = render 只跑一次，prefill 冻结自启动快照。React 里同样的
// 一次性语义：mount effect 跑一次。onApply 写完盘后回调 onApplied —— 手动区那页要
// 按新值重画（原版 manualMounted=false + textContent=''）。
//
// QuickSetup.render 末尾会按清单非空把容器 hidden 置假（quick-setup.js:401）——
// 发生在 React 的 DOM 之外，React 的 diff 看不见。render 之后必须立刻对齐回
// props.hidden（分工同 GrantIsland：渲染器画内容，调用方定显隐），否则从挂载屏
// 起这张卡就在每一屏漏出来 —— 2026-09-26 的 test:onboard 四连红就是这么来的。
// useLayoutEffect 的理由同 GrantIsland：验收门在导航后同步读渲染。
function QuickIsland({ t, onApplied, hidden }) {
  const ref = useRef(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (mounted.current || !ref.current || typeof QuickSetup === 'undefined') return;
    mounted.current = true;
    const snap = readSnapshot(ONBOARD_KEYS);
    QuickSetup.render(ref.current, {
      t,
      readSettings,
      replaceKeyTail: () => new Promise((res) => chrome.storage.local.get(['grantTail'], (v) => res((v && v.grantTail) || ''))),
      sub: t('extob_quick_sub', '一把 key 就能同时配好翻译、朗读、转写。'),
      // 配过的回显出来。设置页早就这么做了（options.js 的 prefill），而这一页没有 ——
      // 于是从「重看开始使用引导」回来的老用户看到一个**空 key 框**，而这一页自己
      // 写过的规矩是「把已配好的 Key 显示成空白会让人以为设置丢了，比不给重看更糟」。
      prefill: (() => {
        const q = QuickSetup.represents(snap);
        return q ? { host: q.host, key: snap.apiKey } : null;
      })(),
      // 自检要按**用户真实的目标语言**测。原来它读一个全仓从未被赋值的
      // window.__mtTargetLang，于是永远测「译成 zh-CN」——一个把目标设成日文的人，
      // 自检通过了也说明不了他要的那条路通没通。
      targetLang: snap.targetLang,
      onApply: async (plan) => {
        await writePatch(plan.writes);
        onApplied();
      },
    });
    ref.current.hidden = hidden;
  }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div id="ob-quick" ref={ref} hidden={hidden} />;
}

// ── 三引擎分别配孤岛（EngineFields.render ×3）───────────────────────────────
// 控件与设置页**是同一批** —— 同一个组件、同一套 id，所以两边以后是一起改的。
// epoch 变化（一键卡刚写完盘）= 原版 manualMounted=false + 清空：三槽按新值重画。
function ManualIsland({ t, visible, epoch }) {
  const ref = useRef(null);
  // useLayoutEffect：visible 翻真的那一刻，三槽的控件要在**同步**落进 DOM ——
  // 验收门点完 tab 立刻数 select；异步 effect 赶不上（EngineFields.render 本身
  // 是同步的，原版 handler 里的重画也是同步的）。
  useLayoutEffect(() => {
    if (!visible || !ref.current || typeof EngineFields === 'undefined') return;
    const values = readSnapshot(ONBOARD_KEYS);
    ref.current.textContent = '';
    for (const slot of ['chat', 'tts', 'stt']) {
      EngineFields.render(ref.current, {
        slot,
        t,
        values,
        // 每改一个字段就落一次盘。**不防抖**中的那一半：输入框自己在组件里挂的是
        // input 事件（change 只在失焦时触发，用户填完直接点「继续」就丢了）。
        // store 的乐观更新让点「测试」时的现读（onTest）拿到的就是屏幕上那份。
        onChange: async (patch) => {
          // 在这一页选引擎就是一次**主动选择** —— 出厂默认不算。故意选了免费引擎的人
          // 必须能满足「配好了」，否则悬浮球会一直把他弹回这一页。见 engine-state.js。
          let p = patch;
          if (slot === 'chat' && 'provider' in patch) {
            p = Object.assign({}, patch, { engineChosen: 1 });
          }
          await writePatch(p);
        },
        // 自检。这一页原来**零反馈** —— 填完 key 唯一的回应是什么都没有，然后点
        // 「继续」。而这是整条链的第一环：key 没配对，后面每一步都白走，却要到他翻
        // 第一页时才发现（2026-09-02 链路核查）。
        //
        // 走的是各功能**真正用的那条传输**（EngineTest 的四条），所以「通了」意味着
        // 真的能翻/能读，不只是字段填了。**现读**：onChange 每敲一个字符就落盘，
        // 所以点测试时拿到的是屏幕上那份。
        onTest: () => {
          const cur = readSnapshot(ONBOARD_KEYS);
          if (slot === 'chat') {
            return EngineTest.translation({
              provider: cur.provider, apiKey: cur.apiKey,
              baseUrl: cur.apiBaseUrl, model: cur.apiModel,
              targetLang: cur.targetLang,
            });
          }
          if (slot === 'tts') {
            return EngineTest.tts({
              engineId: cur.ttsEngine, apiKey: cur.ttsApiKey,
              baseUrl: cur.ttsBaseUrl, model: cur.ttsModel, voice: cur.ttsVoice,
            });
          }
          // **没有 notes 这一支**：这一页的手动区只有 chat / tts / stt 三槽（解析跟随
          // 翻译引擎，与一键卡那边同一条规则）。写一支用不到的分支，代价是要为它加载
          // learn/notes.js —— 而 onboard.html 顶上那条注释明确说了别「顺手补齐」：
          // 那会把 IndexedDB 那一层拖进这一页，而三条被测的传输一个都不需要它。
          return EngineTest.stt({
            engineId: cur.sttEngine, apiKey: cur.sttApiKey,
            baseUrl: cur.sttBaseUrl, model: cur.sttModel,
          });
        },
      });
    }
  }, [t, visible, epoch]);
  return <div id="ob-manual" ref={ref} hidden={!visible} />;
}

function Onboard() {
  const t = PageText.useT();
  const status = useSettingsStatus();
  const s = useSettings(ONBOARD_KEYS);
  const uiLangNow = useUiLang();

  const [at, setAt] = useState(0);
  const [forkPick, setForkPick] = useState(null);   // null = 还没选 · 'grant' = 等领取 · 'key' = 自己配
  const [forkLanded, setForkLanded] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [done, setDone] = useState(false);
  const [grantShown, setGrantShown] = useState(false);
  const [epoch, setEpoch] = useState(0);            // 一键卡写完盘 → 手动区重画的信号
  // init 的 3 秒读超时（原版 storageGet 的保命）：PageSettings.read 没有超时，
  // 「回调根本不来」就永不落地，而这里的读发生在渲染第一屏之前，卡住就是白屏
  // （2026-08-29 真机实测过这一族）。超时后按 schema 默认值渲染 —— 原版超时后按
  // 空档案渲染，两者在「一切控件显示未配置初值」上同效。
  const [initTimedOut, setInitTimedOut] = useState(false);

  // 最新导航状态给 setTimeout 回调用（1500ms 自动前进只在人还停在这屏时执行）。
  const stateRef = useRef({});
  stateRef.current = { at, forkPick, forkLanded };

  // ── boot ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    SettingsStore.init(ONBOARD_KEYS);
    const id = setTimeout(() => setInitTimedOut(true), 3000);
    return () => clearTimeout(id);
  }, []);
  // 原版 applyI18n 只在启动跑一次 —— 引导页开着时 uiLang 不会变（这页没人改它）。
  // React 版额外获得：开着时在别处改 uiLang，标题与全部文案跟着换（行为增强，
  // 记入 PR 描述）。
  useEffect(() => { PageText.setUiLang(s.uiLang); }, [s.uiLang]);
  useEffect(() => {
    const dt = t('extob_header', '');
    if (dt) document.title = dt;
    // t 的结果随 uiLang 变；t 本身是恒定的模块函数，重跑时机由 uiLang 驱动。
  }, [uiLangNow]);   // eslint-disable-line react-hooks/exhaustive-deps
  // 把当前步骤 id 挂到 DOM 上。门禁原来靠「第一个带 CTA 的屏」来认 try 屏 ——
  // 那是个代理，2026-09-01 把 sync 挪到 try 前面时它就指错了屏，而断言照样在跑。
  // 页面自报身份之后，断言问的是「try 屏怎么样」，不是「看起来像 try 的那屏」。
  useEffect(() => {
    try { document.body.dataset.obStep = OB[at]; } catch (_) {}
  }, [at]);

  const ready = status !== 'loading' || initTimedOut;
  // 首帧门控：settings 读回前文案输出空串 —— 原版静态 HTML 就是空壳，读回后
  // paint 一次出字。原版唯一的区别是读回后那一帧的语言：这里首帧即 uiLang 生效的
  // 语言，不再有「先中文兜底再换语言」的闪烁。
  const T = (k, fb) => (ready ? t(k, fb) : '');

  const step = OB[at];
  const isLast = at === OB.length - 1;

  // 这一屏该不该出分流？判据是 **LearnGrant.enabled()**，即注册表里有没有
  // `MT_GRANT` —— 「我们代领的额度」这条路存不存在。按注册表内容判、不按 flavor 名
  // （沿用本文件顶部与 app/app.js:308-312 已确立的规则）。
  //
  // ⚠️ **不能用额度卡的显隐当判据**。它只回答「有没有一张卡要画」，而中国版画的是
  // 另一张卡（grant.js 的 officialCard：「去阿里云注册领额度，然后把 key 粘到下面」）——
  // 那是「自己配 key」那条路的说明，不是第二条路。拿它当判据，中国版会出现一个
  // 两选一，而其中一个选项在那一版根本不存在（2026-09-16 被 verify-onboard 抓到）。
  //
  // 已经领过的人（grantTail 非空）也不问：对他「用免费额度开始」已经发生过了，
  // 再问一遍只是多一次点击。这个判据读的是**本次会话的启动快照**，不是活快照 ——
  // 原版的 settings 对象就是启动快照（onChanged 从不更新它），到账后 fork 屏的收起
  // 由 forkLanded 状态机负责。若这里读活快照，到账瞬间 fork 块会整个消失、直接跳去
  // 普通 engine 屏，「额度已到账」那句一帧都显示不出来，1500ms 的停顿也没了着落。
  // （lazy ref init：ready 后第一次渲染冻结一次，之后不再更新。）
  const bootSnap = useRef(null);
  if (ready && bootSnap.current === null) bootSnap.current = readSnapshot(ONBOARD_KEYS);
  const forkOpen = forkPick !== 'key'
    && typeof LearnGrant !== 'undefined' && LearnGrant.enabled()
    && !String((bootSnap.current && bootSnap.current.grantTail) || '').trim();
  const fork = step === 'engine' && forkOpen;
  const waiting = fork && forkPick === 'grant';

  // 一键卡渲染不出来的 flavor：没有可选的东西，就不给一个只有一边的二选一。
  // 原版判据是「render 后容器里有 children」—— render 一次挂上后恒真，等价于
  // QuickSetup 存在与否。
  const quickShown = typeof QuickSetup !== 'undefined';
  const manual = manualMode || !quickShown;

  // grantTail 到账：领取在设置页发生，但人不必自己走回来。只认**从空变非空**
  // （onChanged 也会因为别的写入触发；首帧的初始读不算「变化」）。
  const prevTail = useRef(undefined);
  useEffect(() => {
    const prev = prevTail.current;
    prevTail.current = s.grantTail;
    if (prev === undefined || prev || !s.grantTail) return;
    if (forkPick !== 'grant' || forkLanded) return;
    setForkLanded(true);
  }, [s.grantTail, forkPick, forkLanded]);
  // 到账后的自动前进：让人看见「到账」再走，否则屏幕闪一下就换了，没人知道
  // 刚才发生了什么。1500ms 内用户已手动走掉（屏变了）就不再代点。
  useEffect(() => {
    if (!forkLanded || step !== 'engine') return;
    const id = setTimeout(() => {
      const cur = stateRef.current;
      if (cur.at === at && cur.forkLanded) setAt(at + 1);
    }, 1500);
    return () => clearTimeout(id);
  }, [forkLanded, step, at]);

  // ── 屏文案（全部派生）──────────────────────────────────────────────────────
  let title = ''; let text = '';
  if (step === 'welcome') {
    title = T('extob_welcome_title', '边读边记，不用离开页面');
    text = T('extob_welcome_body',
      '原文留在原地，译文长在下面。你真正停下来读完的句子会变成复习卡，按遗忘曲线回来找你。');
  } else if (fork) {
    // 分流屏（画布方案 A）。只在**有免费额度可领**且用户还没在这一屏做过选择时出。
    // 遥测查实：不用填 key 的那条路激活率 83%，要填 key 的 14–38%；而这一屏原来把
    // 「要填 key」做成填色主行动、免费额度是次级样式 —— 产品和数据正好反着。
    //
    // 这**不是多一屏**：OB 数组、进度条、现有 id 全不动，只是 engine 屏多了一个前置态。
    // 选②之后的一切逐字不变。
    title = T('ob_fork_title', '你想怎么开始？');
    text = T('ob_fork_sub', '两条路都能用，之后随时能换。');
  } else if (step === 'engine') {
    // 不再按「有没有免费通道」分支。2026-09-01 裁定：决策不为免费通道开特例，
    // 第一优先级是一键配置 —— 原来那句「免费通道零配置就能用」正是在劝人别配。
    // 免费引擎仍然选得到（在「三引擎分别配」里），只是不再由我们推荐。
    title = T('extob_engine_title', '选一个翻译引擎');
    text = T('extob_engine_body_key', '这一步躲不掉：不填 key 就一个字也翻不出来。');
  } else if (step === 'try') {
    title = T('extob_try_title', '现在翻一页看看');
    text = T('extob_try_body',
      '打开一页真实网页，点右下角的悬浮按钮，原文下面就会出现译文。');
  }

  // 页脚。主/次逐屏派生：默认「继续」是主行动；engine 屏（含分流屏）把它降级 ——
  // 这一屏的主行动是**配好**，两个填色按钮并排时用户看不出该点哪个（2026-09-02
  // 靠一张截图才发现）。分流屏到账之后「继续」升回主行动：这时它不再是「先不配」，
  // 而是「带我去下一步」—— 自动前进万一没跑到，人不该卡在一句提示上。
  const nextLabel = step === 'welcome' ? T('ob_start', '开始设置')
    : isLast ? T('extob_finish', '完成') : T('ob_next', '继续');
  const nextSecondary = step === 'engine' && !(fork && forkLanded);
  // try 屏**只有 CTA 一个按钮**。「继续」在这里是「配好了但不去看」，「以后再设置」
  // 是「配好了但不用」—— 都在跟这一屏唯一想让人做的事抢注意力。
  const footHidden = step === 'try';

  // done 屏的反馈地址与遥测披露。地址坏了不能拖垮收尾页（原版 catch 里 hidden）。
  let fbHref = '';
  try { fbHref = MTFeedback.mailtoUrl('onboarding'); } catch (_) {}
  // 匿名用量事件说在前面（docs/telemetry-design.md §5）：默认开、设置里可关。中国版没有
  // telemetry.js，经 Registry 的命名 getter 读那个布尔（src-boundaries 门）。
  const telemetryOn = Registry.telemetryEnabled();

  function openGrantPage() {
    try { window.open(chrome.runtime.getURL('options/options.html') + '#grant', '_blank'); } catch (_) {}
  }

  // ── 收尾 ────────────────────────────────────────────────────────────────────
  // `result`：走完还是跳过 —— 两条路本来就走同一个收尾，于是在表里长得一模一样
  // （telemetry-design §3.6，2026-09-22）。`step` 是**离开时停在哪一屏**，只记这一条：
  // 每屏一条回答不了任何一问，只是噪声。
  async function finish(result) {
    await SettingsStore.set('extObSeen', 1);
    try {
      if (typeof MTTelemetry !== 'undefined') {
        // dwell（§3.9 提案 A）：分桶的停留时长，用来分开「没读就跳」与「读了还是跳」。
        // 算不出来就**不带这个键** —— 空串不在枚举里，会把整条事件判掉。
        const d = MTTelemetry.dwell(shownAt);
        MTTelemetry.track('onboarding_done', Object.assign({
          surface: 'ext', result: result === 'skipped' ? 'skipped' : 'done', step: OB[stateRef.current.at],
        }, d ? { dwell: d } : {}));
      }
    } catch (_) {}
    setDone(true);
  }

  // ── 导航 ────────────────────────────────────────────────────────────────────
  function onNext() {
    // 「继续」不许把已经填好的 key 静默丢掉。选引擎屏上，提交键（#qs-apply）在一键卡
    // 的**最下面**，而这一屏在手机宽度上装不下两张卡 —— 2026-09-09 iPhone Safari 实测
    // 393×659：额度卡把 #qs-apply 顶到 y=635，吸底页脚从 554 起，于是首屏唯一看得见的
    // 按钮就是这颗「继续」，而它当时只前进、不提交。粘完 key 点它 = key 没了，界面还
    // 说设置完成 —— 正是「静默失败」那一类。
    //
    // 所以：填了 key 又还没提交过（结果行 #qs-res 仍是 hidden）时，这颗键先替他提交，
    // **并且不前进** —— 三行绿勾要让他看见，那是「真的配上了」的唯一证据。
    // （#qs-* 在孤岛内部，孤岛承诺不重渲染，DOM 稳定，按 id 直查是命令式互操作。）
    if (step === 'engine') {
      const qk = document.getElementById('qs-key');
      const qa = document.getElementById('qs-apply');
      const qr = document.getElementById('qs-res');
      const quickEl = document.getElementById('ob-quick');
      if (qk && qa && qr && qr.hidden && qk.value.trim() && quickEl && !quickEl.hidden) {
        qa.click();
        return;
      }
    }
    // flushSync：前进必须在 click() 返回时已经画好。原版 handler 里同步 paint，
    // 而 React 18 对 discrete 事件的 commit 排在微任务里 —— 同步调用方（验收门禁
    // 在 click() 之后立刻读渲染）会读到上一屏。下面 fork 两卡与两个 tab 的
    // onClick 同理；只有「点完立刻有脚本读 DOM」的这五个 setState 需要。
    if (at < OB.length - 1) flushSync(() => setAt(at + 1));
    else finish();
  }

  function onTryCta() {
    // 地址走 QuickSetup.tryUrl —— 设置页的「现在翻一页看看」去的是同一页，
    // 两处各写一份 flavor→域名 的映射迟早会漂。按**目标语言**选页：目标是英文的
    // 人打开一页英文示例，看到的是英文翻英文。
    window.open(QuickSetup.tryUrl(s.targetLang), '_blank', 'noopener');
    // 它同时是收尾键。try 现在**永远是最后一屏**（见 OB 的注释：它是终止屏，
    // 点下去人就去了另一个标签），所以这里必须 finish() —— 否则 extObSeen 不写，
    // 弹窗会一直提示「第一次用？」。
    finish();
  }

  const grantBoxHidden = step !== 'engine' || fork || manualMode || !grantShown;
  const quickBoxHidden = step !== 'engine' || fork || manual || !quickShown;
  const manualBoxHidden = step !== 'engine' || fork || !manual;

  return (
    <div className="page">
      <header className="page-header">
        <img src="../icons/icon.svg" width="40" height="40" alt="" />
        <span>{T('extob_header', '大肚猴翻译 · 开始使用')}</span>
      </header>

      <main>
        <section id="onboard" hidden={done}>
          <div id="ob-bar"><div id="ob-fill" style={{ width: Math.round(((at + 1) / OB.length) * 100) + '%' }} /></div>
          <div id="ob-body">
            <h2 id="ob-title">{title}</h2>
            <p id="ob-text">{text}</p>

            {/* 第 1 屏：三步带插图。形状与 App 引导那屏同构（app/app.js 的 obSteps）。
                三步讲的是**这个产品怎么用**，不是怎么配 —— 配置是下一屏的事。 */}
            <ol id="ob-steps" hidden={step !== 'welcome' || !ready}>
              <li>
                <b>1</b>
                <div className="ob-step-body">
                  <span>{T('extob_use_1', '打开一页外语网页')}</span>
                  <Art1 />
                </div>
              </li>
              <li>
                <b>2</b>
                <div className="ob-step-body">
                  <span>{T('extob_use_2', '点右下角的悬浮按钮')}</span>
                  <Art2 />
                </div>
              </li>
              <li>
                <b>3</b>
                <div className="ob-step-body">
                  <span>{T('extob_use_3', '译文长在原文下面；你真正读完的句子会变成复习卡')}</span>
                  <Art3 />
                </div>
              </li>
            </ol>

            {/* 第 2 屏的前置分流（2026-09-16，画布方案 A）。先问一句「你想怎么开始」，
                而不是把两条路并排摆着让人比较。「继续」保留、降为次级（裁定 D2：
                登录永远不是墙）—— 既不想领额度、也还不想配 key 的人，必须有一条
                往下走的路，否则这一屏就成了墙。2026-09-16 第一版把它藏了（想让
                「选择本身就是前进」），被 verify-onboard 挡下：门禁逐屏点「继续」
                遍历，藏了它之后整条遍历卡死在第 2 屏 —— 那也正是用户会卡的地方。 */}
            <div id="ob-fork" hidden={!fork}>
              <div id="ob-fork-pick" hidden={waiting}>
                <button id="ob-fork-grant" type="button" className="ob-fork-card ob-fork-primary"
                  onClick={() => { flushSync(() => setForkPick('grant')); openGrantPage(); }}>
                  <span className="ob-fork-head">
                    <span className="ob-fork-title" id="ob-fork-grant-title">{T('ob_fork_grant_title', '用免费额度开始')}</span>
                    <span className="ob-fork-badge" id="ob-fork-grant-badge">{T('ob_fork_grant_badge', '推荐')}</span>
                  </span>
                  <span className="ob-fork-desc" id="ob-fork-grant-desc">
                    {T('ob_fork_grant_desc', '不用申请 API key，登录一下就能翻。够日常读几百段网页和字幕。')}
                  </span>
                  <span className="ob-fork-cta" id="ob-fork-grant-cta">{T('ob_fork_grant_cta', '免费开始 →')}</span>
                </button>
                <button id="ob-fork-key" type="button" className="ob-fork-card"
                  onClick={() => flushSync(() => setForkPick('key'))}>
                  <span className="ob-fork-head">
                    <span className="ob-fork-title" id="ob-fork-key-title">{T('ob_fork_key_title', '我有自己的 API key')}</span>
                  </span>
                  <span className="ob-fork-desc" id="ob-fork-key-desc">
                    {T('ob_fork_key_desc', '一把 key 同时配好翻译、朗读、转写；也可以三个引擎分别配。')}
                  </span>
                  <span className="ob-fork-cta ob-fork-cta-quiet" id="ob-fork-key-cta">{T('ob_fork_key_cta', '去配置 →')}</span>
                </button>
                <p id="ob-fork-foot" className="hint">{T('ob_fork_foot', '额度用完了随时能换成自己的 key —— 设置里一步。')}</p>
              </div>
              {/* 领取在**设置页**发生（引导页不加载 auth.js：两个页面同时备 PKCE
                  verifier 会互相覆盖）。所以这一档不是干等 —— 领到会往
                  chrome.storage.local 写 grantTail，store 的 onChanged 订阅把它送回
                  这里，页面自己往下走。 */}
              <div id="ob-fork-wait" hidden={!waiting}>
                <p id="ob-fork-wait-line">
                  {forkLanded
                    ? T('ob_fork_landed', '额度已到账，正带你去下一步…')
                    : T('ob_fork_waiting', '正在新标签页里领取…登录完成后回到这里，会自动继续。')}
                </p>
                <button id="ob-fork-reopen" type="button" className="secondary" hidden={forkLanded}
                  onClick={openGrantPage}>{T('ob_fork_reopen', '重新打开领取页')}</button>
                <button id="ob-fork-fallback" type="button" className="link"
                  onClick={() => flushSync(() => setForkPick('key'))}>{T('ob_fork_key_title', '我有自己的 API key')}</button>
              </div>
            </div>

            {/* 第 2 屏：两个**互斥**的入口。同屏只显示其中一个。裁定见
                docs/interaction-spec.md：一键配置与逐引擎配置永不同屏 —— 两者共存时，
                在下面改了引擎，上面那张卡显示的状态就成了谎话。形状照设置页的
                #mode-tabs，不新造一套。 */}
            <div id="ob-modes" className="mode-tabs" role="tablist"
              hidden={step !== 'engine' || fork || !quickShown}>
              <button id="ob-mode-quick" type="button" role="tab"
                aria-selected={String(!manual)} onClick={() => flushSync(() => setManualMode(false))}>
                {T('extob_mode_quick', '一键配置')}
              </button>
              <button id="ob-mode-manual" type="button" role="tab"
                aria-selected={String(manual)} onClick={() => flushSync(() => setManualMode(true))}>
                {T('extob_mode_manual', '三引擎分别配')}
              </button>
            </div>

            {/* 免费额度（§8.10）。与一键卡**并排在同一个 tab 里**（裁定 D2：
                登录永远不是墙，这张卡旁边始终站着「用自己的 key」，「继续」始终可点）。
                注册表里没有额度规格（Registry.grant() 为 null）时整块不出 —— 中国版
                与开关未翻时就是这样。显隐只看
                **用户选的那个 tab**（manualMode），不看派生出来的 manual：额度卡属于
                「一键配置」这一档，而「一键卡里有没有可选平台」是另一个问题。 */}
            {ready && <GrantIsland t={t} onShown={setGrantShown} hidden={grantBoxHidden} />}

            {/* 一把 key 配好全部（QuickSetup） */}
            {ready && <QuickIsland t={t} onApplied={() => setEpoch((e) => e + 1)} hidden={quickBoxHidden} />}

            {/* 三引擎分别配（EngineFields.render ×3） */}
            {ready && <ManualIsland t={t} visible={!manualBoxHidden} epoch={epoch} />}

          </div>
          {/* 行动键全部在吸底页脚。#ob-cta 原来在 #ob-body 里，于是「现在翻一页看看」
              那一屏唯一的按钮会随内容滚走 —— 而那一屏没有别的出口。 */}
          <div id="ob-foot">
            <button id="ob-cta" type="button" hidden={step !== 'try'}
              onClick={onTryCta}>{T('extob_try_cta', '打开示例页面')}</button>
            <button id="ob-next" type="button" hidden={footHidden}
              className={nextSecondary ? 'secondary' : ''}
              onClick={onNext}>{nextLabel}</button>
            <button id="ob-skip" type="button" className="link" hidden={footHidden}
              onClick={() => finish('skipped')}>{T('ob_skip', '以后再设置')}</button>
          </div>
        </section>

        {/* 收尾屏。第 0 天就把出口给出来：引导页说得再对，真机上总有一个站不听话。 */}
        <section id="ob-done" hidden={!done}>
          <h2 id="ob-done-title">{T('extob_done_title', '设置好了')}</h2>
          <p id="ob-done-text">{T('extob_done_text',
            '打开任意外语网页，点右下角的悬浮按钮即可。想改设置或重看这段引导，都在扩展的设置页里。')}</p>
          <p id="ob-done-feedback" className="hint">
            <span id="ob-done-feedback-text">{T('extob_done_feedback', '哪里不对劲？写信给我 —— 每一封我都会读。')}</span>
            {' '}
            <a id="ob-done-feedback-link" target="_blank" rel="noopener"
              href={fbHref} hidden={!fbHref}>{T('feedback_row', '发送反馈')}</a>
          </p>
          {/* 匿名用量事件说在前面（docs/telemetry-design.md §5）：默认开、设置里可关。
              中国版没有 telemetry.js，整行不出。 */}
          <p id="ob-done-telemetry" className="hint" hidden={!telemetryOn}>
            <span id="ob-done-telemetry-text">{T('telemetry_onboard',
              '会发送匿名用量数据（不含网页内容与地址），帮助改进；设置里可关。')}</span>
            {' '}
            <a id="ob-done-telemetry-link" target="_blank" rel="noopener"
              href="https://belliedmonkey.cc/privacy.html#usage">{T('telemetry_what', '会发送什么')}</a>
          </p>
          <button id="ob-done-close" type="button"
            onClick={() => { try { window.close(); } catch (_) {} }}>{T('extob_done_close', '知道了')}</button>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Onboard />);
