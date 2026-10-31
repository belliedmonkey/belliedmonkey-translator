// shared/grant-view.jsx — 免费额度卡的渲染半边（PR7b 起）。
//
// 纯逻辑（cardFor / officialCard / status / plan…）在 src/shared/grant.js；本文件
// 是旧 render() 的后继，保持**命令式**而不是改写为 JSX —— 卡面是一个由宿主状态
// （status / balance / busy / onAction）驱动的**重画型**视图：宿主每次拿到新余额、
// 换登录态就整卡重画一次（旧 render 的 box.textContent='' 全量重画语义）。React
// 重渲染对「命令式 append 进来的子树」没有保真承诺（extras 注入、进度条 style
//.width 都是直改 DOM），所以容器内部归 render 所有，React 永不进去 —— 与
// engine-fields-view.jsx / quick-setup-view.jsx 同一条命令式契约。

import { cardFor, officialCard } from './grant.js';

// render(box, opts) —— 只画，不碰存储、不发请求。动作由 host 接。
//   opts: { t, status, balance, onAction(id), busy }
//
// named export：三个宿主（options / onboard / App settings-view）的额度卡挂载点是
// 命令式孤岛（§10.9），依赖这个 render 的两条旧语义：空壳时写 `box.hidden = true`
// 并 return null（宿主随后读 `box.hidden` 回读），返回 card 供宿主拼摘要行 —— 所以
// 宿主保孤岛、named import 这里的 render，调用点逐字保留。
export function render(box, opts) {
  if (!box) return null;
  const o = opts || {};
  const t = o.t || ((k, d) => d);
  const doc = box.ownerDocument;
  // 两张卡共用这一个位置：有我们的额度时画额度卡，中国版画官方额度那张。
  // 二者互斥（officialCard 在 enabled() 时返回 null），所以不会同时出现。
  const card = cardFor(o.status, o) || officialCard(o);
  box.textContent = '';
  if (!card) { box.hidden = true; return null; }
  box.hidden = false;
  injectGrantStyle(doc);

  const el = (tag, cls, txt) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  const wrap = el('div', 'gr-wrap');
  wrap.append(el('h3', 'gr-title', card.title));
  wrap.append(el('p', 'gr-body', card.body));

  if (card.progress) {
    const bar = el('div', 'gr-bar');
    const fill = el('div', 'gr-fill');
    const pct = card.progress.limit > 0
      ? Math.max(0, Math.min(100, (card.progress.left / card.progress.limit) * 100)) : 0;
    fill.style.width = pct + '%';
    bar.append(fill);
    wrap.append(bar);
    wrap.append(el('p', 'gr-num', card.progress.text));
  }

  if (card.action) {
    // secondary：并排还有别的填色按钮时降级。两个填色按钮并排等于没有主按钮 ——
    // 用户要先做一次「该点哪个」的判断，而这两张卡的意义就是省掉判断。
    const b = el('button', 'gr-action' + (o.secondary ? ' secondary' : ''),
      o.busy ? t('grant_claiming', '领取中…') : card.action.text);
    b.type = 'button';
    b.disabled = !!o.busy;
    // IO 在途时禁按（画布状态 S2）。不禁的话双击就是两次领取请求 —— 服务端幂等
    // 挡得住，但界面会闪两次，而用户读到的是「我是不是点坏了」。
    b.addEventListener('click', () => { if (o.onAction) o.onAction(card.action.id); });
    wrap.append(b);
  }

  if (card.steps && card.steps.length) {
    const ol = el('ol', 'gr-steps');
    for (const st of card.steps) ol.append(el('li', null, st));
    wrap.append(ol);
  }

  if (card.links.length) {
    const row = el('div', 'gr-links');
    for (const l of card.links) {
      const a = el('a', 'gr-link', l.text);
      // 带 href 的链接**就让它是链接**（中国版那张卡去的是外部控制台）：真链接可以
      // 长按复制、可以在新标签打开，而一个 href="#" 加 onclick 的假链接三样都做不到。
      if (l.href) { a.href = l.href; a.target = '_blank'; a.rel = 'noopener'; }
      else {
        a.href = '#';
        a.addEventListener('click', (e) => { e.preventDefault(); if (o.onAction) o.onAction(l.id); });
      }
      row.append(a);
    }
    wrap.append(row);
  }
  if (card.note) wrap.append(el('p', 'gr-note', card.note));
  box.append(wrap);
  return card;
}

let grantStyled = false;
const GRANT_STYLE = `
  .gr-wrap { display:flex; flex-direction:column; gap:8px; }
  .gr-title { margin:0; font-size:1em; }
  /* 次要文字走 --text-secondary，不走 opacity：透明度把 4.5:1 压成 3.4:1，
     而三个宿主的样式表里没有一张管它（2026-09-06 深浅色核查的结论）。 */
  .gr-body { margin:0; font-size:.9em; color:var(--text-secondary, inherit); }
  .gr-note { margin:0; font-size:.85em; color:var(--text-secondary, inherit); }
  .gr-num { margin:0; font-size:.85em; color:var(--text-secondary, inherit); }
  .gr-bar { height:6px; border-radius:3px; background:var(--border, #ddd); overflow:hidden; }
  .gr-fill { height:100%; background:var(--accent, #6b8f71); }
  .gr-links { display:flex; gap:12px; flex-wrap:wrap; }
  .gr-steps { margin:0; padding-left:1.2em; font-size:.9em; color:var(--text-secondary, inherit); }
  .gr-steps li { margin:2px 0; }
  /* 链接必须自带颜色：这三个宿主原来没有一张样式表给 <a> 上色，
     浏览器默认蓝在深色底上是 1.9:1（2026-09-06 报障）。 */
  .gr-link { font-size:.85em; color:var(--link, inherit); text-decoration:underline; cursor:pointer; }
  .gr-action { align-self:flex-start; }
`;
function injectGrantStyle(doc) {
  if (grantStyled || !doc || !doc.head) return;
  const el = doc.createElement('style'); el.textContent = GRANT_STYLE; doc.head.appendChild(el);
  grantStyled = true;
}
