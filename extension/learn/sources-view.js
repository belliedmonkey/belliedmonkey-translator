// learn/sources-view.js — the shared 来源管理 renderer (SourcesView).
// interaction-spec 「来源治理」: one implementation, two hosts — the options page
// and the app shell (bundled via build/app-bundle.js). All element ids are
// prefixed `srcm-` because the app build FAILS on id collisions with review.html.
//
// The view is dumb on purpose: it renders the grouped domain list + block-rule
// chips and reports intent through callbacks. Storage writes, confirms, deletes
// and re-renders belong to the HOST — this file never touches chrome.storage or
// IndexedDB directly (it is loaded in hosts whose storage shims differ).
//
// Primary path is the LIST — nobody is required to type a wildcard. The pattern
// input is the advanced supplement (LearnRules.normalizePattern validates it).

var SourcesView = (() => {
  'use strict';

  // Layout-only styles, injected once; colors and button chrome are inherited
  // from the host page so the view looks native in both hosts.
  const STYLE = `
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
    .srcm-lang-chip[data-on="1"] { border-color:#0a7a3c; color:#0a7a3c; font-weight:600; }
  `;

  function ensureStyle(doc) {
    if (doc.getElementById('srcm-style')) return;
    const s = doc.createElement('style');
    s.id = 'srcm-style';
    s.textContent = STYLE;
    doc.head.appendChild(s);
  }

  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
    catch (_) { return ''; }
  }

  // items+sources → [{host, count, blocked, blockedBy, exactRule}] sorted by count.
  function groupByHost(items, sources, rules) {
    const srcHost = new Map();
    for (const s of sources || []) { if (s && s.id) srcHost.set(s.id, hostOf(s.url)); }
    const counts = new Map();
    for (const it of items || []) {
      const h = it && it.sourceId ? srcHost.get(it.sourceId) : '';
      if (!h) continue;
      counts.set(h, (counts.get(h) || 0) + 1);
    }
    const block = (rules && rules.block) || [];
    const rows = [];
    for (const [host, count] of counts) {
      const probe = 'https://' + host + '/';
      let blockedBy = '';
      for (const p of block) { if (LearnRules.matchesUrl(p, probe)) { blockedBy = p; break; } }
      const exactRule = block.find((p) => LearnRules.normalizePattern(p) === host) || '';
      rows.push({ host, count, blocked: !!blockedBy, blockedBy, exactRule });
    }
    rows.sort((a, b) => b.count - a.count || (a.host < b.host ? -1 : 1));
    return rows;
  }

  function el(doc, tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // opts: { items, sources, rules, t, onDelete({host, pattern, itemIds, sourceIds}),
  //         onBlock(pattern), onUnblock(pattern), onAddRule(normalizedPattern),
  //         onInvalidRule() }
  function render(container, opts) {
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
      del.addEventListener('click', () => {
        const doomed = LearnRules.doomedFor(opts.items, opts.sources, r.host);
        opts.onDelete && opts.onDelete({
          host: r.host, pattern: r.host,
          itemIds: doomed.itemIds, sourceIds: doomed.sourceIds,
        });
      });
      row.appendChild(del);

      if (!r.blocked) {
        const blk = el(doc, 'button', '', t('learn_src_block', '不再收录'));
        blk.addEventListener('click', () => opts.onBlock && opts.onBlock(r.host));
        row.appendChild(blk);
      } else if (r.exactRule) {
        row.appendChild(el(doc, 'span', 'srcm-blocked', t('learn_src_blocked', '已屏蔽')));
        const un = el(doc, 'button', '', t('learn_src_unblock', '恢复收录'));
        un.addEventListener('click', () => opts.onUnblock && opts.onUnblock(r.exactRule));
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
      x.addEventListener('click', () => opts.onUnblock && opts.onUnblock(p));
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
    const submit = () => {
      const norm = LearnRules.normalizePattern(input.value);
      if (!norm) { opts.onInvalidRule && opts.onInvalidRule(); return; }
      input.value = '';
      opts.onAddRule && opts.onAddRule(norm);
    };
    btn.addEventListener('click', submit);
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
  function renderLangChips(container, opts) {
    const doc = container.ownerDocument;
    ensureStyle(doc);
    const t = opts.t || ((k, fb) => fb);
    const registry = opts.registry || [];
    const selected = Array.isArray(opts.langs) && opts.langs.length ? opts.langs.slice() : null;
    container.textContent = '';
    const chips = el(doc, 'div', 'srcm-chips');

    const mk = (label, on, fn) => {
      const c = el(doc, 'span', 'srcm-chip srcm-lang-chip', label);
      c.dataset.on = on ? '1' : '0';
      c.setAttribute('role', 'button');
      c.setAttribute('tabindex', '0');
      c.addEventListener('click', fn);
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
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

  return { render, renderLangChips, groupByHost };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SourcesView;
