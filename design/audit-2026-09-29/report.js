/* report.js — 呈现与过滤。无依赖，无网络请求。 */
(function () {
  'use strict';

  var F = window.FINDINGS || [];

  var SURFACES = {
    ds:        { label: '设计系统',   note: 'token / 字体 / 间距 / 圆角' },
    popup:     { label: '扩展弹窗',   note: 'popup' },
    options:   { label: '扩展设置页', note: 'options' },
    review:    { label: '复习页',     note: 'learn/review' },
    overlay:   { label: '页内注入层', note: 'FAB / 译文 / 字幕叠层' },
    app:       { label: 'App 壳',     note: 'app/index.html' },
    onboarding: { label: '新手引导',   note: 'App / 扩展 / 弹窗各入口' }
  };
  var KINDS = { visual: '视觉', interaction: '交互', strength: '做对了的' };
  var SEV_LABEL = { P0: 'P0 · 先修', P1: 'P1 · 该修', P2: 'P2 · 可排期', POS: '正面样本' };

  var state = { sev: 'all', kind: 'all', surface: 'all' };

  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  function matches(f) {
    if (state.sev !== 'all' && f.severity !== state.sev) return false;
    if (state.kind !== 'all' && f.kind !== state.kind) return false;
    if (state.surface !== 'all' && f.surface !== state.surface) return false;
    return true;
  }

  function cardHTML(f, open) {
    var s = SURFACES[f.surface] || { label: f.surface };
    var ev = f.evidence.map(function (e) {
      return '<li><code>' + esc(e.file) + ':' + esc(e.line) + '</code>' +
             (e.note ? '<p>' + esc(e.note) + '</p>' : '') + '</li>';
    }).join('');

    return '<details class="card" data-sev="' + esc(f.severity) + '" data-kind="' + esc(f.kind) +
           '" data-surface="' + esc(f.surface) + '"' + (open ? ' open' : '') + '>' +
      '<summary>' +
        '<div class="row1">' +
          '<span class="sev" data-s="' + esc(f.severity) + '">' + esc(SEV_LABEL[f.severity] || f.severity) + '</span>' +
          '<span class="fid">' + esc(f.id) + '</span>' +
          '<h3>' + esc(f.title) + '</h3>' +
        '</div>' +
        '<p class="impact">' + esc(f.impact) + '</p>' +
        '<div class="tags">' +
          '<span class="tag">' + esc(s.label) + '</span>' +
          '<span class="tag">' + esc(KINDS[f.kind] || f.kind) + '</span>' +
          '<span class="tag">' + f.evidence.length + ' 处证据</span>' +
        '</div>' +
      '</summary>' +
      '<div class="body">' +
        '<h4>证据锚点</h4>' +
        '<ul class="ev">' + ev + '</ul>' +
        '<h4>修复方向</h4>' +
        '<p class="fix">' + esc(f.fix) + '</p>' +
      '</div>' +
    '</details>';
  }

  function render() {
    var list = F.filter(matches);
    var box = document.getElementById('list');
    box.innerHTML = list.length
      ? list.map(function (f) { return cardHTML(f, false); }).join('')
      : '<p class="empty">没有符合当前筛选条件的结论。</p>';

    document.getElementById('count').textContent =
      list.length === F.length ? '共 ' + F.length + ' 条' : '筛选出 ' + list.length + ' / ' + F.length + ' 条';
  }

  function wireChips() {
    document.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      var group = chip.dataset.group;
      state[group] = chip.dataset.val;
      document.querySelectorAll('.chip[data-group="' + group + '"]').forEach(function (c) {
        c.setAttribute('aria-pressed', String(c === chip));
      });
      render();
    });
  }

  function renderTally() {
    var c = { P0: 0, P1: 0, P2: 0, POS: 0 };
    F.forEach(function (f) { if (c[f.severity] !== undefined) c[f.severity]++; });
    document.getElementById('t-p0').textContent = c.P0;
    document.getElementById('t-p1').textContent = c.P1;
    document.getElementById('t-p2').textContent = c.P2;
    document.getElementById('t-pos').textContent = c.POS;
  }

  function renderSurfaces() {
    var counts = {};
    F.forEach(function (f) { counts[f.surface] = (counts[f.surface] || 0) + 1; });
    document.getElementById('surfaces').innerHTML = Object.keys(SURFACES).map(function (k) {
      var s = SURFACES[k], n = counts[k] || 0;
      return '<a href="#list" data-jump="' + k + '"><strong>' + esc(s.label) + '</strong>' +
             '<small>' + n + ' 条 · ' + esc(s.note) + '</small></a>';
    }).join('');

    document.getElementById('surfaces').addEventListener('click', function (e) {
      var a = e.target.closest('[data-jump]');
      if (!a) return;
      e.preventDefault();
      state.surface = a.dataset.jump;
      document.querySelectorAll('.chip[data-group="surface"]').forEach(function (c) {
        c.setAttribute('aria-pressed', String(c.dataset.val === state.surface));
      });
      render();
      document.getElementById('list').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderTally();
    renderSurfaces();
    wireChips();
    render();
  });
})();
