/* 大肚猴翻译 · 首屏流程画布数据
   每屏每态一板，分组：屏1 登录 / 屏2 资源包 / 屏3 引导 / 就绪与首页 / 边界与失败
   数字（体积、进度）为占位，板注中已标注 */

const ICON_PATHS = {
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M4 7.6l8 5.4 8-5.4"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<path d="M12 3.6L22 20.4H2z"/><path d="M12 9.5v4.2"/><circle cx="12" cy="16.8" r=".9" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/>',
  download: '<path d="M12 3.5v11"/><path d="M7.6 10.4L12 14.8l4.4-4.4"/><path d="M4 19.5h16"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 12a6 6 0 0 0 12 0"/><path d="M12 18v3"/>',
  wave: '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.6 3.6 5.5 3.6 8.5S14.4 17.9 12 20.5c-2.4-2.6-3.6-5.5-3.6-8.5S9.6 6.1 12 3.5z"/>',
  wifi: '<path d="M3.5 9.5a13 13 0 0 1 17 0"/><path d="M6.8 13a8.5 8.5 0 0 1 10.4 0"/><path d="M10 16.4a4 4 0 0 1 4 0"/><circle cx="12" cy="19.4" r="1.1" fill="currentColor" stroke="none"/>',
  cell: '<path d="M3 17.5v3M8 14v6.5M13 10.5V20.5M18 6.5v14"/>',
  shield: '<path d="M12 3l7 2.8v5.7c0 4.2-2.9 7.4-7 9.5-4.1-2.1-7-5.3-7-9.5V5.8z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
  doc: '<path d="M6.5 3.5h7l4.5 4.5v12.5H6.5z"/><path d="M13.5 3.5V8h4.5"/><path d="M9.3 12.5h6M9.3 16h4"/>',
  puzzle: '<path d="M10 4.5h4v2.2a2 2 0 1 0 4 0V4.5H20v4h-2.2a2 2 0 1 0 0 4H20v6.5h-4v-2.2a2 2 0 1 0-4 0V19H4v-6.5h2.2a2 2 0 1 0 0-4H4v-4h6z"/>',
  key: '<circle cx="8" cy="14" r="3.6"/><path d="M10.6 11.6L20 2.5"/><path d="M17 5.5l2.4 2.4M14.6 7.9l2.4 2.4"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10" rx="3"/><path d="M8 10V7.8a4 4 0 0 1 8 0V10"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V10h-5.5"/>',
  chevR: '<path d="M9.5 5.5l6.5 6.5-6.5 6.5"/>',
  chevD: '<path d="M5.5 9.5L12 16l6.5-6.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.4l3.4 2"/>',
  device: '<rect x="3.5" y="4.5" width="17" height="11" rx="2.5"/><path d="M8.5 19.5h7"/>',
  spark: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/>',
  folder: '<path d="M3.5 6.5h5l2 2.5h10v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M3 10h18"/>',
  eye: '<path d="M2.8 12S6.5 5.8 12 5.8 21.2 12 21.2 12 17.5 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
  arrowR: '<path d="M4.5 12h14"/><path d="M13.5 6.5l6 5.5-6 5.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8L20 20"/>'
};

const ico = (name, cls) =>
  `<svg class="ico ${cls || 'ico-l'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;

const LOGO_APPLE = '<svg class="ico ico-l" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.7 2.3 2.9 2.2 1.2 0 1.6-.7 3.1-.7s1.9.7 3.1.7c1.3 0 2.1-1.1 2.8-2.2.9-1.2 1.3-2.5 1.3-2.5s-2.7-1-2.7-3.6zM14.2 5.9c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.2-.5 2.8-1.3z"/></svg>';

const LOGO_GOOGLE = '<svg class="ico ico-l" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

const sb = () => `<div class="sb"><span>9:41</span><span class="isle"></span><span class="icons">
  <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor" aria-hidden="true"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="4.5" y="5" width="3" height="6" rx="1"/><rect x="9" y="2.5" width="3" height="8.5" rx="1"/><rect x="13.5" y="0" width="3" height="11" rx="1"/></svg>
  <svg width="16" height="11" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true"><path d="M8 10.6l2.3-2.5a3.3 3.3 0 0 0-4.6 0zM8 5.1c2 0 3.9.8 5.2 2.2l1.7-1.8A9 9 0 0 0 8 2.6a9 9 0 0 0-6.9 2.9l1.7 1.8A6.6 6.6 0 0 1 8 5.1zM8 0C4.3 0 1 .1.9 2.8l2 1.8A4.6 4.6 0 0 1 8 3.1c1.5 0 2.9.5 3.9 1.5l2-1.8A10 10 0 0 0 8 0z"/></svg>
  <svg width="25" height="12" viewBox="0 0 25 12" aria-hidden="true"><rect x=".5" y=".5" width="21" height="11" rx="3.2" fill="none" stroke="currentColor" stroke-opacity=".4"/><rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor"/><path d="M23 4v4a2.2 2.2 0 0 0 0-4z" fill="currentColor" fill-opacity=".45"/></svg>
</span></div>`;

const phone = (inner, o = {}) =>
  `<div class="phone">${o.sb === false ? '' : sb()}<div class="scr ${o.white ? 'scr-white' : ''}">${inner}</div></div>`;

const steps = (a, b, c) => `<div class="steps"><i class="${a}"></i><i class="${b}"></i><i class="${c}"></i></div>`;
const MB = '<span class="pkg-size">≈ 000 MB<span class="muted">（占位）</span></span>';

const pkgRow = (o) => `
<div class="pkg">
  <span class="pkg-badge pkg-badge--${o.tone}">${ico(o.icon)}</span>
  <span class="grow">
    <span class="row-between"><span class="pkg-name">${o.name}</span>${o.chip || ''}</span>
    <span class="pkg-use">${o.use}</span>
    ${o.bar ? `<span class="bar ${o.barTone ? 'bar--' + o.barTone : ''}"><i style="width:${o.pct}%"></i></span>` : ''}
    ${o.sub ? `<span class="pkg-size" style="display:block;margin-top:6px">${o.sub}</span>` : ''}
  </span>
</div>`;

/* ---------------- 屏 1 · 登录 ---------------- */

const S1_DEFAULT = phone(`
  <div class="pad" style="padding-top:34px">
    <div class="brandline"><span class="tile">译</span><span class="strong">大肚猴翻译</span></div>
    <h2 class="t">登录后开始</h2>
    <p class="en">Sign in to begin</p>
    <p class="p mt">登录即获得一份免费额度，翻译、朗读、听写都能用。语音识别与朗读包随后下载到本机，<strong>音频不出设备</strong>。</p>
    <div class="note note--mute mt">${ico('spark', 'ico-l')}免费额度自动到账，不需要填写任何信息。</div>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="login-apple">${LOGO_APPLE}使用 Apple 继续</button>
      <button class="btn btn--ghost" data-od-id="login-google">${LOGO_GOOGLE}使用 Google 继续</button>
      <button class="btn btn--ghost" data-od-id="login-email">${ico('mail')}使用邮箱登录</button>
    </div>
    <p class="en center" style="margin:12px 0 0">浏览器扩展免登录、可自带 API Key；App 需要登录。</p>
  </div>`);

const S1_LOADING = phone(`
  <div class="pad" style="padding-top:34px">
    <div class="brandline"><span class="tile">译</span><span class="strong">大肚猴翻译</span></div>
    <h2 class="t">登录后开始</h2>
    <p class="p mt">登录即获得一份免费额度。</p>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" disabled>${'<span class="spinner"></span>'}正在通过 Apple 登录…</button>
      <button class="btn btn--ghost" disabled>${LOGO_GOOGLE}使用 Google 继续</button>
      <button class="btn btn--ghost" disabled>${ico('mail')}使用邮箱登录</button>
    </div>
    <p class="en center" style="margin:12px 0 0">正在建立安全会话，音频仍留在本机。</p>
  </div>`);

const S1_ERR_NET = phone(`
  <div class="pad" style="padding-top:34px">
    <div class="brandline"><span class="tile">译</span><span class="strong">大肚猴翻译</span></div>
    <h2 class="t">登录后开始</h2>
    <div class="note note--err mt">${ico('alert')}<span><b>网络连接失败。</b>没有连上登录服务，你的额度与设置都没变。检查网络后重试。</span></div>
    <p class="en" style="margin-top:8px">Network error. Nothing was changed.</p>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="login-retry">${ico('refresh')}重试</button>
      <button class="btn btn--ghost">使用邮箱登录</button>
    </div>
    <p class="en center" style="margin:12px 0 0">重试不会重复发放额度。</p>
  </div>`);

const S1_ERR_CANCEL = phone(`
  <div class="pad" style="padding-top:34px">
    <div class="brandline"><span class="tile">译</span><span class="strong">大肚猴翻译</span></div>
    <h2 class="t">登录后开始</h2>
    <div class="note note--mute mt">${ico('info')}<span>你取消了 Apple 登录。没有创建账号，也没有扣任何额度。</span></div>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary">${LOGO_APPLE}重新使用 Apple 登录</button>
      <button class="btn btn--ghost">${ico('mail')}改用邮箱登录</button>
    </div>
  </div>`);

const S1_NO_APPLE = phone(`
  <div class="pad" style="padding-top:34px">
    <div class="brandline"><span class="tile">译</span><span class="strong">大肚猴翻译</span></div>
    <h2 class="t">用邮箱登录</h2>
    <p class="p mt">这台设备上 Apple 登录不可用（未登录 iCloud 或系统版本过低），已只保留邮箱方式。</p>
    <div class="note note--mute">${ico('info')}<span>换一台登录了 iCloud 的设备，Apple 方式会重新出现。</span></div>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="login-email">${ico('mail')}使用邮箱登录</button>
    </div>
    <p class="en center" style="margin:12px 0 0">Apple 不可用时，登录方式自动降级为邮箱。</p>
  </div>`);

const S1_CN = phone(`
  <div class="pad" style="padding-top:22px">
    <span class="chip chip-run">中国版</span>
    <div class="brandline mt"><span class="tile">译</span><span class="strong">大肚猴翻译</span></div>
    <h2 class="t">登录后开始</h2>
    <p class="p mt">与国际版逐条同构：同样三段流程、同样文案，只有引擎经境内中继、上游为通义千问。免费额度同样登录即到账。</p>
    <div class="checkline mt" data-od-id="cn-consent">
      <span class="box">${ico('check', '')}</span>
      <span class="t">我同意把待翻译文本发送至境外服务处理<small>免费额度经我们的中继转发；识别与朗读仍在本机完成。</small></span>
    </div>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" disabled data-od-id="login-apple-cn">${LOGO_APPLE}使用 Apple 继续</button>
      <button class="btn btn--ghost">${LOGO_GOOGLE}使用 Google 继续</button>
      <button class="btn btn--ghost">${ico('mail')}使用邮箱登录</button>
    </div>
    <p class="en center" style="margin:12px 0 0">未勾选时登录按钮保持不可用；勾选后即时可点。</p>
  </div>`);

const S1_CN_OK = phone(`
  <div class="pad" style="padding-top:22px">
    <span class="chip chip-run">中国版</span>
    <div class="brandline mt"><span class="tile">译</span><span class="strong">大肚猴翻译</span></div>
    <h2 class="t">登录后开始</h2>
    <div class="checkline on mt">
      <span class="box">${ico('check', '')}</span>
      <span class="t">我同意把待翻译文本发送至境外服务处理<small>可随时在设置里撤回；撤回后免费额度不可用，自带 Key 不受影响。</small></span>
    </div>
    <div class="note note--mute mt">${ico('spark')}<span>勾选后额度自动到账，不需要额外确认。</span></div>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="login-apple-cn">${LOGO_APPLE}使用 Apple 继续</button>
      <button class="btn btn--ghost">${LOGO_GOOGLE}使用 Google 继续</button>
      <button class="btn btn--ghost">${ico('mail')}使用邮箱登录</button>
    </div>
  </div>`);

const S1_EMAIL = phone(`
  <div class="pad" style="padding-top:20px">
    <div class="row-between">
      <button class="link" style="color:var(--muted)">${ico('chevR', '').replace('M9.5 5.5l6.5 6.5-6.5 6.5', 'M14.5 5.5L8 12l6.5 6.5')}返回</button>
      <h3 class="t" style="margin:0">邮箱登录</h3>
      <span style="width:34px"></span>
    </div>
    <h2 class="t">输入邮箱</h2>
    <p class="p mt">我们会把一次性验证码发到这个邮箱。</p>
    <div class="field mt">name@example.com</div>
    <p class="en" style="margin-top:8px">演示占位邮箱，不代表真实账号。</p>
    <div class="note note--mute mt">${ico('lock')}<span>邮箱只用于登录与找回。免费额度仍自动到账。</span></div>
  </div>
  <div class="scr-bottom">
    <button class="btn btn--primary" data-od-id="email-send">发送验证码</button>
  </div>`);

const S1_EMAIL_CODE = phone(`
  <div class="pad" style="padding-top:20px">
    <div class="row-between">
      <button class="link" style="color:var(--muted)">${ico('chevR', '').replace('M9.5 5.5l6.5 6.5-6.5 6.5', 'M14.5 5.5L8 12l6.5 6.5')}返回</button>
      <h3 class="t" style="margin:0">邮箱登录</h3>
      <span style="width:34px"></span>
    </div>
    <h2 class="t">输入验证码</h2>
    <p class="p mt">已发送至 <strong>name@example.com</strong>（占位）</p>
    <div class="row mt" style="gap:8px">
      ${[1, 2, 3, 4, 5, 6].map((i) => `<span class="grow center strong" style="border:1.5px solid ${i < 4 ? 'var(--accent)' : 'var(--border)'};border-radius:var(--r-chip);padding:12px 0;background:var(--surface)">${i < 4 ? '•' : ''}</span>`).join('')}
    </div>
    <p class="en" style="margin-top:10px">6 位数字，10 分钟内有效。</p>
    <div class="note note--info mt">${ico('clock')}<span>没收到？60 秒后可重发。连续输错 5 次需等待 15 分钟。</span></div>
  </div>
  <div class="scr-bottom">
    <button class="btn btn--primary" data-od-id="email-verify">登录并开通免费额度</button>
  </div>`);

const S1_DONE = phone(`
  <div class="pad center" style="padding-top:90px">
    <span class="tile" style="margin:0 auto;width:56px;height:56px;font-size:26px;display:grid;place-items:center">${ico('check', 'ico-l')}</span>
    <h2 class="t">登录成功</h2>
    <p class="p">免费额度已到账。</p>
    <div class="card mt" style="text-align:left">
      <div class="kv"><span class="k">额度</span><span class="v">翻译 / 朗读 / 听写 各 000 次（占位）</span></div>
      <div class="kv"><span class="k">有效期</span><span class="v">登录后 30 天（占位）</span></div>
      <div class="kv"><span class="k">来源</span><span class="v">中国版 · 境内中继 · 通义千问</span></div>
    </div>
    <div class="note note--ok mt">${ico('arrowR')}<span>下一步：下载识别与朗读包（必做，一次性）。</span></div>
  </div>
  <div class="scr-bottom"><div class="strobe center" style="justify-content:center"><span class="spinner spinner--ink"></span><span class="small muted">正在前往资源包…</span></div></div>`);

/* ---------------- 屏 2 · 资源包 ---------------- */

const S2_START = phone(`
  ${steps('on', '', '')}
  <div class="pad" style="padding-top:6px">
    <h2 class="t">下载本机语音包</h2>
    <p class="p">识别与朗读都在你的设备上完成，音频不出设备。这一步需要一次，不做就用不了听译与朗读。</p>
    <div class="card mt">
      ${pkgRow({ tone: 'run', icon: 'mic', name: '识别语言包 · 英语（美国）', use: '对话实时听译、实时字幕、语音输入', chip: '<span class="chip chip-run">准备中</span>', sub: MB })}
      ${pkgRow({ tone: 'run', icon: 'wave', name: '高质量朗读包 · 英语', use: '朗读、播客模式、发音示范', chip: '<span class="chip chip-run">准备中</span>', sub: MB })}
    </div>
    <div class="note note--mute mt">${ico('wifi')}<span>当前按网络方式自动开始：<strong>Wi‑Fi</strong>。可随时改为蜂窝数据。</span></div>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="pkgs-start">开始下载</button>
      <button class="btn btn--quiet" data-od-id="pkgs-lang">更换识别语言</button>
    </div>
  </div>`);

const S2_DL = phone(`
  ${steps('done', 'on', '')}
  <div class="pad" style="padding-top:6px">
    <div class="row-between">
      <h2 class="t" style="margin:0">正在下载</h2>
      <span class="small muted tnum">0.0 / 000 MB</span>
    </div>
    <div class="card mt">
      ${pkgRow({ tone: 'run', icon: 'mic', name: '识别语言包 · 英语（美国）', use: '对话实时听译、实时字幕、语音输入', chip: '<span class="chip chip-run">68%</span>', bar: true, pct: 68, barTone: 'thin', sub: '已下 000 MB / 共 000 MB（占位）' })}
      ${pkgRow({ tone: 'run', icon: 'wave', name: '高质量朗读包 · 英语', use: '朗读、播客模式、发音示范', chip: '<span class="chip chip-run">41%</span>', bar: true, pct: 41, barTone: 'thin', sub: '已下 000 MB / 共 000 MB（占位）' })}
    </div>
    <div class="hr"></div>
    <div class="total"><span>总进度</span><b>54%</b></div>
    <div class="bar" style="height:10px"><i style="width:54%"></i></div>
    <div class="seg mt">
      <button aria-pressed="true">${ico('wifi')} Wi‑Fi</button>
      <button aria-pressed="false">${ico('cell')} 蜂窝数据</button>
    </div>
    <p class="en" style="margin-top:8px">离开 App 也会继续下载，回到 App 自动续传。</p>
  </div>
  <div class="scr-bottom">
    <button class="btn btn--quiet" data-od-id="pkgs-bg">隐藏到后台继续下载</button>
  </div>`);

const S2_CELL_SHEET = phone(`
  ${steps('done', 'on', '')}
  <div class="pad" style="padding-top:6px;filter:blur(1.5px);opacity:.55">
    <h2 class="t">正在下载</h2>
    <div class="card mt">${pkgRow({ tone: 'run', icon: 'mic', name: '识别语言包 · 英语（美国）', use: '对话实时听译、实时字幕', chip: '<span class="chip chip-run">68%</span>', bar: true, pct: 68 })}</div>
  </div>
  <div class="scrim"></div>
  <div class="sheet">
    <h3 class="t">用蜂窝数据继续？</h3>
    <p class="p mt">还剩 <strong>000 MB（占位）</strong>，按你的套餐可能产生流量费用。断点续传，不会重复下载。</p>
    <div class="note note--mute mt">${ico('wifi')}<span>等待 Wi‑Fi 也可以：连上 Wi‑Fi 后自动继续。</span></div>
    <div class="stack mt">
      <button class="btn btn--primary" data-od-id="cell-go">用蜂窝数据继续</button>
      <button class="btn btn--ghost">等 Wi‑Fi</button>
    </div>
  </div>`);

const S2_RETRY = phone(`
  ${steps('done', 'on', '')}
  <div class="pad" style="padding-top:6px">
    <h2 class="t">正在重试</h2>
    <p class="p">刚才朗读包中断了，我们从断点继续，已下载的部分不重下。</p>
    <div class="card mt">
      ${pkgRow({ tone: 'run', icon: 'mic', name: '识别语言包 · 英语（美国）', use: '对话实时听译、实时字幕', chip: '<span class="chip chip-run">68%</span>', bar: true, pct: 68, barTone: 'thin' })}
      ${pkgRow({ tone: 'run', icon: 'wave', name: '高质量朗读包 · 英语', use: '朗读、播客模式', chip: '<span class="chip chip-run">第 2 次尝试 · 12%</span>', bar: true, pct: 12, barTone: 'thin' })}
    </div>
    <div class="note note--info mt">${ico('info')}<span>连续 3 次失败会停在这一屏，让你选网络或稍后再试。</span></div>
  </div>
  <div class="scr-bottom"><div class="strobe center" style="justify-content:center"><span class="spinner spinner--ink"></span><span class="small muted">自动重试中…</span></div></div>`);

const S2_PARTIAL = phone(`
  ${steps('done', 'on', '')}
  <div class="pad" style="padding-top:6px">
    <h2 class="t">一个包完成了，另一个没成</h2>
    <p class="p">朗读包已装好，可以先开始读。识别包还差一步。</p>
    <div class="card mt">
      ${pkgRow({ tone: 'ok', icon: 'wave', name: '高质量朗读包 · 英语', use: '朗读、播客模式、发音示范', chip: '<span class="chip chip-ok">已完成</span>', bar: true, pct: 100, barTone: 'ok' })}
      ${pkgRow({ tone: 'err', icon: 'mic', name: '识别语言包 · 英语（美国）', use: '对话实时听译、实时字幕、语音输入', chip: '<span class="chip chip-err">失败</span>', sub: '<span class="danger">网络中断，进度保留在 68%</span>' })}
    </div>
    <div class="note note--err mt">${ico('alert')}<span>重试只需要识别包；朗读包不会重下。</span></div>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="pkg-retry-one">重试识别包</button>
      <button class="btn btn--ghost">稍后再说</button>
    </div>
  </div>`);

const S2_OFFLINE = phone(`
  ${steps('done', 'on', '')}
  <div class="pad" style="padding-top:6px">
    <h2 class="t">下载没完成</h2>
    <div class="note note--err mt">${ico('alert')}<span><b>设备当前离线。</b>两个包都没有完成，进度已保留。</span></div>
    <div class="card mt">
      ${pkgRow({ tone: 'idle', icon: 'mic', name: '识别语言包 · 英语（美国）', use: '对话实时听译、实时字幕', chip: '<span class="chip chip-wait">等待网络</span>', bar: true, pct: 68, barTone: 'thin' })}
      ${pkgRow({ tone: 'idle', icon: 'wave', name: '高质量朗读包 · 英语', use: '朗读、播客模式', chip: '<span class="chip chip-wait">等待网络</span>', bar: true, pct: 41, barTone: 'thin' })}
    </div>
    <p class="p mt">连上网后会自动继续，也可以立刻手动重试。</p>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="pkg-retry">重试下载</button>
      <button class="btn btn--ghost">打开网络设置</button>
    </div>
  </div>`);

const S2_CELL_BLOCK = phone(`
  ${steps('done', 'on', '')}
  <div class="pad" style="padding-top:6px">
    <h2 class="t">下载没完成</h2>
    <div class="note note--err mt">${ico('alert')}<span><b>系统阻止了蜂窝下载。</b>低数据模式或蜂窝数据已关闭，两个包都停在中途。</span></div>
    <div class="card mt">
      ${pkgRow({ tone: 'idle', icon: 'mic', name: '识别语言包 · 英语（美国）', use: '对话实时听译、实时字幕', chip: '<span class="chip chip-err">被阻止</span>', bar: true, pct: 68, barTone: 'thin' })}
      ${pkgRow({ tone: 'idle', icon: 'wave', name: '高质量朗读包 · 英语', use: '朗读、播客模式', chip: '<span class="chip chip-err">被阻止</span>', bar: true, pct: 41, barTone: 'thin' })}
    </div>
    <p class="p mt">Wi‑Fi 通道不受影响；也可以在系统里放开蜂窝数据后重试。</p>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="pkg-retry-wifi">用 Wi‑Fi 继续</button>
      <button class="btn btn--ghost">去系统设置</button>
    </div>
  </div>`);

const S2_SPACE = phone(`
  ${steps('done', 'on', '')}
  <div class="pad" style="padding-top:6px">
    <h2 class="t">空间不够</h2>
    <div class="note note--err mt">${ico('alert')}<span><b>还差 000 MB（占位）。</b>设备可用空间不足，两个包都没有开始写入。</span></div>
    <div class="card mt">
      <div class="kv"><span class="k">识别语言包需要</span><span class="v">000 MB（占位）</span></div>
      <div class="kv"><span class="k">朗读包需要</span><span class="v">000 MB（占位）</span></div>
      <div class="kv"><span class="k">设备当前可用</span><span class="v danger">000 MB（占位）</span></div>
      <div class="kv"><span class="k">建议清理到</span><span class="v">000 MB（占位）</span></div>
    </div>
    <p class="p mt">清理后可继续。已下载部分不会浪费。</p>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="space-again">重新检测空间</button>
      <button class="btn btn--ghost">去系统设置清理</button>
    </div>
  </div>`);

const S2_UNSUPPORTED = phone(`
  ${steps('done', 'on', '')}
  <div class="pad" style="padding-top:6px">
    <h2 class="t">这个语言暂不支持识别</h2>
    <div class="note note--err mt">${ico('alert')}<span><b>系统没有「${'冰岛语' }」的语音识别包。</b>离线识别在系统层不可用，我们无法补上。</span></div>
    <div class="card mt">
      ${pkgRow({ tone: 'err', icon: 'mic', name: '识别语言包 · 冰岛语', use: '对话实时听译、实时字幕', chip: '<span class="chip chip-err">系统不支持</span>' })}
      ${pkgRow({ tone: 'run', icon: 'wave', name: '高质量朗读包 · 冰岛语', use: '朗读、播客模式、发音示范', chip: '<span class="chip chip-run">下载中 40%</span>', bar: true, pct: 40, barTone: 'thin' })}
    </div>
    <div class="note note--info mt">${ico('info')}<span>建议：先用朗读包；识别换成系统支持的语种，或改用云端识别（自备 Key）。</span></div>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="degrade-go">只装朗读包，继续</button>
      <button class="btn btn--ghost">换一个识别语种</button>
    </div>
  </div>`);

const S2_DEGRADED = phone(`
  ${steps('done', 'on', '')}
  <div class="pad" style="padding-top:6px">
    <h2 class="t">已降级：先给你能用的</h2>
    <p class="p">朗读包已装好。下面几件暂时用不了，其余功能不受影响。</p>
    <div class="card mt">
      <div class="row-between" style="padding:8px 0"><span class="row">${ico('check', 'ico-l')}<span class="pkg-name">朗读、播客模式</span></span><span class="chip chip-ok">可用</span></div>
      <div class="hr" style="margin:6px 0"></div>
      <div class="row-between" style="padding:8px 0"><span class="row muted">${ico('x', 'ico-l')}<span class="pkg-name muted">对话实时听译</span></span><span class="chip chip-off">暂不可用</span></div>
      <div class="row-between" style="padding:8px 0"><span class="row muted">${ico('x', 'ico-l')}<span class="pkg-name muted">实时字幕</span></span><span class="chip chip-off">暂不可用</span></div>
      <div class="row-between" style="padding:8px 0"><span class="row muted">${ico('x', 'ico-l')}<span class="pkg-name muted">语音输入</span></span><span class="chip chip-off">暂不可用</span></div>
      <div class="row-between" style="padding:8px 0"><span class="row">${ico('check', 'ico-l')}<span class="pkg-name">复习卡片、翻译文档</span></span><span class="chip chip-ok">可用</span></div>
    </div>
    <div class="note note--info mt">${ico('folder')}<span><b>怎么补：</b>iOS 设置 → 通用 → 语言与地区 → 添加「冰岛语」，装好语音识别包后回到这里点补齐。</span></div>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="enter-home-degraded">进入首页</button>
      <button class="btn btn--ghost">去系统设置添加语言</button>
    </div>
  </div>`);

const S2_LANG = phone(`
  <div class="pad" style="padding-top:16px">
    <div class="row-between">
      <button class="link" style="color:var(--muted)">${ico('chevR', '').replace('M9.5 5.5l6.5 6.5-6.5 6.5', 'M14.5 5.5L8 12l6.5 6.5')}返回</button>
      <h3 class="t" style="margin:0">识别语言</h3>
      <span style="width:34px"></span>
    </div>
    <p class="p mt">识别包按语言单独下载。之后可在设置里增删。</p>
    <div class="card mt" style="padding:6px 14px">
      ${[['英语（美国）', '可用 · 已下载', 'ok'], ['日语', '可用 · 待下载', 'wait'], ['冰岛语', '系统不支持识别', 'err'], ['冰岛语（云端）', '需自带 API Key', 'mute']]
        .map(([n, s, t]) => `<div class="row-between" style="padding:11px 0;${t === 'ok' ? 'border-bottom:1px solid var(--border)' : ''}">
          <span class="row"><span class="pkg-name">${n}</span></span>
          <span class="chip chip-${t === 'ok' ? 'ok' : t === 'err' ? 'err' : t === 'mute' ? 'off' : 'wait'}">${s}</span>
        </div>`).join('')}
    </div>
    <p class="en" style="margin-top:10px">语言清单与支持状态随系统版本变化，界面读系统能力，不写死。</p>
  </div>
  <div class="scr-bottom"><button class="btn btn--primary">下载英语（美国）识别包</button></div>`);

const S2_DONE = phone(`
  ${steps('done', 'done', 'on')}
  <div class="pad center" style="padding-top:64px">
    <span class="tile" style="margin:0 auto;width:56px;height:56px;display:grid;place-items:center">${ico('check', 'ico-l')}</span>
    <h2 class="t">都装好了</h2>
    <p class="p">引擎、识别包、朗读包齐了，全部功能可用。</p>
    <div class="card mt" style="text-align:left">
      <div class="kv"><span class="k">引擎</span><span class="v sage">${'已连通 · 免费额度'}</span></div>
      <div class="kv"><span class="k">识别语言包</span><span class="v sage">英语（美国）</span></div>
      <div class="kv"><span class="k">朗读包</span><span class="v sage">英语 · 高质量</span></div>
      <div class="kv"><span class="k">Safari 扩展</span><span class="v na">不在就绪判据内</span></div>
    </div>
    <div class="note note--ok mt">${ico('arrowR')}<span>下一步是引导，不做也不影响使用。</span></div>
  </div>
  <div class="scr-bottom"><div class="strobe center" style="justify-content:center"><span class="spinner spinner--ink"></span><span class="small muted">正在前往引导…</span></div></div>`);

/* ---------------- 屏 3 · 引导（可跳过） ---------------- */

const S3_HELLO = phone(`
  ${steps('done', 'done', 'on')}
  <div class="pad" style="padding-top:6px">
    <div class="row-between">
      <span class="chip chip-ok">就绪</span>
      <button class="link" data-od-id="onb-skip-1">跳过引导</button>
    </div>
    <h2 class="t" style="margin-top:18px">欢迎</h2>
    <p class="p mt">你在网页上读过的那些句子，我们记下来了。它们会变成卡片等你来复习。</p>
    <div class="card mt">
      <div class="row" style="padding:9px 0">${ico('eye', 'ico-l')}<span class="grow pkg-name">读网页时，扩展悄悄收下你停留最久的句子</span></div>
      <div class="row" style="padding:9px 0">${ico('card', 'ico-l')}<span class="grow pkg-name">App 里变成卡片，随时复习</span></div>
      <div class="row" style="padding:9px 0">${ico('wave', 'ico-l')}<span class="grow pkg-name">听译与朗读都在本机跑，音频不出设备</span></div>
    </div>
    <div class="dots mt-lg"><i class="on"></i><i></i><i></i></div>
  </div>
  <div class="scr-bottom"><button class="btn btn--primary" data-od-id="onb-next-1">下一步</button></div>`);

const S3_TRY = phone(`
  ${steps('done', 'done', 'on')}
  <div class="pad" style="padding-top:6px">
    <div class="row-between">
      <span class="chip chip-ok">就绪</span>
      <button class="link" data-od-id="onb-skip-2">跳过引导</button>
    </div>
    <h2 class="t" style="margin-top:18px">试一句</h2>
    <p class="p">这是你今天读到的一句话，点一下听听看。</p>
    <div class="card mt">
      <p class="p" style="color:var(--fg);font-size:15px;margin:0">The best way out is always through.</p>
      <p class="en" style="margin:6px 0 12px">走出困境最好的办法，永远是穿过去。</p>
      <div class="row"><button class="btn btn--ghost btn--sm">${ico('wave', 'ico-l')}听英语</button><button class="btn btn--sm btn--quiet">看译文</button></div>
    </div>
    <div class="note note--mute mt">${ico('lock')}<span>朗读用的是刚下好的高质量朗读包。</span></div>
    <div class="dots mt-lg"><i class="done" style="background:var(--sage-on)"></i><i class="on"></i><i></i></div>
  </div>
  <div class="scr-bottom"><button class="btn btn--primary" data-od-id="onb-next-2">下一步</button></div>`);

const S3_EXT = phone(`
  ${steps('done', 'done', 'on')}
  <div class="pad" style="padding-top:6px">
    <div class="row-between">
      <span class="chip chip-ok">就绪</span>
      <button class="link" data-od-id="onb-skip-3">跳过引导</button>
    </div>
    <h2 class="t" style="margin-top:18px">把 Safari 扩展打开</h2>
    <p class="p">扩展负责在网页上做双语翻译，并把句子送进你的卡片。<strong>不开也能用</strong>：复习、文档翻译、听译、朗读都不依赖它。</p>
    <div class="card mt">
      <div class="row" style="padding:8px 0"><span class="abn" style="background:rgba(32,30,29,.06)">1</span><span class="grow pkg-name">设置 → Safari → 扩展</span></div>
      <div class="row" style="padding:8px 0"><span class="abn" style="background:rgba(32,30,29,.06)">2</span><span class="grow pkg-name">打开「大肚猴翻译」</span></div>
      <div class="row" style="padding:8px 0"><span class="abn" style="background:rgba(32,30,29,.06)">3</span><span class="grow pkg-name">在网页上点一下扩展图标</span></div>
    </div>
    <div class="dots mt-lg"><i style="background:var(--sage-on)"></i><i style="background:var(--sage-on)"></i><i class="on"></i></div>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="onb-open-settings">去系统设置开启</button>
      <button class="btn btn--quiet" data-od-id="onb-skip-3b">以后再说</button>
    </div>
  </div>`);

const S3_SKIPPED = phone(`
  ${steps('done', 'done', 'done')}
  <div class="pad" style="padding-top:6px">
    <div class="note note--ok">${ico('check')}<span>已跳过引导。不影响任何功能，随时能在首页重看。</span></div>
    <h2 class="t" style="margin-top:18px">首页</h2>
    <p class="p">复习、文档翻译、听译、朗读都已可用。</p>
    <div class="card mt">
      <div class="row-between"><span class="row">${ico('card', 'ico-l')}<span class="pkg-name">今日待复习</span></span><span class="chip chip-ok">12 张</span></div>
    </div>
    <p class="en" style="margin-top:12px">跳过后不落任何阻塞态，扩展在首页仍作为普通入口出现。</p>
  </div>
  <div class="scr-bottom"><button class="btn btn--quiet">进入首页</button></div>`);

/* ---------------- 就绪与首页 ---------------- */

const H_READY = phone(`
  <div class="pad" style="padding-top:12px">
    <div class="row-between">
      <span class="row"><span class="tile tile-ghost" style="width:32px;height:32px;font-size:15px">译</span><span class="strong">大肚猴翻译</span></span>
      <span class="chip chip-ok">就绪</span>
    </div>
    <h2 class="t" style="margin-top:16px">今天读 12 张</h2>
    <p class="p">从你在网页上停下来读完的句子里挑的。</p>
    <div class="card mt">
      <div class="row-between" style="padding:6px 0"><span class="row">${ico('card', 'ico-l')}<span class="pkg-name">今日复习</span></span><span class="small muted">约 6 分钟</span></div>
      <div class="bar bar--ok" style="height:6px"><i style="width:33%"></i></div>
      <p class="en" style="margin-top:6px">已复习 4 / 12</p>
    </div>
    <div class="hr"></div>
    <p class="small muted strong" style="margin:0 0 8px">设备能力</p>
    <div class="card-flat" style="padding:4px 14px">
      ${[['对话 · 实时听译', 'mic', 'ok'], ['实时字幕', 'wave', 'ok'], ['翻译文档', 'doc', 'ok'], ['朗读（含播客）', 'eye', 'ok'], ['系统翻译弹层', 'globe', 'ok'], ['Mac 快速翻译面板', 'device', 'ok']]
        .map(([n, i, s]) => `<div class="row-between" style="padding:10px 0;border-bottom:1px solid var(--border)"><span class="row">${ico(i, 'ico-l')}<span class="pkg-name">${n}</span></span><span class="chip chip-ok">可用</span></div>`).join('')}
    </div>
    <button class="link mt" style="display:block">重看引导</button>
  </div>
  <div class="scr-bottom"><button class="btn btn--primary" data-od-id="home-review">开始复习</button></div>`);

const H_NOT_READY = phone(`
  <div class="pad" style="padding-top:12px">
    <div class="row-between">
      <span class="row"><span class="tile tile-ghost" style="width:32px;height:32px;font-size:15px">译</span><span class="strong">大肚猴翻译</span></span>
      <span class="chip chip-run">未就绪</span>
    </div>
    <h2 class="t" style="margin-top:16px">还差一步</h2>
    <div class="card card--warn mt">
      <div class="row" style="align-items:flex-start">
        <span style="color:var(--danger);margin-top:2px">${ico('alert', 'ico-l')}</span>
        <span class="grow">
          <span class="pkg-name">识别语言包没装好</span>
          <span class="pkg-use">对话实时听译、实时字幕、语音输入还用不了。朗读与其他功能不受影响。</span>
        </span>
      </div>
      <button class="btn btn--ghost btn--sm mt" data-od-id="home-topup">去补齐</button>
    </div>
    <div class="hr"></div>
    <p class="small muted strong" style="margin:0 0 8px">设备能力</p>
    <div class="card-flat" style="padding:4px 14px">
      ${[['对话 · 实时听译', 'mic', 'off'], ['实时字幕', 'wave', 'off'], ['翻译文档', 'doc', 'ok'], ['朗读（含播客）', 'eye', 'ok'], ['系统翻译弹层', 'globe', 'ok']]
        .map(([n, i, s]) => `<div class="row-between" style="padding:10px 0;border-bottom:1px solid var(--border)"><span class="row" style="${s === 'off' ? 'color:var(--muted)' : ''}">${ico(i, 'ico-l')}<span class="pkg-name" style="${s === 'off' ? 'color:var(--muted)' : ''}">${n}</span></span><span class="chip chip-${s}">${s === 'ok' ? '可用' : '缺识别包'}</span></div>`).join('')}
    </div>
    <p class="en" style="margin-top:10px">未就绪时首页不空转：可用功能照常进，缺的那件给出原因和去处。</p>
  </div>
  <div class="scr-bottom"><button class="btn btn--primary" data-od-id="home-review-2">开始复习（12 张）</button></div>`);

const S4_TOPUP = phone(`
  <div class="pad" style="padding-top:18px">
    <span class="chip chip-wait">老用户补齐</span>
    <h2 class="t" style="margin-top:12px">补齐语音包</h2>
    <p class="p">你已登录，引擎也通着，只差语音包。补完直接用首页，不重走三段。</p>
    <div class="card mt">
      ${pkgRow({ tone: 'run', icon: 'mic', name: '识别语言包 · 英语（美国）', use: '对话实时听译、实时字幕', chip: '<span class="chip chip-run">下载中 24%</span>', bar: true, pct: 24, barTone: 'thin', sub: MB })}
      ${pkgRow({ tone: 'ok', icon: 'wave', name: '高质量朗读包 · 英语', use: '朗读、播客模式', chip: '<span class="chip chip-ok">已完成</span>' })}
    </div>
    <div class="note note--mute mt">${ico('info')}<span>这一屏不出现登录，也不出现三段流程的任何一步。</span></div>
  </div>
  <div class="scr-bottom">
    <div class="stack">
      <button class="btn btn--primary" data-od-id="topup-bg">隐藏到后台继续</button>
      <button class="btn btn--quiet" data-od-id="topup-home">先回首页</button>
    </div>
  </div>`);

const S4_PASSTHROUGH = `
<div class="board wide" style="background:transparent;border:0;padding:0">
  <div class="card card--ok" style="display:flex;gap:16px;align-items:flex-start">
    <span style="color:var(--sage);flex:none">${ico('shield', 'ico-l')}</span>
    <div>
      <h3 class="t">已登录 + 已就绪 ⇒ 不出现任何一屏，直进首页</h3>
      <p class="p" style="margin:0">屏 1 / 屏 2 / 屏 3 全部跳过，也不闪一帧空白启动页。判据：<code style="font-size:12.5px">isLoggedIn &amp;&amp; engineOk &amp;&amp; asrPackInstalled &amp;&amp; ttsPackInstalled</code> 时，冷启动直接构造首页。</p>
    </div>
  </div>
  <div class="tbl-wrap" style="margin-top:16px">
    <table class="tbl">
      <thead><tr><th>用户状态</th><th>引擎</th><th>识别包</th><th>朗读包</th><th>进入哪一屏</th><th>说明</th></tr></thead>
      <tbody>
        <tr><td><b>新用户</b>（未登录）</td><td class="na">—</td><td class="na">—</td><td class="na">—</td><td><b>屏 1 登录</b></td><td>硬门，只有登录</td></tr>
        <tr><td>已登录，未装包</td><td class="tick">有</td><td class="cross">缺</td><td class="cross">缺</td><td><b>屏 2 资源包</b></td><td>硬门，无跳过</td></tr>
        <tr><td>已登录，识别包缺</td><td class="tick">有</td><td class="cross">缺</td><td class="tick">有</td><td><b>补齐屏</b>（非三段）</td><td>只补缺的那一个</td></tr>
        <tr><td>已登录，识别不支持</td><td class="tick">有</td><td class="cross">系统不支持</td><td class="tick">有</td><td><b>降级页 → 首页（未就绪形态）</b></td><td>说明哪几件不可用、怎么补</td></tr>
        <tr><td>已登录，已就绪</td><td class="tick">有</td><td class="tick">有</td><td class="tick">有</td><td><b>首页</b></td><td>屏 3 引导也不重放</td></tr>
        <tr><td>已登录，额度用尽</td><td class="cross">无</td><td class="tick">有</td><td class="tick">有</td><td><b>首页 + 额度提示</b></td><td>不是首启问题，仍可自带 Key</td></tr>
      </tbody>
    </table>
  </div>
</div>`;

/* ---------------- 宽板：就绪判据表 ---------------- */

const W_READINESS = `
<div class="board wide" style="background:transparent;border:0;padding:0">
  <div class="tbl-wrap">
    <table class="tbl">
      <thead><tr>
        <th>功能（App 侧）</th><th>登录</th><th>引擎可解析</th><th>识别语言包</th><th>朗读包</th><th>Safari 扩展</th><th>缺任一项时的表现</th>
      </tr></thead>
      <tbody>
        <tr><td><b>复习卡片</b>（来自扩展的句子）</td><td class="tick">需要</td><td class="tick">需要</td><td class="na">不涉及</td><td class="na">不涉及</td><td class="na">不涉及</td><td>扩展未开：卡片为空，首页给启用入口</td></tr>
        <tr><td><b>翻译文档</b></td><td class="tick">需要</td><td class="tick">需要</td><td class="na">不涉及</td><td class="na">不涉及</td><td class="na">不涉及</td><td>—</td></tr>
        <tr><td><b>系统翻译弹层</b></td><td class="tick">需要</td><td class="tick">需要</td><td class="na">不涉及</td><td class="na">不涉及</td><td class="na">不涉及</td><td>—</td></tr>
        <tr><td><b>Mac 快速翻译面板</b></td><td class="tick">需要</td><td class="tick">需要</td><td class="na">不涉及</td><td class="na">不涉及</td><td class="na">不涉及</td><td>—</td></tr>
        <tr><td><b>对话 · 实时听译</b></td><td class="tick">需要</td><td class="tick">需要</td><td class="tick">需要</td><td class="na">不涉及</td><td class="na">不涉及</td><td>入口灰掉 + 标注「缺识别包」</td></tr>
        <tr><td><b>实时字幕</b></td><td class="tick">需要</td><td class="tick">需要</td><td class="tick">需要</td><td class="na">不涉及</td><td class="na">不涉及</td><td>同上</td></tr>
        <tr><td><b>语音输入</b></td><td class="tick">需要</td><td class="tick">需要</td><td class="tick">需要</td><td class="na">不涉及</td><td class="na">不涉及</td><td>同上</td></tr>
        <tr><td><b>朗读（含播客模式）</b></td><td class="tick">需要</td><td class="tick">需要</td><td class="na">不涉及</td><td class="tick">需要</td><td class="na">不涉及</td><td>可退化为系统朗读并说明</td></tr>
        <tr><td><b>网页双语翻译</b></td><td class="cross">免登录</td><td class="tick">需要</td><td class="na">不涉及</td><td class="na">不涉及</td><td class="tick">需要</td><td>扩展可自带 API Key 独立工作</td></tr>
      </tbody>
    </table>
  </div>
  <p class="board-note"><b>怎么用这张表：</b>「就绪」= 登录 ∧ 引擎可解析 ∧ 识别语言包 ∧ 朗读包，四项齐才放行屏 2。Safari 扩展只在屏 3 里作为引导内容出现，<b>不进门</b>。每个功能格由这张表反查，缺项一律给「灰掉 + 原因 + 去处」，不允许点进去才报错。</p>
</div>`;

/* ---------------- 宽板：失败矩阵 ---------------- */

const W_MATRIX = `
<div class="board wide" style="background:transparent;border:0;padding:0">
  <div class="tbl-wrap">
    <table class="tbl">
      <thead><tr><th>失败 / 边界</th><th>触发条件</th><th>屏内表现</th><th>主按钮（唯一实心）</th><th>进度如何处理</th><th>是否可以绕过</th></tr></thead>
      <tbody>
        <tr><td><b>离线</b></td><td>下载时无网络</td><td>红色说明条 + 两包标「等待网络」</td><td>重试下载</td><td>保留各自进度</td><td>否（屏 2 是硬门）</td></tr>
        <tr><td><b>蜂窝被阻止</b></td><td>低数据模式 / 蜂窝关闭</td><td>说明「系统阻止了蜂窝下载」</td><td>用 Wi‑Fi 继续</td><td>保留进度</td><td>否</td></tr>
        <tr><td><b>蜂窝流量确认</b></td><td>用户切到蜂窝</td><td>底部 sheet：剩余体积 + 费用提示</td><td>用蜂窝数据继续</td><td>继续推进</td><td>可选「等 Wi‑Fi」</td></tr>
        <tr><td><b>空间不足</b></td><td>可用空间 &lt; 所需</td><td>所需 / 当前可用 / 建议清理三行数字</td><td>重新检测空间</td><td>未开始，0%</td><td>否</td></tr>
        <tr><td><b>系统不支持该语言识别</b></td><td>系统无该语种识别包</td><td>标「系统不支持」+ 降级说明</td><td>只装朗读包，继续</td><td>朗读包照常下</td><td><b>是</b>：降级进首页（未就绪形态）</td></tr>
        <tr><td><b>包校验失败</b></td><td>下载中断导致文件损坏</td><td>标「校验失败」</td><td>重新下载该包</td><td>该包清零重来</td><td>否</td></tr>
        <tr><td><b>连续 3 次失败</b></td><td>同一包反复失败</td><td>停止自动重试，给两个出口</td><td>换网络重试</td><td>保留进度</td><td>否</td></tr>
        <tr><td><b>登录网络失败</b></td><td>登录请求超时</td><td>屏 1 红色说明条</td><td>重试</td><td>不涉及</td><td>可改邮箱</td></tr>
        <tr><td><b>用户取消登录</b></td><td>用户关闭 Apple 面板</td><td>屏 1 中性说明（非错误红）</td><td>重新登录</td><td>不涉及</td><td>可改邮箱</td></tr>
        <tr><td><b>Apple 不可用</b></td><td>未登录 iCloud / 系统过低</td><td>隐藏 Apple 与 Google 入口</td><td>使用邮箱登录</td><td>不涉及</td><td>—</td></tr>
        <tr><td><b>中国版未勾出境同意</b></td><td>checkbox 未勾</td><td>同意条高亮未完成</td><td>登录按钮不可用（唯一允许的降对比状态）</td><td>不涉及</td><td>否</td></tr>
      </tbody>
    </table>
  </div>
  <p class="board-note"><b>原则：</b>失败屏只允许一个实心按钮，且永远是「让这件事继续发生」的那一个（重试 / 换网络 / 只装朗读包）。破坏性或放弃型出口一律 outline 或文字链。</p>
</div>`;

/* ---------------- 宽板：端到端路径 ---------------- */

const W_FLOW = `
<div class="board wide" style="background:transparent;border:0;padding:0">
  <div class="tbl-wrap">
    <table class="tbl">
      <thead><tr><th>路径</th><th>进入条件</th><th>经过的屏</th><th>可否跳过</th><th>出口</th></tr></thead>
      <tbody>
        <tr><td><b>新用户 · 国际版</b></td><td>未登录</td><td>屏1 登录 → 屏2 资源包（两包）→ 屏3 引导 → 首页（就绪）</td><td>屏2 否 · 屏3 是</td><td>首页</td></tr>
        <tr><td><b>新用户 · 中国版</b></td><td>未登录</td><td>同上，屏1 多一个出境同意勾选</td><td>屏2 否 · 屏3 是</td><td>首页</td></tr>
        <tr><td><b>新用户 · 识别不支持</b></td><td>所选语种系统无识别包</td><td>屏1 → 屏2（失败→降级）→ 屏3 → 首页（未就绪形态）</td><td>降级由系统触发，非用户跳过</td><td>首页（未就绪）</td></tr>
        <tr><td><b>老用户 · 已就绪</b></td><td>登录 ∧ 引擎 ∧ 两包</td><td>无屏，直进首页</td><td>—</td><td>首页（就绪）</td></tr>
        <tr><td><b>老用户 · 缺包</b></td><td>登录 ∧ 引擎 ∧ 缺任一包</td><td>补齐屏（单屏，不重走三段）</td><td>可「先回首页」</td><td>首页（未就绪）</td></tr>
        <tr><td><b>浏览器扩展独立路径</b></td><td>用户未登录 App</td><td>与三段完全无关：装扩展 → 免登录 → 自带 Key 或网页内登录</td><td>—</td><td>网页翻译</td></tr>
      </tbody>
    </table>
  </div>
  <div class="legend">
    <span>屏 1 = 硬门（只有登录）</span><span>屏 2 = 硬门（无跳过）</span><span>屏 3 = 软门（有跳过，不阻塞）</span><span>就绪 = 登录 ∧ 引擎 ∧ 识别包 ∧ 朗读包（不含扩展）</span>
  </div>
</div>`;

/* ---------------- 宽板：旧首屏对照（红线证据） ---------------- */

const W_OLD = `
<div class="board wide" style="background:transparent;border:0;padding:0">
  <div class="row" style="gap:24px;align-items:flex-start;flex-wrap:wrap">
    <div style="flex:1 1 320px;max-width:400px">
      <h3 class="t" style="color:var(--danger)">作废（旧）</h3>
      <p class="board-note" style="margin-top:6px">iPhone · TestFlight · 未登录首页实测反馈「太杂」。以下三样全部移除。</p>
      <div class="card card--warn" style="margin-top:12px;text-decoration:line-through;text-decoration-color:rgba(179,38,30,.5)">
        <div class="row" style="padding:6px 0"><span class="grow">设置</span><span class="chip chip-err">越权入口</span></div>
        <div class="hr" style="margin:6px 0"></div>
        <div class="row" style="padding:6px 0"><span class="grow">功能入口区</span><span class="chip chip-err">越权入口</span></div>
        <p class="en" style="margin:4px 0 0">对话 · 实时听译 / 实时字幕 / 翻译文档</p>
        <div class="hr" style="margin:6px 0"></div>
        <div class="row" style="padding:6px 0"><span class="grow">复习入口</span><span class="chip chip-err">越权入口</span></div>
      </div>
      <div class="card mt" style="text-decoration:line-through;text-decoration-color:rgba(179,38,30,.5)">
        <p class="p" style="margin:0;color:var(--fg)">「不登录也能完整使用」</p>
        <p class="en" style="margin:6px 0 0">与登录门自相矛盾 —— 作废</p>
      </div>
    </div>
    <div style="flex:1 1 320px;max-width:400px">
      <h3 class="t sage">现行</h3>
      <p class="board-note" style="margin-top:6px">未登录首屏只剩：品牌 + 一句话 + 三种登录方式。功能全部在就绪之后按判据逐件解锁。</p>
      <div class="card card--ok" style="margin-top:12px">
        <div class="row" style="padding:6px 0">${ico('check', 'ico-l')}<span class="grow">品牌 + 一句话说明</span></div>
        <div class="hr" style="margin:6px 0"></div>
        <div class="row" style="padding:6px 0">${ico('check', 'ico-l')}<span class="grow">Apple / Google / 邮箱</span></div>
        <div class="hr" style="margin:6px 0"></div>
        <div class="row" style="padding:6px 0">${ico('check', 'ico-l')}<span class="grow">免费额度自动到账的告知（不问、不勾）</span></div>
      </div>
      <div class="note note--ok mt">${ico('lock')}<span>「不登录也能完整使用」这类承诺<b>只允许出现在扩展侧</b>，App 侧一律不得出现。</span></div>
    </div>
  </div>
</div>`;

/* ---------------- 宽板：12 语种文案占位 ---------------- */

const W_I18N = `
<div class="board wide" style="background:transparent;border:0;padding:0">
  <div class="tbl-wrap">
    <table class="tbl">
      <thead><tr><th style="width:22%">文案槽位</th><th style="width:26%">中文（基准）</th><th style="width:26%">English</th><th>写法约束（供 12 语种落）</th></tr></thead>
      <tbody>
        <tr><td><b>S1 主标题</b></td><td>登录后开始</td><td>Sign in to begin</td><td>≤ 8 词；动词开头，不解释产品</td></tr>
        <tr><td><b>S1 说明</b></td><td>登录即获得一份免费额度……音频不出设备。</td><td>…audio never leaves your device.</td><td>2 句以内；「音频不出设备」不可省</td></tr>
        <tr><td><b>S2 标题</b></td><td>下载本机语音包</td><td>Download voice packs</td><td>名词短语；不得出现「跳过」</td></tr>
        <tr><td><b>S2 包名</b></td><td>识别语言包 / 高质量朗读包</td><td>Speech recognition / High-quality voice</td><td>两个名字各 ≤ 24 字符</td></tr>
        <tr><td><b>S2 一句话用途</b></td><td>用于对话实时听译、实时字幕</td><td>Powers live conversation and captions</td><td>每包 1 句，列功能名不写解释</td></tr>
        <tr><td><b>体积</b></td><td>约 000 MB</td><td>~000 MB</td><td><b>占位数字</b>，实测后回填；单位本地化</td></tr>
        <tr><td><b>S2 蜂窝确认</b></td><td>用蜂窝数据继续？</td><td>Continue over cellular?</td><td>问句；含费用提示</td></tr>
        <tr><td><b>S2 不支持识别</b></td><td>系统没有该语言的语音识别包</td><td>No system pack for this language</td><td>归因到系统，不写「我们不支持」</td></tr>
        <tr><td><b>S2 降级说明</b></td><td>哪几件暂不可用 + 怎么补</td><td>What's unavailable, and how to add it</td><td>先说不可用清单，再说一步操作</td></tr>
        <tr><td><b>S3 跳过</b></td><td>跳过引导</td><td>Skip</td><td>4 词内；按钮不落地</td></tr>
        <tr><td><b>失败条</b></td><td>网络连接失败 / 空间不足</td><td>Network error / Not enough space</td><td>说清「没发生什么变化」</td></tr>
        <tr><td><b>就绪徽标</b></td><td>就绪 / 未就绪</td><td>Ready / Not ready</td><td>2 词内；不用绿色文字，用 sage 底</td></tr>
        <tr><td><b>功能项状态</b></td><td>可用 / 缺识别包 / 暂不可用</td><td>Available / Needs recognition pack</td><td>三档封闭集，禁止自由发挥</td></tr>
      </tbody>
    </table>
  </div>
  <p class="board-note"><b>落法：</b>先按这张表把中英两版锁死，再由本地化同学按同一槽位铺 12 语种；所有句子在 320pt 宽度下不折行超过 2 行，超长先改句子再改字号。</p>
</div>`;

/* ---------------- 板集合 ---------------- */

const BOARDS = [
  { g: 'g1', code: 'S1-00', t: '未登录首屏 · 默认', flag: 'gate', flagText: '硬门', note: '<b>只有登录。</b>无设置、无功能入口、无复习入口；免费额度作为告知出现，不问不勾。', html: S1_DEFAULT },
  { g: 'g1', code: 'S1-01', t: '登录中', flag: 'gate', flagText: '硬门', note: '按钮内联 spinner，其他入口置灰但<b>不移除</b>（移除会让用户以为功能消失）。', html: S1_LOADING },
  { g: 'g1', code: 'S1-02', t: '失败 · 网络', note: '失败不写「你没做错什么」，只写「什么都没变」，避免用户以为额度或包被扣。', html: S1_ERR_NET },
  { g: 'g1', code: 'S1-03', t: '失败 · 用户取消', note: '取消是<b>中性态</b>，用灰底说明而不是红色报错。', html: S1_ERR_CANCEL },
  { g: 'g1', code: 'S1-04', t: 'Apple 不可用', note: '降级：只留邮箱，实心按钮也换成邮箱，不留一个点不动的空位。', html: S1_NO_APPLE },
  { g: 'g1', code: 'S1-05', t: '中国版 · 出境同意未勾', flag: 'gate', flagText: '硬门', note: '未勾选时唯一实心按钮<b>不可用</b>（全设计里唯一允许降对比的状态），勾选后即时可点。', html: S1_CN },
  { g: 'g1', code: 'S1-06', t: '中国版 · 已勾选', note: '与屏 1 默认<b>逐条同构</b>：同样的三段、同样文案，只有引擎来源不同。', html: S1_CN_OK },
  { g: 'g1', code: 'S1-07', t: '邮箱登录 · 输入邮箱', note: '邮箱与第三方登录同级，不折叠进「更多」。', html: S1_EMAIL },
  { g: 'g1', code: 'S1-08', t: '邮箱登录 · 验证码', note: '重发有 60 秒冷却与失败上限，避免把登录屏做成无限重试。', html: S1_EMAIL_CODE },
  { g: 'g1', code: 'S1-09', t: '成功过渡 · 额度到账', note: '过渡屏同时交代：额度到账了、接下来要下包。免费额度数字为<b>占位</b>。', html: S1_DONE },

  { g: 'g2', code: 'S2-00', t: '资源包 · 进入即准备', flag: 'gate', flagText: '硬门·无跳过', note: '本屏<b>没有跳过按钮</b>，只有一个主行动（开始/继续下载）与「换语种」这种非跳出型操作。', html: S2_START },
  { g: 'g2', code: 'S2-01', t: '资源包 · 下载中', note: '两包<b>各自独立</b>进度 + 一个总进度；网络方式由用户决定（Wi‑Fi / 蜂窝分段控件）。', html: S2_DL },
  { g: 'g2', code: 'S2-02', t: '资源包 · 蜂窝确认', note: '切到蜂窝时先问，带剩余体积与费用提示；「等 Wi‑Fi」是并列出口，不阻塞。', html: S2_CELL_SHEET },
  { g: 'g2', code: 'S2-03', t: '资源包 · 重试中', note: '断点续传：重试文案必须说明「已下载部分不重下」。', html: S2_RETRY },
  { g: 'g2', code: 'S2-04', t: '资源包 · 部分成功', note: '朗读成功 / 识别失败。重试<b>只针对失败的那个包</b>，成功包不重下。', html: S2_PARTIAL },
  { g: 'g2', code: 'S2-05', t: '资源包 · 失败 · 离线', note: '两个包都标「等待网络」而不是红色失败：没有网络不是用户的错。', html: S2_OFFLINE },
  { g: 'g2', code: 'S2-06', t: '资源包 · 失败 · 蜂窝被阻止', note: '低数据模式 / 蜂窝关闭。给出可用出口：用 Wi‑Fi 继续。', html: S2_CELL_BLOCK },
  { g: 'g2', code: 'S2-07', t: '资源包 · 失败 · 空间不足', note: '三个数字（需要 / 可用 / 建议清理）都是<b>占位</b>；主按钮是「重新检测」而不是「忽略」。', html: S2_SPACE },
  { g: 'g2', code: 'S2-08', t: '资源包 · 系统不支持识别', flag: 'gate', flagText: '降级', note: '归因到系统语言包，我们无法补。主按钮是<b>只装朗读包，继续</b>——这是唯一允许绕过屏 2 的情形。', html: S2_UNSUPPORTED },
  { g: 'g2', code: 'S2-09', t: '资源包 · 降级完成', note: '说清两件事：<b>哪几件暂时用不了</b>、<b>怎么补</b>（一步系统操作）。之后进首页的未就绪形态。', html: S2_DEGRADED },
  { g: 'g2', code: 'S2-10', t: '资源包 · 选择识别语种', note: '支持状态读系统能力，不写死清单；「云端识别需自带 Key」与免费额度路径区分开。', html: S2_LANG },
  { g: 'g2', code: 'S2-11', t: '资源包 · 全部完成', note: '完成的判据在此屏落定：引擎 + 识别包 + 朗读包。扩展<b>明确写成不在判据内</b>。', html: S2_DONE },

  { g: 'g3', code: 'S3-00', t: '引导 · 欢迎', flag: 'skip', flagText: '可跳过', note: '屏 3 全程右上角常驻「跳过引导」，跳过<b>不落阻塞态</b>。', html: S3_HELLO },
  { g: 'g3', code: 'S3-01', t: '引导 · 试一句', note: '复用既有引导第二步：一句真实语料 + 朗读试听。', html: S3_TRY },
  { g: 'g3', code: 'S3-02', t: '引导 · 打开 Safari 扩展', note: '扩展属于屏 3 的引导，<b>不是就绪判据</b>；文案明说「不开也能用」。', html: S3_EXT },
  { g: 'g3', code: 'S3-03', t: '引导 · 跳过后的落点', note: '跳过后直接进首页，并给一句「随时能重看」，不弹确认弹窗。', html: S3_SKIPPED },

  { g: 'g4', code: 'H-01', t: '首页 · 就绪', note: '就绪形态：全部能力按判据亮起，主行动是「开始复习」。', html: H_READY },
  { g: 'g4', code: 'H-02', t: '首页 · 未就绪', note: '未就绪形态<b>不空转</b>：可用功能照常可用，缺的那件给原因与去处。', html: H_NOT_READY },
  { g: 'g4', code: 'H-03', t: '老用户 · 补齐屏', note: '已登录 + 缺包 ⇒ 只有这一屏，<b>不重走三段</b>，也不重新登录。', html: S4_TOPUP },
  { g: 'g4', code: 'H-04', t: '老用户 · 直进首页（无屏）', html: S4_PASSTHROUGH, wide: true },

  { g: 'g5', code: 'B-01', t: '端到端路径表', html: W_FLOW, wide: true },
  { g: 'g5', code: 'B-02', t: '就绪判据表', html: W_READINESS, wide: true },
  { g: 'g5', code: 'B-03', t: '失败与边界矩阵', html: W_MATRIX, wide: true },
  { g: 'g5', code: 'B-04', t: '旧首屏对照（红线证据）', html: W_OLD, wide: true },
  { g: 'g5', code: 'B-05', t: '12 语种文案占位表', html: W_I18N, wide: true }
];

const GROUPS = [
  { id: 'g1', n: '屏 1 · 登录', d: '硬门：这一屏只有登录。所有失败与降级都发生在屏内，不外跳。' },
  { id: 'g2', n: '屏 2 · 资源包', d: '硬门：识别语言包 + 高质量朗读包。独立进度、总进度、失败重试、降级路径。' },
  { id: 'g3', n: '屏 3 · 引导', d: '软门：复用现有引导，可跳过，跳过不阻塞。Safari 扩展在这里，不是就绪条件。' },
  { id: 'g4', n: '就绪与首页', d: '就绪判据怎么决定「进门 / 补齐」，以及首页的两种形态、老用户的直进路径。' },
  { id: 'g5', n: '边界与失败', d: '端到端路径、就绪判据表、失败矩阵、作为红线证据的旧首屏对照、文案占位表。' }
];
