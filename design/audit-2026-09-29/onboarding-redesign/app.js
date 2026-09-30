/* 大肚猴翻译 · iOS 引导改版原型 — 交互层
   改版核心：完成信号收敛到「check 屏拿到 Safari 的确认」这一处。
   「我已打开」不再等于完成；扩展状态由首页横幅如实镜像；
   跳过只写续做入口、不写完成标记（对应产品里的 OB_SEEN / OB_RESUME 语义）。 */
(function () {
  'use strict';

  var root = document.getElementById('root');
  var phone = document.querySelector('[data-phone-screen]');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  var KEY = {
    seen: 'BDT_OB_SEEN',
    resume: 'BDT_OB_RESUME',
    skips: 'BDT_OB_SKIP_COUNT',
    ext: 'BDT_OB_EXT',
    acct: 'BDT_OB_ACCOUNT'
  };

  function read(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) { return fallback; }
  }
  function write(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* 隐私模式忽略 */ }
  }

  var FLOW = ['welcome', 'signin', 'firstuse', 'ext', 'check'];
  var SKIP_CAP = 3;

  var S = {
    name: 'welcome',
    tab: 'translate',
    ext: read(KEY.ext, 'unknown'),
    acct: read(KEY.acct, null),
    skips: read(KEY.skips, 0),
    resume: read(KEY.resume, null),
    attempts: 0,
    checking: false,
    sample: 0,
    form: { email: '', pw: '', err: '', field: '' }
  };

  var stack = [];
  var live = null;
  var toastTimer = null;
  var demoTimer = null;
  var checkTimer = null;

  /* ── 图标（1.8px 描边，内联，无第三方） ───────────── */
  function svg(inner, size) {
    return '<svg class="ico" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }
  var I = {
    chevL: function (s) { return svg('<path d="M14.5 5.5 8 12l6.5 6.5"/>', s); },
    chevR: function (s) { return svg('<path d="M9.5 5.5 16 12l-6.5 6.5"/>', s); },
    arrowR: function (s) { return svg('<path d="M4.5 12h14M13 6.5 18.5 12 13 17.5"/>', s); },
    check: function (s) { return svg('<path d="m5 12.6 4.4 4.4L19 7.2"/>', s); },
    x: function (s) { return svg('<path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6"/>', s); },
    eye: function (s) { return svg('<path d="M2.6 12S6.2 6 12 6s9.4 6 9.4 6-3.6 6-9.4 6-9.4-6-9.4-6Z"/><circle cx="12" cy="12" r="2.6"/>', s); },
    eyeOff: function (s) { return svg('<path d="M4 4.2 20 19.8M9.7 9.8a2.6 2.6 0 0 0 3.5 3.7M6.5 6.8C4 8.4 2.6 12 2.6 12s3.6 6 9.4 6c1.5 0 2.9-.4 4.1-1M17.5 14.9c1.9-1.4 3.9-2.9 3.9-2.9S18 6 12 6c-.7 0-1.4.1-2 .2"/>', s); },
    shield: function (s) { return svg('<path d="M12 3.4 5.2 6v5.6c0 4.2 2.8 7.6 6.8 9.2 4-1.6 6.8-5 6.8-9.2V6L12 3.4Z"/>', s); },
    globe: function (s) { return svg('<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4M12 3.8c2.2 2.3 3.4 5.2 3.4 8.2s-1.2 5.9-3.4 8.2c-2.2-2.3-3.4-5.2-3.4-8.2S9.8 6.1 12 3.8Z"/>', s); },
    translate: function (s) { return svg('<path d="M4 6.6h8.4M8.2 4.6v2.1c0 3.9-1.8 7.3-4.4 8.8M14 20.2 17.8 10l3.8 10.2M15.3 16.6h5"/>', s); },
    book: function (s) { return svg('<path d="M4.5 5.6A2.1 2.1 0 0 1 6.6 3.5H19v13.9H6.6a2.1 2.1 0 0 0-2.1 2.1V5.6ZM19 17.4v3.1H6.6"/>', s); },
    layers: function (s) { return svg('<path d="M12 3.5 20.5 8 12 12.5 3.5 8 12 3.5ZM4.5 12 12 16.3 19.5 12M4.5 15.8 12 20.1l7.5-4.3"/>', s); },
    gear: function (s) { return svg('<circle cx="12" cy="12" r="2.8"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/>', s); },
    refresh: function (s) { return svg('<path d="M20 12a8 8 0 1 1-2.6-5.9M20.2 4.4v4.4h-4.4"/>', s); },
    alert: function (s) { return svg('<path d="M12 4.2 21 19.8H3L12 4.2ZM12 10.2v4.1M12 17.3v.1"/>', s); },
    info: function (s) { return svg('<circle cx="12" cy="12" r="8.2"/><path d="M12 11.2v5M12 7.9v.1"/>', s); },
    external: function (s) { return svg('<path d="M13.8 4.5h5.7v5.7M19.5 4.5 11 13M18 14v4.4a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.4V7.6A1.6 1.6 0 0 1 5.6 6H10"/>', s); },
    mail: function (s) { return svg('<rect x="3.6" y="7.6" width="16.8" height="10.4" rx="2.2"/><path d="m4.2 8.4 7.8 5.4 7.8-5.4"/>', s); },
    clock: function (s) { return svg('<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.2 2"/>', s); },
    sparkle: function (s) { return svg('<path d="M12 3.6 13.9 9l5.4 1.9-5.4 1.9L12 18.2l-1.9-5.4L4.7 10.9 10.1 9 12 3.6Z"/>', s); }
  };

  function esc(text) {
    return String(text).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function maskEmail(email) {
    if (!email || email.indexOf('@') < 1) return '未登录';
    var parts = email.split('@');
    return parts[0].slice(0, 1) + '***@' + parts[1];
  }

  /* ── 小工具 ───────────────────────────────────────── */
  function say(message) {
    if (!live) return;
    live.textContent = '';
    window.requestAnimationFrame(function () { live.textContent = message; });
  }
  function toast(message) {
    var old = root.querySelector('.toast');
    if (old) old.remove();
    var el = document.createElement('p');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    root.appendChild(el);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { if (el.parentNode) el.remove(); }, 2600);
  }
  function stepsLeft() {
    var n = 0;
    if (!S.acct) n += 1;
    if (S.ext !== 'on') n += 1;
    if (!read(KEY.seen, false)) n += 1;
    return n;
  }

  /* ── 导航 ─────────────────────────────────────────── */
  function go(name, mode) {
    closeSheet();
    if (mode === 'replace') { S.name = name; } else { stack.push(S.name); S.name = name; }
    if (name === 'home') S.tab = 'translate';
    render();
  }
  function back() {
    if (!stack.length) return;
    closeSheet();
    S.name = stack.pop();
    render();
  }
  function jump(name) { stack = []; go(name, 'replace'); }

  function skipTo(next) {
    S.skips += 1;
    write(KEY.skips, S.skips);
    write(KEY.resume, { next: next, done: false, from: S.name });
    S.resume = read(KEY.resume);
    say('已跳过，可以在首页继续设置');
    jump('home');
    toast('可以随时从首页继续');
  }
  function finish() {
    write(KEY.seen, true);
    write(KEY.ext, 'on');
    write(KEY.resume, { next: 'ext', done: true, from: 'check' });
    S.ext = 'on';
    S.resume = read(KEY.resume);
    S.attempts = 0;
    say('扩展已启用');
    jump('home');
    toast('装好了，去网页上试试');
  }
  function attemptCheck(viaSafari) {
    S.attempts += 1;
    S.checking = true;
    if (S.name !== 'check') go('check'); else render();
    say('正在向 Safari 确认扩展状态');
    window.clearTimeout(checkTimer);
    checkTimer = window.setTimeout(function () {
      S.checking = false;
      S.ext = viaSafari ? 'on' : 'off';
      write(KEY.ext, S.ext);
      render();
      say(S.ext === 'on' ? '扩展已启用' : '没有检测到扩展，请走检测页确认');
    }, reduce.matches ? 600 : 1500);
  }

  /* ── 屏骨架 ───────────────────────────────────────── */
  function flowHead(index) {
    var left = index === 0
      ? '<span class="icon-btn" aria-hidden="true"></span>'
      : '<button class="icon-btn od-touch" data-act="back" aria-label="返回上一步">' + I.chevL() + '</button>';
    return '<header class="screen-head">' + left +
      '<span class="prog" role="progressbar" aria-valuemin="1" aria-valuemax="5" aria-valuenow="' + (index + 1) + '" aria-label="引导进度">' +
      '<i style="width:' + Math.round(((index + 1) / 5) * 100) + '%"></i></span>' +
      '<span class="head-title">' + (index + 1) + '/5</span></header>';
  }
  function titleHead(text) {
    return '<header class="screen-head"><span class="head-title label">' + text + '</span></header>';
  }
  function skipLink(next, label) {
    if (S.skips >= SKIP_CAP) return '';
    return '<button class="btn btn-quiet btn-block" data-act="skip" data-next="' + next + '">' + (label || '跳过，先看看') + '</button>';
  }
  function tabbar(active) {
    var tabs = [['translate', '翻译', 'translate'], ['review', '复习', 'book'], ['wordbook', '词库', 'layers'], ['settings', '设置', 'gear']];
    return '<nav class="tabbar" aria-label="主导航">' + tabs.map(function (t) {
      return '<button class="tab" data-act="tab" data-tab="' + t[0] + '"' + (t[0] === active ? ' aria-current="page"' : '') + '>' +
        I[t[2]](21) + '<span>' + t[1] + '</span></button>';
    }).join('') + '</nav>';
  }

  var SAMPLES = [
    { src: 'The mitochondria is the powerhouse of the cell.', sel: 'powerhouse of the cell', out: '线粒体是细胞的动力工厂。' },
    { src: 'Please make sure the door is closed before you leave.', sel: 'the door is closed', out: '离开前请确认门已关好。' },
    { src: 'We shipped the fix last Thursday.', sel: 'shipped the fix', out: '我们上周四发布了这个修复。' }
  ];
  var ART = {
    settings: '<svg class="art" viewBox="0 0 92 64" aria-hidden="true"><rect class="f" x="6" y="4" width="80" height="56" rx="12"/>' +
      '<rect class="l-soft" x="15" y="13" width="30" height="5" rx="2.5"/><rect class="hl" x="11" y="22" width="70" height="15" rx="7"/>' +
      '<rect class="l" x="18" y="27.5" width="32" height="5" rx="2.5"/><path class="ink" d="M66 27 73 30l-7 3Z"/>' +
      '<rect class="l-soft" x="15" y="42" width="44" height="5" rx="2.5"/><rect class="l-soft" x="15" y="52" width="26" height="5" rx="2.5"/></svg>',
    toggle: '<svg class="art" viewBox="0 0 92 64" aria-hidden="true"><rect class="f" x="6" y="4" width="80" height="56" rx="12"/>' +
      '<rect class="l-soft" x="15" y="12" width="26" height="5" rx="2.5"/><rect class="hl" x="11" y="20" width="70" height="17" rx="8.5"/>' +
      '<rect class="l" x="18" y="26.5" width="24" height="5" rx="2.5"/><rect class="hl" x="55" y="24" width="23" height="9" rx="4.5"/>' +
      '<circle class="knob" cx="72.5" cy="28.5" r="3.2"/><rect class="l-soft" x="15" y="44" width="30" height="5" rx="2.5"/>' +
      '<rect class="hl" x="15" y="50" width="42" height="8" rx="4"/></svg>',
    page: '<svg class="art" viewBox="0 0 92 64" aria-hidden="true"><rect class="f" x="6" y="4" width="80" height="56" rx="12"/>' +
      '<rect class="l-soft" x="15" y="12" width="46" height="4" rx="2"/><rect class="l-soft" x="15" y="20" width="62" height="4" rx="2"/>' +
      '<rect class="l-soft" x="15" y="28" width="38" height="4" rx="2"/><rect class="hl" x="13" y="36" width="66" height="21" rx="9"/>' +
      '<rect class="l" x="20" y="43" width="28" height="5" rx="2.5"/><circle class="knob" cx="70" cy="45.5" r="4.2"/></svg>'
  };

  /* ── 各屏 ─────────────────────────────────────────── */
  var SCREENS = {};

  SCREENS.welcome = function () {
    return {
      head: flowHead(0),
      body: '<div class="stack-4 hero">' +
        '<span class="hero-mark" aria-hidden="true">' + I.translate(30) + '</span>' +
        '<div class="stack-2">' +
        '<p class="eyebrow">Safari 扩展</p>' +
        '<h1 tabindex="-1">把翻译装进 Safari</h1>' +
        '<p class="lead">装好之后，在网页上选中一段字，译文就出现在原地 —— 不用切 App，不用复制粘贴。</p>' +
        '</div>' +
        '<ul class="chips">' +
        '<li class="chip">' + I.sparkle(14) + '选中即译</li>' +
        '<li class="chip">' + I.globe(14) + '不切 App</li>' +
        '<li class="chip">' + I.shield(14) + '随用随关</li>' +
        '</ul>' +
        '<div class="card card-quiet card-tight"><p class="copy-sm">装扩展、登录一次，之后就在网页上直接划词翻译。</p></div>' +
        '</div>',
      foot: '<div class="foot-actions">' +
        '<button class="btn btn-primary btn-block" data-act="next" data-to="signin">开始设置' + I.arrowR(19) + '</button>' +
        '<button class="btn btn-outline btn-block" data-act="next" data-to="check">我装好了，直接检测</button>' +
        '</div>' + skipLink('signin', '跳过，先看看')
    };
  };

  SCREENS.signin = function () {
    var err = S.form.err;
    return {
      head: flowHead(1),
      body: '<div class="stack-5">' +
        '<div class="stack-2">' +
        '<h1 tabindex="-1">先登录，翻译才有引擎</h1>' +
        '<p class="lead">登录之后才有可用的翻译引擎。不登录也能继续装扩展，之后随时补上。</p>' +
        '</div>' +
        '<form id="ob-signin" novalidate class="stack-4">' +
        '<div class="field' + (S.form.field === 'email' ? ' field-bad' : '') + '">' +
        '<span>邮箱</span><div class="field-box">' +
        '<input id="ob-email" name="email" type="email" inputmode="email" autocomplete="username" placeholder="你的邮箱" ' +
        'value="' + esc(S.form.email) + '" aria-describedby="ob-err" aria-invalid="' + (S.form.field === 'email' ? 'true' : 'false') + '">' +
        I.mail(19) + '</div></div>' +
        '<div class="field' + (S.form.field === 'pw' ? ' field-bad' : '') + '">' +
        '<span>密码</span><div class="field-box">' +
        '<input id="ob-pw" name="pw" type="' + (S.form.show ? 'text' : 'password') + '" autocomplete="current-password" placeholder="至少 6 位" ' +
        'value="' + esc(S.form.pw) + '" aria-describedby="ob-err" aria-invalid="' + (S.form.field === 'pw' ? 'true' : 'false') + '">' +
        '<button class="icon-btn od-touch" data-act="toggle-pw" aria-pressed="' + (S.form.show ? 'true' : 'false') + '" ' +
        'aria-label="' + (S.form.show ? '隐藏密码' : '显示密码') + '">' + (S.form.show ? I.eyeOff(19) : I.eye(19)) + '</button>' +
        '</div></div>' +
        '<p class="field-error" id="ob-err" role="alert">' + (err ? I.alert(15) + '<span>' + esc(err) + '</span>' : '') + '</p>' +
        '<p class="copy-sm">还没有账号？这个邮箱注册后就是账号。</p>' +
        '</form>' +
        '</div>',
      foot: '<div class="foot-actions">' +
        '<button class="btn btn-primary btn-block" type="submit" form="ob-signin">登录并继续</button>' +
        '<button class="btn btn-outline btn-block" data-act="next" data-to="firstuse">跳过登录，先装扩展</button>' +
        '</div>' + skipLink('firstuse')
    };
  };

  SCREENS.firstuse = function () {
    return {
      head: flowHead(2),
      body: '<div class="stack-5">' +
        '<div class="stack-2">' +
        '<h1 tabindex="-1">先试一次，再决定留不留</h1>' +
        '<p class="lead">在网页上选中一段字，译文就出现在原位。</p>' +
        '</div>' +
        '<div class="demo">' + demoInner() + '</div>' +
        '<div class="card card-quiet card-tight"><p class="copy-sm">' + I.info(14) + ' 扩展装好之前，这里只是示意 —— 你还看不到真实结果。</p></div>' +
        '</div>',
      foot: '<div class="foot-actions">' +
        '<button class="btn btn-primary btn-block" data-act="next" data-to="ext">装上 Safari 扩展' + I.arrowR(19) + '</button>' +
        '</div>' + skipLink('ext'),
      enter: revealDemo
    };
  };

  function demoInner() {
    var item = SAMPLES[S.sample % SAMPLES.length];
    var src = item.src.split(item.sel);
    return '<div class="demo-src">' + esc(src[0]) + '<span class="demo-sel">' + esc(item.sel) + '</span>' + esc(src[1]) + '</div>' +
      '<div class="demo-out" data-demo-out>' + I.check(19) + '<span>' + esc(item.out) + '</span></div>' +
      '<div class="demo-foot"><span class="copy-sm">示例 ' + ((S.sample % SAMPLES.length) + 1) + '/' + SAMPLES.length + '</span>' +
      '<button class="btn btn-quiet" data-act="sample">换一句</button></div>';
  }
  function revealDemo() {
    window.clearTimeout(demoTimer);
    var out = root.querySelector('[data-demo-out]');
    if (!out) return;
    if (reduce.matches) { out.classList.add('on'); return; }
    demoTimer = window.setTimeout(function () { out.classList.add('on'); }, 620);
  }

  SCREENS.ext = function () {
    return {
      head: flowHead(3),
      body: '<div class="stack-5">' +
        '<div class="stack-2">' +
        '<h1 tabindex="-1">装上扩展，三步就好</h1>' +
        '<p class="lead">前两步在「设置」里，第三步回到这里确认。</p>' +
        '</div>' +
        '<ol class="steps">' +
        '<li class="step"><div class="step-body"><span class="step-no"><span class="badge badge-num">1</span></span>' +
        '<span class="label">打开扩展列表</span><span class="copy-sm">设置 → Safari → 扩展</span></div>' + ART.settings + '</li>' +
        '<li class="step"><div class="step-body"><span class="step-no"><span class="badge badge-num">2</span></span>' +
        '<span class="label">打开开关，改权限</span><span class="copy-sm">把网站权限改成「所有网站」</span></div>' + ART.toggle + '</li>' +
        '<li class="step"><div class="step-body"><span class="step-no"><span class="badge badge-num">3</span></span>' +
        '<span class="label">回这里确认一次</span><span class="copy-sm">检测要在 Safari 的页面里完成</span></div>' + ART.page + '</li>' +
        '</ol>' +
        '<div class="card card-accent card-row"><span class="badge badge-warn" aria-hidden="true">' + I.alert(18) + '</span>' +
        '<p class="copy-sm">App 读不到 Safari 里的开关状态，所以「我已打开」不算完成 —— 只有检测页的确认才算。</p></div>' +
        '</div>',
      foot: '<div class="foot-actions">' +
        '<button class="btn btn-primary btn-block" data-act="open-sheet">' + I.external(19) + '在 Safari 里打开检测页</button>' +
        '<button class="btn btn-outline btn-block" data-act="next" data-to="check">我已打开，去看检测状态</button>' +
        '</div>' + skipLink('check')
    };
  };

  SCREENS.check = function () {
    var body, foot;
    if (S.ext === 'on') {
      body = '<div class="stack-5">' +
        '<div class="stack-2"><h1 tabindex="-1">扩展已启用</h1><p class="lead">Safari 已经把状态确认回来了。</p></div>' +
        '<div class="card card-ok card-row"><span class="badge badge-ok" aria-hidden="true">' + I.check(18) + '</span>' +
        '<div class="stack-2"><span class="label">装好了</span><p class="copy-sm">在网页上选中一段字就能直接译。</p></div></div>' +
        '<div class="group">' +
        summaryRow(I.shield(19), '扩展', '已启用 · 所有网站', 'ok') +
        summaryRow(I.sparkle(19), '引擎', S.acct ? '已就绪' : '未就绪 · 还没登录', S.acct ? 'ok' : 'warn') +
        summaryRow(I.mail(19), '账号', maskEmail(S.acct), S.acct ? 'ok' : 'warn') +
        '</div></div>';
      foot = '<div class="foot-actions">' +
        '<button class="btn btn-primary btn-block" data-act="finish">完成，开始使用</button>' +
        '<button class="btn btn-quiet btn-block" data-act="next" data-to="ext">再看一遍开启步骤</button>' +
        '</div>';
    } else if (S.checking) {
      body = '<div class="stack-5">' +
        '<div class="stack-2"><h1 tabindex="-1">正在确认</h1><p class="lead">等 Safari 把结果送回来。</p></div>' +
        '<div class="card card-row" aria-busy="true"><span class="spinner" aria-hidden="true"></span>' +
        '<div class="stack-2"><span class="label">正在向 Safari 确认扩展状态</span>' +
        '<p class="copy-sm">通常一两秒。检测不到也不会弄丢任何设置。</p></div></div>' +
        '<p class="copy-sm">已检测 ' + S.attempts + ' 次</p></div>';
      foot = '<div class="foot-actions">' +
        '<button class="btn btn-primary btn-block" disabled>正在确认…</button>' +
        '<button class="btn btn-outline btn-block" data-act="back">返回</button>' +
        '</div>';
    } else if (S.ext === 'off') {
      var hard = S.attempts >= 2;
      body = '<div class="stack-5">' +
        '<div class="stack-2"><h1 tabindex="-1">还是没检测到</h1>' +
        '<p class="lead">App 收不到 Safari 的确认，所以它不能替你判断 —— 这不是卡住了，是真的没拿到结果。</p></div>' +
        '<div class="card card-bad card-row"><span class="badge badge-bad" aria-hidden="true">' + I.alert(18) + '</span>' +
        '<div class="stack-2"><span class="label">' + (hard ? '两次都没通过' : '这一次没通过') + '</span>' +
        '<p class="copy-sm">常见原因就这几个，逐条排一下：</p></div></div>' +
        '<ul class="steps-list">' +
        '<li>' + I.x(16) + '<span>还没在「设置 → Safari → 扩展」里打开「大肚猴翻译」的开关</span></li>' +
        '<li>' + I.x(16) + '<span>网站权限还是「仅这些网站」，而当前页面不在名单里</span></li>' +
        '<li>' + I.x(16) + '<span>iOS 更新之后扩展被自动关掉了</span></li>' +
        '</ul>' +
        '<details class="foldout"' + (hard ? ' open' : '') + '><summary>一步步怎么查<span class="chev">' + I.chevR(16) + '</span></summary>' +
        '<div class="foldout-body"><ol>' +
        '<li>打开「设置」，进入 Safari 的「扩展」</li>' +
        '<li>打开「大肚猴翻译」，确认开关是开的</li>' +
        '<li>把网站权限改成「所有网站」，返回</li>' +
        '<li>回到这里，点下面那个按钮在 Safari 里再确认一次</li>' +
        '</ol></div></details>' +
        '<p class="copy-sm">已检测 ' + S.attempts + ' 次' + (hard ? '。别再点「我已打开」了 —— 它一直都不是完成信号。' : '。') + '</p>' +
        '</div>';
      foot = '<div class="foot-actions">' +
        '<button class="btn btn-primary btn-block" data-act="open-sheet">' + I.external(19) + '在 Safari 里打开检测页</button>' +
        (hard ? '' : '<button class="btn btn-outline btn-block" data-act="blind-check">我已打开，再检测一次</button>') +
        '</div>' + skipLink(null, '先跳过，稍后再说');
    } else {
      body = '<div class="stack-5">' +
        '<div class="stack-2"><h1 tabindex="-1">确认扩展已启用</h1>' +
        '<p class="lead">扩展开关在 Safari 里，App 这边读不到它的真实状态。</p></div>' +
        '<div class="card card-accent card-row"><span class="badge badge-warn" aria-hidden="true">' + I.shield(18) + '</span>' +
        '<div class="stack-2"><span class="label">还没收到确认</span>' +
        '<p class="copy-sm">需要在 Safari 的检测页里确认一次。App 只能如实告诉你收没收到。</p></div></div>' +
        '<div class="card card-quiet card-tight"><p class="copy-sm">' +
        I.info(14) + ' 「我已打开」不算完成 —— 只有 Safari 真的返回确认，扩展才算装好。</p></div>' +
        (S.attempts ? '<p class="copy-sm">已检测 ' + S.attempts + ' 次</p>' : '') +
        '</div>';
      foot = '<div class="foot-actions">' +
        '<button class="btn btn-primary btn-block" data-act="open-sheet">' + I.external(19) + '在 Safari 里打开检测页</button>' +
        '<button class="btn btn-outline btn-block" data-act="blind-check">我已打开，再检测一次</button>' +
        '</div>' + skipLink(null, '先跳过，稍后再说');
    }
    return { head: flowHead(4), body: body, foot: foot };
  };

  function summaryRow(icon, title, value, tone) {
    return '<div class="row row-static">' + icon +
      '<span class="row-title">' + title + '</span>' +
      '<span class="row-value' + (tone === 'ok' ? ' row-value-strong' : '') + '">' + esc(value) + '</span></div>';
  }

  SCREENS.home = function () {
    var left = stepsLeft();
    var showBanner = S.ext !== 'on';
    var showResume = !showBanner && S.resume && !S.resume.done && left > 0;
    return {
      head: '',
      bleed: '',
      body: '<div class="stack-5" style="padding-top:var(--sp-4)">' +
        '<div class="stack-2">' +
        '<p class="eyebrow">早上好</p>' +
        '<h1 tabindex="-1">大肚猴翻译</h1>' +
        '</div>' +
        (showBanner
          ? '<button class="banner" data-act="next" data-to="check">' +
            '<span class="badge badge-warn" aria-hidden="true">' + I.shield(18) + '</span>' +
            '<span class="banner-body"><span class="banner-title">扩展还没启用</span>' +
            '<span class="banner-sub">在 Safari 里确认一次，网页上才能直接译</span></span>' +
            '<span class="banner-go">去检测' + I.chevR(15) + '</span></button>'
          : '') +
        (showResume
          ? '<button class="card card-accent banner" data-act="next" data-to="' + esc(S.resume.next) + '">' +
            '<span class="badge" aria-hidden="true">' + I.refresh(18) + '</span>' +
            '<span class="banner-body"><span class="banner-title">继续设置 · 还差 ' + left + ' 步</span>' +
            '<span class="banner-sub">' + (S.acct ? '还差一次 Safari 确认' : '登录之后翻译引擎才能用') + '</span></span>' +
            '<span class="banner-go">继续' + I.chevR(15) + '</span></button>'
          : '') +
        (S.acct
          ? '<div class="group">' +
            summaryRow(I.sparkle(19), '翻译引擎', '已就绪', 'ok') +
            summaryRow(I.mail(19), '账号', maskEmail(S.acct), 'ok') +
            '</div>'
          : '<button class="card card-accent card-row" data-act="next" data-to="signin" style="text-align:left;cursor:pointer">' +
            '<span class="badge" aria-hidden="true">' + I.mail(18) + '</span>' +
            '<span class="stack-2" style="flex:1 1 auto;min-width:0"><span class="label">还没有登录，引擎用不了</span>' +
            '<span class="copy-sm">点一下去登录，30 秒</span></span>' + I.chevR(16) + '</button>') +
        '<div class="stack-3">' +
        '<p class="group-label">复习</p>' +
        '<div class="empty">' + I.book(28) +
        '<p class="label">今天没有要复习的内容</p>' +
        '<p class="copy-sm">在网页上选中的词会自动进来。</p>' +
        '<button class="btn btn-outline" data-act="tab" data-tab="review">去看看</button>' +
        '</div></div>' +
        (S.resume && S.resume.done
          ? '<button class="btn btn-quiet btn-block" data-act="next" data-to="ext">' + I.refresh(18) + '回顾一遍开启步骤</button>'
          : '') +
        '</div>',
      foot: tabbar('translate')
    };
  };

  SCREENS.review = function () {
    return {
      head: titleHead('复习'),
      body: '<div class="stack-5"><h1 tabindex="-1">复习</h1>' +
        '<div class="empty">' + I.clock(30) +
        '<p class="label">今天没有要复习的内容</p>' +
        '<p class="copy">在网页上选中的词会自动进来，攒够一批就会出现在这里。</p>' +
        '<button class="btn btn-outline" data-act="tab" data-tab="wordbook">看看词库</button>' +
        '</div></div>',
      foot: tabbar('review')
    };
  };

  SCREENS.wordbook = function () {
    return {
      head: titleHead('词库'),
      body: '<div class="stack-5"><h1 tabindex="-1">词库</h1>' +
        '<div class="empty">' + I.layers(30) +
        '<p class="label">词库还是空的</p>' +
        '<p class="copy">翻译时选中一个词，就能把它收进词库。</p>' +
        '</div>' +
        '<div class="group">' +
        '<button class="row" data-act="next" data-to="ext">' + I.shield(19) +
        '<span class="row-title">扩展状态<span class="row-sub">没装好的话，这里一直收不到词</span></span>' +
        '<span class="row-value">' + (S.ext === 'on' ? '已启用' : '未启用') + '</span>' + I.chevR(16) + '</button>' +
        '</div></div>',
      foot: tabbar('wordbook')
    };
  };

  SCREENS.settings = function () {
    return {
      head: titleHead('设置'),
      body: '<div class="stack-6"><h1 tabindex="-1">设置</h1>' +
        '<div class="stack-2"><p class="group-label">扩展</p><div class="group">' +
        '<button class="row" data-act="next" data-to="check">' + I.shield(19) +
        '<span class="row-title">扩展状态</span>' +
        '<span class="row-value' + (S.ext === 'on' ? ' row-value-strong' : '') + '">' +
        (S.ext === 'on' ? '已启用' : S.ext === 'off' ? '未启用' : '未检测') + '</span>' + I.chevR(16) + '</button>' +
        '<button class="row" data-act="open-sheet">' + I.globe(19) +
        '<span class="row-title">网站权限</span><span class="row-value">所有网站</span>' + I.chevR(16) + '</button>' +
        '<button class="row" data-act="restart">' + I.refresh(19) +
        '<span class="row-title">重新看一遍引导</span>' + I.chevR(16) + '</button>' +
        '</div></div>' +
        '<div class="stack-2"><p class="group-label">账号</p><div class="group">' +
        (S.acct
          ? summaryRow(I.mail(19), '账号', maskEmail(S.acct), 'ok')
          : '<button class="row" data-act="next" data-to="signin">' + I.mail(19) +
            '<span class="row-title">登录<span class="row-sub">登录后才有翻译引擎</span></span>' +
            '<span class="row-value">未登录</span>' + I.chevR(16) + '</button>') +
        summaryRow(I.sparkle(19), '翻译引擎', S.acct ? '已就绪' : '未就绪', S.acct ? 'ok' : 'warn') +
        '</div></div>' +
        '<div class="stack-2"><p class="group-label">通用</p><div class="group">' +
        '<div class="row row-static">' + I.sparkle(19) + '<span class="row-title">触发方式</span><span class="row-value">选中即译</span></div>' +
        '<div class="row row-static">' + I.globe(19) + '<span class="row-title">默认语言</span><span class="row-value">简体中文 → 英语</span></div>' +
        '<div class="row row-static">' + I.eye(19) + '<span class="row-title">外观</span><span class="row-value">跟随系统</span></div>' +
        '</div></div>' +
        '<div class="stack-2"><p class="group-label">其他</p><div class="group">' +
        '<div class="row row-static">' + I.info(19) + '<span class="row-title">大肚猴翻译</span><span class="row-value">iOS 1.0.0</span></div>' +
        '<div class="row row-static">' + I.shield(19) + '<span class="row-title">隐私</span><span class="row-value">翻译内容不上传</span></div>' +
        '</div></div></div>',
      foot: tabbar('settings')
    };
  };

  /* ── Safari 检测页（代替 setup.html 深链） ────────── */
  function openSheet(trigger) {
    closeSheet();
    var scrim = document.createElement('div');
    scrim.className = 'sheet-scrim';
    scrim.setAttribute('data-act', 'close-sheet');
    scrim.innerHTML =
      '<div class="sheet" data-act="noop" role="dialog" aria-modal="true" aria-label="Safari 扩展检测页">' +
      '<span class="sheet-grab" aria-hidden="true"></span>' +
      '<div class="sheet-bar"><span class="label">Safari · 扩展</span>' +
      '<span class="url">safari-web-extension://…/setup.html</span></div>' +
      '<div class="stack-2"><p class="label">大肚猴翻译</p>' +
      '<p class="copy-sm">这是扩展自己的检测页。App 里的状态以它返回的结果为准。</p></div>' +
      '<div class="group"><div class="row row-static">' + I.shield(19) +
      '<span class="row-title">扩展<span class="row-sub">由 Safari 读取，不由 App 猜测</span></span>' +
      '<span class="row-value">等待确认</span></div></div>' +
      '<div class="foot-actions">' +
      '<button class="btn btn-primary btn-block" data-act="safari-enabled">' + I.shield(19) + '打开扩展，允许所有网站</button>' +
      '<button class="btn btn-quiet btn-block" data-act="safari-back">返回 App</button>' +
      '</div>' +
      '<p class="sheet-url-full">真实实现里，这一步是一次 safari-web-extension://…/setup.html 深链，由 App 发起、由 Safari 打开。</p>' +
      '</div>';
    phone.appendChild(scrim);
    var first = scrim.querySelector('[data-act="safari-enabled"]');
    if (first) first.focus();
    say('已打开 Safari 扩展检测页');
  }
  function closeSheet() {
    var scrim = phone.querySelector('.sheet-scrim');
    if (scrim) scrim.remove();
  }

  /* ── 渲染 ─────────────────────────────────────────── */
  function render() {
    var screen = SCREENS[S.name]();
    root.innerHTML = (screen.head || '') +
      '<div class="screen-body od-scroll">' + screen.body + '</div>' +
      (screen.foot || '') +
      '<p class="sr-only" role="status" aria-live="polite" id="ob-live"></p>';
    live = document.getElementById('ob-live');
    root.setAttribute('data-screen', S.name);
    window.clearTimeout(demoTimer);
    var body = root.querySelector('.screen-body');
    if (body) body.scrollTop = 0;
    var h1 = root.querySelector('h1');
    if (h1) h1.focus({ preventScroll: true });
    if (screen.enter) screen.enter();
  }

  /* ── 登录校验 ─────────────────────────────────────── */
  function submitSignin(form) {
    var email = (form.email.value || '').trim();
    var pw = form.pw.value || '';
    S.form.email = email;
    S.form.pw = pw;
    S.form.err = '';
    S.form.field = '';
    if (!email) { S.form.field = 'email'; S.form.err = '请填写邮箱'; }
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { S.form.field = 'email'; S.form.err = '这个邮箱地址看起来不太对'; }
    else if (!pw) { S.form.field = 'pw'; S.form.err = '请填写密码'; }
    else if (pw.length < 6) { S.form.field = 'pw'; S.form.err = '密码至少 6 位'; }
    if (S.form.err) { render(); say(S.form.err); return; }
    S.acct = email;
    write(KEY.acct, email);
    S.form.pw = '';
    S.form.err = '';
    S.form.field = '';
    say('登录成功');
    go('firstuse');
  }
  function fieldError(field, message) {
    var input = document.getElementById(field === 'email' ? 'ob-email' : 'ob-pw');
    var slot = document.getElementById('ob-err');
    if (!input || !slot) return;
    input.setAttribute('aria-invalid', 'true');
    input.parentNode.parentNode.classList.add('field-bad');
    slot.innerHTML = I.alert(15) + '<span>' + esc(message) + '</span>';
    input.focus();
    say(message);
  }

  /* ── 事件 ─────────────────────────────────────────── */
  document.addEventListener('click', function (event) {
    var el = event.target.closest ? event.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');

    if (act === 'noop') return;
    if (act === 'close-sheet') { closeSheet(); return; }
    if (act === 'back') { back(); return; }
    if (act === 'next') { go(el.getAttribute('data-to')); return; }
    if (act === 'tab') { go(el.getAttribute('data-tab') === 'translate' ? 'home' : el.getAttribute('data-tab'), 'replace'); return; }
    if (act === 'skip') {
      var next = el.getAttribute('data-next');
      skipTo(next || (!S.acct ? 'signin' : 'ext'));
      return;
    }
    if (act === 'finish') { finish(); return; }
    if (act === 'restart') {
      S.attempts = 0;
      S.checking = false;
      jump('welcome');
      return;
    }
    if (act === 'blind-check') { attemptCheck(false); return; }
    if (act === 'open-sheet') { openSheet(); return; }
    if (act === 'safari-enabled') { closeSheet(); attemptCheck(true); return; }
    if (act === 'safari-back') {
      closeSheet();
      if (S.name !== 'check') go('check');
      toast('还没收到确认结果');
      return;
    }
    if (act === 'sample') {
      S.sample = (S.sample + 1) % SAMPLES.length;
      var box = root.querySelector('.demo');
      if (box) { box.innerHTML = demoInner(); revealDemo(); }
      return;
    }
    if (act === 'toggle-pw') {
      var input = document.getElementById('ob-pw');
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      el.setAttribute('aria-pressed', show ? 'true' : 'false');
      el.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
      el.innerHTML = show ? I.eyeOff(19) : I.eye(19);
      input.focus();
      return;
    }
  });

  document.addEventListener('submit', function (event) {
    if (event.target && event.target.id === 'ob-signin') {
      event.preventDefault();
      submitSignin(event.target);
    }
  });

  document.addEventListener('input', function (event) {
    if (!event.target || !event.target.id) return;
    var input = event.target;
    if (input.id === 'ob-email' || input.id === 'ob-pw') {
      S.form.field = '';
      S.form.err = '';
      input.setAttribute('aria-invalid', 'false');
      input.parentNode.parentNode.classList.remove('field-bad');
      var slot = document.getElementById('ob-err');
      if (slot) slot.innerHTML = '';
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeSheet();
  });

  /* ── 启动 ─────────────────────────────────────────── */
  if (read(KEY.seen, false) || S.resume) { S.name = 'home'; S.tab = 'translate'; }
  render();
})();
