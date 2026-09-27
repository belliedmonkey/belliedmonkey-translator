// shared/quick-setup-view.jsx — QuickSetup 的渲染半边（PR7b 起）。
//
// 纯逻辑（platforms / plan / prefill / tryVisible…）在 src/shared/quick-setup.js；
// 本文件是旧 render() 与 runOne() 的后继。保持**命令式**而不是改写为 JSX，理由与
// engine-fields-view.jsx 相同且更多一条：
//
//   · 「配好」的整个执行流是命令式异步状态机：点下按钮 → 现读设置 → plan → 逐槽
//     建结果行 → await onApply → 逐槽测试 → 失败追加「重试这一项」按钮（点击时
//     remove 自己再重测）。JSX 化等于把这条流重写一遍，每一步都是行为漂移的机会。
//   · id（qs-platform / qs-base-row / qs-base / qs-key / qs-key-link / qs-apply /
//     qs-res / qs-try）被宿主与门禁钉着；.qs-res 的四行形状被 app/setup-done 的
//     回执消费方看着。
//
// 孤岛契约（§10.9）：宿主把本文件挂进 ref 容器，承诺永不重渲染孤岛子树，运行期
// 变化由宿主显式重调 render —— 与 engine-fields-view.jsx 逐字同一条。

import { labelOf } from './engine-fields.js';
import Registry from '../lib/registry.js';
import {
  platforms, plan, tryUrl, tryVisible,
} from './quick-setup.js';

const STYLE = `
  .qs-wrap { display:flex; flex-direction:column; gap:10px; }
  /* 次要文字走 --text-secondary，不走 opacity：透明度把 4.5:1 的字压成 3.4:1，
     而它在三个宿主的三张样式表里都没人管（2026-09-06 深浅色核查）。 */
  .qs-sub { font-size:.9em; color:var(--text-secondary, inherit); margin:0; }
  .qs-privacy { font-size:.85em; color:var(--text-secondary, inherit); margin:0; }
  /* 链接颜色必须自带：这个组件挂在引导页 / 扩展设置页 / App 设置页，三张样式表里
     原来没有一张给 <a> 上色 —— 浏览器默认蓝在深色底上 1.9:1（2026-09-06 报障）。 */
  .qs-key-link { font-size:.85em; margin:0; color:var(--link, inherit); text-decoration:underline; }
  .qs-try { margin-top:4px; }
  .qs-try-note { font-size:.85em; color:var(--text-secondary, inherit); margin:0; }
  .qs-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .qs-row label { flex:0 0 auto; font-size:.85em; color:var(--text-secondary, inherit); min-width:3em; }
  .qs-row input, .qs-row select { flex:1 1 8em; min-width:0; }
  .qs-res { display:flex; flex-direction:column; gap:6px; margin:0; padding:0; list-style:none; }
  .qs-res li { font-size:.9em; line-height:1.5; white-space:pre-wrap; }
  .qs-res .qs-name { font-weight:600; }
  .qs-ok { color:var(--sage-text, #2f6b4f); }
  .qs-bad { color:var(--danger, #c0392b); }
  .qs-idle { color:var(--text-secondary, inherit); }
  .qs-res button { font-size:.8em; padding:2px 8px; width:auto; margin:0 0 0 6px; }
`;
let styled = false;
function injectStyle(doc) {
  if (styled || !doc) return;
  const el = doc.createElement('style'); el.textContent = STYLE; doc.head.appendChild(el);
  styled = true;
}

const SLOTS = ['chat', 'tts', 'stt'];
// 写成函数而不是 [key, 兜底串] 的表：兜底串放在数据结构里，
// test/no-hardcoded-copy.test.js 认不出它是兜底位。而那条门禁曾经**看不见这一段**
// （quick-setup.js 有 310 行被一个假块注释吞掉了，2026-08-31 修好扫描器后才露出来），
// 所以这份写法一直没被拦过。
const slotLabel = (slot, t) => (slot === 'chat' ? t('qs_slot_chat', '翻译')
  : slot === 'tts' ? t('qs_slot_tts', '朗读')
    : t('qs_slot_stt', '转写'));

// named export：三个宿主（options / onboard / App settings-view）的一键卡挂载点是
// 命令式孤岛（§10.9），依赖这个 render 的两条旧语义：平台表为空时写 `box.hidden =
// true`（宿主读 `box.hidden` 回读、且以 `children.length` 做不重画守卫），执行流是
// 点按钮后的命令式异步状态机（现读设置 → plan → 逐槽测试）。宿主保孤岛、named
// import 这里的 render，调用点逐字保留。
export function render(box, opts) {
  const t = opts.t;
  const doc = box.ownerDocument;
  injectStyle(doc);
  box.textContent = '';

  const list = platforms();
  if (!list.length) { box.hidden = true; return; }   // 空壳不留
  box.hidden = false;

  // 已经配过的，回显出来。空着的输入框在一个**已经配好**的页面上是假话：它看起来
  // 像「你还没配」，而用户此刻能做的唯一动作（粘一把新 key）会覆盖掉现有配置。
  // prefill 由 host 算好传进来（组件不碰存储）。
  const pre = opts.prefill || null;

  const el = (tag, cls, txt) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  const wrap = el('div', 'qs-wrap');

  // 副标题可由 host 覆盖。默认那句写的是「其它引擎请在各自的卡片里单独配置」——
  // 那在设置页上是真的（引擎/语音/学习各有一张卡），在引导页上不是：那里没有别的
  // 卡片，只有一个「手动填」的展开。一句指向不存在地方的说明比没有说明更糟。
  wrap.append(el('p', 'qs-sub', opts.sub || t('qs_sub',
    '下面这些平台，一把 key 能同时配好翻译、朗读、转写。其它引擎请在各自的卡片里单独配置。')));

  // 只有一项时不渲染 <select> —— 一个只有一个选项的下拉是在假装有选择。
  let current = (pre && pre.custom && list.find((p) => p.custom))
    || (pre && pre.host && list.find((p) => p.host === pre.host)) || list[0];
  if (list.length > 1) {
    const row = el('div', 'qs-row');
    row.append(el('label', null, t('qs_platform', '平台')));
    const sel = el('select'); sel.id = 'qs-platform';
    list.forEach((p, i) => {
      const o = doc.createElement('option');
      o.value = String(i);
      // 自定义那一项没有 host 可写（地址还没填）—— 标签就是注册表里那条引擎的名字。
      // 标 data-custom：宿主与门禁靠它认人，别去猜标签长什么样（中国版那条注册表
      // 标签里本来就带「·」，按符号猜会认错）。
      o.textContent = p.custom ? labelOf(p.chat, t) : labelOf(p.chat, t) + ' · ' + p.host;
      if (p.custom) o.dataset.custom = '1';
      sel.append(o);
    });
    sel.value = String(list.indexOf(current));
    sel.addEventListener('change', () => { current = list[Number(sel.value)] || list[0]; paintPlatform(); });
    row.append(sel); wrap.append(row);
  } else {
    wrap.append(el('p', 'qs-sub', t('qs_only_one', '可用平台：{p}').replace('{p}',
      labelOf(current.chat, t) + ' · ' + current.host)));
  }

  // 接口地址：只有自定义平台要填（#421 C）。占位符**取自注册表的 placeholder** ——
  // 地址类的事实一律归注册表，这张卡不再抄一份示例地址。
  const baseRow = el('div', 'qs-row');
  baseRow.id = 'qs-base-row';
  baseRow.append(el('label', null, t('qs_base', '接口地址（完整）')));
  const base = doc.createElement('input');
  base.id = 'qs-base'; base.type = 'url'; base.autocomplete = 'off';
  base.autocapitalize = 'none'; base.spellcheck = false;
  if (pre && pre.baseUrl) base.value = pre.baseUrl;
  baseRow.append(base); wrap.append(baseRow);

  const keyRow = el('div', 'qs-row');
  keyRow.append(el('label', null, t('qs_key', 'API Key')));
  const key = doc.createElement('input');
  key.id = 'qs-key'; key.type = 'password'; key.autocomplete = 'off';
  key.placeholder = t('qs_key_ph', '粘贴一次，三样一起配好');
  if (pre && pre.key) key.value = pre.key;
  keyRow.append(key); wrap.append(keyRow);

  // 「我还没有 key」是这张卡最常见的断点 —— 卡在这一步，前面省下的二十几次点击
  // 一次都用不上。地址由注册表给（keyUrl），**不在这里写死**：同一条规则挡的是
  // defaultEndpoint 的第二份副本，地址类的事实一律归注册表。没有 keyUrl 的平台
  // 就不显示这一行（隐藏而不是显示一个死链）。
  const keyLink = el('a', 'qs-key-link');
  keyLink.id = 'qs-key-link';
  keyLink.target = '_blank'; keyLink.rel = 'noopener noreferrer';
  wrap.append(keyLink);

  // 这张卡里**没有**模型选择器。原本有一个「改一改用哪个模型」的折叠，
  // 2026-08-31 去掉：它与下面那个（同样折叠着的）手动引擎配置重复，而一张承诺
  // 「最少操作」的卡里放一个模型选择器，本身就在跟这个承诺打架。写进去的永远是
  // 注册表默认 —— 那正是 recommend.config.js 里有实测依据的那一个。改模型的路
  // 一条都没少：设置页的详细配置里三样各有各的字段。
  //
  // 下面这个函数只重画**跟着平台变**的两处（申请入口、隐私那句），换平台时调用。
  function paintPlatform() {
    const ku = (current.chat && current.chat.keyUrl) || '';
    keyLink.hidden = !ku;
    if (ku) {
      keyLink.href = ku;
      keyLink.textContent = t('qs_get_key', '还没有 key？去 {p} 申请 ↗')
        .replace('{p}', labelOf(current.chat, t));
    }
    // 自定义平台（#421 C）：多一个地址框；按钮与隐私句都只说它真做得到的那一样。
    baseRow.hidden = !current.custom;
    base.placeholder = (current.chat && current.chat.placeholder) || '';
    key.placeholder = current.custom
      ? t('qs_key_ph_one', '粘贴一次，配好翻译')
      : t('qs_key_ph', '粘贴一次，三样一起配好');
    btn.textContent = current.custom
      ? t('qs_apply_one', '用这个地址配好翻译')
      : t('qs_apply', '配好翻译、朗读、转写');
    // 转写那句隐私话只有在这个平台真的做转写时才成立。
    privacy.hidden = !!current.custom;
    privacy.textContent = current.custom ? '' : t('qs_privacy',
      '转写会把你的**录音**发到 {host} 识别，识别完立即丢弃，不存储也不同步。')
      .replace('{host}', current.host).replace(/\*\*/g, '');
  }

  // 常显、不可折叠。「录音去哪儿必须是一次显式选择」这条裁定的落点从一个复选框
  // 挪到了这里 —— 按下之前就看得见的一句话，加上一个点名三样的按钮。
  const privacy = el('p', 'qs-privacy');
  wrap.append(privacy);

  const btn = doc.createElement('button');
  btn.id = 'qs-apply'; btn.type = 'button';
  btn.textContent = t('qs_apply', '配好翻译、朗读、转写');
  wrap.append(btn);

  const res = el('ul', 'qs-res'); res.id = 'qs-res'; res.hidden = true;
  wrap.append(res);

  // 三行绿勾之后，这张卡原本就到此为止了 —— 用户配好了，然后停在一个设置页上，
  // 没有任何东西告诉他下一步该干什么。翻译是在**网页**上发生的，而设置页不是网页
  // （content script 不在 chrome-extension:// 上跑），所以「去用」必须是一次真正的
  // 跳转，不能只写一句说明。
  //
  // opts.showTry 由 host 决定：引导页自己有「现在翻一页看看」那一屏，在那里再来
  // 一个同义按钮是重复。默认不显示 —— 忘了传的 host 拿到的是今天的行为，不是一个
  // 半成品出口。
  const tryNote = el('p', 'qs-try-note'); tryNote.hidden = true;
  const tryBtn = doc.createElement('button');
  tryBtn.id = 'qs-try'; tryBtn.type = 'button'; tryBtn.className = 'qs-try'; tryBtn.hidden = true;
  tryBtn.textContent = t('qs_try', '现在翻一页看看');
  tryNote.textContent = t('qs_try_note',
    '打开一页真实网页，点右下角的悬浮按钮，原文下面就会出现译文。');
  tryBtn.addEventListener('click', () => {
    try { window.open(tryUrl(opts.targetLang), '_blank', 'noopener'); } catch (_) {}
  });
  wrap.append(tryNote, tryBtn);

  if (opts.disabled) { btn.disabled = true; key.disabled = true; }
  paintPlatform();
  box.append(wrap);

  btn.addEventListener('click', async () => {
    const k = key.value.trim();
    if (!k) { key.focus(); return; }
    // 自定义平台没有默认端点：地址是构成要件，缺了就什么都别写（plan 里也再挡一次）。
    if (current.custom && !base.value.trim()) { base.focus(); return; }
    // **点下去那一刻才读设置。** 原来这里用的是 render 时传进来的快照，而那份快照
    // 在 options 上是页面加载时读的、之后永不更新（s0）。后果不是显示不对，是丢数据：
    // 用户在「详细」里敲了 key → 点这个按钮 → state() 按旧快照判「没配过」→ 覆盖那把
    // key，还报「✓ 通了」。反向亦然（清空了 key 却说「没动 · 你已经配过了」）。
    //
    // 现读一次就把这一整类关掉：跨标签、跨模式、重复点击全覆盖，不需要任何事件监听。
    // 读失败**什么都不写** —— 一个读不出设置的时刻不该被当成「用户没配过」。
    let cur = opts.settings || {};
    if (typeof opts.readSettings === 'function') {
      const r = await opts.readSettings();
      if (!r || r.ok === false) {
        btn.disabled = false;
        res.hidden = false;
        res.textContent = '';
        const li = doc.createElement('li');
        li.append(el('span', 'qs-bad', t('settings_read_failed_short',
          '读不到已保存的设置，请稍后再试')));
        res.append(li);
        return;
      }
      cur = r.data || {};
    }
    // 免费额度的槽（尾号命中）可以被用户自己的 key 盖掉，结果行如实写「替换了免费额度的 key」（L737）。
    // 尾八位由宿主给（它存在 grantTail，不在 SETTINGS_KEYS 里）；2026-09-11 回归前这里没传，免费槽永远算「已配过」。
    let replaceKeyTail = '';
    try { replaceKeyTail = typeof opts.replaceKeyTail === 'function' ? String((await opts.replaceKeyTail()) || '') : String(cur.grantTail || ''); } catch (_) { replaceKeyTail = ''; }
    const p = plan({ platform: current, key: k, settings: cur, replaceKeyTail, baseUrl: base.value.trim() });
    btn.disabled = true;
    // 四行**在按下那一刻就存在**，不是「成功后才冒出来的绿框」—— 那种形状让失败
    // 看起来像什么都没发生。
    res.hidden = false;
    const rows = {};
    res.textContent = '';
    for (const slot of SLOTS) {
      const li = doc.createElement('li');
      const nm = el('span', 'qs-name', slotLabel(slot, t) + '：');
      const val = el('span', 'qs-idle', t('qs_testing', '测试中…'));
      li.append(nm, val); res.append(li); rows[slot] = val;
    }
    // 解析那一行恒定出现。不出现，它看起来就像被漏了。
    const nli = doc.createElement('li');
    nli.append(el('span', 'qs-name', t('qs_slot_notes', '解析') + '：'),
      el('span', 'qs-idle', t('qs_notes_follow', '跟随翻译引擎（未改动）')));
    res.append(nli);

    for (const sk of p.skipped) {
      rows[sk.slot].className = 'qs-idle';
      // 「这个平台没有这一样」与「你已经配过了」是两回事（#421 C）。原来两种都印成
      // 后者 —— 对一个只做翻译的平台，那句话是假的：用户并没有配过朗读。
      rows[sk.slot].textContent = sk.reason === 'absent'
        ? (current.custom ? t('qs_absent_custom', '— 这个地址不提供') : t('qs_absent', '— 这个平台不提供'))
        : t('qs_untouched', '— 没动 · 你已经配过了（{cur}）')
          .replace('{cur}', sk.current || t('qs_unknown', '已有配置'));
    }

    try { await opts.onApply(p); } catch (e) {
      for (const slot of p.tests) {
        rows[slot].className = 'qs-bad';
        rows[slot].textContent = '✗ ' + ((e && e.message) || 'save failed');
      }
      btn.disabled = false;
      return;
    }

    const results = await Promise.all(p.tests.map((slot) =>
      runOne(slot, p, current, rows[slot], t, doc, opts.targetLang)));
    // 被盖掉的免费额度槽要如实说（L737：「替换免费额度的 key」）—— 不论自检通没通，替换这件事已经发生了。
    for (const slot of p.replaced) {
      if (rows[slot]) rows[slot].textContent += '\n' + t('qs_grant_replaced', '（替换了免费额度的 key）');
    }
    btn.disabled = false;

    // 把这一轮的结果交给调用方 —— **不让它再测一遍**。App 侧的「配好了」回执
    // （app/setup-done.js）原来自己又跑了一遍 EngineTest：屏幕上两块自检并排、
    // 内容还不同步，而且每次点「配好」要发两倍的真实请求（都是花钱的）。
    // 画布第 7 页写的是「搬形状 A」，不是「再做一份」。
    if (typeof opts.onResults === 'function') {
      try { opts.onResults(p, results); } catch (_) { /* 订阅者抛了不该影响这张卡 */ }
    }

    // 只在**翻译这一路真的通了**的时候给出口。翻译没通却请人去翻一页，是把失败
    // 推迟到一个更难解释的地方发生。没测翻译（因为早就配过了）也算通 —— 那种情况
    // 下用户本来就在用。
    const show = !!opts.showTry && tryVisible(p.tests, results);
    tryNote.hidden = !show;
    tryBtn.hidden = !show;
  });
}

// 三条各自独立成败。失败**不回滚** —— 最常见的原因（key 少粘一位、限流、模型
// 下架）恰恰重试就过；回滚只会浪费掉用户已经付出的那次粘贴。
// targetLang 是**参数**，不是从外层闭包读的。runOne 与 opts 异层而居 —— 而它被
// try/catch 包着，一个 ReferenceError 会被印成一行错误文案「✗ opts is not
// defined」，看上去像是 key 或网络出了问题（2026-09-02 用户报的）。
async function runOne(slot, p, platform, cell, t, doc, targetLang) {
  const w = p.writes;
  const run = () => {
    if (slot === 'chat') {
      return EngineTest.translation({
        provider: w.provider, apiKey: w.apiKey, baseUrl: w.apiBaseUrl, model: w.apiModel,
        // 调用方传进来的目标语言。原来读 window.__mtTargetLang —— 那个全局**全仓
        // 没有任何一处赋值**，所以自检永远测 zh-CN。缺省仍回落到默认目标语言，
        // 但那是「调用方没传」的兜底，不是唯一的路。
        targetLang: targetLang || Registry.defaultTargetLang() || 'zh-CN',
      });
    }
    if (slot === 'tts') {
      return EngineTest.tts({ engineId: w.ttsEngine, apiKey: w.ttsApiKey, baseUrl: w.ttsBaseUrl, model: w.ttsModel, voice: w.ttsVoice });
    }
    return EngineTest.stt({ engineId: w.sttEngine, apiKey: w.sttApiKey, baseUrl: w.sttBaseUrl, model: w.sttModel });
  };
  cell.className = 'qs-idle';
  cell.textContent = t('qs_testing', '测试中…');
  try {
    const r = await run();
    cell.className = 'qs-ok';
    cell.textContent = EngineTest.format(r, null, t)
      // 三条测试都不覆盖**播放**（自动播放策略、编解码、音量）。这道缝要点名，
      // 而不是让用户以为朗读整条都验过了。
      + (slot === 'tts' ? '\n' + t('qs_tts_untried', '（还没试听 —— 到下面的〈语音〉卡点「试听一句」听一次）') : '');
    return { slot, ok: true };
  } catch (e) {
    cell.className = 'qs-bad';
    cell.textContent = EngineTest.format(null, e, t)
      // 用户在隐私敏感项失败时的第一个念头就是「有东西已经发出去了吗」。
      + (slot === 'stt' ? '\n' + t('qs_stt_failed_note',
        '录音功能不会因此打开。刚才发出去的是一段 0.6 秒的正弦音，不是你的声音。') : '');
    const again = doc.createElement('button');
    again.type = 'button';
    again.textContent = t('qs_retry', '重试这一项');
    // 只重测，不重写 —— 配置已经保存了。
    again.addEventListener('click', () => {
      again.remove(); runOne(slot, p, platform, cell, t, doc, targetLang);
    });
    cell.parentNode.append(again);
    return { slot, ok: false };
  }
}
