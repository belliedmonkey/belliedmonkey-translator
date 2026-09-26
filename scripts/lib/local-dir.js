// scripts/lib/local-dir.js —— 主仓库的 .local/（在 git worktree 里跑也指向主树那一份）。
//
// 为什么：同一个仓库常有别的会话在跑，改动一律在独立 worktree 里做（git worktree add …）。而 .local/ 是
// gitignored 的，每棵 worktree 各有一份空的 —— 在 worktree 里跑的快照脚本会把**当天唯一的一份**读数写进
// 临时目录，删树就没了，而且不报错。2026-09-25 第一次撞上（aso-rank 的候选词基线写进了临时树）。
// 只给「写历史快照」的脚本用：丢了补不回来的是它们。读密钥的脚本缺文件会明着报错，不在此列。
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

function mainLocalDir(root) {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return path.join(path.dirname(path.resolve(root, common)), '.local');
  } catch (_) {
    return path.join(root, '.local');
  }
}
module.exports = { mainLocalDir };
