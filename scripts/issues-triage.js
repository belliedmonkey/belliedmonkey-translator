#!/usr/bin/env node
// scripts/issues-triage.js —— 别人提的 issue / PR，有没有人回。
//
// 用法：
//   npm run issues            # 列出来；有没人回的就 exit 1
//   npm run issues -- --all   # 连已关闭的一起列（看历史）
//   npm run issues -- --quiet # 只在有没人回的时候说话（给别的脚本串用）
//
// **为什么要有这个脚本。** 2026-09-09 发 1.9.0 的路上，产品方偶然发现 #149 ——
// 一个外部用户在 **22 天前**提的功能请求，而且他读过 AGENTS.md，按仓库自己的规约
// 先开了一个 docs-only 的领域设计 PR（#150）等人评审。**一条回复都没有。**
//
// 为什么会漏：这个仓库的 issue 几乎全是自己开给自己的待办（53 条里 52 条），于是
// 「看一眼 issue 列表」这个动作长期等于「看自己的待办」，别人的那一条混在里面，
// 长得和别的没两样。**眼睛不会自动把「别人写的」挑出来，得让机器挑。**
//
// 判据是「**我回过没有**」，不是「开着还是关着」，也不是「有没有评论」——
// 提问的人自己追加一条评论，issue 看起来就「有人在动」，而其实没有。
//
// 退出码：有外部条目没人回 ⇒ 1。这是刻意的：一句打印会被滚过去，一个非零退出码
// 不会（同 npm run perf:status 的先例）。
'use strict';

const { execFileSync } = require('child_process');

const ARGS = process.argv.slice(2);
const ALL = ARGS.includes('--all');
const QUIET = ARGS.includes('--quiet');

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString().trim().split('\n')[0];
    console.error(`gh 调不动：${msg}`);
    console.error('（这个脚本要 gh CLI 且已登录 —— gh auth status 看一眼）');
    process.exit(2);
  }
}

// 「谁是我」不写死：从仓库自己的 owner 取。fork 到别处也照样对。
function owner() {
  return JSON.parse(gh(['repo', 'view', '--json', 'owner'])).owner.login;
}

const days = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);

function fetchItems(kind, me) {
  const state = ALL ? 'all' : 'open';
  const fields = kind === 'issue'
    ? 'number,title,author,createdAt,state,comments,url'
    : 'number,title,author,createdAt,state,comments,url,isDraft,reviews';
  const raw = JSON.parse(gh([kind, 'list', '--state', state, '--limit', '200', '--json', fields]));
  return raw
    .filter((x) => (x.author?.login || '').toLowerCase() !== me.toLowerCase())
    .map((x) => {
      const mine = (x.comments || []).filter(
        (c) => (c.author?.login || '').toLowerCase() === me.toLowerCase());
      const reviewed = (x.reviews || []).some(
        (r) => (r.author?.login || '').toLowerCase() === me.toLowerCase());
      return {
        kind, n: x.number, title: x.title, who: x.author.login, url: x.url,
        state: x.state, draft: !!x.isDraft, age: days(x.createdAt),
        replies: mine.length, answered: mine.length > 0 || reviewed,
      };
    })
    .sort((a, b) => b.age - a.age);
}

const me = owner();
const items = [...fetchItems('issue', me), ...fetchItems('pr', me)];
const open = items.filter((x) => x.state === 'OPEN');
const unanswered = open.filter((x) => !x.answered);

if (QUIET && !unanswered.length) process.exit(0);

console.log(`\n外部提交巡检 · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
console.log(`仓库 ${me}  ·  ${ALL ? '含已关闭' : '只看开着的'}\n`);

if (!items.length) {
  console.log('  没有别人提的 issue 或 PR。');
  process.exit(0);
}

for (const x of items) {
  const tag = x.kind === 'pr' ? (x.draft ? 'PR草稿' : 'PR    ') : 'issue ';
  const mark = x.state !== 'OPEN' ? '·' : (x.answered ? '✓' : '✗');
  console.log(`  ${mark} ${tag} #${String(x.n).padEnd(4)} ${String(x.age).padStart(3)}天  `
    + `${x.who.padEnd(22)} ${x.answered ? `已回 ${x.replies} 条` : '**一条都没回**'}`);
  console.log(`      ${x.title.slice(0, 76)}`);
  console.log(`      ${x.url}`);
}

if (!unanswered.length) {
  console.log('\n✓ 别人提的都回过了。');
  process.exit(0);
}

console.log(`\n✗ 有 ${unanswered.length} 条别人提的**一条都没回**。`);
console.log('\n  这不是「待办积压」，是**有人在等**。按仓库规约走：');
console.log('  1. 先回一句 —— 哪怕是「看到了，在想」。22 天的沉默会把人劝退，');
console.log('     而这个仓库的外部提交本来就极少（53 条里只有 1 条）。');
console.log('  2. 动到领域设计的（新提供方 / 新传输 / 新数据面）按 AGENTS.md：');
console.log('     **先出文档 PR 过人评审，再写代码**。对方若已经这么开了，那条 PR');
console.log('     就是评审的入口 —— 需要产品方裁定收不收，不是技术上做不做得出来。');
console.log('  3. 裁定完把结果写进 .local/TODO.md，回读到结果才算完成。\n');
process.exit(1);
