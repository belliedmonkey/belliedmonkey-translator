// test/tracked-generated.test.js — 生成物与本机状态不许进版本库。
//
// `.gitignore` 只能挡住还没被跟踪的文件；一旦有人 `git add -f` 或者规则漏了一种后缀，
// 文件就会一直留在库里，`.gitignore` 再改也赶不走它。#397 就这样带进了五份
// `safari-project*.bak*` 备份（185 个文件），在 main 上躺了三周没人发现。
// 所以这里读 `git ls-files` 的结果，而不是只看规则写没写。
const { execFileSync } = require('child_process');
const path = require('path');
const { describe, test, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');

function tracked() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n');
  } catch (_) {
    return null; // 不在 git 工作树里（例如解开的源码包）：没有「已跟踪」可言
  }
}

describe('生成物与本机状态不在版本库里', () => {
  const files = tracked();
  test('没有任何 safari-project* 目录被跟踪（生成的 Xcode 工程与它的备份）', () => {
    if (!files) return;
    deepEq(files.filter((f) => /^safari-project[^/]*\//.test(f)).slice(0, 5), [],
      '有 safari-project* 下的文件被提交了 —— 它们由 build-safari.sh 生成，`git rm -r --cached` 掉');
  });
  test('没有 .reasonix/tasks/ 下的运行记录被跟踪', () => {
    if (!files) return;
    deepEq(files.filter((f) => f.startsWith('.reasonix/tasks/')).slice(0, 5), [],
      '.reasonix/tasks/ 是 Reasonix 的本机任务记录，不该进库');
  });
});
