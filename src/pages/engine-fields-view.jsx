// pages/engine-fields-view.jsx — engine-fields 的视图半边（PR7b 起）。
//
// 纯规则层在 src/shared/engine-fields.js（visibility / populate / SLOTS，两宿主
// 直 import）；本文件是旧 render() 的后继。它保持**命令式**而不是改写为 JSX：
//
//   · render() 画出的 19 个 id 被 options 的 saveNow 键域与 smoke 门钉着，DOM 结构
//     被 test:learn 的 76 选择器钉着 —— 结构重写等于把「翻转」变成「重写」。
//   · 宿主往 handle.rows[f].row / .inputRow 里挂 extras（设置页的三条 hint 模板与
//     「显示/隐藏」眼睛按钮是父级 cloneNode 后 append 进行的）。React 重渲染时对
//     「React 不知道的兄弟节点」没有承诺，纯 JSX 子树会被 diff 碰 —— 容器内部归
//     命令式 render 所有，React 永不进去（§10.9 孤岛规则）。
//   · 事件顺序照旧：render 里的原生监听在目标阶段先跑，options 的容器委托监听在
//     冒泡后跑 —— onProviderChange 读 chatCleared 的顺序陷阱由此逐字保留。
//
// 孤岛契约（§10.9）：宿主把本文件挂进 ref 容器，承诺永不重渲染孤岛子树 —— 输入框
// uncontrolled，store 是镜像不是源，运行期状态变化（界面语言、父级 epoch）由宿主
// 显式重调 render。handle 的形状与旧 render 的返回值逐字相同：
// { el, paint, rows, ids, keys, testNote }。

import EngineFields, { SLOTS, fieldLabels, visibility, populate, injectStyle } from '../shared/engine-fields.js';
import Registry from '../lib/registry.js';

// 旧 extension/learn/engine-fields.js 的 render(container, opts)，逐字搬运。唯一的
// 改动是注册表解析：`window[spec.registry]` → `Registry[spec.registry]()`（SLOTS 的
// registry 键现在是 getter 名；两宿主各自 bundle 外的生成注册表经 lib/registry.js
// 在调用时读 —— src-boundaries 门禁的唯一命中区）。
//
// named export：三个宿主（options / onboard / App settings-view）的挂载点是**命令式
// 孤岛**（§10.9）——它们要在 render 的返回句柄里挂 extras、读 rows[f].row。所以宿主
// 保孤岛、named import 这个 render，调用点逐字保留。
export function render(container, opts) {
  if (!container) return null;
  const o = opts || {};
  const spec = SLOTS[o.slot];
  if (!spec) return null;
  const t = o.t || ((k, fb) => fb);
  const doc = container.ownerDocument || document;
  const entries = o.entries || Registry[spec.registry]() || [];
  const values = o.values || {};
  injectStyle(doc);

  const el = (tag, cls, txt) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  const emit = (patch) => { if (typeof o.onChange === 'function') o.onChange(patch); };

  const L = fieldLabels(o.slot, t);
  const box = el('div', 'ef-slot');
  // head:false 给设置页用 —— 那边每个槽已经有一张卡的标题，再来一行「转写」是重复。
  // 引导页三个槽连着排，没有小标题就分不清哪三行属于哪一样。
  if (o.head !== false) box.append(el('div', 'ef-head', L.head));

  // 引擎行
  const engineRow = el('div', 'ef-row');
  const engineLabel = el('label', null, L.engine);
  engineLabel.setAttribute('for', spec.ids.engine);
  const sel = doc.createElement('select');
  sel.id = spec.ids.engine;
  populate(sel, entries, {
    t,
    selected: values[spec.keys.engine] || '',
    sentinel: spec.sentinelKey ? { value: '', text: L.sentinel } : null,
  });
  engineRow.append(engineLabel, sel);
  box.append(engineRow);

  // 其余三行。每一行都**始终建出来**，只切 hidden —— 与 options 同一条规矩：
  // 藏可以，删不行（删掉之后读它的地方会拿到 null，而 null 会被当成「用户清空了」）。
  const rows = {};
  for (const f of ['key', 'baseUrl', 'model']) {
    const row = el('div', 'ef-row');
    const lab = el('label', null, L[f]);
    lab.setAttribute('for', spec.ids[f]);
    const inp = doc.createElement('input');
    inp.id = spec.ids[f];
    inp.type = f === 'key' ? 'password' : (f === 'baseUrl' ? 'url' : 'text');
    // ⚠️ **别为了「让 1Password 能补齐 API key」来改这一行 —— 在这个页面上做不到。**
    //
    // 这个组件只渲染在**扩展自己的页面**（options / onboard，chrome-extension:// 与
    // moz-extension:// 源）。浏览器**禁止一个扩展向另一个扩展的页面注入内容脚本**
    // （Chrome 与 MDN 口径一致，理由是防止通过特权页提权）。所以密码管理器的内容
    // 脚本根本到不了这里，改 autocomplete / name / data-1p-* 一个字都不会生效。
    //
    // 能做到的面是另外两个：官网（普通 https 页）与宿主 App（WKWebView，走系统级
    // AutoFill 而不是浏览器插件）。App 那一侧的 markup 在 app/index.html，
    // 是否真能被填要在真机上看 —— 在拿到那个结论之前不动它的属性。
    //   —— 2026-09-04 查证
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    inp.value = values[spec.keys[f]] || '';
    // input 而不是 change：change 只在失焦时触发，用户填完直接点「继续」就丢了。
    // 2026-08-30 在 options.js 上修过的同一个缺陷，不要在新代码里重犯。
    inp.addEventListener('input', () => emit({ [spec.keys[f]]: inp.value.trim() }));
    // 输入框外面套一层 .input-row，是为了让 host 能往它**旁边**挂东西（设置页的
    // 「显示/隐藏」眼睛按钮就贴在 Key 输入框右边）。给组件加一堆 `eye:true`
    // `hint:'…'` 参数是另一条路，但那会让组件替每个 host 猜它想要什么；交回句柄，
    // host 自己挂，组件只管那四个框本身。
    const wrap = el('div', 'input-row');
    wrap.append(inp);
    row.append(lab, wrap);
    box.append(row);
    rows[f] = { row, input: inp, inputRow: wrap };
  }

  // 地址填完、离开输入框就判形状（2026-09-21，#385）。判据与文案都问 EngineTest ——
  // 组件不自己认识「什么样的地址算对」，那是 wire-format 的事，多一份必走样。
  //
  // 挂在**行里面**，理由同上面那条：行按 visibility 收起时提示跟着收。
  // 空地址不提示 —— 空 = 用注册表默认端点，是合法状态。
  const shapeNote = el('p', 'ef-field-note');
  shapeNote.hidden = true;
  rows.baseUrl.row.append(shapeNote);
  function paintShape() {
    const hint = (typeof EngineTest !== 'undefined' && typeof EngineTest.shapeHint === 'function')
      ? EngineTest.shapeHint(rows.baseUrl.input.value, t) : '';
    shapeNote.textContent = hint;
    shapeNote.hidden = !hint;
  }
  rows.baseUrl.input.addEventListener('blur', paintShape);
  // 已经在说话时才跟着每次输入重判：让用户改对的那一刻当场看见提示消失，而不是
  // 一边打字一边被一句红字追着跑。
  rows.baseUrl.input.addEventListener('input', () => { if (!shapeNote.hidden) paintShape(); });

  function paint() {
    const cur = entries.find((e) => e.id === sel.value) || null;
    const v = visibility(cur);
    paintShape();
    rows.key.row.hidden = !v.key;
    rows.baseUrl.row.hidden = !v.baseUrl;
    rows.model.row.hidden = !v.model;
    rows.baseUrl.input.placeholder = v.basePlaceholder;
    rows.model.input.placeholder = v.modelPlaceholder;
  }

  // 换引擎时清端点，而且**看得见地清**（interaction-spec 「接口地址字段」）。
  // 地址不能跨端点沿用 —— 同 src/app/settings-view.jsx 换语音引擎要重置音色的理由
  // （「音色名不跨引擎」）。带默认端点的条目清空后落在一个能工作的配置上；要求自填
  // 地址的条目本来也得重填。
  //
  // 放在组件里而不是各自的 change 处理器里：四组都要这条规则，options.js 原来只为
  // 其中三组写了，TTS 那组一直没有。patch 里带上被清的那个键，host 据此把「已清空」
  // 说给用户听 —— 静默丢掉别人填过的地址，正是这条规则要防的事。
  sel.addEventListener('change', () => {
    // 换引擎清空端点：把一个引擎的地址留给另一个引擎，正是 notes.js 明文禁止的
    // 「把 key 和一个不是发给它的端点配在一起」。清空 = 走注册表默认 = 能工作。
    rows.baseUrl.input.value = '';
    paint();
    emit({ [spec.keys.engine]: sel.value, [spec.keys.baseUrl]: '' });
  });

  // ── 自检按钮（可选）────────────────────────────────────────────────────
  //
  // **只有传了 onTest 的宿主才有。** 设置页四个槽早就各有一个静态的「测试连接」，
  // 连着它自己的 saveNow / assertEndpointShape / DOM id —— 把那些搬进这个组件是把
  // 宿主的事塞进组件里，方向反了。所以这里只管**按钮与状态行**（两个面长得一样），
  // 真正怎么测由宿主给。设置页不传 ⇒ 什么都不渲染 ⇒ 它一个字节都不受影响。
  //
  // 为什么引导页非有不可：「三引擎分别配」那一页原来**零反馈** —— 用户填完 key，
  // 唯一的回应是什么都没有，然后点「继续」。而这一步正是整条链的第一环：
  // key 没配对，后面每一步都白走，却要到他翻第一页时才发现（2026-09-02 链路核查）。
  let testNote = null;
  if (typeof o.onTest === 'function') {
    const wrap = el('div', 'ef-test');
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'ef-test-btn';
    btn.textContent = t('engine_test', '测试连接');
    testNote = el('p', 'ef-test-note');
    testNote.hidden = true;
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;            // 全局原则：IO 在途，控件不可用
      btn.disabled = true;
      testNote.hidden = false;
      testNote.className = 'ef-test-note';
      testNote.textContent = t('engine_testing', '测试中…');
      try {
        const r = await o.onTest();
        testNote.className = 'ef-test-note ok';
        // 成功也要说出**它做了什么**（耗时、真正请求的地址、走了哪条通路）——
        // 一句不带证据的「通了」，与「根本没发请求」在界面上一模一样。
        // format 的签名是 (result, err, t)，与 quick-setup 用的是同一个。
        testNote.textContent = EngineTest.format(r, null, t);
      } catch (e) {
        testNote.className = 'ef-test-note bad';
        // 具名失败 + 服务端原话（format 里已经带上了）。一句「失败」说不出该改哪个字段。
        testNote.textContent = EngineTest.format(null, e, t);
      } finally {
        btn.disabled = false;
      }
    });
    wrap.append(btn, testNote);
    box.append(wrap);
  }

  paint();
  container.append(box);
  // rows 交回去：host 想往某一行里加提示、按钮，就往 rows[f].row / .inputRow 里挂。
  // 挂在行内**而不是行外**是构成要件 —— 行按 visibility 收起时，挂在里面的东西
  // 跟着一起收；挂在外面就会出现「字段藏了、它的提示还在」。
  return { el: box, paint, rows, ids: spec.ids, keys: spec.keys, testNote };
}
