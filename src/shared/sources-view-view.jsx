// shared/sources-view-view.jsx — 来源管理的视图半边（PR7b 起）。
//
// 纯逻辑（五个分组函数）在 src/shared/sources-view.js，两宿主直 import；本文件是
// 旧 render()/renderLangChips() 的后继，保持**命令式**而不是改写为 JSX：render 画出
// 的全部 id 带 `srcm-` 前缀（App 包对与 review.html 的 id 撞车是构建期 FAIL），DOM
// 结构被 test:learn 双宿主驱动钉着，宿主在每次存储写完之后整视图重画（旧语义）。
// 容器内部归 render 所有，React 永不进去 —— 与 engine-fields-view.jsx 等三个视图
// 同一条命令式契约。

import Registry from '../lib/registry.js';
import { groupByHost, groupConversations, groupDocuments, groupHandoff } from './sources-view.js';

// Layout-only styles, injected once; colors and button chrome are inherited
// from the host page so the view looks native in both hosts.
//
// 旧文件在**模块加载期**求值模板字符串读 window.MT_PALETTE（旧单测因此要先垫
// window 再 require）。纯函数层不得在 import 期读注册表，这里改成注入时求值：
// palette.gen.js 先于一切加载、注入永远晚于它，两宿主行为逐字等价。
function buildStyle() {
  const p = Registry.palette() || {};
  return `
    .srcm-row { display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid rgba(128,128,128,.15); }
    .srcm-row:last-child { border-bottom:none; }
    .srcm-host { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .srcm-count { flex:0 0 auto; opacity:.65; font-size:.85em; }
    .srcm-row button { flex:0 0 auto; font-size:.85em; padding:4px 8px; margin:0; width:auto; }
    .srcm-blocked { opacity:.65; font-size:.85em; }
    .srcm-chips { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
    .srcm-chip { display:inline-flex; align-items:center; gap:6px; padding:3px 10px;
      border:1px solid rgba(128,128,128,.4); border-radius:999px; font-size:.85em; }
    .srcm-chip button { border:none; background:none; padding:0 2px; margin:0; width:auto;
      cursor:pointer; font-size:1em; line-height:1; color:inherit; opacity:.7; }
    .srcm-chip button:hover { opacity:1; }
    .srcm-add { display:flex; gap:8px; margin-top:8px; }
    .srcm-add input { flex:1 1 auto; min-width:0; }
    .srcm-add button { flex:0 0 auto; width:auto; margin:0; }
    .srcm-empty { opacity:.65; font-size:.9em; padding:6px 0; }
    .srcm-lang-chip { cursor:pointer; user-select:none; }
    /* Chip buttons must NOT inherit host button chrome: the options host paints
       every .card button green-on-white (specificity (0,3,1), beating a bare
       button.srcm-chip), which made unselected chips identical to selected ones.
       !important is deliberate — this widget owns its chip look in every host. */
    button.srcm-chip { background:none !important; font:inherit !important;
      color:inherit !important; font-weight:400 !important; text-align:left;
      border:1px solid rgba(128,128,128,.45) !important; border-radius:999px !important;
      padding:3px 10px !important; font-size:.85em !important; cursor:pointer; }
    button.srcm-chip:hover { background:${p.chipOnHover} !important; color:inherit !important; }
    /* Selected = solid fill, unmistakable at a glance. */
    button.srcm-lang-chip[data-on="1"] { background:${p.chipOn} !important;
      border-color:${p.chipOn} !important; color:#fff !important; font-weight:600 !important; }
    button.srcm-lang-chip[data-on="1"]:hover { background:${p.chipOn} !important; color:#fff !important; }
    .srcm-chip button { border:none !important; background:none !important;
      padding:0 2px !important; width:auto !important; }
    .srcm-row button:disabled, .srcm-add button:disabled, .srcm-chip button:disabled,
    button.srcm-chip:disabled { opacity:.55 !important; cursor:default; }
  `;
}

function ensureStyle(doc) {
  if (doc.getElementById('srcm-style')) return;
  const s = doc.createElement('style');
  s.id = 'srcm-style';
  s.textContent = buildStyle();
  doc.head.appendChild(s);
}

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// interaction-spec 全局原则 (IO 在途，控件不可用): every callback below reaches
// storage and often a forced network sync in the HOST — the host usually
// re-renders the whole view on success, but the disable must not depend on
// that: restore in finally so a failed callback hands the control back.
function lock(ctl, fn) {
  return (...args) => {
    if (ctl.disabled) return;
    ctl.disabled = true;
    Promise.resolve().then(() => fn && fn(...args))
      // 失败要具名 (same 全局原则): the host owns user-facing failure copy, but
      // a swallowed throw here would vanish entirely — name it in the console.
      .catch((e) => { try { console.error('[sources-view] callback failed:', e); } catch (_) {} })
      .then(() => { ctl.disabled = false; });
  };
}

// opts: { items, sources, rules, t, onDelete({host, pattern, itemIds, sourceIds}),
//         onBlock(pattern), onUnblock(pattern), onAddRule(normalizedPattern),
//         onInvalidRule() }
export function render(container, opts) {
  const doc = container.ownerDocument;
  ensureStyle(doc);
  const t = opts.t || ((k, fb) => fb);
  container.textContent = '';

  // ── grouped domain list ──
  const list = el(doc, 'div');
  list.id = 'srcm-list';
  const rows = groupByHost(opts.items, opts.sources, opts.rules);
  if (!rows.length) {
    list.appendChild(el(doc, 'div', 'srcm-empty', t('learn_sources_empty', '还没有采集到任何来源')));
  }
  for (const r of rows) {
    const row = el(doc, 'div', 'srcm-row');
    row.appendChild(el(doc, 'span', 'srcm-host', r.host));
    row.appendChild(el(doc, 'span', 'srcm-count',
      t('learn_sources_count', '{n} 张卡').replace('{n}', String(r.count))));

    const del = el(doc, 'button', '', t('learn_src_delete', '删除已存'));
    del.addEventListener('click', lock(del, () => {
      const doomed = LearnRules.doomedFor(opts.items, opts.sources, r.host);
      return opts.onDelete && opts.onDelete({
        host: r.host, pattern: r.host,
        itemIds: doomed.itemIds, sourceIds: doomed.sourceIds,
      });
    }));
    row.appendChild(del);

    if (!r.blocked) {
      const blk = el(doc, 'button', '', t('learn_src_block', '不再收录'));
      blk.addEventListener('click', lock(blk, () => opts.onBlock && opts.onBlock(r.host)));
      row.appendChild(blk);
    } else if (r.exactRule) {
      row.appendChild(el(doc, 'span', 'srcm-blocked', t('learn_src_blocked', '已屏蔽')));
      const un = el(doc, 'button', '', t('learn_src_unblock', '恢复收录'));
      un.addEventListener('click', lock(un, () => opts.onUnblock && opts.onUnblock(r.exactRule)));
      row.appendChild(un);
    } else {
      // Blocked by a BROADER wildcard rule: name the rule instead of offering
      // an unblock that would silently delete a rule covering other sites.
      row.appendChild(el(doc, 'span', 'srcm-blocked',
        t('learn_src_blocked_by', '由规则 {pattern} 屏蔽').replace('{pattern}', r.blockedBy)));
    }
    list.appendChild(row);
  }
  container.appendChild(list);

  // ── 对话（§9.6）：按会话一行，只有「删除已存」—— 屏蔽一场会话没有意义 ──
  const convs = groupConversations(opts.items, opts.sources);
  if (convs.length) {
    const wrap = el(doc, 'div');
    wrap.id = 'srcm-conv';
    for (const g of convs) {
      const row = el(doc, 'div', 'srcm-row');
      row.appendChild(el(doc, 'span', 'srcm-host', '🎙 ' + g.title));
      row.appendChild(el(doc, 'span', 'srcm-count', t('learn_sources_count', '{n} 张卡').replace('{n}', String(g.count))));
      const del = el(doc, 'button', '', t('learn_src_delete', '删除已存'));
      del.addEventListener('click', lock(del, () => opts.onDelete && opts.onDelete({
        host: g.title, pattern: '', itemIds: g.itemIds.slice(), sourceIds: [g.sourceId],
      })));
      row.appendChild(del);
      wrap.appendChild(row);
    }
    wrap.appendChild(el(doc, 'div', 'srcm-empty', t('listen_sources_note', '每句原文来自转写、译文来自你的翻译引擎，都可能有错——加星的句子优先进复习。')));
    container.appendChild(wrap);
  }

  // ── 实时字幕（§9.8）：与对话同形，按会话一行、只有「删除已存」──
  const subs = groupConversations(opts.items, opts.sources, 'subtitle');
  if (subs.length) {
    const wrap = el(doc, 'div');
    wrap.id = 'srcm-subs';
    for (const g of subs) {
      const row = el(doc, 'div', 'srcm-row');
      row.appendChild(el(doc, 'span', 'srcm-host', '📺 ' + g.title));
      row.appendChild(el(doc, 'span', 'srcm-count', t('learn_sources_count', '{n} 张卡').replace('{n}', String(g.count))));
      const del = el(doc, 'button', '', t('learn_src_delete', '删除已存'));
      del.addEventListener('click', lock(del, () => opts.onDelete && opts.onDelete({
        host: g.title, pattern: '', itemIds: g.itemIds.slice(), sourceIds: [g.sourceId],
      })));
      row.appendChild(del);
      wrap.appendChild(row);
    }
    wrap.appendChild(el(doc, 'div', 'srcm-empty', t('listen_sources_note', '每句原文来自转写、译文来自你的翻译引擎，都可能有错——加星的句子优先进复习。')));
    container.appendChild(wrap);
  }

  // ── 文档（§9.7）：按文档一行，只有「删除已存」（连文档本体一起删，宿主负责）──
  const docs = groupDocuments(opts.items, opts.sources);
  if (docs.length) {
    const wrap = el(doc, 'div');
    wrap.id = 'srcm-doc';
    for (const g of docs) {
      const row = el(doc, 'div', 'srcm-row');
      row.appendChild(el(doc, 'span', 'srcm-host', '📄 ' + g.title));
      row.appendChild(el(doc, 'span', 'srcm-count', t('learn_sources_count', '{n} 张卡').replace('{n}', String(g.count))));
      const del = el(doc, 'button', '', t('learn_src_delete', '删除已存'));
      del.addEventListener('click', lock(del, () => opts.onDelete && opts.onDelete({
        host: g.title, pattern: '', itemIds: g.itemIds.slice(), sourceIds: [g.sourceId],
      })));
      row.appendChild(del);
      wrap.appendChild(row);
    }
    wrap.appendChild(el(doc, 'div', 'srcm-empty', t('doc_sources_note', '删除会连文档本体一起删掉。')));
    container.appendChild(wrap);
  }

  // ── 交来的文字（§9.9）：按入口 + 月份一行，只有「删除已存」──
  const hands = groupHandoff(opts.items, opts.sources);
  if (hands.length) {
    const wrap = el(doc, 'div');
    wrap.id = 'srcm-handoff';
    for (const g of hands) {
      const row = el(doc, 'div', 'srcm-row');
      row.appendChild(el(doc, 'span', 'srcm-host', '↪ ' + g.title));
      row.appendChild(el(doc, 'span', 'srcm-count', t('learn_sources_count', '{n} 张卡').replace('{n}', String(g.count))));
      const del = el(doc, 'button', '', t('learn_src_delete', '删除已存'));
      del.addEventListener('click', lock(del, () => opts.onDelete && opts.onDelete({
        host: g.title, pattern: '', itemIds: g.itemIds.slice(), sourceIds: [g.sourceId],
      })));
      row.appendChild(del);
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
  }

  // ── block-rule chips ──
  const block = (opts.rules && opts.rules.block) || [];
  const chipsWrap = el(doc, 'div');
  chipsWrap.appendChild(el(doc, 'div', 'srcm-empty', t('learn_block_title', '屏蔽规则')));
  const chips = el(doc, 'div', 'srcm-chips');
  chips.id = 'srcm-block-list';
  if (!block.length) chips.appendChild(el(doc, 'span', 'srcm-empty', '—'));
  for (const p of block) {
    const chip = el(doc, 'span', 'srcm-chip');
    chip.appendChild(el(doc, 'span', '', p));
    const x = el(doc, 'button', '', '✕');
    x.setAttribute('aria-label', t('learn_src_unblock', '恢复收录'));
    x.addEventListener('click', lock(x, () => opts.onUnblock && opts.onUnblock(p)));
    chip.appendChild(x);
    chips.appendChild(chip);
  }
  chipsWrap.appendChild(chips);

  // ── advanced pattern input ──
  const add = el(doc, 'div', 'srcm-add');
  const input = el(doc, 'input');
  input.id = 'srcm-add-input';
  input.type = 'text';
  input.placeholder = t('learn_block_placeholder', '例如 *.example.com/news/*');
  const btn = el(doc, 'button', '', t('learn_block_add', '添加'));
  btn.id = 'srcm-add-btn';
  const submit = lock(btn, () => {
    const norm = LearnRules.normalizePattern(input.value);
    if (!norm) { opts.onInvalidRule && opts.onInvalidRule(); return; }
    input.value = '';
    return opts.onAddRule && opts.onAddRule(norm);
  });
  btn.addEventListener('click', submit);
  // Enter routes through the same lock: while the button is disabled the
  // keyboard path is refused too, not just the pointer one.
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  add.appendChild(input);
  add.appendChild(btn);
  chipsWrap.appendChild(add);
  chipsWrap.appendChild(el(doc, 'div', 'srcm-empty',
    t('learn_block_hint', '支持通配符：example.com 匹配整个域名（含子域）；*.example.com/news/* 匹配路径。')));
  container.appendChild(chipsWrap);
}

// The 学习语言 chip row (learning-design §4.1), same two hosts. `langs` is
// learnRules.langs (null = 全部); onChange receives the new value (null | [codes]).
export function renderLangChips(container, opts) {
  const doc = container.ownerDocument;
  ensureStyle(doc);
  const t = opts.t || ((k, fb) => fb);
  const registry = opts.registry || [];
  const selected = Array.isArray(opts.langs) && opts.langs.length ? opts.langs.slice() : null;
  container.textContent = '';
  const chips = el(doc, 'div', 'srcm-chips');

  // Real <button>s, not span[role=button]: the 全局原则 requires a disabled
  // state during the storage write + forced sync the host runs from onChange,
  // and a span cannot express one. Native buttons also give Enter/Space for free.
  const mk = (label, on, fn) => {
    const c = el(doc, 'button', 'srcm-chip srcm-lang-chip', label);
    c.type = 'button';
    c.dataset.on = on ? '1' : '0';
    c.addEventListener('click', lock(c, fn));
    chips.appendChild(c);
  };

  mk(t('learn_langs_all', '全部（默认）'), !selected, () => {
    if (selected) opts.onChange && opts.onChange(null);
  });
  for (const l of registry) {
    const on = !!selected && selected.indexOf(l.code) >= 0;
    mk(l.labelKey ? t(l.labelKey, l.label) : l.label, on, () => {
      let next;
      if (!selected) next = [l.code];
      else if (on) {
        next = selected.filter((c) => c !== l.code);
        if (!next.length) next = null;     // deselecting the last one = back to 全部
      } else next = selected.concat([l.code]);
      opts.onChange && opts.onChange(next);
    });
  }
  container.appendChild(chips);
}
