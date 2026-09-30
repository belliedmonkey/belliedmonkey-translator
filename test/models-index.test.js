// test/models-index.test.js — `models/` 是**候选模型台账**：它不进构建、不被运行时读，
// 所以没有任何东西会因为「一条候选烂在那儿」而变红 —— 除了这份门禁。
//
// 坏掉的三种形状（都是安静的）：
//   · 加了一条候选却忘了加进 README 的索引 ⇒ 半年后没人知道它在
//   · 索引里链到一个被删/改名的文件 ⇒ 点开是 404
//   · 「结论」那一行没写状态、或状态与索引表里那格对不上 ⇒ 台账与索引各说各话
//
// 字段清单固定下来的理由与门禁无关、与**晋升**有关：升到 `build/*.config.js` 那天要能逐字搬。
const { describe, test, ok } = require('./harness');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'models');
const INDEX = path.join(DIR, 'README.md');
const REQUIRED = ['来源', '任务', '许可', '形态', '跑在哪', '服务的面', '实测', '结论', '治理'];
const STATUSES = ['candidate', 'spike', 'watch', 'adopted', 'parked', 'rejected'];

const index = fs.readFileSync(INDEX, 'utf8');
const entries = fs.readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();

// 「**字段**：值」——值不能是空的（也别只写一个「-」糊过去）
function field(text, label) {
  const m = text.match(new RegExp(`\\*\\*${label}\\*\\*\\s*[:：]\\s*([^\\n]*)`));
  const v = m ? m[1].trim() : '';
  return v.length > 1 && v !== '—' && v !== '-' ? v : null;
}

describe('models/ —— 候选模型台账', () => {
  test('至少有一条候选，且每条都被 README 的索引链到', () => {
    ok(entries.length > 0, 'models/ 下除了 README.md 一条候选都没有');
    for (const f of entries) {
      ok(index.includes(`](${f})`) || index.includes(`](./${f})`), `models/README.md 的索引里没有 ${f}`);
    }
  });

  test('索引里的每个本地 .md 链接都指得到文件', () => {
    const links = [...index.matchAll(/\]\((?:\.\/)?([^)#:]+\.md)\)/g)].map((m) => m[1]);
    ok(links.length > 0, 'models/README.md 的索引一个链接都没有');
    for (const l of links) {
      ok(fs.existsSync(path.join(DIR, l)), `索引里的 ${l} 不存在（删了文件要同时改索引）`);
    }
  });

  test('每条候选的必备字段都非空', () => {
    for (const f of entries) {
      const text = fs.readFileSync(path.join(DIR, f), 'utf8');
      for (const label of REQUIRED) {
        ok(field(text, label), `${f} 的「${label}」缺失或为空 —— 字段是给「晋升那天逐字搬进 config」用的`);
      }
    }
  });

  test('「结论」以状态开头，且与索引表里那一格一致', () => {
    for (const f of entries) {
      const text = fs.readFileSync(path.join(DIR, f), 'utf8');
      const status = (field(text, '结论').match(/^\*{0,2}`([a-z]+)`\*{0,2}/) || [])[1];
      ok(status, `${f} 的「结论」没有以 ${STATUSES.map((s) => '`' + s + '`').join(' / ')} 之一开头`);
      ok(STATUSES.includes(status), `${f} 的状态 \`${status}\` 不在图例里（models/README.md 的状态图例是唯一出处）`);
      const row = index.split('\n').find((l) => l.includes(`](${f})`) || l.includes(`](./${f})`)) || '';
      ok(row.includes('`' + status + '`'), `models/README.md 索引里 ${f} 那一行的状态不是 \`${status}\`（台账与索引各说各话）`);
    }
  });
});
