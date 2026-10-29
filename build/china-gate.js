// build/china-gate.js — 中国版合规门的判据（纯函数，build.js 的 complianceGateChina 调它）。
//
// 抽出来的理由只有一个：2026-09-22 额度那一条要从「不许有」改成「只许是境内那一个」，
// 而一条门禁在改写的那一刻最容易变成红不了的门禁（memory: gate-must-be-falsified-first）。
// 纯函数才能在单测里喂它「该红」的输入 —— test/china-gate.test.js。
//
// 三类禁令：
//
// ① 品牌与境外端点（从第一天就有）。`anthropic-version`（通用 Messages 格式的协议头）
//    **不算** —— 它不是品牌指代。见 docs/domain-design.md。
//
// ② 遥测 / 额度路径按**主机**判，不按路径字面量一刀切（BEL-135，2026-10-29，ACCEPT-E）：
//    · bt-ingest —— 中国版发与国际版同一份白名单，但只许打境内 ingestHost
//      （MT_BACKEND.china.url，现网 api.belliedmonkey.com）。*.supabase.co 以及任何
//      别的主机上的 bt-ingest 仍红。ingestHost 为空 ⇒ 出现即红（境内入口还没就绪）。
//    · /functions/v1/bt-grant 与 bt-relay/(chat|audio) —— *.supabase.co（东京生产）仍禁。
//      境内 grantHost 上的地址交给下面的额度规格判据；grantHost 为空时这两条路径出现即红。
//    这一组是**证伪出来的**：2026-09-08 把 grant.enabled 试着翻成 true，中国版产物里一度
//    真的出现了完整的 MT_GRANT 与三条中继条目 —— flipSyncFlag 撞上嵌套的 enabled 中途退出，
//    产物停在了没被覆盖的全球版上。路径级「见 bt-ingest 就红」会把将来指境内主机的行也判死，
//    所以 ingest 改成主机维，东京 grant/relay 不放。
//
// ③ 额度规格 `MT_GRANT = {…}`（2026-09-22 改写）：
//    · grantHost 为空（grant.china 未就绪）→ 出现即违规，与改写前逐字等价；
//    · grantHost 有值 → 那一行必须能解析，且里面**每一个** URL 的主机都是 grantHost。
//    判据写成**发射形式**而不是裸词 `MT_GRANT`：backend.config.js 的注释会提到它，而注释
//    不是能力；`= null` 那一行必须放行，否则「恒为 null」本身就没法表达。
//    另外，注册表里 grantOnly 的条目（providers.gen.js 的 "grantOnly":true）的端点也必须在
//    grantHost 上 —— 那是原文真正发出去的地址，MT_GRANT 里只有领取地址。

const BRANDS = /ChatGPT|OpenAI|\bClaude\b|api\.openai\.com|api\.anthropic\.com/i;
// 历史导出名。判据已是主机维（*.supabase.co），不再是「路径里出现 bt-ingest 即红」。
const TOKYO = /(^|\.)supabase\.co$/i;
const GRANT_SPEC = /MT_GRANT = (\{.*\});?\s*$/;
const URL_RE = /https?:\/\/[^\s"'`)\\]+/g;

function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch (_) { return ''; } }

// 一行里的 ingest / grant / relay URL 有没有打到不该去的主机。
// 返回 true ⇒ 这行违规。没有这三类 URL ⇒ false（交给品牌词与额度规格）。
function foreignBackend(line, grantHost, ingestHost) {
  const urls = line.match(URL_RE) || [];
  for (const raw of urls) {
    let u;
    try { u = new URL(raw); } catch (_) { continue; }
    const path = u.pathname || '';
    const ingest = /\/bt-ingest\b/i.test(path);
    const grant = /\/functions\/v1\/bt-grant\b/i.test(path);
    const relay = /bt-relay\/(chat|audio)/i.test(path);
    if (!ingest && !grant && !relay) continue;
    const h = u.hostname.toLowerCase();
    if (TOKYO.test(h)) return true;
    if (ingest) {
      if (u.protocol !== 'https:' || !ingestHost || h !== ingestHost) return true;
    } else if (!grantHost || h !== grantHost) {
      return true;
    }
  }
  return false;
}

// 一行里所有 URL 的主机是否都是 host。一个 URL 都没有 ⇒ 不成立（空规格不算合法）。
function allOn(text, host) {
  const urls = text.match(URL_RE) || [];
  return urls.length > 0 && urls.every((u) => hostOf(u) === host);
}

// scan([{ name, text }], { grantHost }) → ['file:line  片段', …]
function scan(files, opts) {
  const host = String((opts && opts.grantHost) || '').toLowerCase();
  const ingestHost = String((opts && opts.ingestHost) || '').toLowerCase();
  const hits = [];
  for (const f of files || []) {
    String(f.text || '').split('\n').forEach((line, i) => {
      const at = `${f.name}:${i + 1}  ${line.trim().slice(0, 100)}`;
      if (BRANDS.test(line) || foreignBackend(line, host, ingestHost)) { hits.push(at); return; }
      const m = line.match(GRANT_SPEC);
      if (m) {
        if (!host) { hits.push(at + '   ← grant.china 未就绪，中国版不该有额度规格'); return; }
        let spec = null; try { spec = JSON.parse(m[1]); } catch (_) {}
        if (!spec || !allOn(JSON.stringify(spec), host)) hits.push(at + '   ← 额度规格里有不在 ' + host + ' 上的地址');
        return;
      }
      if (/MT_GRANT = (?!null)/.test(line)) { hits.push(at + '   ← 认不出的额度规格形状'); return; }
      // 注册表里的额度条目：原文真正发去的地址。
      if (/"grantOnly":true/.test(line)) {
        const re = /\{[^{}]*"grantOnly":true[^{}]*\}/g;
        let e;
        while ((e = re.exec(line))) {
          if (!host || !allOn(e[0], host)) { hits.push(`${f.name}:${i + 1}  ${e[0].slice(0, 100)}   ← 额度条目的端点不在境内中继上`); }
        }
      }
    });
  }
  return hits;
}

module.exports = { scan, BRANDS, TOKYO, foreignBackend };
