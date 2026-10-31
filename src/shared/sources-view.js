// shared/sources-view.js — 来源管理的**纯逻辑**半边（PR7b 起，§9.4 单源翻转）。
//
// 分组规则从 extension/learn/sources-view.js 原样搬出：不碰 chrome.storage、
// 不读全局 document、不读注册表。LearnRules 是唯一的外部名字（裸全局，与旧文件
// 一致 —— 只有视图层的回调运行时才碰到它）。视图半边（render / renderLangChips
// / 样式）在 sources-view-view.jsx，两宿主经各自入口 import 同一路径。
//
// The view is dumb on purpose: it renders the grouped domain list + block-rule
// chips and reports intent through callbacks. Storage writes, confirms, deletes
// and re-renders belong to the HOST — this file never touches chrome.storage or
// IndexedDB directly (it is loaded in hosts whose storage shims differ).

// 对话来源（learning-design §9.6）：`conv://<sessionId>`，没有 host，按会话一行。
export function isConv(src) { return !!(src && typeof src.url === 'string' && src.url.startsWith('conv://')); }
// conv sources → [{sourceId, title, count, itemIds}] newest first (ids embed the start time).
// 实时字幕（§9.8）沿用 conv:// 来源、靠卡上的 anchor.mode 区分：wantMode 'subtitle' 只收字幕句，
// 缺省（对话）不收字幕句 —— 两类在来源页各成一组。
export function groupConversations(items, sources, wantMode) {
  const want = wantMode === 'subtitle' ? 'subtitle' : 'conv';
  const byId = new Map();
  for (const s of sources || []) if (isConv(s)) byId.set(s.id, { sourceId: s.id, title: s.title || s.id, count: 0, itemIds: [] });
  for (const it of items || []) {
    const g = it && it.sourceId ? byId.get(it.sourceId) : null;
    if (!g) continue;
    if (((it.anchor && it.anchor.mode === 'subtitle') ? 'subtitle' : 'conv') !== want) continue;
    g.count++; g.itemIds.push(it.id);
  }
  return Array.from(byId.values()).filter((g) => g.count > 0).sort((a, b) => (a.sourceId < b.sourceId ? 1 : -1));
}

// 文档来源（learning-design §9.7）：`doc://<docId>`，按文档一行；删卡连文档本体一起删（宿主做）。
export function isDoc(src) { return !!(src && typeof src.url === 'string' && src.url.startsWith('doc://')); }
export function groupDocuments(items, sources) {
  const byId = new Map();
  for (const s of sources || []) if (isDoc(s)) byId.set(s.id, { sourceId: s.id, title: s.title || s.id, count: 0, itemIds: [] });
  for (const it of items || []) { const g = it && it.sourceId ? byId.get(it.sourceId) : null; if (!g) continue; g.count++; g.itemIds.push(it.id); }
  return Array.from(byId.values()).filter((g) => g.count > 0).sort((a, b) => b.count - a.count);
}

// 交来的文字（learning-design §9.9）：`handoff://<入口>/<YYYY-MM>`，按入口 + 月份一行（卡上的锚点是 k:'handoff'）。
// 没有 host，所以必须从下面的按站点分组里排除 —— 否则 hostOf 会把入口名当成域名。
export function isHandoff(src) { return !!(src && typeof src.url === 'string' && src.url.startsWith('handoff://')); }
export function groupHandoff(items, sources) {
  const byId = new Map();
  for (const s of sources || []) if (isHandoff(s)) byId.set(s.id, { sourceId: s.id, title: s.title || s.id, count: 0, itemIds: [] });
  for (const it of items || []) { const g = it && it.sourceId ? byId.get(it.sourceId) : null; if (!g) continue; g.count++; g.itemIds.push(it.id); }
  // id 末尾是 YYYY-MM：新的月份在前；同月按入口名稳定排序
  return Array.from(byId.values()).filter((g) => g.count > 0).sort((a, b) => {
    const ma = a.sourceId.slice(-7), mb = b.sourceId.slice(-7);
    return ma === mb ? (a.sourceId < b.sourceId ? -1 : 1) : (ma < mb ? 1 : -1);
  });
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (_) { return ''; }
}

// items+sources → [{host, count, blocked, blockedBy, exactRule}] sorted by count.
export function groupByHost(items, sources, rules) {
  const srcHost = new Map();
  for (const s of sources || []) { if (s && s.id && !isConv(s) && !isDoc(s) && !isHandoff(s)) srcHost.set(s.id, hostOf(s.url)); }
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

// 与旧 module.exports 同形（render / renderLangChips 在视图层）。
export default { groupByHost, groupConversations, isDoc, groupDocuments, isHandoff, groupHandoff };
