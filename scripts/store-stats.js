#!/usr/bin/env node
// scripts/store-stats.js — 六个发布面的「有多少人在用」，一条命令读回来。
//
// 2026-08-28：查 Supabase 里那 40 个账号时才发现，**装机量这件事我们一直没看过**，
// 而其中两个面根本不需要新建任何东西：
//
//   · GitHub Release —— 每个 asset 自带 download_count，`gh` 的 token 已经在钥匙串里
//   · Firefox AMO   —— average_daily_users / weekly_downloads / ratings 就在
//                       amo-publish.js 早就在请求的那个 JSON 里，以前被丢掉了
//
// 2026-09-04 补上 Apple 与「趋势」，因为前一版有两个洞，而第二个洞更贵：
//
//   ① **Apple 不在里面，而它占 85%**。实测 30 天 202 次下载里 Apple 占 202
//      （AMO 约 26/月、GitHub 累计才 55）—— 一张不含最大那一面的报表会把人引向
//      完全错误的结论（当时正准备去优化 Firefox）。现在走 lib/asc-client.js。
//   ② **没有快照就没有趋势**。这一条是本脚本存在的理由：
//
//        Apple salesReports        按天切片，天然可回溯
//        AMO average_daily_users   **只有当前值**
//        GitHub download_count     **只有累计值**
//        Chrome Web Store          无 API
//
//      也就是说 AMO 的日活和 GitHub 的下载数，**你今天不存下来，明天就再也问不到
//      昨天是多少**。所以每次跑都写一份 .local/stats/<日期>.json，并与上一份对比。
//
// 这个脚本只读、不改任何东西，也**不新增任何采集**：读的是商店给运营者的数据，
// 不是用户给我们的数据（AGENTS.md 规则 4 禁的是后者）。
//
// 两个读不到的面，明说 + 支持手工回填，而不是留空：
//   · Chrome Web Store —— 开发者 API 不给用户数/曝光/转化（#176），公开商店页也抓不到
//                          （curl 实测返回 0 字节）。**但数在另一个地方**：Google 会给每个
//                          CWS 商品自动建一个 GA4 属性（账号「Chrome Web Store developer
//                          properties」，属性名就是扩展 id），里面的 `install` 事件就是
//                          安装数，`page_view` 是商品页访客。2026-09-04 首次读到：
//                          28 天 21 访客 / 3 次安装（转化 14.3%），平均停留 2 秒。
//                          ⚠️ 那个属性顶部常驻一条「Report filtering is turned on」，
//                          所以它是**下限**，不是精确值。仍然只能人工读，故走手工回填。
//   · Supabase 漏斗   —— service key **刻意不落盘**，这条策略不动。
//
//   手工填在 .local/stats/manual.json（见下 manual() 的注释）。**手填的数在输出里
//   一律带 [手工 · 日期]** —— 分不清哪个是回读、哪个是人记的，整张表就都不可信了。
//
// 用法: node scripts/store-stats.js [--json] [--days N]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ASC = require('./lib/asc-client');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const SNAPDIR = path.join(ROOT, '.local', 'stats');   // .local/ 已在 .gitignore:35

// 与 amo-publish.js 同款槽位读取：`[^\S\n]*` 而不是 `\s*`，空槽位不许跨行吃下一个字段名。
function slot(name) {
  if (!fs.existsSync(KEYS)) return null;
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
}

async function github() {
  // gh 的 token 在 macOS 钥匙串里，这里不碰凭证本身。
  let raw;
  try {
    raw = execFileSync('gh', ['api', 'repos/:owner/:repo/releases', '--paginate',
      '--jq', '.[] | {tag: .tag_name, at: .published_at, dl: ([.assets[].download_count] | add // 0)}'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return { ok: false, why: 'gh 不可用或未登录：' + String(e.stderr || e.message).split('\n')[0] };
  }
  const rows = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { ok: true, releases: rows.length, total: rows.reduce((a, r) => a + r.dl, 0), rows };
}

async function amo() {
  const id = slot('amo_addon_id');
  if (!id) return { ok: false, why: '.local/keys.md 缺 amo_addon_id' };
  // 这个端点是公开的 —— 读装机量不需要 JWT。
  const r = await fetch(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(id)}/`);
  if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
  const d = await r.json();
  return {
    ok: true, id, status: d.status,
    version: (d.current_version || {}).version || null,
    dau: d.average_daily_users ?? null,
    weekly: d.weekly_downloads ?? null,
    ratings: d.ratings || {},
  };
}

// Apple。下载量走 salesReports（按天、自带国家与设备），评分走 customerReviews。
// 两条都在 lib 里，与 `asc.js installs` / `asc.js reviews` 是同一份实现 ——
// 两张报表给出两个总数是最坏的情况，因为没人知道该信哪个。
async function apple(days) {
  // 只认我们自己的两个 app 记录。同一个开发者账号下还挂着别的 app，
  // 不滤掉的话它会混进「评分」那一行 —— 而且一旦它有下载，总数就是错的。
  const OURS = /^com\.belliedmonkeytranslator(\.|$)/;
  let names;
  try {
    names = {};
    for (const a of await ASC.apps()) if (OURS.test(a.bundleId)) names[a.id] = a.name;
  } catch (e) {
    return { ok: false, why: String(e.message || e) };
  }
  if (!Object.keys(names).length) return { ok: false, why: '没有匹配 ' + OURS + ' 的 app 记录' };
  let sales;
  try {
    sales = await ASC.salesRows(days);
  } catch (e) {
    return { ok: false, why: String(e.message || e) };
  }
  const mine = sales.rows.filter((r) => names[r['Apple Identifier']]);
  const agg = ASC.aggregateSales(mine, names);

  // 评分。产品没有遥测，商店评论是极少数能听见真实用户的渠道之一 —— 而三个面
  // 至今都是 0 条，这本身就是一条要盯的指标。
  const ratings = {};
  for (const [id, name] of Object.entries(names)) {
    try {
      const d = await ASC.api('GET', `/apps/${id}/customerReviews?limit=200&fields[customerReviews]=rating`);
      const rows = (d && d.data) || [];
      ratings[name] = {
        count: rows.length,
        avg: rows.length ? rows.reduce((a, r) => a + (r.attributes.rating || 0), 0) / rows.length : null,
      };
    } catch (_) { ratings[name] = { count: null, avg: null }; }
  }

  const terr = {};
  for (const [cc, m] of agg.terr) terr[cc] = [...m.values()].reduce((a, b) => a + b, 0);
  const byApp = Object.fromEntries(agg.byApp);
  const byDev = {};      // 跨 app 按设备相加 —— 分 app 的明细在 `asc.js installs` 里
  for (const [k, v] of agg.byDev) { const dev = ASC.cut(k)[1]; byDev[dev] = (byDev[dev] || 0) + v; }

  return { ok: true, days, total: agg.total, from: sales.from, to: sales.to,
    live: sales.live, quiet: sales.quiet, byApp, byDev, terr, ratings };
}

// 手工回填。两个面读不到（CWS 无 API、Supabase 的 service key 刻意不落盘），
// 但「读不到」不该让整张报表停摆 —— 也不该让这两行永远空着假装不存在。
//
// .local/stats/manual.json 形如：
//   {
//     "cws":      { "at": "2026-09-04", "installs_28d": 3, "visitors_28d": 21,
//                    "note": "GA4 · Chrome Web Store developer properties" },
//     "supabase": { "at": "2026-09-04", "accounts": 67, "with_data": 12, "chunks": 22 }
//   }
//
// `at` 是**读到这个数的那天**，不是写文件的那天 —— 输出里原样打出来，
// 好让人一眼看出它有多旧。
function manual() {
  const f = path.join(SNAPDIR, 'manual.json');
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {
    return { _err: `manual.json 解析失败：${e.message}` };
  }
}

// ─── locale 缺口 ────────────────────────────────────────────────────────────
//
// 把「按国家的下载量」对上「我们有没有这个语言的界面 / 商店文案」。
// 没有这一格，这个脚本就只是一堆好看的数字 —— 它是数据与动作之间的那道接缝。
//
// 促成它的实测（2026-09-04）：IT 是下载量第 3 名（18 次，8.9%），而
// `extension/_locales/` 里没有 it，`store-assets/aso.md` 里也没有 it 段。
// 加上 TR 9 / VN 6 / PL 4，合计 37 次 = 国际版的 21.5%。而 manifest 的
// `default_locale` 是 zh_CN —— chrome.i18n 对没有对应目录的用户回落到它，
// **也就是说一个意大利用户装完，界面是中文的**。
//
// ⚠️ **国家不等于语言**，这张表是启发式不是事实：CH 说德/法/意、US 有大量西语用户、
// IN 更是几十种。所以只列语言明确且量足够的那些，其余一律归到「其它」不猜。
const COUNTRY_LANG = {
  US: { ui: 'en', aso: 'en-US' }, GB: { ui: 'en', aso: 'en-US' }, AU: { ui: 'en', aso: 'en-US' },
  CA: { ui: 'en', aso: 'en-US' }, IE: { ui: 'en', aso: 'en-US' }, NZ: { ui: 'en', aso: 'en-US' },
  CN: { ui: 'zh_CN', aso: 'zh-Hans' }, TW: { ui: 'zh_TW', aso: 'zh-Hant' },
  HK: { ui: 'zh_TW', aso: 'zh-Hant' }, MO: { ui: 'zh_TW', aso: 'zh-Hant' },
  JP: { ui: 'ja', aso: 'ja' }, KR: { ui: 'ko', aso: 'ko' },
  DE: { ui: 'de', aso: 'de-DE' }, AT: { ui: 'de', aso: 'de-DE' },
  FR: { ui: 'fr', aso: 'fr-FR' }, BE: { ui: 'fr', aso: 'fr-FR' },
  ES: { ui: 'es', aso: 'es-ES' }, MX: { ui: 'es', aso: 'es-ES' }, AR: { ui: 'es', aso: 'es-ES' },
  CL: { ui: 'es', aso: 'es-ES' }, CO: { ui: 'es', aso: 'es-ES' }, PE: { ui: 'es', aso: 'es-ES' },
  BR: { ui: 'pt_BR', aso: 'pt-BR' }, PT: { ui: 'pt_BR', aso: 'pt-BR' },
  RU: { ui: 'ru', aso: 'ru' }, BY: { ui: 'ru', aso: 'ru' }, KZ: { ui: 'ru', aso: 'ru' },
  SA: { ui: 'ar', aso: 'ar-SA' }, AE: { ui: 'ar', aso: 'ar-SA' }, EG: { ui: 'ar', aso: 'ar-SA' },
  KW: { ui: 'ar', aso: 'ar-SA' }, QA: { ui: 'ar', aso: 'ar-SA' }, IQ: { ui: 'ar', aso: 'ar-SA' },
  // 下面这些目前一个都没有 —— 正是这张表要报出来的东西
  IT: { ui: 'it', aso: 'it' }, TR: { ui: 'tr', aso: 'tr' }, VN: { ui: 'vi', aso: 'vi' },
  PL: { ui: 'pl', aso: 'pl' }, NL: { ui: 'nl', aso: 'nl-NL' }, ID: { ui: 'id', aso: 'id' },
  TH: { ui: 'th', aso: 'th' }, UA: { ui: 'uk', aso: 'uk' }, RO: { ui: 'ro', aso: 'ro' },
  SE: { ui: 'sv', aso: 'sv' }, NO: { ui: 'no', aso: 'no' }, DK: { ui: 'da', aso: 'da' },
  FI: { ui: 'fi', aso: 'fi' }, CZ: { ui: 'cs', aso: 'cs' }, HU: { ui: 'hu', aso: 'hu' },
  EL: { ui: 'el', aso: 'el' }, IL: { ui: 'he', aso: 'he' }, MY: { ui: 'ms', aso: 'ms' },
  HR: { ui: 'hr', aso: 'hr' }, SK: { ui: 'sk', aso: 'sk' }, BG: { ui: 'bg', aso: 'bg' },
};

function localeGaps(terr) {
  const uiDir = path.join(ROOT, 'extension', '_locales');
  const haveUi = new Set(fs.existsSync(uiDir) ? fs.readdirSync(uiDir) : []);
  const md = fs.readFileSync(path.join(ROOT, 'store-assets', 'aso.md'), 'utf8');
  // 只认国际版 —— 中国版只有 zh-Hans，那是它的储区决定的，不是漏了。
  const haveAso = new Set([...md.matchAll(/^##\s+国际版\s*·\s*([A-Za-z-]+)\s*·/gm)].map((m) => m[1]));

  const rows = [];
  let unknown = 0;
  for (const [cc, n] of Object.entries(terr)) {
    const L = COUNTRY_LANG[cc];
    if (!L) { unknown += n; continue; }
    const ui = haveUi.has(L.ui);
    const aso = haveAso.has(L.aso);
    if (ui && aso) continue;
    rows.push({ cc, n, lang: L.ui, ui, aso });
  }
  rows.sort((a, b) => b.n - a.n);
  const total = Object.values(terr).reduce((a, b) => a + b, 0);
  return { rows, unknown, total, gapUnits: rows.reduce((a, r) => a + r.n, 0) };
}

// ─── 快照 ──────────────────────────────────────────────────────────────────
function lastSnapshot(todayFile) {
  if (!fs.existsSync(SNAPDIR)) return null;
  const files = fs.readdirSync(SNAPDIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f !== todayFile)
    .sort();
  if (!files.length) return null;
  try {
    return { at: files[files.length - 1].replace('.json', ''),
      data: JSON.parse(fs.readFileSync(path.join(SNAPDIR, files[files.length - 1]), 'utf8')) };
  } catch (_) { return null; }
}

// delta 的呈现规则：**没有上一份就不画箭头**，而不是画一个 ↑0。
// 「没得比」和「比过了没变」是两件不同的事，混在一起会让第一次跑看起来像已经稳定了。
function delta(now, then) {
  if (typeof now !== 'number' || typeof then !== 'number') return '';
  const d = now - then;
  if (d === 0) return '  ±0';
  return (d > 0 ? '  ↑' : '  ↓') + Math.abs(d);
}

(async () => {
  const argv = process.argv.slice(2);
  const di = argv.indexOf('--days');
  const days = di >= 0 ? Math.max(1, Math.min(365, parseInt(argv[di + 1], 10) || 30)) : 30;

  const [gh, mo, ap] = await Promise.all([github(), amo(), apple(days)]);
  const man = manual();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const snapFile = `${today}.json`;
  const prev = lastSnapshot(snapFile);
  const P = (prev && prev.data) || {};

  const snapshot = { at: new Date().toISOString(), days, github: gh, amo: mo, apple: ap, manual: man };

  // 先落盘再打印：报表是可以重跑的，而**今天的 AMO 日活错过了就永远拿不回来**。
  fs.mkdirSync(SNAPDIR, { recursive: true });
  fs.writeFileSync(path.join(SNAPDIR, snapFile), JSON.stringify(snapshot, null, 2));

  if (argv.includes('--json')) { console.log(JSON.stringify(snapshot, null, 2)); return; }

  console.log('\n各面使用数据 · ' + today
    + (prev ? `　（↑↓ 是与 ${prev.at} 那份快照的对比）` : '　（第一份快照，没有可比的历史）'));

  // ── Apple ──
  console.log('\nApple App Store');
  if (!ap.ok) { console.log('  ✗ ' + ap.why); } else {
    console.log(`  ${days} 天下载 ${ap.total}${delta(ap.total, P.apple && P.apple.total)}`
      + `　（${ap.from} → ${ap.to}；${ap.live} 天有量，${ap.quiet} 天安静）`);
    for (const [k, v] of Object.entries(ap.byApp).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(26)} ${String(v).padStart(4)}  ${(100 * v / ap.total).toFixed(0)}%`);
    }
    const dev = Object.entries(ap.byDev).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`);
    console.log('    设备  ' + dev.join(' · '));
    const rt = Object.entries(ap.ratings).map(([k, v]) => `${k} ${v.count === null ? '?' : v.count + ' 条'}`);
    console.log('    评分  ' + rt.join(' · '));
  }

  // ── Firefox AMO ──
  console.log('\nFirefox AMO');
  if (!mo.ok) { console.log('  ✗ ' + mo.why); } else {
    const rt = mo.ratings || {};
    const Pm = P.amo || {};
    console.log(`  ${mo.id}  状态 ${mo.status}  线上 ${mo.version}`);
    console.log(`  日活 ${mo.dau}${delta(mo.dau, Pm.dau)}`
      + `　周下载 ${mo.weekly}${delta(mo.weekly, Pm.weekly)}`
      + `　评分 ${rt.count ? `${rt.average} × ${rt.count} 条` : '暂无'}`);
  }

  // ── Chrome Web Store ──
  console.log('\nChrome Web Store');
  const Pc = (P.manual && P.manual.cws) || {};
  if (man.cws && typeof man.cws.installs_28d === 'number') {
    const c = man.cws;
    const conv = c.visitors_28d ? `　转化 ${(100 * c.installs_28d / c.visitors_28d).toFixed(1)}%` : '';
    console.log(`  28 天安装 ${c.installs_28d}${delta(c.installs_28d, Pc.installs_28d)}`
      + `　商品页访客 ${c.visitors_28d ?? '?'}${delta(c.visitors_28d, Pc.visitors_28d)}${conv}`
      + `　[手工 · ${c.at || '日期未填'}]`);
    if (c.note) console.log('    ' + c.note);
  } else {
    console.log('  — 开发者 API 不给这些数。去 GA4 读：账号「Chrome Web Store developer');
    console.log('    properties」→ 属性 = 扩展 id → Reports → Events，看 install 与 page_view。');
    console.log('    读到之后填进 .local/stats/manual.json 的 cws.installs_28d / visitors_28d。');
  }

  // ── GitHub ──
  console.log('\nGitHub Release（官网直装 ZIP 走的就是这条）');
  if (!gh.ok) { console.log('  ✗ ' + gh.why); } else {
    console.log(`  累计下载 ${gh.total}${delta(gh.total, P.github && P.github.total)}`
      + `，跨 ${gh.releases} 个 release`);
    for (const r of gh.rows.slice(0, 5)) {
      console.log(`    ${r.tag.padEnd(9)} ${r.at.slice(0, 10)}  ${String(r.dl).padStart(3)}`);
    }
    if (gh.rows.length > 5) console.log(`    …其余 ${gh.rows.length - 5} 个`);
  }

  // ── Supabase ──
  console.log('\nSupabase（同步账号 · 学习层）');
  if (man.supabase && typeof man.supabase.accounts === 'number') {
    const s = man.supabase;
    const Ps = (P.manual && P.manual.supabase) || {};
    console.log(`  账号 ${s.accounts}${delta(s.accounts, Ps.accounts)}`
      + `　有数据 ${s.with_data ?? '?'}　句子 ${s.chunks ?? '?'}`
      + `　[手工 · ${s.at || '日期未填'}]`);
  } else {
    console.log('  — service key 刻意不落盘，本脚本不查。走 bt-supabase MCP：');
    console.log("    select count(*) from auth.users where email not ilike 'belliedmonkey%';");
    console.log('    读到之后填进 .local/stats/manual.json 的 supabase。');
  }

  if (man._err) console.log('\n⚠️ ' + man._err);

  // ── locale 缺口 ──
  if (ap.ok) {
    const g = localeGaps(ap.terr);
    console.log('\n⚠️ 市场缺口（有下载量，但没有界面语言 / 没有商店文案）');
    if (!g.rows.length) {
      console.log('  （没有缺口）');
    } else {
      const MIN = 3;                       // 低于这个数的市场折成一行，别把主次抹平
      const head = g.rows.filter((r) => r.n >= MIN);
      const tail = g.rows.filter((r) => r.n < MIN);
      for (const r of head) {
        console.log(`  ${r.cc.padEnd(3)} ${String(r.n).padStart(4)} 次  ${r.lang.padEnd(6)}`
          + `UI ${r.ui ? '✓' : '✗'}　文案 ${r.aso ? '✓' : '✗'}`);
      }
      if (tail.length) {
        console.log(`  另有 ${tail.length} 个市场各 <${MIN} 次，共 ${tail.reduce((a, r) => a + r.n, 0)} 次：`
          + tail.map((r) => r.cc).join(' '));
      }
      console.log(`  合计 ${g.gapUnits} 次 = 全部下载的 ${(100 * g.gapUnits / g.total).toFixed(1)}%`);
      console.log('  ⚠️ 国家不等于语言，这是启发式；'
        + `另有 ${g.unknown} 次来自语言不明确的地区，没有计入。`);
    }
  }

  console.log(`\n快照已写入 .local/stats/${snapFile}\n`);
})();
