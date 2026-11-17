// pages/popup-perm.js — BEL-290：popup 的 perm_denied 判据。
//
// 只有一个场景要发：内容脚本没回应（sendToPage → null），而**站点访问权限确实被
// 拒了**。三条件同时成立才发，缺一条都不发：
//   ① 当前 tab 是 http(s) 页面（chrome:// / file:// 没有站点权限可谈）；
//   ② chrome.permissions.contains({origins:[origin+'/*']}) 明确返回 false
//      —— true 表示有权限，那次失败不是权限问题；拿不到明确 false 不猜；
//   ③ API 不存在 / 抛错 ⇒ 不发（fail-closed）。权限 API 自己坏了的那一刻，
//      最不该做的事就是发一条「用户拒绝了权限」。
//
// 纯判据，不直接发事件：发送点留在 popup.jsx（SEAMS 只认那一处），这样这个函数
// 可以在 node 里用假 chrome 走真实分支。
export function httpOrigin(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin && u.origin !== 'null' ? u.origin : '';
  } catch (_) { return ''; }
}

export async function shouldNotePermDenied(deps) {
  try {
    const tabs = deps && deps.tabs;
    if (!tabs || typeof tabs.query !== 'function') return false;
    const list = await tabs.query({ active: true, currentWindow: true });
    const tab = Array.isArray(list) ? list[0] : null;
    const origin = httpOrigin(tab && tab.url);
    if (!origin) return false;
    const perms = deps && deps.permissions;
    if (!perms || typeof perms.contains !== 'function') return false;
    const has = await perms.contains({ origins: [origin + '/*'] });
    return has === false;
  } catch (_) {
    return false;
  }
}
